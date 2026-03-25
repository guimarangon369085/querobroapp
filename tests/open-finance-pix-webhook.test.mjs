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

test('open finance webhook baixa pedido pendente e responde por idempotencia no replay', async (t) => {
  const previousOpenFinanceWebhookToken = process.env.OPEN_FINANCE_WEBHOOK_TOKEN;
  process.env.OPEN_FINANCE_WEBHOOK_TOKEN = 'test-open-finance-token';

  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    orderId: null,
    customerId: null,
    productId: null
  };

  t.after(async () => {
    process.env.OPEN_FINANCE_WEBHOOK_TOKEN = previousOpenFinanceWebhookToken;

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
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const uniquePhone = `11${String(Date.now()).slice(-9)}`;

  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Open Finance broa ${suffix}`,
      category: 'Teste',
      unit: 'un',
      price: 35,
      active: true
    }
  });
  created.productId = product.id;

  const customer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: 'Joao Guilherme',
      phone: uniquePhone,
      address: 'Rua Open Finance, 10'
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
        items: [{ productId: product.id, quantity: 2 }]
      },
      payment: {
        method: 'pix',
        status: 'PENDENTE'
      },
      source: {
        channel: 'CUSTOMER_LINK',
        externalId: `open-finance-${suffix}`
      }
    }
  });
  created.orderId = intake.order.id;

  const payload = {
    provider: 'BELVO',
    eventId: `evt-${suffix}`,
    transactionId: `txn-${suffix}`,
    rail: 'PIX',
    direction: 'INCOMING',
    status: 'BOOKED',
    amount: intake.order.total,
    bookedAt: '2026-03-25T14:32:00-03:00',
    payerName: 'Joao Guilherme',
    endToEndId: `e2e-${suffix}`
  };

  const first = await request(apiUrl, '/payments/open-finance/webhook', {
    method: 'POST',
    headers: {
      'x-open-finance-token': 'test-open-finance-token'
    },
    body: payload
  });

  assert.equal(first.ok, true);
  assert.equal(first.matched, true);
  assert.equal(first.ignored, false);
  assert.equal(first.payment.status, 'PAGO');
  assert.equal(first.replayed, undefined);

  const replay = await request(apiUrl, '/payments/open-finance/webhook', {
    method: 'POST',
    headers: {
      'x-open-finance-token': 'test-open-finance-token'
    },
    body: payload
  });

  assert.equal(replay.ok, true);
  assert.equal(replay.matched, true);
  assert.equal(replay.replayed, true);

  const finalOrder = await request(apiUrl, `/orders/${created.orderId}`);
  assert.equal(finalOrder.paymentStatus, 'PAGO');
});
