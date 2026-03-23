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

test('pix reconciliation webhook baixa pedido pendente por nome + valor', async (t) => {
  const previousWebhookToken = process.env.BANK_SYNC_WEBHOOK_TOKEN;
  process.env.BANK_SYNC_WEBHOOK_TOKEN = 'test-bank-sync-token';

  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    orderIds: [],
    customerId: null,
    productId: null
  };

  t.after(async () => {
    process.env.BANK_SYNC_WEBHOOK_TOKEN = previousWebhookToken;

    for (const orderId of created.orderIds) {
      try {
        await request(apiUrl, `/orders/${orderId}`, { method: 'DELETE' });
      } catch {}
    }

    for (const cleanup of [
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
      name: `Reconciliacao broa ${suffix}`,
      category: 'Teste',
      unit: 'un',
      price: 31,
      active: true
    }
  });
  created.productId = product.id;

  const customer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: 'Guilherme Marangon',
      phone: uniquePhone,
      address: 'Rua Reconciliacao, 10'
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
        externalId: `pix-reconciliation-${suffix}`
      }
    }
  });
  created.orderIds.push(intake.order.id);

  const reconciliation = await request(apiUrl, '/payments/pix-reconciliations/webhook', {
    method: 'POST',
    headers: {
      'x-bank-sync-token': 'test-bank-sync-token'
    },
    body: {
      payerName: 'Guilherme Marangon',
      amount: intake.order.total,
      paidAt: '2026-03-18T13:50:00-03:00',
      source: 'test-suite',
      sourceTransactionId: `txn-${suffix}`
    }
  });

  assert.equal(reconciliation.ok, true);
  assert.equal(reconciliation.matched, true);
  assert.equal(reconciliation.matchReason, 'NAME_AND_AMOUNT');
  assert.equal(reconciliation.payment.status, 'PAGO');

  const finalOrder = await request(apiUrl, `/orders/${intake.order.id}`);
  assert.equal(finalOrder.paymentStatus, 'PAGO');
});

test('pix reconciliation webhook preserva pedido pendente quando o match e ambiguo', async (t) => {
  const previousWebhookToken = process.env.BANK_SYNC_WEBHOOK_TOKEN;
  process.env.BANK_SYNC_WEBHOOK_TOKEN = 'test-bank-sync-token';

  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    orderIds: [],
    customerId: null,
    productId: null
  };

  t.after(async () => {
    process.env.BANK_SYNC_WEBHOOK_TOKEN = previousWebhookToken;

    for (const orderId of created.orderIds) {
      try {
        await request(apiUrl, `/orders/${orderId}`, { method: 'DELETE' });
      } catch {}
    }

    for (const cleanup of [
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
      name: `Reconciliacao ambigua ${suffix}`,
      category: 'Teste',
      unit: 'un',
      price: 40,
      active: true
    }
  });
  created.productId = product.id;

  const customer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: 'Ana Paula Costa',
      phone: uniquePhone,
      address: 'Rua Ambigua, 10'
    }
  });
  created.customerId = customer.id;

  const first = await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      intent: 'CONFIRMED',
      customer: {
        customerId: customer.id
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt: validExternalScheduleIso({ hour: 11, minute: 0 })
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
        externalId: `pix-reconciliation-ambiguous-a-${suffix}`
      }
    }
  });
  created.orderIds.push(first.order.id);

  const second = await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      intent: 'CONFIRMED',
      customer: {
        customerId: customer.id
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt: validExternalScheduleIso({ hour: 11, minute: 15 })
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
        externalId: `pix-reconciliation-ambiguous-b-${suffix}`
      }
    }
  });
  created.orderIds.push(second.order.id);

  const reconciliation = await request(apiUrl, '/payments/pix-reconciliations/webhook', {
    method: 'POST',
    headers: {
      'x-bank-sync-token': 'test-bank-sync-token'
    },
    body: {
      payerName: 'Ana Paula Costa',
      amount: first.order.total,
      source: 'test-suite',
      sourceTransactionId: `txn-ambiguous-${suffix}`
    }
  });

  assert.equal(reconciliation.ok, true);
  assert.equal(reconciliation.matched, false);
  assert.equal(reconciliation.reason, 'AMBIGUOUS');

  const finalFirst = await request(apiUrl, `/orders/${first.order.id}`);
  const finalSecond = await request(apiUrl, `/orders/${second.order.id}`);
  assert.equal(finalFirst.paymentStatus, 'PENDENTE');
  assert.equal(finalSecond.paymentStatus, 'PENDENTE');
});
