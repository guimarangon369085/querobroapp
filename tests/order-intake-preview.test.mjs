import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

test('order intake google-form preview: valida payload sem criar pedido', async (t) => {
  const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  const { apiUrl, shutdown } = await ensureApiServer();

  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const preview = await request(apiUrl, '/orders/intake/google-form/preview', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      version: 1,
      customer: {
        name: `Cliente Preview ${suffix}`,
        phone: '11977776666',
        address: 'Rua Preview, 12',
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
      notes: 'Preview vindo do Google Forms',
      source: {
        externalId: `google-form-preview-${suffix}`
      }
    }
  });

  assert.equal(preview.channel, 'CUSTOMER_LINK');
  assert.equal(preview.expectedStage, 'PIX_PENDING');
  assert.equal(preview.fulfillmentMode, 'DELIVERY');
  assert.equal('orderId' in preview, false);
  assert.equal(preview.order.items.length, 2);
  assert.equal(preview.order.totalUnits, 7);
  assert.equal(preview.payment.method, 'pix');
  assert.equal(preview.payment.payable, false);
  assert.equal(typeof preview.order.total, 'number');
  assert.equal(preview.order.total >= preview.order.subtotal, true);
});

test('order intake google-form preview: aceita items explicitos para sabor dinamico', async (t) => {
  const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    traditionalProductId: null,
    specialProductId: null
  };

  t.after(async () => {
    const cleanups = [
      created.specialProductId
        ? () => request(apiUrl, `/inventory-products/${created.specialProductId}`, { method: 'DELETE' })
        : null,
      created.traditionalProductId
        ? () => request(apiUrl, `/inventory-products/${created.traditionalProductId}`, { method: 'DELETE' })
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
  const traditionalProduct = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Broa Tradicional (T) [TESTE_E2E] ${suffix}`,
      category: 'Sabores',
      unit: 'unidade',
      price: 40,
      active: true
    }
  });
  created.traditionalProductId = traditionalProduct.id;

  const specialProduct = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Broa Especial [TESTE_E2E] ${suffix}`,
      category: 'Sabores',
      unit: 'unidade',
      price: 55,
      active: true
    }
  });
  created.specialProductId = specialProduct.id;

  const preview = await request(apiUrl, '/orders/intake/google-form/preview', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      version: 1,
      customer: {
        name: `Cliente Preview Dinamico ${suffix}`,
        phone: '11977776666'
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt: new Date(Date.UTC(2030, 2, 15, 14, 30, 0)).toISOString()
      },
      items: [
        { productId: traditionalProduct.id, quantity: 4 },
        { productId: specialProduct.id, quantity: 3 }
      ],
      notes: 'Preview com items explicitos',
      source: {
        externalId: `google-form-preview-items-${suffix}`
      }
    }
  });

  assert.equal(preview.channel, 'CUSTOMER_LINK');
  assert.equal(preview.fulfillmentMode, 'PICKUP');
  assert.equal(preview.order.items.length, 2);
  assert.equal(preview.order.totalUnits, 7);
  assert.equal(preview.order.subtotal, 47);
  assert.equal(preview.order.items.some((item) => item.productId === specialProduct.id), true);
});
