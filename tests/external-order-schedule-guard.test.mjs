import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request, requestExpectError } from './lib/api-server.mjs';

function resolveMinimumSchedule(reference = new Date()) {
  const minimum = new Date(reference);
  const dayOffset = minimum.getHours() >= 22 ? 2 : 1;
  minimum.setDate(minimum.getDate() + dayOffset);
  minimum.setHours(8, 0, 0, 0);
  return minimum;
}

function invalidExternalScheduleIso(reference = new Date()) {
  const invalid = new Date(resolveMinimumSchedule(reference).getTime() - 15 * 60_000);
  return invalid.toISOString();
}

test('delivery quotes reject external schedules before the minimum window', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();

  t.after(async () => {
    await shutdown();
  });

  await requestExpectError(apiUrl, '/deliveries/quotes', 400, {
    method: 'POST',
    body: {
      mode: 'DELIVERY',
      scheduledAt: invalidExternalScheduleIso(),
      customer: {
        name: 'Cliente Quote',
        phone: '11999998888',
        address: 'Rua Quote, 10',
        placeId: null,
        lat: null,
        lng: null,
        deliveryNotes: null
      },
      manifest: {
        items: [{ name: 'Tradicional', quantity: 1 }],
        subtotal: 40,
        totalUnits: 7
      }
    }
  });
});

test('whatsapp-flow rejects external schedules before the minimum window', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    productId: null
  };

  t.after(async () => {
    if (created.productId) {
      try {
        await request(apiUrl, `/inventory-products/${created.productId}`, { method: 'DELETE' });
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
      name: `Schedule Guard Broa ${suffix}`,
      category: 'Teste',
      unit: 'cx',
      price: 40,
      active: true
    }
  });
  created.productId = product.id;

  const body = await requestExpectError(apiUrl, '/orders/intake/whatsapp-flow', 400, {
    method: 'POST',
    body: {
      version: 1,
      intent: 'CONFIRMED',
      customer: {
        name: `Cliente Schedule ${suffix}`,
        phone: '11988887777',
        address: 'Rua WhatsApp, 10'
      },
      fulfillment: {
        mode: 'DELIVERY',
        scheduledAt: invalidExternalScheduleIso()
      },
      order: {
        items: [{ productId: product.id, quantity: 1 }]
      },
      payment: {
        method: 'pix',
        status: 'PENDENTE'
      },
      source: {
        externalId: `wpp-schedule-${suffix}`
      }
    }
  });

  assert.match(JSON.stringify(body), /agendados para o dia seguinte/i);
});
