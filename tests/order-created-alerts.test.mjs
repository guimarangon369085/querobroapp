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
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function waitFor(fn, timeoutMs = 4000, intervalMs = 50) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fn()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('Tempo esgotado aguardando notificacao.'));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function applyAlertEnv(env) {
  const keys = [
    'ORDER_ALERT_WHATSAPP_TO',
    'ORDER_ALERT_WEBHOOK_URL',
    'ORDER_ALERT_WEBHOOK_BEARER_TOKEN',
    'ORDER_ALERT_WEBHOOK_TIMEOUT_MS',
    'ORDER_ALERT_OPERATIONS_URL'
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

test('order created alert: dispara webhook uma vez so mesmo com retry idempotente', async (t) => {
  const hits = [];
  const webhook = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    hits.push({
      url: req.url,
      body: body ? JSON.parse(body) : null
    });
    res.writeHead(204).end();
  });
  const address = await listen(webhook);
  const restoreEnv = applyAlertEnv({
    ORDER_ALERT_WHATSAPP_TO: '',
    ORDER_ALERT_WEBHOOK_URL: `http://127.0.0.1:${address.port}/order-created`,
    ORDER_ALERT_WEBHOOK_TIMEOUT_MS: '1500',
    ORDER_ALERT_OPERATIONS_URL: 'https://querobroa.com.br/pedidos'
  });

  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    orderId: null,
    customerId: null,
    productId: null
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
    if (created.productId) {
      try {
        await request(apiUrl, `/inventory-products/${created.productId}`, { method: 'DELETE' });
      } catch {}
    }
    await shutdown();
    restoreEnv();
    await closeServer(webhook);
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Alerta Pedido ${suffix}`,
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
      name: `Cliente Alerta ${suffix}`,
      phone: '11988887777',
      address: 'Rua Alerta, 10'
    },
    fulfillment: {
      mode: 'PICKUP',
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
      channel: 'WHATSAPP_FLOW',
      externalId: `alert-${suffix}`,
      idempotencyKey: `alert-${suffix}`
    }
  };

  const first = await request(apiUrl, '/orders/intake/whatsapp-flow', {
    method: 'POST',
    body: payload
  });
  const second = await request(apiUrl, '/orders/intake/whatsapp-flow', {
    method: 'POST',
    body: payload
  });

  created.orderId = first.order.id;
  created.customerId = first.intake.customerId;

  assert.equal(second.order.id, first.order.id);
  await waitFor(() => hits.length > 0);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].body.event, 'order.created');
  assert.equal(hits[0].body.order.id, first.order.id);
  assert.equal(hits[0].body.intake.channel, 'WHATSAPP_FLOW');
  assert.match(hits[0].body.message, /Novo pedido #/);
});

test('order created alert: falha no webhook nao bloqueia o pedido', async (t) => {
  let hitCount = 0;
  const failingWebhook = http.createServer(async (_req, res) => {
    hitCount += 1;
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'forced failure' }));
  });
  const address = await listen(failingWebhook);
  const restoreEnv = applyAlertEnv({
    ORDER_ALERT_WHATSAPP_TO: '',
    ORDER_ALERT_WEBHOOK_URL: `http://127.0.0.1:${address.port}/broken`,
    ORDER_ALERT_WEBHOOK_TIMEOUT_MS: '1500'
  });

  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    orderId: null,
    customerId: null,
    productId: null
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
    if (created.productId) {
      try {
        await request(apiUrl, `/inventory-products/${created.productId}`, { method: 'DELETE' });
      } catch {}
    }
    await shutdown();
    restoreEnv();
    await closeServer(failingWebhook);
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Alerta Falha ${suffix}`,
      category: 'Teste',
      unit: 'cx',
      price: 40,
      active: true
    }
  });
  created.productId = product.id;

  const response = await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      version: 1,
      intent: 'CONFIRMED',
      customer: {
        name: `Cliente Falha ${suffix}`,
        phone: '11977776666',
        address: 'Rua Falha, 20'
      },
      fulfillment: {
        mode: 'PICKUP',
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
        channel: 'INTERNAL_DASHBOARD',
        originLabel: 'test-alert-failure'
      }
    }
  });

  created.orderId = response.order.id;
  created.customerId = response.intake.customerId;

  assert.ok(response.order.id);
  await waitFor(() => hitCount > 0);
  assert.ok(hitCount > 0);
});
