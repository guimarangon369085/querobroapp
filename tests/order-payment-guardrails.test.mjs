import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request, requestExpectError } from './lib/api-server.mjs';

test('payment guardrails: bloqueia overpayment e total abaixo do valor pago', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    paymentId: null,
    orderId: null,
    customerId: null,
    productId: null
  };

  t.after(async () => {
    const cleanups = [
      created.paymentId
        ? () => request(apiUrl, `/payments/${created.paymentId}`, { method: 'DELETE' })
        : null,
      created.orderId ? () => request(apiUrl, `/orders/${created.orderId}`, { method: 'DELETE' }) : null,
      created.customerId
        ? () => request(apiUrl, `/customers/${created.customerId}`, { method: 'DELETE' })
        : null,
      created.productId
        ? () => request(apiUrl, `/inventory-products/${created.productId}`, { method: 'DELETE' })
        : null
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
      name: `Guardrail broa ${suffix}`,
      category: 'Teste',
      unit: 'un',
      price: 10,
      active: true
    }
  });
  created.productId = product.id;

  const customer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: `Guardrail cliente ${suffix}`,
      phone: '11977776666',
      address: 'Rua Guardrail, 10'
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
  assert.ok(order.total > 0);

  const firstPaymentAmount = Number((order.total - 5).toFixed(2));
  const overpaymentAmount = Number((order.total - firstPaymentAmount + 0.01).toFixed(2));
  const discountThatDropsBelowPaid = Number((order.total - (firstPaymentAmount - 1)).toFixed(2));

  const payment = await request(apiUrl, '/payments', {
    method: 'POST',
    body: {
      orderId: order.id,
      amount: firstPaymentAmount,
      method: 'pix',
      status: 'PAGO'
    }
  });
  created.paymentId = payment.id;
  assert.equal(payment.amount, firstPaymentAmount);

  await requestExpectError(apiUrl, '/payments', 400, {
    method: 'POST',
    body: {
      orderId: order.id,
      amount: overpaymentAmount,
      method: 'pix',
      status: 'PAGO'
    }
  });

  await requestExpectError(apiUrl, `/orders/${order.id}`, 400, {
    method: 'PUT',
    body: {
      discount: discountThatDropsBelowPaid
    }
  });

  const finalOrder = await request(apiUrl, `/orders/${order.id}`);
  assert.equal(finalOrder.total, order.total);
  assert.equal(finalOrder.amountPaid, firstPaymentAmount);
  assert.equal(finalOrder.balanceDue, Number((order.total - firstPaymentAmount).toFixed(2)));
  assert.equal(finalOrder.paymentStatus, 'PARCIAL');
});
