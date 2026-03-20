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
  const scheduledAt = new Date(Date.UTC(2032, 0, 15, 14, 0, 0)).toISOString();

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
      scheduledAt,
      items: [{ productId: product.id, quantity: 1 }]
    }
  });
  created.orderId = order.id;

  const delivered = await request(apiUrl, `/orders/${order.id}/status`, {
    method: 'PATCH',
    body: { status: 'ENTREGUE' }
  });
  assert.equal(delivered.status, 'ENTREGUE');

  const backToConfirmado = await request(apiUrl, `/orders/${order.id}/status`, {
    method: 'PATCH',
    body: { status: 'CONFIRMADO' }
  });
  assert.equal(backToConfirmado.status, 'CONFIRMADO');

  const backToAberto = await request(apiUrl, `/orders/${order.id}/status`, {
    method: 'PATCH',
    body: { status: 'ABERTO' }
  });
  assert.equal(backToAberto.status, 'ABERTO');

  const cancelled = await request(apiUrl, `/orders/${order.id}/status`, {
    method: 'PATCH',
    body: { status: 'CANCELADO' }
  });
  assert.equal(cancelled.status, 'CANCELADO');

  await requestExpectError(apiUrl, `/orders/${order.id}/status`, 400, {
    method: 'PATCH',
    body: { status: 'PRONTO' }
  });

  await request(apiUrl, `/customers/${customer.id}`, { method: 'DELETE' });

  const orderAfterDelete = await request(apiUrl, `/orders/${order.id}`);
  assert.ok(orderAfterDelete.customer?.deletedAt, 'Order still references deleted customer');

  await requestExpectError(apiUrl, '/orders', 400, {
    method: 'POST',
    body: {
      customerId: customer.id,
      scheduledAt,
      items: [{ productId: product.id, quantity: 1 }]
    }
  });
});
