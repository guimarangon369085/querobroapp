import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request, requestExpectError } from './lib/api-server.mjs';

const MASS_PREP_EVENT_NAME = 'FAZER MASSA';
const MASS_READY_ITEM_NAME = 'MASSA PRONTA';
const TEST_REASON = '[TESTE_E2E] order-mass-prep-automation';

function normalizeLookup(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function findByAliases(items, aliases) {
  const aliasesLookup = new Set(aliases.map((alias) => normalizeLookup(alias)));
  return items.find((item) => aliasesLookup.has(normalizeLookup(item.name)));
}

function computeBalanceByItemId(movements) {
  const ordered = [...movements].sort((left, right) => (left.id || 0) - (right.id || 0));
  const balanceByItem = new Map();

  for (const movement of ordered) {
    const itemId = movement.itemId;
    if (!itemId) continue;
    const current = balanceByItem.get(itemId) || 0;
    if (movement.type === 'IN') {
      balanceByItem.set(itemId, current + Number(movement.quantity || 0));
    } else if (movement.type === 'OUT') {
      balanceByItem.set(itemId, current - Number(movement.quantity || 0));
    } else if (movement.type === 'ADJUST') {
      balanceByItem.set(itemId, Number(movement.quantity || 0));
    }
  }

  return balanceByItem;
}

test(
  'evento FAZER MASSA tem status proprio e debitos coerentes de MASSA PRONTA + recheio',
  { timeout: 180000 },
  async (t) => {
    const { apiUrl, shutdown } = await ensureApiServer();
    const created = {
      orderId: null,
      customerId: null,
      productTraditionalId: null,
      productGoiabadaId: null
    };
    const touchedInventoryBaselineByItemId = new Map();

    t.after(async () => {
      if (created.orderId) {
        try {
          await request(apiUrl, `/orders/${created.orderId}`, { method: 'DELETE' });
        } catch {
          // melhor esforco
        }
      }

      const cleanupResources = [
        created.productTraditionalId
          ? () => request(apiUrl, `/products/${created.productTraditionalId}`, { method: 'DELETE' })
          : null,
        created.productGoiabadaId
          ? () => request(apiUrl, `/products/${created.productGoiabadaId}`, { method: 'DELETE' })
          : null,
        created.customerId
          ? () => request(apiUrl, `/customers/${created.customerId}`, { method: 'DELETE' })
          : null
      ].filter(Boolean);

      for (const cleanup of cleanupResources) {
        try {
          await cleanup();
        } catch {
          // melhor esforco
        }
      }

      for (const [itemId, baseline] of touchedInventoryBaselineByItemId.entries()) {
        try {
          await request(apiUrl, '/inventory-movements', {
            method: 'POST',
            body: {
              itemId,
              type: 'ADJUST',
              quantity: baseline,
              reason: `${TEST_REASON} restore`
            }
          });
        } catch {
          // melhor esforco
        }
      }

      await shutdown();
    });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const productTraditional = await request(apiUrl, '/products', {
      method: 'POST',
      body: {
        name: `Broa Tradicional [TESTE_E2E] ${suffix}`,
        category: 'Sabores',
        unit: 'un',
        price: 10,
        active: true
      }
    });
    created.productTraditionalId = productTraditional.id;

    const productGoiabada = await request(apiUrl, '/products', {
      method: 'POST',
      body: {
        name: `Broa Goiabada [TESTE_E2E] ${suffix}`,
        category: 'Sabores',
        unit: 'un',
        price: 12,
        active: true
      }
    });
    created.productGoiabadaId = productGoiabada.id;

    const customer = await request(apiUrl, '/customers', {
      method: 'POST',
      body: {
        name: `Cliente Massa Status [TESTE_E2E] ${suffix}`,
        phone: '11988887777',
        address: 'Rua Massa, 123'
      }
    });
    created.customerId = customer.id;

    const recipeIngredients = [
      {
        canonicalName: 'LEITE',
        aliases: ['LEITE'],
        unit: 'ml',
        purchasePackSize: 1000,
        purchasePackCost: 4.19,
        adjustQty: 100
      },
      {
        canonicalName: 'MANTEIGA COM SAL',
        aliases: ['MANTEIGA COM SAL', 'MANTEIGA'],
        unit: 'g',
        purchasePackSize: 500,
        purchasePackCost: 24.9,
        adjustQty: 1000
      },
      {
        canonicalName: 'ACUCAR',
        aliases: ['ACUCAR', 'AÇÚCAR'],
        unit: 'g',
        purchasePackSize: 1000,
        purchasePackCost: 5.69,
        adjustQty: 1000
      },
      {
        canonicalName: 'FARINHA DE TRIGO',
        aliases: ['FARINHA DE TRIGO'],
        unit: 'g',
        purchasePackSize: 1000,
        purchasePackCost: 6.49,
        adjustQty: 1000
      },
      {
        canonicalName: 'FUBA DE CANJICA',
        aliases: ['FUBA DE CANJICA', 'FUBÁ DE CANJICA'],
        unit: 'g',
        purchasePackSize: 1000,
        purchasePackCost: 6,
        adjustQty: 1000
      },
      {
        canonicalName: 'OVOS',
        aliases: ['OVOS'],
        unit: 'uni',
        purchasePackSize: 20,
        purchasePackCost: 23.9,
        adjustQty: 20
      }
    ];

    const inventoryMovementsInitial = await request(apiUrl, '/inventory-movements');
    const initialBalanceByItemId = computeBalanceByItemId(inventoryMovementsInitial);

    const ensureInventoryItem = async (config) => {
      const freshItems = await request(apiUrl, '/inventory-items');
      let item = findByAliases(freshItems, config.aliases);
      if (!item) {
        item = await request(apiUrl, '/inventory-items', {
          method: 'POST',
          body: {
            name: config.canonicalName,
            category: 'INGREDIENTE',
            unit: config.unit,
            purchasePackSize: config.purchasePackSize,
            purchasePackCost: config.purchasePackCost
          }
        });
      }
      if (!touchedInventoryBaselineByItemId.has(item.id)) {
        touchedInventoryBaselineByItemId.set(item.id, initialBalanceByItemId.get(item.id) || 0);
      }
      return item;
    };

    const massReadyItem = await ensureInventoryItem({
      canonicalName: MASS_READY_ITEM_NAME,
      aliases: [MASS_READY_ITEM_NAME],
      unit: 'receita',
      purchasePackSize: 1,
      purchasePackCost: 0
    });
    const goiabadaItem = await ensureInventoryItem({
      canonicalName: 'GOIABADA',
      aliases: ['GOIABADA'],
      unit: 'g',
      purchasePackSize: 1000,
      purchasePackCost: 19
    });

    for (const ingredient of recipeIngredients) {
      const item = await ensureInventoryItem(ingredient);
      await request(apiUrl, '/inventory-movements', {
        method: 'POST',
        body: {
          itemId: item.id,
          type: 'ADJUST',
          quantity: ingredient.adjustQty,
          reason: `${TEST_REASON} setup`
        }
      });
    }

    await request(apiUrl, '/inventory-movements', {
      method: 'POST',
      body: {
        itemId: massReadyItem.id,
        type: 'ADJUST',
        quantity: 0,
        reason: `${TEST_REASON} setup`
      }
    });
    await request(apiUrl, '/inventory-movements', {
      method: 'POST',
      body: {
        itemId: goiabadaItem.id,
        type: 'ADJUST',
        quantity: 1000,
        reason: `${TEST_REASON} setup`
      }
    });

    const scheduledAt = new Date(Date.UTC(2030, 1, 10, 9, 0, 0)).toISOString();
    const order = await request(apiUrl, '/orders', {
      method: 'POST',
      body: {
        customerId: customer.id,
        items: [
          { productId: productTraditional.id, quantity: 4 },
          { productId: productGoiabada.id, quantity: 3 }
        ],
        scheduledAt
      }
    });
    created.orderId = order.id;

    const eventsAfterCreate = await request(apiUrl, '/orders/mass-prep-events');
    const createdMassPrepEvent = eventsAfterCreate.find(
      (event) => event.orderId === order.id && event.eventName === MASS_PREP_EVENT_NAME
    );
    assert.ok(createdMassPrepEvent, 'Evento FAZER MASSA deveria ser criado quando faltar MASSA PRONTA');
    assert.equal(createdMassPrepEvent.status, 'INGREDIENTES');
    assert.equal(createdMassPrepEvent.massRecipes, 1);

    const orderMovementsAfterCreate = (await request(apiUrl, '/inventory-movements')).filter(
      (movement) => movement.orderId === order.id
    );
    const massReadyConsumptionMovement = orderMovementsAfterCreate.find(
      (movement) =>
        movement.itemId === massReadyItem.id &&
        movement.source === 'MASS_READY' &&
        movement.type === 'OUT'
    );
    assert.ok(massReadyConsumptionMovement, 'Consumo de MASSA PRONTA do pedido nao encontrado');
    assert.equal(Number(massReadyConsumptionMovement.quantity), 0.25);

    const fillingMovement = orderMovementsAfterCreate.find(
      (movement) =>
        movement.itemId === goiabadaItem.id &&
        movement.source === 'ORDER_FILLING' &&
        movement.type === 'OUT'
    );
    assert.ok(fillingMovement, 'Consumo de recheio (ORDER_FILLING) nao encontrado');
    assert.equal(Number(fillingMovement.quantity), 15);

    const blockedTransition = await requestExpectError(
      apiUrl,
      `/orders/${order.id}/mass-prep-event/status`,
      400,
      {
        method: 'PATCH',
        body: { status: 'PREPARO' }
      }
    );
    assert.ok(
      String(blockedTransition.message || '').toLowerCase().includes('insumos'),
      'Transicao INGREDIENTES -> PREPARO deveria bloquear com mensagem de insumos insuficientes'
    );

    const leiteItem = findByAliases(await request(apiUrl, '/inventory-items'), ['LEITE']);
    assert.ok(leiteItem, 'Item LEITE deveria existir');
    await request(apiUrl, '/inventory-movements', {
      method: 'POST',
      body: {
        itemId: leiteItem.id,
        type: 'ADJUST',
        quantity: 1000,
        reason: `${TEST_REASON} unlock preparo`
      }
    });

    const eventInPreparo = await request(apiUrl, `/orders/${order.id}/mass-prep-event/status`, {
      method: 'PATCH',
      body: { status: 'PREPARO' }
    });
    assert.equal(eventInPreparo.status, 'PREPARO');

    const movementsAfterPreparo = (await request(apiUrl, '/inventory-movements')).filter(
      (movement) => movement.orderId === order.id
    );
    assert.ok(
      movementsAfterPreparo.some(
        (movement) =>
          movement.itemId === massReadyItem.id &&
          movement.source === 'MASS_PREP' &&
          movement.type === 'IN' &&
          Number(movement.quantity) === 1
      ),
      'Entrada de MASSA PRONTA do PREPARO nao encontrada'
    );
    assert.ok(
      movementsAfterPreparo.filter(
        (movement) => movement.source === 'MASS_PREP' && movement.type === 'OUT'
      ).length >= 6,
      'Baixa dos ingredientes no PREPARO nao foi registrada por completo'
    );

    await request(apiUrl, `/orders/${order.id}/status`, {
      method: 'PATCH',
      body: { status: 'CONFIRMADO' }
    });
    await request(apiUrl, `/orders/${order.id}/status`, {
      method: 'PATCH',
      body: { status: 'EM_PREPARACAO' }
    });

    const eventsAfterOven = await request(apiUrl, '/orders/mass-prep-events');
    const eventReady = eventsAfterOven.find((event) => event.id === createdMassPrepEvent.id);
    assert.ok(eventReady, 'Evento FAZER MASSA deveria continuar existente');
    assert.equal(eventReady.status, 'PRONTA');
  }
);
