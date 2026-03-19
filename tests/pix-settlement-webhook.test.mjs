import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request, requestExpectError } from './lib/api-server.mjs';

function validExternalScheduleIso(reference = new Date()) {
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
  const dayOffset = localHour >= 22 ? 2 : 1;
  const targetYear = Number(parts.year);
  const targetMonth = Number(parts.month);
  const targetDay = Number(parts.day) + dayOffset;
  return new Date(Date.UTC(targetYear, targetMonth - 1, targetDay, 11, 0, 0, 0)).toISOString();
}

test('pix settlement webhook baixa pagamento pendente por txid', async (t) => {
  const previousWebhookToken = process.env.BANK_SYNC_WEBHOOK_TOKEN;
  process.env.BANK_SYNC_WEBHOOK_TOKEN = 'test-bank-sync-token';

  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    orderId: null,
    customerId: null,
    productId: null
  };

  t.after(async () => {
    process.env.BANK_SYNC_WEBHOOK_TOKEN = previousWebhookToken;

    const cleanups = [
      created.orderId ? () => request(apiUrl, `/orders/${created.orderId}`, { method: 'DELETE' }) : null,
      created.customerId ? () => request(apiUrl, `/customers/${created.customerId}`, { method: 'DELETE' }) : null,
      created.productId ? () => request(apiUrl, `/inventory-products/${created.productId}`, { method: 'DELETE' }) : null
    ].filter(Boolean);

    for (const cleanup of cleanups) {
      try {
        await cleanup();
      } catch {
        // cleanup best effort
      }
    }

    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const uniquePhone = `11${String(Date.now()).slice(-9)}`;

  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Webhook broa ${suffix}`,
      category: 'Teste',
      unit: 'un',
      price: 12,
      active: true
    }
  });
  created.productId = product.id;

  const customer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: `Cliente webhook ${suffix}`,
      phone: uniquePhone,
      address: 'Rua Settlement, 10'
    }
  });
  created.customerId = customer.id;

  const intake = await request(apiUrl, '/orders/intake/whatsapp-flow', {
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
        externalId: `pix-settlement-${suffix}`
      }
    }
  });
  created.orderId = intake.order.id;

  const txid = intake.intake.pixCharge?.txid;
  assert.ok(txid);

  await requestExpectError(apiUrl, '/payments/pix-settlements/webhook', 401, {
    method: 'POST',
    body: {
      txid,
      amount: intake.order.total,
      source: 'test-suite'
    }
  });

  const settlement = await request(apiUrl, '/payments/pix-settlements/webhook', {
    method: 'POST',
    headers: {
      'x-bank-sync-token': 'test-bank-sync-token'
    },
    body: {
      txid,
      amount: intake.order.total,
      source: 'test-suite'
    }
  });

  assert.equal(settlement.ok, true);
  assert.equal(settlement.alreadyPaid, false);
  assert.equal(settlement.payment.status, 'PAGO');

  const finalOrder = await request(apiUrl, `/orders/${created.orderId}`);
  assert.equal(finalOrder.paymentStatus, 'PAGO');
});
