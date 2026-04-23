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

test('review do extrato permite match manual e classificacao customizada', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const uniquePhone = `11${String(Date.now()).slice(-9)}`;

  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Extrato Review ${suffix}`,
      category: 'Teste',
      unit: 'un',
      price: 71.4,
      active: true
    }
  });

  const customer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: 'Julia Horta Nassif Toni',
      phone: uniquePhone,
      address: 'Rua Extrato Review, 10'
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
        externalId: `statement-review-${suffix}`
      }
    }
  });

  const csv = [
    'index,Data,Valor,Identificador,Descrição',
    `0,${formatCsvDate()},${Number(intake.order.total).toFixed(2)},txn-${suffix},Transferência recebida pelo Pix - Maria Extrato Review - •••.377.136-•• - ITAÚ UNIBANCO S.A. (0341) Agência: 9634 Conta: 4891-3`,
    `1,${formatCsvDate()},-15.55,out-${suffix},Compra no débito - LOJA EXEMPLO`
  ].join('\n');

  const formData = new FormData();
  formData.append('file', new Blob([csv], { type: 'text/csv' }), `NU_REVIEW_${suffix}.csv`);

  const importResponse = await fetch(`${apiUrl}/dashboard/bank-statements/import`, {
    method: 'POST',
    body: formData
  });
  assert.equal(importResponse.ok, true);
  const importPayload = await importResponse.json();
  assert.equal(importPayload.import.matchedPaymentsCount, 0);
  assert.equal(importPayload.import.unmatchedInflowsCount, 1);

  const initialReview = await request(apiUrl, '/dashboard/bank-statements/review');
  assert.equal(initialReview.transactions.length >= 2, true);
  assert.equal(initialReview.classificationOptions.some((item) => item.code === 'SALES'), true);

  const inflowTransaction = initialReview.transactions.find((item) => item.externalId === `txn-${suffix}`);
  const outflowTransaction = initialReview.transactions.find((item) => item.externalId === `out-${suffix}`);
  assert.ok(inflowTransaction, 'deve listar a entrada no review');
  assert.ok(outflowTransaction, 'deve listar a saída no review');

  const candidates = await request(
    apiUrl,
    `/dashboard/bank-statements/transactions/${inflowTransaction.id}/match-candidates`
  );
  assert.equal(candidates.length >= 1, true);

  const matchedReview = await request(apiUrl, `/dashboard/bank-statements/transactions/${inflowTransaction.id}`, {
    method: 'PUT',
    body: {
      matchedPaymentId: candidates[0].paymentId
    }
  });
  const matchedTransaction = matchedReview.transactions.find((item) => item.id === inflowTransaction.id);
  assert.equal(matchedTransaction.category, 'SALES');
  assert.equal(Boolean(matchedTransaction.matchedPaymentId), true);

  const updatedOrder = await request(apiUrl, `/orders/${intake.order.id}`);
  assert.equal(updatedOrder.paymentStatus, 'PAGO');

  const optionReview = await request(apiUrl, '/dashboard/bank-statements/classification-options', {
    method: 'POST',
    body: {
      label: `Frete parceiro ${suffix}`,
      baseCategory: 'DELIVERY',
      active: true
    }
  });
  const customOption = optionReview.classificationOptions.find((item) => item.label === `Frete parceiro ${suffix}`);
  assert.ok(customOption, 'deve criar a nova classificação customizada');

  const finalReview = await request(apiUrl, `/dashboard/bank-statements/transactions/${outflowTransaction.id}`, {
    method: 'PUT',
    body: {
      classificationCode: customOption.code,
      matchedPaymentId: null
    }
  });
  const updatedOutflow = finalReview.transactions.find((item) => item.id === outflowTransaction.id);
  assert.equal(updatedOutflow.category, 'DELIVERY');

  const summary = await request(apiUrl, '/dashboard/summary?days=30');
  assert.equal(summary.business.statement.latestImport.matchedPaymentsCount, 1);
  assert.equal(approxEqual(summary.business.statement.kpis.deliveryExpensesInRange, 15.55), true);
});

test('importacao do extrato privilegia o melhor match por nome quando o valor se repete', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Extrato Match ${suffix}`,
      category: 'Teste',
      unit: 'un',
      price: 116,
      active: true
    }
  });

  const primaryCustomer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: 'Camila Mari Ohno',
      phone: `11${String(Date.now()).slice(-9)}`,
      address: 'Rua Match, 10'
    }
  });

  const secondaryCustomer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: 'Camila Ohno Ferreira',
      phone: `11${String(Date.now() + 1).slice(-9)}`,
      address: 'Rua Match, 11'
    }
  });

  const primaryOrder = await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      intent: 'CONFIRMED',
      customer: {
        customerId: primaryCustomer.id
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
        externalId: `statement-primary-${suffix}`
      }
    }
  });

  const secondaryOrder = await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      intent: 'CONFIRMED',
      customer: {
        customerId: secondaryCustomer.id
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
        externalId: `statement-secondary-${suffix}`
      }
    }
  });

  const csv = [
    'index,Data,Valor,Identificador,Descrição',
    `0,${formatCsvDate()},${Number(primaryOrder.order.total).toFixed(2)},txn-dispute-${suffix},Transferência recebida pelo Pix - CAMILA MARI OHNO - •••.491.558-•• - BCO SANTANDER (BRASIL) S.A. (0033) Agência: 1784 Conta: 1003128-7`
  ].join('\n');

  const formData = new FormData();
  formData.append('file', new Blob([csv], { type: 'text/csv' }), `NU_MATCH_${suffix}.csv`);

  const importResponse = await fetch(`${apiUrl}/dashboard/bank-statements/import`, {
    method: 'POST',
    body: formData
  });
  assert.equal(importResponse.ok, true);
  const importPayload = await importResponse.json();

  assert.equal(importPayload.import.matchedPaymentsCount, 1);
  assert.equal(importPayload.import.unmatchedInflowsCount, 0);

  const refreshedPrimaryOrder = await request(apiUrl, `/orders/${primaryOrder.order.id}`);
  const refreshedSecondaryOrder = await request(apiUrl, `/orders/${secondaryOrder.order.id}`);
  assert.equal(refreshedPrimaryOrder.paymentStatus, 'PAGO');
  assert.equal(refreshedSecondaryOrder.paymentStatus, 'PENDENTE');
});

