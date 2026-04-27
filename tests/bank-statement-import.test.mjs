import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

function validExternalScheduleIso({ dayOffset = 1, hour = 11, minute = 0 } = {}, reference = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(formatter.formatToParts(reference).map((entry) => [entry.type, entry.value]));
  const localHour = Number(parts.hour);
  const normalizedDayOffset = dayOffset + (localHour >= 22 ? 1 : 0);
  const baseYear = Number(parts.year);
  const baseMonth = Number(parts.month);
  const baseDay = Number(parts.day) + normalizedDayOffset;
  return new Date(Date.UTC(baseYear, baseMonth - 1, baseDay, hour + 3, minute, 0, 0)).toISOString();
}

function formatCsvDate(value = new Date()) {
  return value.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function approxEqual(left, right, epsilon = 0.0001) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= epsilon;
}

test('dashboard sinaliza extrato pendente quando nada foi importado', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  t.after(async () => {
    await shutdown();
  });

  const summary = await request(apiUrl, '/dashboard/summary');
  const statementRail = summary.integrations.items.find((item) => item.id === 'bank_statement_import');

  assert.ok(statementRail, 'dashboard deve expor o rail de extrato bancario');
  assert.equal(statementRail.status, 'PENDING');
  assert.equal(summary.integrations.pendingCount >= 1, true);
  assert.equal(summary.business.statement.latestImport.status, 'PENDING');
});

