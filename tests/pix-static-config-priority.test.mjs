import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

function validExternalScheduleIso(reference = new Date()) {
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
  return new Date(Date.UTC(targetYear, targetMonth - 1, targetDay, 11, 0, 0, 0)).toISOString();
}

test('pix estatico prioriza o perfil oficial mesmo com PIX_* legado no runtime', async (t) => {
  const previousEnv = {
    PIX_PROVIDER: process.env.PIX_PROVIDER,
    PIX_STATIC_KEY: process.env.PIX_STATIC_KEY,
    PIX_RECEIVER_NAME: process.env.PIX_RECEIVER_NAME,
    PIX_RECEIVER_CITY: process.env.PIX_RECEIVER_CITY,
    BUSINESS_PIX_KEY: process.env.BUSINESS_PIX_KEY,
    BUSINESS_BRAND_NAME: process.env.BUSINESS_BRAND_NAME,
    BUSINESS_CITY: process.env.BUSINESS_CITY
  };

  process.env.PIX_PROVIDER = 'STATIC_PIX';
  process.env.PIX_STATIC_KEY = '+55 31 98480-7515';
  process.env.PIX_RECEIVER_NAME = 'QUERO BROA';
  process.env.PIX_RECEIVER_CITY = 'BELO HORIZONTE';
  delete process.env.BUSINESS_PIX_KEY;
  delete process.env.BUSINESS_BRAND_NAME;
  delete process.env.BUSINESS_CITY;

  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    orderId: null,
    customerId: null,
    productId: null
  };

  t.after(async () => {
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (typeof value === 'undefined') {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });

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
  const uniquePhone = `11${String(Date.now()).slice(-9)}`;

  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `PIX prioridade ${suffix}`,
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
      name: `Cliente PIX ${suffix}`,
      phone: uniquePhone,
      address: 'Rua PIX Oficial, 10'
    }
  });
  created.customerId = customer.id;

  const intake = await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      intent: 'CONFIRMED',
      customer: {
        customerId: customer.id
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt: validExternalScheduleIso()
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
        externalId: `pix-priority-${suffix}`
      }
    }
  });
  created.orderId = intake.order.id;

  const copyPasteCode = intake.intake.pixCharge?.copyPasteCode || '';
  assert.ok(copyPasteCode.includes('+5511994009584'));
  assert.ok(copyPasteCode.includes('SAO PAULO'));
  assert.ok(copyPasteCode.includes('QUEROBROA'));
  assert.ok(!copyPasteCode.includes('+5531984807515'));
  assert.ok(!copyPasteCode.includes('BELO HORIZONTE'));
  assert.ok(!copyPasteCode.includes('QUERO BROA'));
});
