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
