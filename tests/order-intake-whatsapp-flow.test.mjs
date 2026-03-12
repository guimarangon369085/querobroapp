import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

test('order intake whatsapp-flow: cria pedido idempotente com cobranca PIX', async (t) => {
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
      name: `WhatsApp Flow Broa ${suffix}`,
      category: 'Teste',
      unit: 'cx',
      price: 40,
      active: true
    }
  });
  created.productId = product.id;

  const payload = {
    version: 1,
    intent: 'CONFIRMED',
    customer: {
      name: `Cliente WhatsApp ${suffix}`,
      phone: '11988887777',
      address: 'Rua WhatsApp, 10'
    },
    fulfillment: {
      mode: 'DELIVERY',
      scheduledAt: new Date(Date.UTC(2030, 1, 12, 15, 0, 0)).toISOString()
    },
    order: {
      items: [{ productId: product.id, quantity: 1 }]
    },
    payment: {
      method: 'pix',
      status: 'PENDENTE'
    },
    source: {
      externalId: `wpp-${suffix}`
    }
  };

  const first = await request(apiUrl, '/orders/intake/whatsapp-flow', {
    method: 'POST',
    body: payload
  });

  created.orderId = first.order.id;
  created.customerId = first.intake.customerId;

  assert.equal(first.intake.channel, 'WHATSAPP_FLOW');
  assert.equal(first.intake.stage, 'PIX_PENDING');
  assert.equal(first.intake.paymentMethod, 'pix');
  assert.ok(first.intake.pixCharge);
  assert.ok(first.intake.pixCharge.providerRef);
  assert.ok(first.intake.pixCharge.copyPasteCode);

  const second = await request(apiUrl, '/orders/intake/whatsapp-flow', {
    method: 'POST',
    body: payload
  });

  assert.equal(second.order.id, first.order.id);
  assert.equal(second.intake.customerId, first.intake.customerId);
  assert.equal(second.intake.pixCharge.providerRef, first.intake.pixCharge.providerRef);

  const pixCharge = await request(apiUrl, `/orders/${first.order.id}/pix-charge`);
  assert.equal(pixCharge.providerRef, first.intake.pixCharge.providerRef);
  assert.equal(pixCharge.txid, first.intake.pixCharge.txid);
});