test('importacao do extrato classifica venda por nome + valor mesmo sem PIX pendente', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Extrato Order Match ${suffix}`,
      category: 'Teste',
      unit: 'un',
      price: 94,
      active: true
    }
  });

  const customer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: 'Alexandre Almeida Medeiros',
      phone: `11${String(Date.now()).slice(-9)}`,
      address: 'Rua Match Order, 19'
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
        status: 'PAGO'
      },
      source: {
        channel: 'CUSTOMER_LINK',
        externalId: `statement-order-match-${suffix}`
      }
    }
  });

  const csv = [
    'index,Data,Valor,Identificador,Descrição',
    `0,${formatCsvDate()},${Number(intake.order.total).toFixed(2)},txn-order-match-${suffix},Transferência recebida pelo Pix - ALEXANDRE ALMEIDA MEDEIROS - •••.738.398-•• - ITAÚ UNIBANCO S.A. (0341) Agência: 3767 Conta: 24208-8`
  ].join('\n');

  const formData = new FormData();
  formData.append('file', new Blob([csv], { type: 'text/csv' }), `NU_ORDER_MATCH_${suffix}.csv`);

  const importResponse = await fetch(`${apiUrl}/dashboard/bank-statements/import`, {
    method: 'POST',
    body: formData
  });
  assert.equal(importResponse.ok, true);
  const importPayload = await importResponse.json();
  assert.equal(importPayload.import.matchedPaymentsCount, 1);
  assert.equal(importPayload.import.unmatchedInflowsCount, 0);

  const review = await request(apiUrl, '/dashboard/bank-statements/review');
  const matchedTransaction = review.transactions.find((item) => item.externalId === `txn-order-match-${suffix}`);
  assert.ok(matchedTransaction, 'lancamento deve aparecer no review');
  assert.equal(matchedTransaction.category, 'SALES');
  assert.equal(matchedTransaction.matchedPaymentId, null);
  assert.equal(matchedTransaction.matchedOrderId, intake.order.id);
});

test('importacao do extrato aceita nome do pagador com iniciais e sufixos', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Extrato Nome Flex ${suffix}`,
      category: 'Teste',
      unit: 'un',
      price: 109,
      active: true
    }
  });

  const customer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: 'Thullio Barbosa',
      phone: `11${String(Date.now()).slice(-9)}`,
      address: 'Rua Nome Flex, 77'
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
        status: 'PAGO'
      },
      source: {
        channel: 'CUSTOMER_LINK',
        externalId: `statement-flex-name-${suffix}`
      }
    }
  });

  const csv = [
    'index,Data,Valor,Identificador,Descrição',
    `0,${formatCsvDate()},${Number(intake.order.total).toFixed(2)},txn-flex-name-${suffix},Transferência recebida pelo Pix - THULLIO GABRIEL SANTOS BARBOSA - •••.646.361-•• - ITAÚ UNIBANCO S.A. (0341) Agência: 4349 Conta: 30865-2`
  ].join('\n');

  const formData = new FormData();
  formData.append('file', new Blob([csv], { type: 'text/csv' }), `NU_FLEX_NAME_${suffix}.csv`);

  const importResponse = await fetch(`${apiUrl}/dashboard/bank-statements/import`, {
    method: 'POST',
    body: formData
  });
  assert.equal(importResponse.ok, true);
  const importPayload = await importResponse.json();
  assert.equal(importPayload.import.matchedPaymentsCount, 1);
  assert.equal(importPayload.import.unmatchedInflowsCount, 0);

  const review = await request(apiUrl, '/dashboard/bank-statements/review');
  const matchedTransaction = review.transactions.find((item) => item.externalId === `txn-flex-name-${suffix}`);
  assert.ok(matchedTransaction, 'lancamento deve aparecer no review');
  assert.equal(matchedTransaction.category, 'SALES');
  assert.equal(matchedTransaction.matchedOrderId, intake.order.id);
});

