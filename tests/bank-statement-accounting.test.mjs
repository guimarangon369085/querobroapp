import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { ensureApiServer, request } from './lib/api-server.mjs';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('/Users/gui/querobroapp/apps/api/node_modules/@prisma/client');

function formatCsvDate(value = new Date()) {
  return value.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function approxEqual(left, right, epsilon = 0.0001) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= epsilon;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
        return;
      }
      resolve();
    });
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}

function applySumUpEnv(env) {
  const keys = ['SUMUP_API_KEY', 'SUMUP_MERCHANT_CODE', 'SUMUP_API_BASE_URL', 'APP_PUBLIC_BASE_URL'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  for (const key of keys) {
    const nextValue = env[key];
    if (typeof nextValue === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = nextValue;
    }
  }

  return () => {
    for (const key of keys) {
      const prior = previous[key];
      if (typeof prior === 'undefined') {
        delete process.env[key];
      } else {
        process.env[key] = prior;
      }
    }
  };
}

function createFakeSumUpServer() {
  const checkouts = new Map();
  let sequence = 0;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const body = rawBody ? JSON.parse(rawBody) : null;

    if (req.method === 'POST' && url.pathname === '/v0.1/checkouts') {
      sequence += 1;
      const id = `sumup-accounting-${sequence}`;
      const checkout = {
        id,
        amount: Number(body?.amount || 0),
        checkout_reference: String(body?.checkout_reference || `ref-${sequence}`),
        currency: 'BRL',
        description: String(body?.description || ''),
        merchant_code: String(body?.merchant_code || 'MTEST123'),
        redirect_url: typeof body?.redirect_url === 'string' ? body.redirect_url : null,
        return_url: typeof body?.return_url === 'string' ? body.return_url : null,
        hosted_checkout: { enabled: true },
        hosted_checkout_url: `https://checkout.sumup.test/pay/${id}`,
        status: 'PENDING',
        valid_until: '2030-02-15T15:30:00.000Z',
      };
      checkouts.set(id, checkout);
      res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      res.end(JSON.stringify(checkout));
      return;
    }

    const checkoutMatch = url.pathname.match(/^\/v0\.1\/checkouts\/([^/]+)$/);
    if (req.method === 'GET' && checkoutMatch) {
      const checkout = checkouts.get(decodeURIComponent(checkoutMatch[1]));
      if (!checkout) {
        res.writeHead(404, { 'content-type': 'application/json', connection: 'close' });
        res.end(JSON.stringify({ message: 'Checkout not found' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      res.end(JSON.stringify(checkout));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify({ message: 'Not found' }));
  });

  return {
    server,
    setStatus(id, status) {
      const current = checkouts.get(id);
      if (!current) return false;
      checkouts.set(id, {
        ...current,
        status,
      });
      return true;
    },
  };
}

test('extrato detalha plano de contas e separa tesouraria dos custos operacionais', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const csv = [
    'index,Data,Valor,Identificador,Descrição',
    `0,${formatCsvDate()},-500.00,rdb-${suffix},Aplicação RDB`,
    `1,${formatCsvDate()},-82.05,das-${suffix},Pagamento de boleto efetuado - DAS-SIMPLES NACIONAL`,
    `2,${formatCsvDate()},-94.60,kalunga-${suffix},Compra no débito - KALUNGA`,
    `3,${formatCsvDate()},-79.00,lint-${suffix},Transferência enviada pelo Pix - LINT EMBALAGENS LTDA. - •••.387.914-•• - NU PAGAMENTOS - IP (0260) Agência: 1 Conta: 154980376`,
    `4,${formatCsvDate()},-188.10,vindi-${suffix},Transferência enviada pelo Pix - VINDI PAGAMENTOS ONLINE BRASIL LTDA - •••.148.941-•• - BCO BRADESCO S.A. (0237) Agência: 1453 Conta: 101520-5`,
    `5,${formatCsvDate()},150.35,resgate-${suffix},Resgate RDB`,
  ].join('\n');

  const formData = new FormData();
  formData.append('file', new Blob([csv], { type: 'text/csv' }), `NU_ACCOUNTING_${suffix}.csv`);

  const importResponse = await fetch(`${apiUrl}/dashboard/bank-statements/import`, {
    method: 'POST',
    body: formData,
  });
  assert.equal(importResponse.ok, true);

  const summary = await request(apiUrl, '/dashboard/summary?days=30');
  const breakdown = summary.business.statement.classificationBreakdown;

  const treasuryApplication = breakdown.find((entry) => entry.code === 'TREASURY_APPLICATION');
  const taxes = breakdown.find((entry) => entry.code === 'TAXES');
  const office = breakdown.find((entry) => entry.code === 'OFFICE_SUPPLIES');
  const packaging = breakdown.find((entry) => entry.code === 'PACKAGING_SUPPLIER');
  const gateway = breakdown.find((entry) => entry.code === 'PAYMENT_GATEWAY');
  const treasuryRedemption = breakdown.find((entry) => entry.code === 'TREASURY_REDEMPTION');

  assert.equal(approxEqual(treasuryApplication?.outflowAmount, 500), true);
  assert.equal(approxEqual(taxes?.outflowAmount, 82.05), true);
  assert.equal(approxEqual(office?.outflowAmount, 94.6), true);
  assert.equal(approxEqual(packaging?.outflowAmount, 79), true);
  assert.equal(approxEqual(gateway?.outflowAmount, 188.1), true);
  assert.equal(approxEqual(treasuryRedemption?.inflowAmount, 150.35), true);

  assert.equal(approxEqual(summary.business.statement.kpis.actualExpensesInRange, 443.75), true);
  assert.equal(
    approxEqual(summary.business.statement.reconciliation.nonOperationalOutflows, 500),
    true,
  );
  assert.equal(
    approxEqual(summary.business.statement.reconciliation.nonOperationalInflows, 150.35),
    true,
  );
  assert.equal(
    approxEqual(summary.business.statement.reconciliation.nonOperationalNet, -349.65),
    true,
  );
});

test('extrato concilia repasse da SumUp ao pagamento em cartão e expõe o match no review', async (t) => {
  const fakeSumUp = createFakeSumUpServer();
  const address = await listen(fakeSumUp.server);
  const restoreEnv = applySumUpEnv({
    SUMUP_API_KEY: 'sumup-test-key',
    SUMUP_MERCHANT_CODE: 'MTEST123',
    SUMUP_API_BASE_URL: `http://127.0.0.1:${address.port}`,
    APP_PUBLIC_BASE_URL: 'https://querobroa.com.br',
  });
  const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    orderId: null,
    customerId: null,
  };

  t.after(async () => {
    if (created.orderId) {
      try {
        await request(apiUrl, `/orders/${created.orderId}`, { method: 'DELETE' });
      } catch {}
    }
    if (created.customerId) {
      try {
        await request(apiUrl, `/customers/${created.customerId}`, { method: 'DELETE' });
      } catch {}
    }
    await shutdown();
    restoreEnv();
    await closeServer(fakeSumUp.server);
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const intake = await request(apiUrl, '/orders/intake/customer-form', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      version: 1,
      customer: {
        name: `Cliente Extrato Cartão ${suffix}`,
        phone: '11977776666',
        address: 'Rua Cartão, 10',
        addressLine1: 'Rua Cartão, 10',
        addressLine2: 'Apto 12',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        postalCode: '01234-000',
        country: 'BR',
        placeId: `sumup-accounting-${suffix}`,
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt: new Date(Date.UTC(2030, 2, 15, 14, 30, 0)).toISOString(),
      },
      paymentMethod: 'card',
      flavors: {
        T: 4,
        G: 3,
        D: 0,
        Q: 0,
        R: 0,
        RJ: 0,
      },
      notes: 'Extrato SumUp',
      source: {
        externalId: `statement-sumup-${suffix}`,
      },
    },
  });

  created.orderId = intake.order.id;
  created.customerId = intake.intake.customerId;

  assert.equal(Boolean(intake.intake.cardCheckout?.checkoutId), true);
  fakeSumUp.setStatus(intake.intake.cardCheckout.checkoutId, 'PAID');

  await request(
    apiUrl,
    `/payments/sumup/checkouts/${encodeURIComponent(intake.intake.cardCheckout.checkoutId)}/sync`,
    {
      method: 'POST',
    },
  );

  const csv = [
    'index,Data,Valor,Identificador,Descrição',
    `0,${formatCsvDate()},${Number(intake.order.total).toFixed(2)},sumup-${suffix},Transferência recebida - 65.756.685 GUILHERME MARANGON - •••.685.0001-•• - SUMUP * QUEROBROA`,
  ].join('\n');

  const formData = new FormData();
  formData.append('file', new Blob([csv], { type: 'text/csv' }), `NU_SUMUP_${suffix}.csv`);

  const importResponse = await fetch(`${apiUrl}/dashboard/bank-statements/import`, {
    method: 'POST',
    body: formData,
  });
  assert.equal(importResponse.ok, true);
  const importPayload = await importResponse.json();
  assert.equal(importPayload.import.matchedPaymentsCount, 1);
  assert.equal(importPayload.import.unmatchedInflowsCount, 0);

  const review = await request(apiUrl, '/dashboard/bank-statements/review');
  const transaction = review.transactions.find((entry) => entry.externalId === `sumup-${suffix}`);
  assert.ok(transaction, 'deve listar o repasse da SumUp no review');
  assert.equal(transaction.category, 'SALES');
  assert.equal(Boolean(transaction.matchedPaymentId), true);
  assert.match(transaction.matchedPaymentLabel, /Pedido #/);

  const summary = await request(apiUrl, '/dashboard/summary?days=30');
  assert.equal(
    approxEqual(summary.business.statement.reconciliation.matchedRevenue, intake.order.total),
    true,
  );
});

test('extrato concilia PIX já pago mesmo com order.customerName vazio e pagador divergente', async (t) => {
  const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    orderId: null,
    customerId: null,
  };

  const apiPort = Number(new URL(apiUrl).port || 0);
  const databasePath = path.join(process.cwd(), 'output', 'tests', `api-${apiPort}.db`);
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${databasePath}`;
  const prisma = new PrismaClient();

  t.after(async () => {
    await prisma.$disconnect();
    if (typeof previousDatabaseUrl === 'undefined') {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    if (created.orderId) {
      try {
        await request(apiUrl, `/orders/${created.orderId}`, { method: 'DELETE' });
      } catch {}
    }
    if (created.customerId) {
      try {
        await request(apiUrl, `/customers/${created.customerId}`, { method: 'DELETE' });
      } catch {}
    }
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const intake = await request(apiUrl, '/orders/intake/customer-form', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      version: 1,
      customer: {
        name: `Renata Pequê ${suffix}`,
        phone: '11999990000',
        address: 'Rua do Pix, 10',
        addressLine1: 'Rua do Pix, 10',
        addressLine2: 'Apto 4',
        neighborhood: 'Jardins',
        city: 'São Paulo',
        state: 'SP',
        postalCode: '01420-000',
        country: 'BR',
        placeId: `pix-settled-${suffix}`,
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt: new Date(Date.UTC(2030, 2, 15, 14, 30, 0)).toISOString(),
      },
      paymentMethod: 'pix',
      flavors: {
        T: 4,
        G: 3,
        D: 0,
        Q: 0,
        R: 0,
        RJ: 0,
      },
      notes: 'Extrato PIX já pago',
      source: {
        externalId: `statement-pix-settled-${suffix}`,
      },
    },
  });

  created.orderId = intake.order.id;
  created.customerId = intake.intake.customerId;

  const payment = await prisma.payment.findFirst({
    where: { orderId: intake.order.id, method: 'pix' },
    select: { id: true, providerRef: true },
  });
  assert.ok(payment?.id, 'deve criar pagamento pix para o pedido');

  const paidAt = new Date();
  await prisma.order.update({
    where: { id: intake.order.id },
    data: {
      customerName: null,
    },
  });
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: 'PAGO',
      paidAt,
      providerRef: payment.providerRef || `STATIC_PIX:QBTEST${suffix}`,
    },
  });

  const csv = [
    'index,Data,Valor,Identificador,Descrição',
    `0,${formatCsvDate(paidAt)},${Number(intake.order.total).toFixed(2)},pix-paid-${suffix},Transferência recebida pelo Pix - PEQUE LTDA - 48.797.232/0001-49 - BCO C6 S.A. (0336) Agência: 1 Conta: 24252250-5`,
  ].join('\n');

  const formData = new FormData();
  formData.append('file', new Blob([csv], { type: 'text/csv' }), `NU_PIX_SETTLED_${suffix}.csv`);

  const importResponse = await fetch(`${apiUrl}/dashboard/bank-statements/import`, {
    method: 'POST',
    body: formData,
  });
  assert.equal(importResponse.ok, true);
  const importPayload = await importResponse.json();
  assert.equal(importPayload.import.matchedPaymentsCount, 1);
  assert.equal(importPayload.import.unmatchedInflowsCount, 0);

  const review = await request(apiUrl, '/dashboard/bank-statements/review');
  const transaction = review.transactions.find((entry) => entry.externalId === `pix-paid-${suffix}`);
  assert.ok(transaction, 'deve listar o recebimento PIX no review');
  assert.equal(transaction.category, 'SALES');
  assert.equal(transaction.matchedPaymentId, payment.id);
  assert.equal(transaction.matchedOrderId, intake.order.id);
});