test('importar extrato concilia PIX pendente e atualiza caixa real do dashboard', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const uniquePhone = `11${String(Date.now()).slice(-9)}`;
  const baselineSummary = await request(apiUrl, '/dashboard/summary?days=30');

  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Extrato PIX ${suffix}`,
      category: 'Teste',
      unit: 'un',
      price: 64,
      active: true
    }
  });

  const customer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: 'Julia Horta Nassif Toni',
      phone: uniquePhone,
      address: 'Rua Extrato, 10'
    }
  });

  const intake = await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      intent: 'CONFIRMED',
      customer: {
        customerId: customer.id
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt: validExternalScheduleIso()
      },
      order: {
        items: [{ productId: product.id, quantity: 1 }]
      },
      payment: {
        method: 'pix',
        status: 'PENDENTE'
      },
      source: {
        channel: 'CUSTOMER_LINK',
        externalId: `statement-import-${suffix}`
      }
    }
  });

  const csv = [
    'index,Data,Valor,Identificador,Descrição',
    `0,${formatCsvDate()},${Number(intake.order.total).toFixed(2)},txn-${suffix},Transferência recebida pelo Pix - Julia Horta Nassif Toni - •••.377.136-•• - ITAÚ UNIBANCO S.A. (0341) Agência: 9634 Conta: 4891-3`,
    `1,${formatCsvDate()},-12.45,uber-${suffix},Compra no débito - Uber UBER *TRIP HELP.U`,
    `2,${formatCsvDate()},4.20,uber-estorno-${suffix},Estorno - Compra no débito - Uber UBER *TRIP HELP.U`,
    `3,${formatCsvDate()},-88.90,pao-${suffix},Compra no débito - PAO DE ACUCAR-1226`
  ].join('\n');

  const formData = new FormData();
  formData.append('file', new Blob([csv], { type: 'text/csv' }), `NU_TEST_${suffix}.csv`);

  const importResponse = await fetch(`${apiUrl}/dashboard/bank-statements/import`, {
    method: 'POST',
    body: formData
  });
  assert.equal(importResponse.ok, true, 'importacao do extrato deve responder 200');
  const importPayload = await importResponse.json();

  assert.equal(importPayload.import.transactionCount, 4);
  assert.equal(importPayload.import.matchedPaymentsCount, 1);
  assert.equal(importPayload.import.unmatchedInflowsCount, 0);

  const finalOrder = await request(apiUrl, `/orders/${intake.order.id}`);
  assert.equal(finalOrder.paymentStatus, 'PAGO');

  const summary = await request(apiUrl, '/dashboard/summary?days=30');
  const statementRail = summary.integrations.items.find((item) => item.id === 'bank_statement_import');

  assert.equal(statementRail.status, 'RUNNING');
  assert.equal(summary.business.statement.latestImport.status, 'RUNNING');
  assert.equal(
    approxEqual(
      Number(summary.business.kpis.paidRevenueInRange || 0) -
        Number(baselineSummary.business.kpis.paidRevenueInRange || 0),
      intake.order.total
    ),
    true
  );
  assert.equal(approxEqual(summary.business.statement.kpis.bankInflowInRange, intake.order.total + 4.2), true);
  assert.equal(approxEqual(summary.business.statement.kpis.actualExpensesInRange, 101.35), true);
  assert.equal(approxEqual(summary.business.statement.kpis.deliveryExpensesInRange, 8.25), true);
  assert.equal(approxEqual(summary.business.statement.kpis.ingredientExpensesInRange, 88.9), true);
  assert.equal(
    approxEqual(
      summary.business.statement.kpis.netCashFlowInRange,
      Number(intake.order.total) - 97.15
    ),
    true
  );
});

test('dashboard cruza frete cobrado com custo real do Uber', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const uniquePhone = `11${String(Date.now()).slice(-9)}`;
  const baselineSummary = await request(apiUrl, '/dashboard/summary?days=30');

  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Extrato Frete ${suffix}`,
      category: 'Teste',
      unit: 'un',
      price: 82,
      active: true
    }
  });

  const customer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: `Cliente Frete ${suffix}`,
      phone: uniquePhone,
      address: 'Rua do Frete, 200'
    }
  });

  const intake = await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      intent: 'CONFIRMED',
      customer: {
        customerId: customer.id
      },
      fulfillment: {
        mode: 'DELIVERY',
        scheduledAt: validExternalScheduleIso(),
        address: 'Rua do Frete, 200',
        deliveryNotes: 'Portão azul'
      },
      order: {
        items: [{ productId: product.id, quantity: 1 }]
      },
      payment: {
        method: 'pix',
        status: 'PENDENTE'
      },
      source: {
        channel: 'CUSTOMER_LINK',
        externalId: `statement-delivery-${suffix}`
      }
    }
  });

  assert.equal(Number(intake.order.deliveryFee) > 0, true, 'pedido de entrega precisa cobrar frete');

  const csv = [
    'index,Data,Valor,Identificador,Descrição',
    `0,${formatCsvDate()},${Number(intake.order.total).toFixed(2)},txn-delivery-${suffix},Transferência recebida pelo Pix - Cliente Frete ${suffix} - •••.377.136-•• - ITAÚ UNIBANCO S.A. (0341) Agência: 9634 Conta: 4891-3`,
    `1,${formatCsvDate()},-15.75,uber-delivery-${suffix},Compra no débito - Uber UBER *TRIP HELP.U`,
    `2,${formatCsvDate()},-4.25,uber-delivery-2-${suffix},DL*UberRides`
  ].join('\n');

  const formData = new FormData();
  formData.append('file', new Blob([csv], { type: 'text/csv' }), `NU_FRETE_${suffix}.csv`);

  const importResponse = await fetch(`${apiUrl}/dashboard/bank-statements/import`, {
    method: 'POST',
    body: formData
  });
  assert.equal(importResponse.ok, true);

  const summary = await request(apiUrl, '/dashboard/summary?days=30');
  const expectedDeliveryExpenses = 20;
  const expectedDeliveryMargin = Number(intake.order.deliveryFee) - expectedDeliveryExpenses;
  const expectedCoveragePct =
    ((Number(baselineSummary.business.kpis.deliveryRevenueInRange || 0) + Number(intake.order.deliveryFee)) /
      (Number(baselineSummary.business.kpis.deliveryExpensesInRange || 0) + expectedDeliveryExpenses)) *
    100;

  assert.equal(
    approxEqual(
      Number(summary.business.kpis.deliveryRevenueInRange || 0) -
        Number(baselineSummary.business.kpis.deliveryRevenueInRange || 0),
      Number(intake.order.deliveryFee),
    ),
    true,
  );
  assert.equal(
    approxEqual(
      Number(summary.business.kpis.deliveryExpensesInRange || 0) -
        Number(baselineSummary.business.kpis.deliveryExpensesInRange || 0),
      expectedDeliveryExpenses,
    ),
    true,
  );
  assert.equal(
    approxEqual(
      Number(summary.business.kpis.deliveryMarginInRange || 0) -
        Number(baselineSummary.business.kpis.deliveryMarginInRange || 0),
      expectedDeliveryMargin,
    ),
    true,
  );
  assert.equal(
    approxEqual(summary.business.kpis.deliveryCoveragePctInRange, expectedCoveragePct),
    true,
  );
  assert.equal(
    Number(summary.business.kpis.deliveryOrdersInRange || 0) -
      Number(baselineSummary.business.kpis.deliveryOrdersInRange || 0) >=
      1,
    true,
  );
});
