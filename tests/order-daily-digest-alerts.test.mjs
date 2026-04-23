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

function waitFor(fn, timeoutMs = 4000, intervalMs = 50) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fn()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('Tempo esgotado aguardando digest diario.'));
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

function dateKeyFromIso(iso) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(iso))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function nextAvailableSchedule(apiUrl, requestedAt) {
  const availability = await request(apiUrl, `/orders/public-schedule?scheduledAt=${encodeURIComponent(requestedAt)}`);
  return availability.requestedAvailable ? requestedAt : availability.nextAvailableAt;
}

function applyDigestEnv(env) {
  const keys = [
    'ORDER_DAILY_DIGEST_ENABLED',
    'ORDER_DAILY_DIGEST_SEND_AT_HOUR',
    'ORDER_DAILY_DIGEST_NTFY_TOPIC_URL',
    'ORDER_DAILY_DIGEST_NTFY_PRIORITY',
    'ORDER_DAILY_DIGEST_NTFY_TAGS',
    'ORDER_DAILY_DIGEST_OPERATIONS_URL',
    'ORDER_ALERT_NTFY_TOPIC_URL',
    'ORDER_ALERT_WEBHOOK_URL'
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

test('order daily digest: envia resumo do dia com link de WhatsApp e deduplicacao diaria', async (t) => {
  const hits = [];
  const webhook = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    hits.push({
      headers: req.headers,
      url: req.url,
      body: Buffer.concat(chunks).toString('utf8')
    });
    res.setHeader('connection', 'close');
    res.writeHead(204).end();
  });
  const address = await listen(webhook);
  const restoreEnv = applyDigestEnv({
    ORDER_DAILY_DIGEST_ENABLED: 'true',
    ORDER_DAILY_DIGEST_SEND_AT_HOUR: '23',
    ORDER_DAILY_DIGEST_NTFY_TOPIC_URL: `http://127.0.0.1:${address.port}/qbapp-daily-digest`,
    ORDER_DAILY_DIGEST_NTFY_PRIORITY: '4',
    ORDER_DAILY_DIGEST_NTFY_TAGS: 'sunrise,bread,clipboard',
    ORDER_DAILY_DIGEST_OPERATIONS_URL: 'https://querobroa.com.br/confirmacoes',
    ORDER_ALERT_NTFY_TOPIC_URL: '',
    ORDER_ALERT_WEBHOOK_URL: ''
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
  const requestedAt = localScheduleIso(2030, 1, 22, 9, 0);
  const scheduledAt = await nextAvailableSchedule(apiUrl, requestedAt);
  const dateKey = dateKeyFromIso(scheduledAt);
  const orderItemsSummaryMetadata = `pedido=${encodeURIComponent(
    JSON.stringify([
      {
        label: 'Caixa Mista de Goiabada',
        detail: '4 Tradicional + 3 Goiabada'
      }
    ])
  )}`;

  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Digest Diario ${suffix}`,
      category: 'Teste',
      unit: 'cx',
      price: 42,
      active: true
    }
  });
  created.productId = product.id;

  const createdOrder = await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      version: 1,
      intent: 'CONFIRMED',
      customer: {
        name: `Cliente Digest ${suffix}`,
        phone: '11988887777',
        address: 'Rua Digest, 10'
      },
      fulfillment: {
        mode: 'DELIVERY',
        scheduledAt
      },
      order: {
        items: [{ productId: product.id, quantity: 1 }],
        notes: orderItemsSummaryMetadata
      },
      payment: {
        method: 'pix',
        status: 'PENDENTE'
      },
      source: {
        channel: 'CUSTOMER_LINK',
        externalId: `daily-digest-${suffix}`,
        idempotencyKey: `daily-digest-${suffix}`
      }
    }
  });

  created.orderId = createdOrder.order.id;
  created.customerId = createdOrder.intake.customerId;

  const firstSend = await request(apiUrl, '/orders/daily-digest/send', {
    method: 'POST',
    body: {
      date: dateKey
    }
  });

  assert.equal(firstSend.status, 'SENT');
  assert.equal(firstSend.dateKey, dateKey);
  assert.ok(firstSend.orderCount >= 1);

  const preview = await request(apiUrl, `/orders/daily-digest/preview?date=${encodeURIComponent(dateKey)}`);
  assert.equal(preview.dateKey, dateKey);
  assert.ok(preview.orderCount >= 1);
  const previewOrder = preview.orders.find((entry) => entry.id === created.orderId);
  assert.ok(previewOrder, 'pedido criado deve aparecer na fila de preview');
  assert.match(previewOrder.whatsappUrl || '', /^https:\/\/wa\.me\//);
  const whatsappUrl = new URL(previewOrder.whatsappUrl);
  const message = whatsappUrl.searchParams.get('text') || '';
  const expectedTotal = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(previewOrder.total || 0));
  assert.match(message, /^Oi, Cliente!/);
  assert.match(message, /pedido da @QUEROBROA para 22\/02, entre 09:00 e 12:00\./);
  assert.match(message, /Modalidade: Entrega/);
  assert.match(message, /Endereço: Rua Digest, 10/);
  assert.match(message, /Pedido:\n#1\nCaixa Mista de Goiabada\n4 Tradicional \+ 3 Goiabada/);
  assert.match(message, new RegExp(`Total: ${expectedTotal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(
    message,
    /Se estiver tudo certo, me responde com OK por aqui\. Se precisar ajustar algo, me avisa nesta mensagem mesmo que a gente resolve!/
  );
  assert.doesNotMatch(message, /pedido #/i);

  await waitFor(() => hits.length === 1);
  assert.equal(hits[0].url, '/qbapp-daily-digest');
  assert.equal(hits[0].headers.priority, '4');
  assert.equal(hits[0].headers.click, `https://querobroa.com.br/confirmacoes?date=${dateKey}`);
  assert.match(hits[0].headers.title, /Resumo do dia/);
  assert.match(hits[0].body, /Toque para abrir a fila de confirmação/);
  assert.match(hits[0].body, /Cliente Digest/);
  assert.match(hits[0].body, /WhatsApp:/);
  assert.match(hits[0].body, /Sabores: 1Digest Diario /);

  const secondSend = await request(apiUrl, '/orders/daily-digest/send', {
    method: 'POST',
    body: {
      date: dateKey
    }
  });

  assert.equal(secondSend.status, 'ALREADY_SENT');
  assert.equal(hits.length, 1);
});

test('order daily digest: preview preserva a identidade do snapshot do pedido mesmo se o cadastro mudar', async (t) => {
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
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const requestedAt = localScheduleIso(2030, 1, 23, 10, 0);
  const scheduledAt = await nextAvailableSchedule(apiUrl, requestedAt);
  const dateKey = dateKeyFromIso(scheduledAt);
  const originalName = `Ana Snapshot ${suffix}`;
  const originalPhone = '11988887777';
  const originalAddress = `Rua Snapshot ${suffix}, 10`;
  const updatedName = `Maria Corrigida ${suffix}`;
  const updatedPhone = '11977776666';

  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Digest Atualizado ${suffix}`,
      category: 'Teste',
      unit: 'cx',
      price: 37,
      active: true
    }
  });
  created.productId = product.id;

  const createdOrder = await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      version: 1,
      intent: 'CONFIRMED',
      customer: {
        name: originalName,
        phone: originalPhone,
        address: originalAddress
      },
      fulfillment: {
        mode: 'DELIVERY',
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
        channel: 'CUSTOMER_LINK',
        externalId: `daily-digest-customer-update-${suffix}`,
        idempotencyKey: `daily-digest-customer-update-${suffix}`
      }
    }
  });

  created.orderId = createdOrder.order.id;
  created.customerId = createdOrder.intake.customerId;

  await request(apiUrl, `/customers/${created.customerId}`, {
    method: 'PUT',
    body: {
      name: updatedName,
      phone: updatedPhone,
      address: `Rua Cadastro Atualizado ${suffix}, 99`
    }
  });

  const preview = await request(apiUrl, `/orders/daily-digest/preview?date=${encodeURIComponent(dateKey)}`);
  const previewOrder = preview.orders.find((entry) => entry.id === created.orderId);
  assert.ok(previewOrder, 'pedido atualizado deve aparecer na fila de preview');
  assert.equal(previewOrder.customerName, originalName);
  assert.equal(previewOrder.customerPhone, '5511988887777');
  assert.equal(previewOrder.customerAddress, originalAddress);
  assert.match(previewOrder.whatsappUrl || '', /^https:\/\/wa\.me\/5511988887777\?/);

  const whatsappUrl = new URL(previewOrder.whatsappUrl);
  const message = whatsappUrl.searchParams.get('text') || '';
  assert.match(message, /^Oi, Ana!/);
  assert.match(message, new RegExp(`Endereço: ${originalAddress.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.doesNotMatch(message, new RegExp(updatedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(message, /Rua Cadastro Atualizado/);
});

test('order daily digest: amiga da broa nao quebra em chips separados nem duplica detalhe no WhatsApp', async (t) => {
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
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const requestedAt = localScheduleIso(2030, 1, 24, 12, 0);
  const scheduledAt = await nextAvailableSchedule(apiUrl, requestedAt);
  const dateKey = dateKeyFromIso(scheduledAt);
  const companionName =
    'CAFÉ TORRADO E MOÍDO • TORRA MÉDIA - CATUCAÍ AMARELO 24/137 • FAZENDA DONA LUIZA - Cambuquira/MG';
  const companionDetail =
    'TORRA MÉDIA - CATUCAÍ AMARELO 24/137 • FAZENDA DONA LUIZA - Cambuquira/MG';
  const orderItemsSummaryMetadata = `pedido=${encodeURIComponent(
    JSON.stringify([
      {
        label: `${companionName} (1 item)`,
        detail: companionDetail
      }
    ])
  )}`;

  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: companionName,
      category: 'Amigas da Broa',
      unit: 'unidade',
      price: 55,
      active: true,
      inventoryQtyPerSaleUnit: 250,
      companionInventory: {
        balance: 1000,
        unit: 'g',
        purchasePackSize: 500,
        purchasePackCost: 32
      }
    }
  });
  created.productId = product.id;

  const createdOrder = await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      version: 1,
      intent: 'CONFIRMED',
      customer: {
        name: `Cliente Amiga Digest ${suffix}`,
        phone: '27999491500',
        address: 'Avenida Doutor Altino Arantes, 31'
      },
      fulfillment: {
        mode: 'DELIVERY',
        scheduledAt
      },
      order: {
        items: [{ productId: product.id, quantity: 1 }],
        notes: orderItemsSummaryMetadata
      },
      payment: {
        method: 'pix',
        status: 'PENDENTE'
      },
      source: {
        channel: 'CUSTOMER_LINK',
        externalId: `daily-digest-amiga-${suffix}`,
        idempotencyKey: `daily-digest-amiga-${suffix}`
      }
    }
  });

  created.orderId = createdOrder.order.id;
  created.customerId = createdOrder.intake.customerId;

  const preview = await request(apiUrl, `/orders/daily-digest/preview?date=${encodeURIComponent(dateKey)}`);
  const previewOrder = preview.orders.find((entry) => entry.id === created.orderId);
  assert.ok(previewOrder, 'pedido com amiga da broa deve aparecer na fila de preview');
  assert.equal(previewOrder.flavorSummary, '1CAFÉ TORRADO E MOÍDO');
  assert.doesNotMatch(previewOrder.flavorSummary, /TORRA M[ÉE]DIA|FAZENDA DONA LUIZA/);

  assert.match(previewOrder.whatsappUrl || '', /^https:\/\/wa\.me\//);
  const whatsappUrl = new URL(previewOrder.whatsappUrl);
  const message = whatsappUrl.searchParams.get('text') || '';

  assert.match(
    message,
    /Pedido:\n#1\nCAFÉ TORRADO E MOÍDO \(1 item\)\nTORRA MÉDIA - CATUCAÍ AMARELO 24\/137 • FAZENDA DONA LUIZA - Cambuquira\/MG/
  );
  assert.doesNotMatch(
    message,
    /CAFÉ TORRADO E MOÍDO • TORRA MÉDIA - CATUCAÍ AMARELO 24\/137 • FAZENDA DONA LUIZA - Cambuquira\/MG/
  );
});
