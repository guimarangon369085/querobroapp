import assert from 'node:assert/strict';
import http from 'node:http';
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

test('pluggy webhook busca transacoes novas e baixa pedido por PIX recebido', async (t) => {
  const previousPluggyWebhookToken = process.env.PLUGGY_WEBHOOK_TOKEN;
  const previousPluggyClientId = process.env.PLUGGY_CLIENT_ID;
  const previousPluggyClientSecret = process.env.PLUGGY_CLIENT_SECRET;
  const previousPluggyApiUrl = process.env.PLUGGY_API_URL;
  process.env.PLUGGY_WEBHOOK_TOKEN = 'test-pluggy-webhook-token';
  process.env.PLUGGY_CLIENT_ID = 'pluggy-client-id';
  process.env.PLUGGY_CLIENT_SECRET = 'pluggy-client-secret';

  const mockState = {
    authCalls: 0,
    transactionsCalls: 0
  };

  let transactionPayload = null;
  const pluggyServer = http.createServer(async (req, res) => {
    if (req.url === '/auth' && req.method === 'POST') {
      mockState.authCalls += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ apiKey: 'pluggy-api-key' }));
      return;
    }

    if (req.url?.startsWith('/transactions') && req.method === 'GET') {
      mockState.transactionsCalls += 1;
      assert.equal(req.headers['x-api-key'], 'pluggy-api-key');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          page: 1,
          totalPages: 1,
          results: transactionPayload ? [transactionPayload] : []
        })
      );
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise((resolve) => pluggyServer.listen(0, '127.0.0.1', resolve));
  const address = pluggyServer.address();
  const pluggyBaseUrl =
    address && typeof address === 'object' ? `http://127.0.0.1:${address.port}` : 'http://127.0.0.1:0';
  process.env.PLUGGY_API_URL = pluggyBaseUrl;

  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    orderId: null,
    customerId: null,
    productId: null
  };

  t.after(async () => {
    process.env.PLUGGY_WEBHOOK_TOKEN = previousPluggyWebhookToken;
    process.env.PLUGGY_CLIENT_ID = previousPluggyClientId;
    process.env.PLUGGY_CLIENT_SECRET = previousPluggyClientSecret;
    process.env.PLUGGY_API_URL = previousPluggyApiUrl;

    for (const cleanup of [
      created.orderId ? () => request(apiUrl, `/orders/${created.orderId}`, { method: 'DELETE' }) : null,
      created.customerId ? () => request(apiUrl, `/customers/${created.customerId}`, { method: 'DELETE' }) : null,
      created.productId ? () => request(apiUrl, `/inventory-products/${created.productId}`, { method: 'DELETE' }) : null
    ].filter(Boolean)) {
      try {
        await cleanup();
      } catch {}
    }

    await shutdown();
    await new Promise((resolve, reject) => pluggyServer.close((error) => (error ? reject(error) : resolve())));
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const uniquePhone = `11${String(Date.now()).slice(-9)}`;

  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Pluggy broa ${suffix}`,
      category: 'Teste',
      unit: 'un',
      price: 42,
      active: true
    }
  });
  created.productId = product.id;

  const customer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: 'Maria Fernanda',
      phone: uniquePhone,
      address: 'Rua Pluggy, 10'
    }
  });
  created.customerId = customer.id;

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
        externalId: `pluggy-webhook-${suffix}`
      }
    }
  });
  created.orderId = intake.order.id;

  transactionPayload = {
    id: `txn-${suffix}`,
    accountId: 'pluggy-account-1',
    description: 'PIX RECEBIDO MARIA FERNANDA',
    amount: intake.order.total,
    date: '2026-03-25T18:33:00.000Z',
    type: 'CREDIT',
    status: 'POSTED',
    paymentData: {
      payer: {
        name: 'Maria Fernanda',
        documentNumber: {
          type: 'CPF',
          value: '111.222.333-44'
        }
      },
      paymentMethod: 'PIX',
      referenceNumber: `E2E-${suffix}`,
      receiverReferenceId: intake.intake.pixCharge?.txid
    }
  };

  const webhookResponse = await request(apiUrl, '/payments/pluggy/webhook', {
    method: 'POST',
    headers: {
      'x-pluggy-token': 'test-pluggy-webhook-token'
    },
    body: {
      event: 'transactions/created',
      eventId: `evt-${suffix}`,
      itemId: 'pluggy-item-1',
      accountId: 'pluggy-account-1',
      transactionsCount: 1,
      transactionsCreatedAtFrom: '2026-03-25T18:30:00.000Z',
      createdTransactionsLink: `${pluggyBaseUrl}/transactions?accountId=pluggy-account-1&createdAtFrom=2026-03-25T18:30:00.000Z`
    }
  });

  assert.equal(webhookResponse.ok, true);
  assert.equal(webhookResponse.event, 'transactions/created');
  assert.equal(webhookResponse.fetchedTransactions, 1);
  assert.equal(webhookResponse.processedTransactions, 1);
  assert.equal(webhookResponse.matchedTransactions, 1);
  assert.equal(mockState.authCalls, 1);
  assert.equal(mockState.transactionsCalls, 1);

  const finalOrder = await request(apiUrl, `/orders/${created.orderId}`);
  assert.equal(finalOrder.paymentStatus, 'PAGO');
});
