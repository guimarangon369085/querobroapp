import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

function resolveScheduleDate(seed = Date.now()) {
  const baseDate = new Date(Date.UTC(2030, 0, 1, 0, 0, 0, 0));
  const offsetDays = Math.abs(Number(seed) || 0) % 320;
  baseDate.setUTCDate(baseDate.getUTCDate() + offsetDays);
  return baseDate;
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
      name: `Broa Agenda ${suffix}`,
      category: 'Teste',
      unit: 'unidade',
      price: 7.43,
      active: true
    }
  });
}

async function createIntakeOrder(apiUrl, productId, suffix, scheduledAt, quantity, channel = 'CUSTOMER_LINK') {
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
        items: [{ productId, quantity }]
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

test('public schedule blocks the next 14 broas for one full oven hour', async (t) => {
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
  const scheduleDate = resolveScheduleDate(`${suffix}-two-boxes`.length + Date.now());
  const product = await createOrderProduct(apiUrl, suffix);
  created.productId = product.id;

  const scheduledAt = localScheduleIso(scheduleDate, 10, 0);
  const createdOrder = await createIntakeOrder(apiUrl, product.id, `${suffix}-1`, scheduledAt, 14);
  created.orderIds.push(createdOrder.order.id);
  created.customerIds.push(createdOrder.intake.customerId);

  const availability = await request(
    apiUrl,
    `/orders/public-schedule?scheduledAt=${encodeURIComponent(scheduledAt)}&totalBroas=14`
  );

  assert.equal(availability.requestedAvailable, false);
  assert.equal(availability.reason, 'SLOT_TAKEN');
  assert.equal(availability.requestedTotalBroas, 14);
  assert.equal(availability.requestedDurationMinutes, 60);
  assert.equal(availability.nextAvailableAt, localScheduleIso(scheduleDate, 11, 0));
});

test('public schedule expands the occupied window to two hours for 21 broas', async (t) => {
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
  const scheduleDate = resolveScheduleDate(`${suffix}-three-boxes`.length + Date.now());
  const product = await createOrderProduct(apiUrl, suffix);
  created.productId = product.id;

  const scheduledAt = localScheduleIso(scheduleDate, 10, 0);
  const createdOrder = await createIntakeOrder(apiUrl, product.id, `${suffix}-1`, scheduledAt, 21);
  created.orderIds.push(createdOrder.order.id);
  created.customerIds.push(createdOrder.intake.customerId);

  const availability = await request(
    apiUrl,
    `/orders/public-schedule?scheduledAt=${encodeURIComponent(scheduledAt)}&totalBroas=21`
  );

  assert.equal(availability.requestedAvailable, false);
  assert.equal(availability.reason, 'SLOT_TAKEN');
  assert.equal(availability.requestedTotalBroas, 21);
  assert.equal(availability.requestedDurationMinutes, 120);
  assert.equal(availability.nextAvailableAt, localScheduleIso(scheduleDate, 12, 0));
});

test('internal dashboard orders can overlap even when public schedule is blocked', async (t) => {
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

  const firstSchedule = localScheduleIso(scheduleDate, 10, 0);
  const secondSchedule = localScheduleIso(scheduleDate, 10, 30);
  const first = await createIntakeOrder(apiUrl, product.id, `${suffix}-first`, firstSchedule, 14, 'INTERNAL_DASHBOARD');
  const second = await createIntakeOrder(apiUrl, product.id, `${suffix}-second`, secondSchedule, 14, 'INTERNAL_DASHBOARD');

  created.orderIds.push(first.order.id, second.order.id);
  created.customerIds.push(first.intake.customerId, second.intake.customerId);

  const publicAvailability = await request(
    apiUrl,
    `/orders/public-schedule?scheduledAt=${encodeURIComponent(firstSchedule)}&totalBroas=14`
  );

  assert.equal(publicAvailability.requestedAvailable, false);
  assert.equal(publicAvailability.reason, 'SLOT_TAKEN');
  assert.equal(publicAvailability.nextAvailableAt, localScheduleIso(scheduleDate, 11, 30));

  const updated = await request(apiUrl, `/orders/${second.order.id}`, {
    method: 'PUT',
    body: {
      scheduledAt: firstSchedule
    }
  });

  assert.equal(updated.id, second.order.id);
  assert.equal(updated.scheduledAt, firstSchedule);
});
