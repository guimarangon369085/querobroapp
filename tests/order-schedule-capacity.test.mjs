import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request, requestExpectError } from './lib/api-server.mjs';

function localScheduleIso(year, monthIndex, day, hour, minute) {
  return new Date(Date.UTC(year, monthIndex, day, hour + 3, minute, 0, 0)).toISOString();
}

async function createOrderProduct(apiUrl, suffix) {
  return request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Agenda Slot Broa ${suffix}`,
      category: 'Teste',
      unit: 'cx',
      price: 40,
      active: true
    }
  });
}

async function createIntakeOrder(apiUrl, productId, suffix, scheduledAt, channel = 'WHATSAPP_FLOW') {
  return request(apiUrl, channel === 'WHATSAPP_FLOW' ? '/orders/intake/whatsapp-flow' : '/orders/intake', {
    method: 'POST',
    body: {
      version: 1,
      intent: 'CONFIRMED',
      customer: {
        name: `Cliente Agenda ${suffix}`,
        phone: `1198${suffix.slice(-7).padStart(7, '0')}`,
        address: `Rua Agenda ${suffix}, 10`
      },
      fulfillment: {
        mode: 'DELIVERY',
        scheduledAt
      },
      order: {
        items: [{ productId, quantity: 1 }]
      },
      payment: {
        method: 'pix',
        status: 'PENDENTE'
      },
      source:
        channel === 'WHATSAPP_FLOW'
          ? {
              externalId: `agenda-${suffix}`,
              idempotencyKey: `agenda-${suffix}`
            }
          : {
              channel: 'INTERNAL_DASHBOARD',
              originLabel: 'schedule-test'
            }
    }
  });
}

test('public schedule availability skips occupied slots', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    productId: null,
    orderIds: [],
    customerIds: []
  };

  t.after(async () => {
    for (const orderId of created.orderIds) {
      try {
        await request(apiUrl, `/orders/${orderId}`, { method: 'DELETE' });
      } catch {}
    }
    for (const customerId of created.customerIds) {
      try {
        await request(apiUrl, `/customers/${customerId}`, { method: 'DELETE' });
      } catch {}
    }
    if (created.productId) {
      try {
        await request(apiUrl, `/inventory-products/${created.productId}`, { method: 'DELETE' });
      } catch {}
    }
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const product = await createOrderProduct(apiUrl, suffix);
  created.productId = product.id;

  const firstSchedule = localScheduleIso(2030, 1, 12, 8, 0);
  const first = await createIntakeOrder(apiUrl, product.id, `${suffix}-1`, firstSchedule);
  created.orderIds.push(first.order.id);
  created.customerIds.push(first.intake.customerId);

  const availability = await request(
    apiUrl,
    `/orders/public-schedule?scheduledAt=${encodeURIComponent(firstSchedule)}`
  );

  assert.equal(availability.requestedAvailable, false);
  assert.equal(availability.reason, 'SLOT_TAKEN');
  assert.equal(availability.nextAvailableAt, localScheduleIso(2030, 1, 12, 8, 15));
});

test('whatsapp-flow rejects the 16th scheduled order on the same day', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    productId: null,
    orderIds: [],
    customerIds: []
  };

  t.after(async () => {
    for (const orderId of created.orderIds) {
      try {
        await request(apiUrl, `/orders/${orderId}`, { method: 'DELETE' });
      } catch {}
    }
    for (const customerId of created.customerIds) {
      try {
        await request(apiUrl, `/customers/${customerId}`, { method: 'DELETE' });
      } catch {}
    }
    if (created.productId) {
      try {
        await request(apiUrl, `/inventory-products/${created.productId}`, { method: 'DELETE' });
      } catch {}
    }
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const product = await createOrderProduct(apiUrl, suffix);
  created.productId = product.id;

  for (let index = 0; index < 15; index += 1) {
    const hour = 8 + Math.floor(index / 4);
    const minute = (index % 4) * 15;
    const createdOrder = await createIntakeOrder(
      apiUrl,
      product.id,
      `${suffix}-${index + 1}`,
      localScheduleIso(2030, 1, 12, hour, minute)
    );
    created.orderIds.push(createdOrder.order.id);
    created.customerIds.push(createdOrder.intake.customerId);
  }

  const body = await requestExpectError(apiUrl, '/orders/intake/whatsapp-flow', 400, {
    method: 'POST',
    body: {
      version: 1,
      intent: 'CONFIRMED',
      customer: {
        name: `Cliente Agenda ${suffix}-16`,
        phone: '11988887770',
        address: 'Rua Agenda, 160'
      },
      fulfillment: {
        mode: 'DELIVERY',
        scheduledAt: localScheduleIso(2030, 1, 12, 12, 0)
      },
      order: {
        items: [{ productId: product.id, quantity: 1 }]
      },
      payment: {
        method: 'pix',
        status: 'PENDENTE'
      },
      source: {
        externalId: `agenda-${suffix}-16`,
        idempotencyKey: `agenda-${suffix}-16`
      }
    }
  });

  assert.equal(body.reason, 'DAY_FULL');
  assert.equal(body.nextAvailableAt, localScheduleIso(2030, 1, 13, 8, 0));
  assert.match(String(body.message || ''), /15 pedidos/i);
});

test('order update rejects moving into an occupied slot', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    productId: null,
    orderIds: [],
    customerIds: []
  };

  t.after(async () => {
    for (const orderId of created.orderIds) {
      try {
        await request(apiUrl, `/orders/${orderId}`, { method: 'DELETE' });
      } catch {}
    }
    for (const customerId of created.customerIds) {
      try {
        await request(apiUrl, `/customers/${customerId}`, { method: 'DELETE' });
      } catch {}
    }
    if (created.productId) {
      try {
        await request(apiUrl, `/inventory-products/${created.productId}`, { method: 'DELETE' });
      } catch {}
    }
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const product = await createOrderProduct(apiUrl, suffix);
  created.productId = product.id;

  const firstSchedule = localScheduleIso(2030, 1, 14, 8, 0);
  const secondSchedule = localScheduleIso(2030, 1, 14, 8, 15);
  const first = await createIntakeOrder(apiUrl, product.id, `${suffix}-first`, firstSchedule, 'INTERNAL_DASHBOARD');
  const second = await createIntakeOrder(apiUrl, product.id, `${suffix}-second`, secondSchedule, 'INTERNAL_DASHBOARD');

  created.orderIds.push(first.order.id, second.order.id);
  created.customerIds.push(first.intake.customerId, second.intake.customerId);

  const body = await requestExpectError(apiUrl, `/orders/${second.order.id}`, 400, {
    method: 'PUT',
    body: {
      scheduledAt: firstSchedule
    }
  });

  assert.equal(body.reason, 'SLOT_TAKEN');
  assert.equal(body.nextAvailableAt, secondSchedule);
  assert.match(String(body.message || ''), /horário/i);
});
