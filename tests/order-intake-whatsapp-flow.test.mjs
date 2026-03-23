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

test('order intake whatsapp-flow: cria pedido idempotente com cobranca PIX', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    orderId: null,
    customerId: null,
    productId: null
  };

  t.after(async () => {
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
      name: `WhatsApp Flow Broa ${suffix}`,
      category: 'Teste',
      unit: 'cx',
      price: 40,
      active: true
    }
  });
  created.productId = product.id;

  const buildPayload = (resolvedScheduledAt) => ({
    version: 1,
    intent: 'CONFIRMED',
    customer: {
      name: `Cliente WhatsApp ${suffix}`,
      phone,
      address: 'Rua WhatsApp, 10'
    },
    fulfillment: {
      mode: 'DELIVERY',
      scheduledAt: resolvedScheduledAt
    },
    order: {
      items: [{ productId: product.id, quantity: 1 }]
    },
    payment: {
      method: 'pix',
      status: 'PENDENTE'
    },
    source: {
      externalId: `wpp-${suffix}`
    }
  });

  const firstAttempt = await submitWithScheduleRetry(
    apiUrl,
    '/orders/intake/whatsapp-flow',
    buildPayload,
    scheduledAt
  );
  const payload = buildPayload(firstAttempt.scheduledAt);
  const first = firstAttempt.body;

  created.orderId = first.order.id;
  created.customerId = first.intake.customerId;

  assert.equal(first.intake.channel, 'WHATSAPP_FLOW');
  assert.equal(first.intake.stage, 'PIX_PENDING');
  assert.equal(first.intake.paymentMethod, 'pix');
  assert.ok(first.intake.pixCharge);
  assert.ok(first.intake.pixCharge.providerRef);
  assert.ok(first.intake.pixCharge.copyPasteCode);

  const second = await request(apiUrl, '/orders/intake/whatsapp-flow', {
    method: 'POST',
    body: payload
  });

  assert.equal(second.order.id, first.order.id);
  assert.equal(second.intake.customerId, first.intake.customerId);
  assert.equal(second.intake.pixCharge.providerRef, first.intake.pixCharge.providerRef);

  const pixCharge = await request(apiUrl, `/orders/${first.order.id}/pix-charge`);
  assert.equal(pixCharge.providerRef, first.intake.pixCharge.providerRef);
  assert.equal(pixCharge.txid, first.intake.pixCharge.txid);
});
