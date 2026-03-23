import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

test('order intake google-form: cria pedido idempotente usando contagem de sabores', async (t) => {
  const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    orderId: null,
    customerId: null
  };

  t.after(async () => {
    const cleanups = [
      created.orderId ? () => request(apiUrl, `/orders/${created.orderId}`, { method: 'DELETE' }) : null,
      created.customerId ? () => request(apiUrl, `/customers/${created.customerId}`, { method: 'DELETE' }) : null
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

  const products = await request(apiUrl, '/inventory-products');
  const items = (products.items || products).filter((entry) => entry.active !== false);
  const hasTraditional = items.some((entry) => /tradicional/i.test(entry.name || ''));
  const hasGoiabada = items.some((entry) => /goiabada/i.test(entry.name || ''));

  assert.equal(hasTraditional, true);
  assert.equal(hasGoiabada, true);

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const payload = {
    version: 1,
    customer: {
      name: `Cliente Google Forms ${suffix}`,
      phone: '11977776666',
      address: 'Rua Forms, 12',
      deliveryNotes: 'Portao azul'
    },
    fulfillment: {
      mode: 'DELIVERY',
      scheduledAt: new Date(Date.UTC(2030, 2, 15, 14, 30, 0)).toISOString()
    },
    flavors: {
      T: 4,
      G: 3,
      D: 0,
      Q: 0,
      R: 0
    },
    notes: 'Pedido vindo do Google Forms',
    source: {
      externalId: `google-form-${suffix}`
    }
  };

  const first = await request(apiUrl, '/orders/intake/google-form', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: payload
  });

  created.orderId = first.order.id;
  created.customerId = first.intake.customerId;

  assert.equal(first.intake.channel, 'CUSTOMER_LINK');
  assert.equal(first.intake.stage, 'PIX_PENDING');
  assert.equal(first.order.items.length, 2);
  assert.equal(first.order.customer.name.includes('Cliente Google Forms'), true);
  assert.ok(first.intake.pixCharge?.copyPasteCode);

  const second = await request(apiUrl, '/orders/intake/google-form', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: payload
  });

  assert.equal(second.order.id, first.order.id);
  assert.equal(second.intake.customerId, first.intake.customerId);
  assert.equal(second.intake.pixCharge?.providerRef, first.intake.pixCharge?.providerRef);
});
