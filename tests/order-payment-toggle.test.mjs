import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

test('payment toggle: alterna entre pago e nao pago sem depender do status operacional', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    orderId: null,
    customerId: null,
    productId: null
  };

  t.after(async () => {
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

  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Toggle pagamento ${suffix}`,
      category: 'Teste',
      unit: 'un',
      price: 25,
      active: true
    }
  });
  created.productId = product.id;

  const customer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: `Cliente toggle ${suffix}`,
      phone: '11955554444',
      address: 'Rua Toggle, 10'
    }
  });
  created.customerId = customer.id;

  const order = await request(apiUrl, '/orders', {
    method: 'POST',
    body: {
      customerId: customer.id,
      fulfillmentMode: 'PICKUP',
      items: [{ productId: product.id, quantity: 2 }]
    }
  });
  created.orderId = order.id;

  const delivered = await request(apiUrl, `/orders/${order.id}/status`, {
    method: 'PATCH',
    body: {
      status: 'ENTREGUE'
    }
  });
  assert.equal(delivered.status, 'ENTREGUE');
  assert.equal(delivered.paymentStatus, 'PENDENTE');

  const paid = await request(apiUrl, `/orders/${order.id}/mark-paid`, {
    method: 'PATCH',
    body: {}
  });
  assert.equal(paid.status, 'ENTREGUE');
  assert.equal(paid.paymentStatus, 'PAGO');

  const unpaid = await request(apiUrl, `/orders/${order.id}/mark-paid`, {
    method: 'PATCH',
    body: {
      paid: false
    }
  });
  assert.equal(unpaid.status, 'ENTREGUE');
  assert.equal(unpaid.paymentStatus, 'PENDENTE');
  assert.equal(unpaid.amountPaid, 0);

  const repaid = await request(apiUrl, `/orders/${order.id}/mark-paid`, {
    method: 'PATCH',
    body: {
      paid: true
    }
  });
  assert.equal(repaid.status, 'ENTREGUE');
  assert.equal(repaid.paymentStatus, 'PAGO');
});
