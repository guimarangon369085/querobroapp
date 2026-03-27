import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request, requestExpectError } from './lib/api-server.mjs';

test('coupon management: CRUD interno e resolve publico', async (t) => {
  const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  const { apiUrl, shutdown } = await ensureApiServer();

  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const created = await request(apiUrl, '/dashboard/coupons', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: `broa ${suffix}`,
      discountPct: 12.5,
      usageLimitPerCustomer: 1,
      active: true
    }
  });

  assert.equal(created.code, `BROA ${suffix}`.toUpperCase());
  assert.equal(created.discountPct, 12.5);
  assert.equal(created.usageLimitPerCustomer, 1);
  assert.equal(created.active, true);

  const resolved = await request(apiUrl, '/dashboard/coupons/resolve', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: created.code.toLowerCase(),
      subtotal: 80,
      customerPhone: '31999999998'
    }
  });

  assert.equal(resolved.code, created.code);
  assert.equal(resolved.discountPct, 12.5);
  assert.equal(resolved.discountAmount, 10);
  assert.equal(resolved.subtotalAfterDiscount, 70);

  const updated = await request(apiUrl, `/dashboard/coupons/${created.id}`, {
    method: 'PUT',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: created.code,
      discountPct: 15,
      usageLimitPerCustomer: 2,
      active: false
    }
  });

  assert.equal(updated.discountPct, 15);
  assert.equal(updated.usageLimitPerCustomer, 2);
  assert.equal(updated.active, false);

  const invalidResolve = await requestExpectError(apiUrl, '/dashboard/coupons/resolve', 400, {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: created.code,
      subtotal: 80
    }
  });

  assert.equal(invalidResolve.message, `Cupom ${created.code} esta inativo.`);

  const removed = await request(apiUrl, `/dashboard/coupons/${created.id}`, {
    method: 'DELETE',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined
  });

  assert.deepEqual(removed, { ok: true });

  const noActiveCoupons = await requestExpectError(apiUrl, '/dashboard/coupons/resolve', 400, {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: 'DEVA',
      subtotal: 80
    }
  });

  assert.equal(noActiveCoupons.message, 'Nenhum cupom ativo cadastrado no momento.');
});

test('coupon limit por cliente bloqueia nova utilizacao e aparece no detalhe do cliente', async (t) => {
  const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  const { apiUrl, shutdown } = await ensureApiServer();

  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const coupon = await request(apiUrl, '/dashboard/coupons', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: `BROASVINDAS-${suffix}`,
      discountPct: 10,
      usageLimitPerCustomer: 1,
      active: true
    }
  });

  const scheduledAt = new Date(Date.UTC(2030, 2, 18, 15, 0, 0)).toISOString();
  const first = await request(apiUrl, '/orders/intake/customer-form', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      version: 1,
      customer: {
        name: `Cliente Boas Vindas ${suffix}`,
        phone: '31999999999'
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt
      },
      flavors: {
        T: 7,
        G: 0,
        D: 0,
        Q: 0,
        R: 0
      },
      couponCode: coupon.code,
      source: {
        externalId: `customer-form-coupon-intake-${suffix}`
      }
    }
  });

  assert.equal(first.order.couponCode, coupon.code);
  assert.equal(first.order.discount, 4);

  const secondResolve = await requestExpectError(apiUrl, '/dashboard/coupons/resolve', 400, {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: coupon.code,
      subtotal: 40,
      customerPhone: '31999999999'
    }
  });

  assert.equal(
    secondResolve.message,
    `Cupom ${coupon.code} ja atingiu o limite de 1 uso(s) para este cliente.`
  );

  const customer = await request(apiUrl, `/customers/${first.order.customerId}`, {
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined
  });

  assert.deepEqual(customer.couponUsage, [
    {
      code: coupon.code,
      uses: 1,
      lastUsedAt: customer.couponUsage[0].lastUsedAt
    }
  ]);
  assert.ok(customer.couponUsage[0].lastUsedAt);
});

test('customer-form preview aplica desconto do cupom no total e nas notas', async (t) => {
  const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  const { apiUrl, shutdown } = await ensureApiServer();

  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const coupon = await request(apiUrl, '/dashboard/coupons', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: `PROMO${suffix}`,
      discountPct: 10,
      active: true
    }
  });

  const preview = await request(apiUrl, '/orders/intake/customer-form/preview', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      version: 1,
      customer: {
        name: `Cliente Cupom ${suffix}`,
        phone: '31999999999'
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt: new Date(Date.UTC(2030, 2, 15, 14, 30, 0)).toISOString()
      },
      flavors: {
        T: 4,
        G: 3,
        D: 0,
        Q: 0,
        R: 0
      },
      couponCode: coupon.code,
      notes: 'Preview com cupom',
      source: {
        externalId: `customer-form-coupon-preview-${suffix}`
      }
    }
  });

  assert.equal(preview.fulfillmentMode, 'PICKUP');
  assert.equal(preview.order.subtotal, 45);
  assert.equal(preview.order.discount, 4.5);
  assert.equal(preview.order.deliveryFee, 0);
  assert.equal(preview.order.total, 40.5);
  assert.equal(preview.order.notes.includes(`Cupom aplicado: ${coupon.code} (10%)`), true);
});
