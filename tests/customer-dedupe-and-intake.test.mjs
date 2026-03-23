import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

async function nextAvailableSchedule(apiUrl, requestedAt) {
  const availability = await request(apiUrl, `/orders/public-schedule?scheduledAt=${encodeURIComponent(requestedAt)}`);
  return availability.requestedAvailable ? requestedAt : availability.nextAvailableAt;
}

test('customers: criar com telefone repetido reaproveita o cadastro ativo', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  let customerId = null;

  t.after(async () => {
    if (customerId) {
      try {
        await request(apiUrl, `/customers/${customerId}`, { method: 'DELETE' });
      } catch {
        // cleanup best effort
      }
    }
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const first = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: `Cliente Dedupe ${suffix}`,
      phone: '11955554444'
    }
  });
  customerId = first.id;

  const second = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: `Cliente Dedupe ${suffix}`,
      phone: '11955554444',
      address: 'Rua Consolidada, 123',
      deliveryNotes: 'Portao cinza'
    }
  });

  assert.equal(second.id, first.id);

  const hydrated = await request(apiUrl, `/customers/${first.id}`);
  assert.equal(hydrated.id, first.id);
  assert.equal(hydrated.address, 'Rua Consolidada, 123');
  assert.equal(hydrated.deliveryNotes, 'Portao cinza');
});

test('order intake google-form: nao colapsa clientes diferentes com o mesmo nome sem telefone', async (t) => {
  const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  const { apiUrl, shutdown } = await ensureApiServer();
  const createdOrderIds = [];
  const createdCustomerIds = [];

  t.after(async () => {
    for (const orderId of createdOrderIds) {
      try {
        await request(apiUrl, `/orders/${orderId}`, { method: 'DELETE' });
      } catch {
        // cleanup best effort
      }
    }
    for (const customerId of createdCustomerIds) {
      try {
        await request(apiUrl, `/customers/${customerId}`, { method: 'DELETE' });
      } catch {
        // cleanup best effort
      }
    }
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const customerName = `Cliente Mesmo Nome ${suffix}`;
  const firstSchedule = await nextAvailableSchedule(apiUrl, new Date(Date.UTC(2030, 2, 15, 14, 30, 0)).toISOString());
  const secondSchedule = await nextAvailableSchedule(
    apiUrl,
    new Date(new Date(firstSchedule).getTime() + 15 * 60 * 1000).toISOString()
  );

  const buildPayload = (externalId, address, scheduledAt) => ({
    version: 1,
    customer: {
      name: customerName,
      address
    },
    fulfillment: {
      mode: 'DELIVERY',
      scheduledAt
    },
    flavors: {
      T: 7,
      G: 0,
      D: 0,
      Q: 0,
      R: 0
    },
    source: {
      externalId
    }
  });

  const first = await request(apiUrl, '/orders/intake/google-form', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: buildPayload(`same-name-a-${suffix}`, 'Rua Alfa, 10', firstSchedule)
  });
  createdOrderIds.push(first.order.id);
  createdCustomerIds.push(first.intake.customerId);

  const second = await request(apiUrl, '/orders/intake/google-form', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: buildPayload(`same-name-b-${suffix}`, 'Rua Beta, 20', secondSchedule)
  });
  createdOrderIds.push(second.order.id);
  createdCustomerIds.push(second.intake.customerId);

  assert.notEqual(second.intake.customerId, first.intake.customerId);
  assert.equal(first.order.customer.address, 'Rua Alfa, 10');
  assert.equal(second.order.customer.address, 'Rua Beta, 20');
});
