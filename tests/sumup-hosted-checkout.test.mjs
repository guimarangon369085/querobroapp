import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
        return;
      }
      resolve();
    });
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}

function createFakeSumUpServer() {
  const checkouts = new Map();
  let sequence = 0;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const body = rawBody ? JSON.parse(rawBody) : null;

    if (req.method === 'POST' && url.pathname === '/v0.1/checkouts') {
      sequence += 1;
      const id = `sumup-checkout-${sequence}`;
      const checkout = {
        id,
        amount: Number(body?.amount || 0),
        checkout_reference: String(body?.checkout_reference || `ref-${sequence}`),
        currency: String(body?.currency || 'BRL'),
        description: String(body?.description || ''),
        merchant_code: String(body?.merchant_code || 'MTEST123'),
        redirect_url: typeof body?.redirect_url === 'string' ? body.redirect_url : null,
        return_url: typeof body?.return_url === 'string' ? body.return_url : null,
        hosted_checkout: { enabled: true },
        hosted_checkout_url: `https://checkout.sumup.test/pay/${id}`,
        status: 'PENDING',
        valid_until: '2030-02-15T15:30:00.000Z'
      };
      checkouts.set(id, checkout);
      res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      res.end(JSON.stringify(checkout));
      return;
    }

    const checkoutMatch = url.pathname.match(/^\/v0\.1\/checkouts\/([^/]+)$/);
    if (req.method === 'GET' && checkoutMatch) {
      const checkout = checkouts.get(decodeURIComponent(checkoutMatch[1]));
      if (!checkout) {
        res.writeHead(404, { 'content-type': 'application/json', connection: 'close' });
        res.end(JSON.stringify({ message: 'Checkout not found' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      res.end(JSON.stringify(checkout));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify({ message: 'Not found' }));
  });

  return {
    server,
    getCheckout(id) {
      return checkouts.get(id) || null;
    },
    setStatus(id, status) {
      const current = checkouts.get(id);
      if (!current) return false;
      checkouts.set(id, {
        ...current,
        status
      });
      return true;
    }
  };
}

function applySumUpEnv(env) {
  const keys = [
    'SUMUP_API_KEY',
    'SUMUP_MERCHANT_CODE',
    'SUMUP_API_BASE_URL',
    'APP_PUBLIC_BASE_URL'
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  for (const key of keys) {
    const nextValue = env[key];
    if (typeof nextValue === 'undefined') {
      delete process.env[key];
      continue;
    }
    process.env[key] = nextValue;
  }

  return () => {
    for (const key of keys) {
      const prior = previous[key];
      if (typeof prior === 'undefined') {
        delete process.env[key];
      } else {
        process.env[key] = prior;
      }
    }
  };
}

test('sumup hosted checkout: preview e intake público respeitam cartão e idempotência', async (t) => {
  const fakeSumUp = createFakeSumUpServer();
  const address = await listen(fakeSumUp.server);
  const restoreEnv = applySumUpEnv({
    SUMUP_API_KEY: 'sumup-test-key',
    SUMUP_MERCHANT_CODE: 'MTEST123',
    SUMUP_API_BASE_URL: `http://127.0.0.1:${address.port}`,
    APP_PUBLIC_BASE_URL: 'https://querobroa.com.br'
  });
  const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    orderId: null,
    customerId: null
  };

  t.after(async () => {
    if (created.orderId) {
      try {
        await request(apiUrl, `/orders/${created.orderId}`, { method: 'DELETE' });
      } catch {}
    }
    if (created.customerId) {
      try {
        await request(apiUrl, `/customers/${created.customerId}`, { method: 'DELETE' });
      } catch {}
    }
    await shutdown();
    restoreEnv();
    await closeServer(fakeSumUp.server);
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const payload = {
    version: 1,
    customer: {
      name: `Cliente Cartão ${suffix}`,
      phone: '11977776666',
      address: 'Rua Cartão, 10',
      addressLine1: 'Rua Cartão, 10',
      addressLine2: 'Apto 12',
      neighborhood: 'Centro',
      city: 'São Paulo',
      state: 'SP',
      postalCode: '01234-000',
      country: 'BR',
      placeId: 'sumup-test-place'
    },
    fulfillment: {
      mode: 'DELIVERY',
      scheduledAt: new Date(Date.UTC(2030, 2, 15, 14, 30, 0)).toISOString()
    },
    paymentMethod: 'card',
    flavors: {
      T: 4,
      G: 3,
      D: 0,
      Q: 0,
      R: 0,
      RJ: 0
    },
    notes: 'Pedido com checkout SumUp',
    source: {
      externalId: `sumup-card-${suffix}`
    }
  };

  const preview = await request(apiUrl, '/orders/intake/customer-form/preview', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: payload
  });
  assert.equal(preview.expectedStage, 'PAYMENT_PENDING');
  assert.equal(preview.payment.method, 'card');

  const first = await request(apiUrl, '/orders/intake/customer-form', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: payload
  });
  created.orderId = first.order.id;
  created.customerId = first.intake.customerId;

  assert.equal(first.intake.paymentMethod, 'card');
  assert.equal(first.intake.stage, 'PAYMENT_PENDING');
  assert.equal(first.intake.pixCharge, null);
  assert.equal(first.intake.cardCheckout.provider, 'SUMUP');
  assert.match(first.intake.cardCheckout.hostedCheckoutUrl, /^https:\/\/checkout\.sumup\.test\/pay\//);
  assert.equal(preview.order.total > first.order.total, true);
  assert.equal(fakeSumUp.getCheckout(first.intake.cardCheckout.checkoutId)?.amount, preview.order.total);
  assert.equal(
    fakeSumUp.getCheckout(first.intake.cardCheckout.checkoutId)?.checkout_reference,
    first.intake.cardCheckout.reference
  );

  const second = await request(apiUrl, '/orders/intake/customer-form', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: payload
  });

  assert.equal(second.order.id, first.order.id);
  assert.equal(second.intake.cardCheckout.checkoutId, first.intake.cardCheckout.checkoutId);
  assert.equal(second.intake.cardCheckout.hostedCheckoutUrl, first.intake.cardCheckout.hostedCheckoutUrl);
});

test('sumup hosted checkout: webhook liquida pagamento do pedido', async (t) => {
  const fakeSumUp = createFakeSumUpServer();
  const address = await listen(fakeSumUp.server);
  const restoreEnv = applySumUpEnv({
    SUMUP_API_KEY: 'sumup-test-key',
    SUMUP_MERCHANT_CODE: 'MTEST123',
    SUMUP_API_BASE_URL: `http://127.0.0.1:${address.port}`,
    APP_PUBLIC_BASE_URL: 'https://querobroa.com.br'
  });
  const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    orderId: null,
    customerId: null
  };

  t.after(async () => {
    if (created.orderId) {
      try {
        await request(apiUrl, `/orders/${created.orderId}`, { method: 'DELETE' });
      } catch {}
    }
    if (created.customerId) {
      try {
        await request(apiUrl, `/customers/${created.customerId}`, { method: 'DELETE' });
      } catch {}
    }
    await shutdown();
    restoreEnv();
    await closeServer(fakeSumUp.server);
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const intake = await request(apiUrl, '/orders/intake/customer-form', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      version: 1,
      customer: {
        name: `Cliente Webhook ${suffix}`,
        phone: '11977776666',
        address: 'Rua Webhook, 10',
        addressLine1: 'Rua Webhook, 10',
        addressLine2: 'Casa',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        postalCode: '01234-000',
        country: 'BR',
        placeId: 'sumup-test-place-webhook'
      },
      fulfillment: {
        mode: 'DELIVERY',
        scheduledAt: new Date(Date.UTC(2030, 2, 16, 14, 30, 0)).toISOString()
      },
      paymentMethod: 'card',
      flavors: {
        T: 7,
        G: 0,
        D: 0,
        Q: 0,
        R: 0,
        RJ: 0
      },
      source: {
        externalId: `sumup-card-webhook-${suffix}`
      }
    }
  });

  created.orderId = intake.order.id;
  created.customerId = intake.intake.customerId;
  const checkoutId = intake.intake.cardCheckout.checkoutId;
  assert.equal(fakeSumUp.setStatus(checkoutId, 'PAID'), true);

  const webhookResult = await request(apiUrl, '/payments/sumup/webhook', {
    method: 'POST',
    body: {
      event_type: 'CHECKOUT_STATUS_CHANGED',
      id: checkoutId
    }
  });

  assert.equal(webhookResult.ok, true);
  assert.equal(webhookResult.cardCheckout.status, 'PAID');
  assert.equal(webhookResult.payment.status, 'PAGO');

  const order = await request(apiUrl, `/orders/${intake.order.id}`);
  assert.equal(order.paymentStatus, 'PAGO');
  assert.equal(order.payments.some((payment) => payment.method === 'card' && payment.status === 'PAGO'), true);
});
