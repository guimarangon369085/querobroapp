import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

async function postJson(apiUrl, requestPath, body) {
  const response = await fetch(`${apiUrl}${requestPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const raw = await response.text();
  const parsed = raw ? JSON.parse(raw) : null;
  return {
    ok: response.ok,
    status: response.status,
    body: parsed
  };
}

async function submitWithScheduleRetry(apiUrl, requestPath, buildBody, initialScheduledAt) {
  let scheduledAt = initialScheduledAt;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await postJson(apiUrl, requestPath, buildBody(scheduledAt));
    if (response.ok) {
      return {
        scheduledAt,
        body: response.body
      };
    }

    if (
      response.status === 400 &&
      response.body &&
      (response.body.reason === 'SLOT_TAKEN' || response.body.reason === 'DAY_FULL') &&
      response.body.nextAvailableAt
    ) {
      scheduledAt = response.body.nextAvailableAt;
      continue;
    }

    throw new Error(
      `POST ${requestPath} -> ${response.status}\n${JSON.stringify(response.body)}`
    );
  }

  throw new Error(`Nao foi possivel encontrar horario disponivel para ${requestPath}.`);
}

test('whatsapp flow order intake session: launch, session e submit criam pedido canonico', async (t) => {
  const previousEnv = {
    APP_AUTH_ENABLED: process.env.APP_AUTH_ENABLED,
    WHATSAPP_CLOUD_API_TOKEN: process.env.WHATSAPP_CLOUD_API_TOKEN,
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID,
    WHATSAPP_AUTO_REPLY_ENABLED: process.env.WHATSAPP_AUTO_REPLY_ENABLED,
    WHATSAPP_FLOW_ORDER_INTAKE_ID: process.env.WHATSAPP_FLOW_ORDER_INTAKE_ID,
    WHATSAPP_FLOW_API_BASE_URL: process.env.WHATSAPP_FLOW_API_BASE_URL
  };

  process.env.APP_AUTH_ENABLED = 'false';
  process.env.WHATSAPP_CLOUD_API_TOKEN = '';
  process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID = '';
  process.env.WHATSAPP_AUTO_REPLY_ENABLED = 'false';
  process.env.WHATSAPP_FLOW_ORDER_INTAKE_ID = '';
  process.env.WHATSAPP_FLOW_API_BASE_URL = '';

  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    orderId: null,
    customerId: null,
    productId: null
  };

  t.after(async () => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (typeof value === 'undefined') {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

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
  const phone = `11${String(Date.now()).slice(-9)}`;
  const availability = await request(apiUrl, '/orders/public-schedule');
  const scheduledAt = availability.nextAvailableAt;
  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `WhatsApp Flow Session Broa ${suffix}`,
      category: 'Teste',
      unit: 'cx',
      price: 52,
      active: true
    }
  });
  created.productId = product.id;

  const launch = await request(apiUrl, '/whatsapp/flows/order-intake/launch', {
    method: 'POST',
    body: {
      recipientPhone: phone,
      fulfillmentMode: 'DELIVERY',
      scheduledAt,
      notes: 'Fluxo estruturado do WhatsApp'
    }
  });

  assert.match(launch.sessionId, /^[0-9a-f-]{36}$/i);
  assert.match(launch.sessionToken, /^[0-9a-f-]{36}$/i);
  assert.equal(launch.dispatchStatus, 'SKIPPED');
  assert.equal(launch.dispatchTransport, 'NONE');
  assert.equal(launch.canSendViaMeta, false);
  assert.equal(typeof launch.sessionEndpoint, 'string');
  assert.equal(typeof launch.submitEndpoint, 'string');

  const session = await request(
    apiUrl,
    `/whatsapp/flows/order-intake/sessions/${launch.sessionId}?token=${launch.sessionToken}`
  );

  assert.equal(session.sessionId, launch.sessionId);
  assert.equal(session.sessionToken, launch.sessionToken);
  assert.equal(session.status, 'PENDING');
  assert.equal(session.prefill.customerPhone, `55${phone}`);
  assert.equal(session.prefill.fulfillmentMode, 'DELIVERY');
  assert.equal(session.prefill.notes, 'Fluxo estruturado do WhatsApp');
  assert.equal(session.products.some((entry) => entry.id === product.id), true);

  const buildSubmitPayload = (resolvedScheduledAt) => ({
    sessionId: launch.sessionId,
    token: launch.sessionToken,
    customer: {
      name: `Cliente WhatsApp Flow ${suffix}`,
      phone,
      address: 'Rua do WhatsApp, 88',
      deliveryNotes: 'Casa 2'
    },
    fulfillment: {
      mode: 'DELIVERY',
      scheduledAt: resolvedScheduledAt
    },
    order: {
      items: [{ productId: product.id, quantity: 2 }],
      discount: 0,
      notes: 'Pedido criado pelo WhatsApp Flow'
    }
  });

  const submitAttempt = await submitWithScheduleRetry(
    apiUrl,
    '/whatsapp/flows/order-intake/submit',
    buildSubmitPayload,
    scheduledAt
  );
  const submitPayload = buildSubmitPayload(submitAttempt.scheduledAt);
  const submit = submitAttempt.body;

  created.orderId = submit.orderId;
  created.customerId = submit.customerId;

  assert.equal(submit.ok, true);
  assert.equal(submit.alreadyCompleted, false);
  assert.equal(typeof submit.orderId, 'number');
  assert.equal(typeof submit.customerId, 'number');

  const orders = await request(apiUrl, '/orders');
  const createdOrder = orders.find((entry) => entry.id === submit.orderId);
  assert.ok(createdOrder);
  assert.equal(createdOrder.customer.id, submit.customerId);
  assert.match(createdOrder.customer.name, /cliente whatsapp flow/i);
  assert.equal(createdOrder.items.some((entry) => entry.productId === product.id && entry.quantity === 2), true);

  const secondSubmit = await request(apiUrl, '/whatsapp/flows/order-intake/submit', {
    method: 'POST',
    body: submitPayload
  });

  assert.equal(secondSubmit.ok, true);
  assert.equal(secondSubmit.alreadyCompleted, true);
  assert.equal(secondSubmit.orderId, submit.orderId);
  assert.equal(secondSubmit.customerId, submit.customerId);
});