test('importacao do extrato privilegia primeiro e ultimo nome mesmo com ruido no meio', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Extrato Assinatura ${suffix}`,
      category: 'Teste',
      unit: 'un',
      price: 118,
      active: true
    }
  });

  const primaryCustomer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: 'Maria Carolina Barbosa',
      phone: `11${String(Date.now()).slice(-9)}`,
      address: 'Rua Assinatura, 10'
    }
  });

  const secondaryCustomer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: 'Maria Carolina Santos',
      phone: `11${String(Date.now() + 1).slice(-9)}`,
      address: 'Rua Assinatura, 11'
    }
  });

  const primaryOrder = await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      intent: 'CONFIRMED',
      customer: {
        customerId: primaryCustomer.id
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt: validExternalScheduleIso({ dayOffset: 1, hour: 10 })
      },
      order: {
        items: [{ productId: product.id, quantity: 1 }]
      },
      payment: {
        method: 'pix',
        status: 'PAGO'
      },
      source: {
        channel: 'CUSTOMER_LINK',
        externalId: `statement-signature-primary-${suffix}`
      }
    }
  });

  await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      intent: 'CONFIRMED',
      customer: {
        customerId: secondaryCustomer.id
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt: validExternalScheduleIso({ dayOffset: 1, hour: 17 })
      },
      order: {
        items: [{ productId: product.id, quantity: 1 }]
      },
      payment: {
        method: 'pix',
        status: 'PAGO'
      },
      source: {
        channel: 'CUSTOMER_LINK',
        externalId: `statement-signature-secondary-${suffix}`
      }
    }
  });

  const csv = [
    'index,Data,Valor,Identificador,Descrição',
    `0,${formatCsvDate()},${Number(primaryOrder.order.total).toFixed(2)},txn-signature-${suffix},Transferência recebida pelo Pix - MARIA EDUARDA CAROLINA BARBOSA FILHO - •••.377.136-•• - ITAÚ UNIBANCO S.A. (0341) Agência: 9634 Conta: 4891-3`
  ].join('\n');

  const formData = new FormData();
  formData.append('file', new Blob([csv], { type: 'text/csv' }), `NU_SIGNATURE_${suffix}.csv`);

  const importResponse = await fetch(`${apiUrl}/dashboard/bank-statements/import`, {
    method: 'POST',
    body: formData
  });
  assert.equal(importResponse.ok, true);
  const importPayload = await importResponse.json();
  assert.equal(importPayload.import.matchedPaymentsCount, 1);
  assert.equal(importPayload.import.unmatchedInflowsCount, 0);

  const review = await request(apiUrl, '/dashboard/bank-statements/review');
  const matchedTransaction = review.transactions.find((item) => item.externalId === `txn-signature-${suffix}`);
  assert.ok(matchedTransaction, 'lancamento deve aparecer no review');
  assert.equal(matchedTransaction.category, 'SALES');
  assert.equal(matchedTransaction.matchedOrderId, primaryOrder.order.id);
});

test('importacao do extrato distribui transferencias duplicadas entre pedidos do mesmo cliente', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Extrato Duplicado ${suffix}`,
      category: 'Teste',
      unit: 'un',
      price: 116,
      active: true
    }
  });

  const customer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: 'Camila Ohno',
      phone: `11${String(Date.now()).slice(-9)}`,
      address: 'Rua Duplicada, 10'
    }
  });

  const firstOrder = await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      intent: 'CONFIRMED',
      customer: {
        customerId: customer.id
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt: validExternalScheduleIso({ dayOffset: 1, hour: 10 })
      },
      order: {
        items: [{ productId: product.id, quantity: 1 }]
      },
      payment: {
        method: 'pix',
        status: 'PAGO'
      },
      source: {
        channel: 'CUSTOMER_LINK',
        externalId: `statement-duplicate-first-${suffix}`
      }
    }
  });

  const secondOrder = await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      intent: 'CONFIRMED',
      customer: {
        customerId: customer.id
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt: validExternalScheduleIso({ dayOffset: 1, hour: 16 })
      },
      order: {
        items: [{ productId: product.id, quantity: 1 }]
      },
      payment: {
        method: 'pix',
        status: 'PAGO'
      },
      source: {
        channel: 'CUSTOMER_LINK',
        externalId: `statement-duplicate-second-${suffix}`
      }
    }
  });

  const csv = [
    'index,Data,Valor,Identificador,Descrição',
    `0,${formatCsvDate()},${Number(firstOrder.order.total).toFixed(2)},txn-duplicate-a-${suffix},Transferência recebida pelo Pix - CAMILA MARI OHNO - •••.491.558-•• - BCO SANTANDER (BRASIL) S.A. (0033) Agência: 1784 Conta: 1003128-7`,
    `1,${formatCsvDate()},${Number(secondOrder.order.total).toFixed(2)},txn-duplicate-b-${suffix},Transferência recebida pelo Pix - CAMILA MARI OHNO - •••.491.558-•• - BCO SANTANDER (BRASIL) S.A. (0033) Agência: 1784 Conta: 1003128-7`
  ].join('\n');

  const formData = new FormData();
  formData.append('file', new Blob([csv], { type: 'text/csv' }), `NU_DUPLICATE_${suffix}.csv`);

  const importResponse = await fetch(`${apiUrl}/dashboard/bank-statements/import`, {
    method: 'POST',
    body: formData
  });
  assert.equal(importResponse.ok, true);
  const importPayload = await importResponse.json();
  assert.equal(importPayload.import.matchedPaymentsCount, 2);
  assert.equal(importPayload.import.unmatchedInflowsCount, 0);

  const review = await request(apiUrl, '/dashboard/bank-statements/review');
  const firstTransaction = review.transactions.find((item) => item.externalId === `txn-duplicate-a-${suffix}`);
  const secondTransaction = review.transactions.find((item) => item.externalId === `txn-duplicate-b-${suffix}`);
  assert.ok(firstTransaction, 'primeiro lancamento deve aparecer no review');
  assert.ok(secondTransaction, 'segundo lancamento deve aparecer no review');
  assert.equal(Boolean(firstTransaction.matchedOrderId), true);
  assert.equal(Boolean(secondTransaction.matchedOrderId), true);
  assert.notEqual(firstTransaction.matchedOrderId, secondTransaction.matchedOrderId);
  assert.deepEqual(
    [firstTransaction.matchedOrderId, secondTransaction.matchedOrderId].sort((left, right) => left - right),
    [firstOrder.order.id, secondOrder.order.id].sort((left, right) => left - right)
  );
});
