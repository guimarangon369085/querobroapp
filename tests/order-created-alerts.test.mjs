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

function localScheduleIso(year, monthIndex, day, hour, minute) {
  return new Date(Date.UTC(year, monthIndex, day, hour + 3, minute, 0, 0)).toISOString();
}

function uniqueScheduleIso(seed, slotOffset = 0) {
  const digits = String(seed || '').replace(/\D/g, '');
  const numeric = Number(digits.slice(-6) || '0');
  const day = 20 + (numeric % 8);
  const slot = (Math.floor(numeric / 8) + slotOffset) % 40;
  const hour = 8 + Math.floor(slot / 4);
  const minute = (slot % 4) * 15;
  return localScheduleIso(2030, 1, day, hour, minute);
}

async function nextAvailableSchedule(apiUrl, requestedAt) {
  const availability = await request(apiUrl, `/orders/public-schedule?scheduledAt=${encodeURIComponent(requestedAt)}`);
  return availability.requestedAvailable ? requestedAt : availability.nextAvailableAt;
}

function applyAlertEnv(env) {
  const keys = [
    'ORDER_ALERT_NTFY_TOPIC_URL',
    'ORDER_ALERT_NTFY_PRIORITY',
    'ORDER_ALERT_NTFY_TAGS',
    'ORDER_ALERT_WEBHOOK_URL',
    'ORDER_ALERT_WEBHOOK_BEARER_TOKEN',
    'ORDER_ALERT_WEBHOOK_TIMEOUT_MS',
    'ORDER_ALERT_OPERATIONS_URL',
    'WHATSAPP_CLOUD_API_TOKEN',
    'WHATSAPP_CLOUD_PHONE_NUMBER_ID',
    'WHATSAPP_CLOUD_API_VERSION',
    'WHATSAPP_CLOUD_API_BASE_URL'
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

test('order created alert: publica no ntfy uma vez so mesmo com retry idempotente', async (t) => {
  const hits = [];
  const webhook = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    hits.push({
      headers: req.headers,
      url: req.url,
      body
    });
    res.writeHead(204).end();
  });
  const address = await listen(webhook);
  const restoreEnv = applyAlertEnv({
    ORDER_ALERT_NTFY_TOPIC_URL: `http://127.0.0.1:${address.port}/qbapp-orders-topic`,
    ORDER_ALERT_NTFY_PRIORITY: '5',
    ORDER_ALERT_NTFY_TAGS: 'bread,shopping_cart',
    ORDER_ALERT_WEBHOOK_URL: '',
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
  const scheduledAt = await nextAvailableSchedule(apiUrl, uniqueScheduleIso(suffix));
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
      scheduledAt
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
  assert.equal(hits[0].url, '/qbapp-orders-topic');
  assert.equal(hits[0].headers.title, `Novo pedido #${first.order.publicNumber ?? first.order.id}`);
  assert.equal(hits[0].headers.priority, '5');
  assert.equal(hits[0].headers.click, 'https://querobroa.com.br/pedidos');
  assert.match(hits[0].body, /Novo pedido #/);
  assert.match(hits[0].body, /Cliente:/);
});

test('order created alert: falha no ntfy nao bloqueia o pedido', async (t) => {
  let hitCount = 0;
  const failingWebhook = http.createServer(async (_req, res) => {
    hitCount += 1;
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'forced failure' }));
  });
  const address = await listen(failingWebhook);
  const restoreEnv = applyAlertEnv({
    ORDER_ALERT_NTFY_TOPIC_URL: `http://127.0.0.1:${address.port}/qbapp-orders-topic`,
    ORDER_ALERT_NTFY_PRIORITY: '5',
    ORDER_ALERT_WEBHOOK_URL: '',
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
  const scheduledAt = await nextAvailableSchedule(apiUrl, uniqueScheduleIso(suffix));
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
        scheduledAt
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

test('order created alert: nao envia confirmacao automatica ao cliente via WhatsApp', async (t) => {
  const graphHits = [];
  const graphApi = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    graphHits.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ messages: [{ id: `wamid.${graphHits.length}` }] }));
  });
  const address = await listen(graphApi);
  const restoreEnv = applyAlertEnv({
    ORDER_ALERT_NTFY_TOPIC_URL: '',
    ORDER_ALERT_WEBHOOK_URL: '',
    ORDER_ALERT_WEBHOOK_TIMEOUT_MS: '1500',
    WHATSAPP_CLOUD_API_TOKEN: 'test-token',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: '123456789',
    WHATSAPP_CLOUD_API_VERSION: 'v23.0',
    WHATSAPP_CLOUD_API_BASE_URL: `http://127.0.0.1:${address.port}`
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
    await closeServer(graphApi);
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const scheduledAt = await nextAvailableSchedule(apiUrl, uniqueScheduleIso(suffix));
  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Sem Confirmacao WhatsApp ${suffix}`,
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
      name: `Cliente Sem Confirmacao ${suffix}`,
      phone: '11940009584',
      address: 'Rua Sem Confirmacao, 30'
    },
    fulfillment: {
      mode: 'PICKUP',
      scheduledAt
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
      externalId: `confirmation-${suffix}`,
      idempotencyKey: `confirmation-${suffix}`
    }
  };

  const createdOrder = await request(apiUrl, '/orders/intake/whatsapp-flow', {
    method: 'POST',
    body: payload
  });

  created.orderId = createdOrder.order.id;
  created.customerId = createdOrder.intake.customerId;

  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.equal(graphHits.length, 0);
});
