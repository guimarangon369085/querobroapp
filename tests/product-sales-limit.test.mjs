import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request, requestExpectError } from './lib/api-server.mjs';

function uniqueSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function futureIsoAt(daysAhead, hour) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

test('limited product auto-inactivates when configured box quota is exhausted', async (t) => {
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
    if (created.productId) {
      try {
        await request(apiUrl, `/inventory-products/${created.productId}`, { method: 'DELETE' });
      } catch {}
    }
    await shutdown();
  });

  const suffix = uniqueSuffix();
  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Broa Limite ${suffix}`,
      category: 'Sabores',
      unit: 'unidade',
      price: 52,
      active: true,
      salesLimitEnabled: true,
      salesLimitBoxes: 1,
      imageUrl: '/querobroa-brand/cardapio/doce-de-leite.jpg'
    }
  });
  created.productId = product.id;

  const createdOrder = await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      version: 1,
      intent: 'CONFIRMED',
      customer: {
        name: `Cliente Limite ${suffix}`,
        phone: `1197${String(suffix.length).padStart(7, '0')}`,
        address: `Rua Limite ${suffix}, 10`
      },
      fulfillment: {
        mode: 'DELIVERY',
        scheduledAt: futureIsoAt(2, 10)
      },
      order: {
        items: [{ productId: product.id, quantity: 7 }]
      },
      payment: {
        method: 'pix',
        status: 'PENDENTE'
      },
      source: {
        channel: 'CUSTOMER_LINK',
        externalId: `limit-${suffix}`,
        idempotencyKey: `limit-${suffix}`
      }
    }
  });
  created.orderIds.push(createdOrder.order.id);
  created.customerIds.push(createdOrder.intake.customerId);

  const refreshedProduct = await request(apiUrl, `/inventory-products/${product.id}`);
  assert.equal(refreshedProduct.active, false);
  assert.equal(refreshedProduct.salesLimitEnabled, true);
  assert.equal(refreshedProduct.salesLimitExhausted, true);
  assert.equal(refreshedProduct.salesLimitRemainingBoxes, 0);

  const failedAttempt = await requestExpectError(apiUrl, '/orders/intake', 400, {
    method: 'POST',
    body: {
      version: 1,
      intent: 'CONFIRMED',
      customer: {
        name: `Cliente Limite 2 ${suffix}`,
        phone: `1196${String(suffix.length).padStart(7, '0')}`,
        address: `Rua Limite ${suffix}, 20`
      },
      fulfillment: {
        mode: 'DELIVERY',
        scheduledAt: futureIsoAt(2, 12)
      },
      order: {
        items: [{ productId: product.id, quantity: 7 }]
      },
      payment: {
        method: 'pix',
        status: 'PENDENTE'
      },
      source: {
        channel: 'CUSTOMER_LINK',
        externalId: `limit-2-${suffix}`,
        idempotencyKey: `limit-2-${suffix}`
      }
    }
  });

  assert.match(String(failedAttempt?.message || ''), /indisponivel|esgot/i);
});
