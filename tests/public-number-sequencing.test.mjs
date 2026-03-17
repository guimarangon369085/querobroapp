import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

test('clientes e pedidos novos recebem numeracao publica sequencial', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    orderIds: [],
    productId: null,
    customerIds: []
  };

  t.after(async () => {
    for (const orderId of created.orderIds) {
      try {
        await request(apiUrl, `/orders/${orderId}`, { method: 'DELETE' });
      } catch {}
    }

    if (created.productId) {
      try {
        await request(apiUrl, `/inventory-products/${created.productId}`, { method: 'DELETE' });
      } catch {}
    }

    for (const customerId of created.customerIds) {
      try {
        await request(apiUrl, `/customers/${customerId}`, { method: 'DELETE' });
      } catch {}
    }

    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Public-number broa ${suffix}`,
      category: 'Teste',
      unit: 'un',
      price: 5,
      active: true
    }
  });
  created.productId = product.id;

  const customerOne = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: `Cliente publico A ${suffix}`,
      phone: `11991${Math.floor(Math.random() * 900000 + 100000)}`,
      address: 'Rua Sequencial, 10'
    }
  });
  const customerTwo = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: `Cliente publico B ${suffix}`,
      phone: `11992${Math.floor(Math.random() * 900000 + 100000)}`,
      address: 'Rua Sequencial, 20'
    }
  });
  created.customerIds.push(customerOne.id, customerTwo.id);

  assert.ok(customerOne.publicNumber > 0);
  assert.equal(customerTwo.publicNumber, customerOne.publicNumber + 1);

  const orderOne = await request(apiUrl, '/orders', {
    method: 'POST',
    body: {
      customerId: customerOne.id,
      fulfillmentMode: 'PICKUP',
      scheduledAt: new Date(Date.UTC(2030, 1, 10, 15, 0, 0)).toISOString(),
      items: [{ productId: product.id, quantity: 1 }]
    }
  });
  const orderTwo = await request(apiUrl, '/orders', {
    method: 'POST',
    body: {
      customerId: customerTwo.id,
      fulfillmentMode: 'PICKUP',
      scheduledAt: new Date(Date.UTC(2030, 1, 11, 15, 0, 0)).toISOString(),
      items: [{ productId: product.id, quantity: 2 }]
    }
  });
  created.orderIds.push(orderOne.id, orderTwo.id);

  assert.ok(orderOne.publicNumber > 0);
  assert.equal(orderTwo.publicNumber, orderOne.publicNumber + 1);

  const customerList = await request(apiUrl, '/customers');
  const listedCustomerOne = customerList.find((entry) => entry.id === customerOne.id);
  const listedCustomerTwo = customerList.find((entry) => entry.id === customerTwo.id);
  assert.equal(listedCustomerOne.publicNumber, customerOne.publicNumber);
  assert.equal(listedCustomerTwo.publicNumber, customerTwo.publicNumber);

  const orderList = await request(apiUrl, '/orders');
  const listedOrderOne = orderList.find((entry) => entry.id === orderOne.id);
  const listedOrderTwo = orderList.find((entry) => entry.id === orderTwo.id);
  assert.equal(listedOrderOne.publicNumber, orderOne.publicNumber);
  assert.equal(listedOrderTwo.publicNumber, orderTwo.publicNumber);
});
