import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request, requestExpectError } from './lib/api-server.mjs';

function resolveMinimumSchedule(reference = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(formatter.formatToParts(reference).map((entry) => [entry.type, entry.value]));
  const localHour = Number(parts.hour);
  const dayOffset = localHour >= 22 ? 2 : 1;
  const targetYear = Number(parts.year);
  const targetMonth = Number(parts.month);
  const targetDay = Number(parts.day) + dayOffset;
  return new Date(Date.UTC(targetYear, targetMonth - 1, targetDay, 11, 0, 0, 0));
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

test('customer-link rejects external schedules before the minimum window', async (t) => {
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

  const body = await requestExpectError(apiUrl, '/orders/intake', 400, {
    method: 'POST',
    body: {
      version: 1,
      intent: 'CONFIRMED',
      customer: {
        name: `Cliente Schedule ${suffix}`,
        phone: '11988887777',
        address: 'Rua Schedule, 10'
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
        channel: 'CUSTOMER_LINK',
        externalId: `wpp-schedule-${suffix}`
      }
    }
  });

  assert.match(JSON.stringify(body), /agendados a partir de/i);
});
