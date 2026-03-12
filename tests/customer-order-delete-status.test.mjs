import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request, requestExpectError } from './lib/api-server.mjs';

test('soft delete customer still referenced by order and status rollback', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    orderId: null,
    productId: null,
    customerId: null
  };

  t.after(async () => {
    const cleanups = [
      created.orderId ? () => request(apiUrl, `/orders/${created.orderId}`, { method: 'DELETE' }) : null,
      created.productId ? () => request(apiUrl, `/inventory-products/${created.productId}`, { method: 'DELETE' }) : null
    ].filter(Boolean);

    for (const cleanup of cleanups) {
      try {
        await cleanup();
      } catch {
        // best effort
      }
    }

    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Delete-flow broa ${suffix}`,
      category: 'Teste',
      unit: 'un',
      price: 1,
      active: true
    }
  });
  created.productId = product.id;

  const customer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: `Delete-flow cliente ${suffix}`,
      phone: '11988881111',
      address: 'Rua Exemplo, 100'
    }
  });
  created.customerId = customer.id;

  const order = await request(apiUrl, '/orders', {
    method: 'POST',
    body: {
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 1 }]
    }
  });
  created.orderId = order.id;

  const statusSequence = ['CONFIRMADO', 'EM_PREPARACAO', 'PRONTO', 'ENTREGUE'];
  for (const status of statusSequence) {
    const updated = await request(apiUrl, `/orders/${order.id}/status`, {
      method: 'PATCH',
      body: { status }
    });
    assert.equal(updated.status, status);
  }

  const backToPronto = await request(apiUrl, `/orders/${order.id}/status`, {
    method: 'PATCH',
    body: { status: 'PRONTO' }
  });
  assert.equal(backToPronto.status, 'PRONTO');

  const cancelled = await request(apiUrl, `/orders/${order.id}/status`, {
    method: 'PATCH',
    body: { status: 'CANCELADO' }
  });
  assert.equal(cancelled.status, 'CANCELADO');

  await request(apiUrl, `/customers/${customer.id}`, { method: 'DELETE' });

  const orderAfterDelete = await request(apiUrl, `/orders/${order.id}`);
  assert.ok(orderAfterDelete.customer?.deletedAt, 'Order still references deleted customer');

  await requestExpectError(apiUrl, '/orders', 400, {
    method: 'POST',
    body: {
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 1 }]
    }
  });
});
