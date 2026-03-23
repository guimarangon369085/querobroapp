import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request, requestExpectError } from './lib/api-server.mjs';

function resolveScheduleDate(seed = Date.now()) {
  const baseDate = new Date(Date.UTC(2030, 0, 1, 0, 0, 0, 0));
  const offsetDays = Math.abs(Number(seed) || 0) % 320;
  baseDate.setUTCDate(baseDate.getUTCDate() + offsetDays);
  return baseDate;
}

function addUtcDays(baseDate, days) {
  const nextDate = new Date(baseDate);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function localScheduleIso(baseDate, hour, minute) {
  return new Date(
    Date.UTC(
      baseDate.getUTCFullYear(),
      baseDate.getUTCMonth(),
      baseDate.getUTCDate(),
      hour + 3,
      minute,
      0,
      0
    )
  ).toISOString();
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

async function createIntakeOrder(apiUrl, productId, suffix, scheduledAt, channel = 'CUSTOMER_LINK') {
  return request(apiUrl, '/orders/intake', {
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
        channel === 'CUSTOMER_LINK'
          ? {
              channel: 'CUSTOMER_LINK',
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
  const scheduleDate = resolveScheduleDate(`${suffix}-availability`.length + Date.now());
  const product = await createOrderProduct(apiUrl, suffix);
  created.productId = product.id;

  const firstSchedule = localScheduleIso(scheduleDate, 8, 0);
  const first = await createIntakeOrder(apiUrl, product.id, `${suffix}-1`, firstSchedule);
  created.orderIds.push(first.order.id);
  created.customerIds.push(first.intake.customerId);

  const availability = await request(
    apiUrl,
    `/orders/public-schedule?scheduledAt=${encodeURIComponent(firstSchedule)}`
  );

  assert.equal(availability.requestedAvailable, false);
  assert.equal(availability.reason, 'SLOT_TAKEN');
  assert.equal(availability.nextAvailableAt, localScheduleIso(scheduleDate, 8, 15));
});

test('customer-link rejects the 16th scheduled order on the same day', async (t) => {
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
  const scheduleDate = resolveScheduleDate(`${suffix}-day-full`.length + Date.now());
  const product = await createOrderProduct(apiUrl, suffix);
  created.productId = product.id;

  for (let index = 0; index < 15; index += 1) {
    const hour = 8 + Math.floor(index / 4);
    const minute = (index % 4) * 15;
    const createdOrder = await createIntakeOrder(
      apiUrl,
      product.id,
      `${suffix}-${index + 1}`,
      localScheduleIso(scheduleDate, hour, minute)
    );
    created.orderIds.push(createdOrder.order.id);
    created.customerIds.push(createdOrder.intake.customerId);
  }

  const body = await requestExpectError(apiUrl, '/orders/intake', 400, {
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
        scheduledAt: localScheduleIso(scheduleDate, 12, 0)
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
        externalId: `agenda-${suffix}-16`,
        idempotencyKey: `agenda-${suffix}-16`
      }
    }
  });

  assert.equal(body.reason, 'DAY_FULL');
  assert.equal(body.nextAvailableAt, localScheduleIso(addUtcDays(scheduleDate, 1), 8, 0));
  assert.match(String(body.message || ''), /15 pedidos/i);
});

test('order update allows moving an internal dashboard order into an occupied slot', async (t) => {
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
  const scheduleDate = resolveScheduleDate(`${suffix}-internal-update`.length + Date.now());
  const product = await createOrderProduct(apiUrl, suffix);
  created.productId = product.id;

  const firstSchedule = localScheduleIso(scheduleDate, 8, 0);
  const secondSchedule = localScheduleIso(scheduleDate, 8, 15);
  const first = await createIntakeOrder(apiUrl, product.id, `${suffix}-first`, firstSchedule, 'INTERNAL_DASHBOARD');
  const second = await createIntakeOrder(apiUrl, product.id, `${suffix}-second`, secondSchedule, 'INTERNAL_DASHBOARD');

  created.orderIds.push(first.order.id, second.order.id);
  created.customerIds.push(first.intake.customerId, second.intake.customerId);

  const updated = await request(apiUrl, `/orders/${second.order.id}`, {
    method: 'PUT',
    body: {
      scheduledAt: firstSchedule
    }
  });

  assert.equal(updated.id, second.order.id);
  assert.equal(updated.scheduledAt, firstSchedule);
});
