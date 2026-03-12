import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

const TEST_REASON = '[TESTE_E2E] order-packaging-grouping';

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

function approxEqual(actual, expected, epsilon = 0.0001) {
  return Math.abs(Number(actual) - Number(expected)) <= epsilon;
}

test(
  'sacola consolida duas caixas do mesmo cliente e cancelamento libera reserva corretamente',
  { timeout: 180000 },
  async (t) => {
    const { apiUrl, shutdown } = await ensureApiServer();
    const created = {
      customerId: null,
      productTraditionalId: null,
      orderIds: []
    };
    const touchedInventoryBaselineByItemId = new Map();

    t.after(async () => {
      for (const orderId of created.orderIds) {
        try {
          await request(apiUrl, `/orders/${orderId}`, { method: 'DELETE' });
        } catch {
          // melhor esforco
        }
      }

      const cleanupResources = [
        created.productTraditionalId
          ? () => request(apiUrl, `/inventory-products/${created.productTraditionalId}`, { method: 'DELETE' })
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
            category: config.category,
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
      canonicalName: 'MASSA PRONTA',
      aliases: ['MASSA PRONTA'],
      category: 'INGREDIENTE',
      unit: 'receita',
      purchasePackSize: 1,
      purchasePackCost: 0
    });
    const plasticBoxItem = await ensureInventoryItem({
      canonicalName: 'CAIXA DE PLASTICO',
      aliases: ['CAIXA DE PLASTICO', 'CAIXA DE PLÁSTICO'],
      category: 'EMBALAGEM_INTERNA',
      unit: 'uni',
      purchasePackSize: 100,
      purchasePackCost: 86.65
    });
    const paperBagItem = await ensureInventoryItem({
      canonicalName: 'SACOLA',
      aliases: ['SACOLA'],
      category: 'EMBALAGEM_EXTERNA',
      unit: 'uni',
      purchasePackSize: 10,
      purchasePackCost: 17.88
    });
    const butterPaperItem = await ensureInventoryItem({
      canonicalName: 'PAPEL MANTEIGA',
      aliases: ['PAPEL MANTEIGA'],
      category: 'EMBALAGEM_INTERNA',
      unit: 'cm',
      purchasePackSize: 7000,
      purchasePackCost: 10.29
    });

    await request(apiUrl, '/inventory-movements', {
      method: 'POST',
      body: {
        itemId: massReadyItem.id,
        type: 'ADJUST',
        quantity: 10,
        reason: `${TEST_REASON} setup`
      }
    });
    await request(apiUrl, '/inventory-movements', {
      method: 'POST',
      body: {
        itemId: plasticBoxItem.id,
        type: 'ADJUST',
        quantity: 20,
        reason: `${TEST_REASON} setup`
      }
    });
    await request(apiUrl, '/inventory-movements', {
      method: 'POST',
      body: {
        itemId: paperBagItem.id,
        type: 'ADJUST',
        quantity: 20,
        reason: `${TEST_REASON} setup`
      }
    });
    await request(apiUrl, '/inventory-movements', {
      method: 'POST',
      body: {
        itemId: butterPaperItem.id,
        type: 'ADJUST',
        quantity: 1000,
        reason: `${TEST_REASON} setup`
      }
    });

    const productTraditional = await request(apiUrl, '/inventory-products', {
      method: 'POST',
      body: {
        name: `Broa Tradicional (T) [TESTE_E2E] ${suffix}`,
        category: 'Sabores',
        unit: 'un',
        price: 10,
        active: true
      }
    });
    created.productTraditionalId = productTraditional.id;

    const customer = await request(apiUrl, '/customers', {
      method: 'POST',
      body: {
        name: `Cliente Sacola Consolidada [TESTE_E2E] ${suffix}`,
        phone: '11977776666',
        address: 'Rua Embalagem, 14'
      }
    });
    created.customerId = customer.id;

    const scheduledAt = new Date(Date.UTC(2030, 2, 11, 9, 0, 0)).toISOString();
    const firstOrder = await request(apiUrl, '/orders', {
      method: 'POST',
      body: {
        customerId: customer.id,
        scheduledAt,
        items: [{ productId: productTraditional.id, quantity: 7 }]
      }
    });
    created.orderIds.push(firstOrder.id);

    const secondOrder = await request(apiUrl, '/orders', {
      method: 'POST',
      body: {
        customerId: customer.id,
        scheduledAt,
        items: [{ productId: productTraditional.id, quantity: 7 }]
      }
    });
    created.orderIds.push(secondOrder.id);

    const movementsAfterCreate = await request(apiUrl, '/inventory-movements');
    const bagReservationsAfterCreate = movementsAfterCreate.filter(
      (movement) =>
        movement.itemId === paperBagItem.id &&
        movement.source === 'ORDER_PACKAGING' &&
        [firstOrder.id, secondOrder.id].includes(movement.orderId)
    );
    const totalBagReservationsAfterCreate = bagReservationsAfterCreate.reduce(
      (sum, movement) => sum + Number(movement.quantity || 0),
      0
    );
    assert.ok(
      approxEqual(totalBagReservationsAfterCreate, 1),
      `Reserva total de sacolas deveria ser 1, recebido ${totalBagReservationsAfterCreate}`
    );

    const requirements = await request(apiUrl, '/production/requirements?date=2030-03-11');
    const paperBagRow = requirements.rows.find((row) => row.ingredientId === paperBagItem.id);
    assert.ok(paperBagRow, 'Sacola deveria aparecer no D+1 consolidado');
    assert.ok(approxEqual(paperBagRow.requiredQty, 1));

    const plasticBoxRow = requirements.rows.find((row) => row.ingredientId === plasticBoxItem.id);
    assert.ok(plasticBoxRow, 'Caixa de plastico deveria aparecer no D+1 consolidado');
    assert.ok(approxEqual(plasticBoxRow.requiredQty, 2));

    const butterPaperRow = requirements.rows.find((row) => row.ingredientId === butterPaperItem.id);
    assert.ok(butterPaperRow, 'Papel manteiga deveria aparecer no D+1 consolidado');
    assert.ok(approxEqual(butterPaperRow.requiredQty, 32));

    const cancelled = await request(apiUrl, `/orders/${firstOrder.id}/status`, {
      method: 'PATCH',
      body: { status: 'CANCELADO' }
    });
    assert.equal(cancelled.status, 'CANCELADO');

    const movementsAfterCancel = await request(apiUrl, '/inventory-movements');
    const canceledOrderFormulaMovements = movementsAfterCancel.filter(
      (movement) =>
        movement.orderId === firstOrder.id &&
        ['MASS_READY', 'ORDER_FILLING', 'ORDER_PACKAGING'].includes(movement.source)
    );
    assert.equal(
      canceledOrderFormulaMovements.length,
      0,
      'Pedido cancelado nao deveria manter reservas operacionais'
    );

    const remainingBagReservations = movementsAfterCancel.filter(
      (movement) =>
        movement.itemId === paperBagItem.id &&
        movement.source === 'ORDER_PACKAGING' &&
        [firstOrder.id, secondOrder.id].includes(movement.orderId)
    );
    const totalBagReservationsAfterCancel = remainingBagReservations.reduce(
      (sum, movement) => sum + Number(movement.quantity || 0),
      0
    );
    assert.ok(approxEqual(totalBagReservationsAfterCancel, 1));
    assert.ok(
      remainingBagReservations.some(
        (movement) =>
          movement.orderId === secondOrder.id && approxEqual(Number(movement.quantity || 0), 1)
      ),
      'Sacola restante deveria ser realocada para o pedido ativo'
    );

    const massReadyReservationsAfterCancel = movementsAfterCancel.filter(
      (movement) =>
        movement.itemId === massReadyItem.id &&
        movement.source === 'MASS_READY' &&
        [firstOrder.id, secondOrder.id].includes(movement.orderId)
    );
    const totalMassReadyReservationsAfterCancel = massReadyReservationsAfterCancel.reduce(
      (sum, movement) => sum + Number(movement.quantity || 0),
      0
    );
    assert.ok(approxEqual(totalMassReadyReservationsAfterCancel, 1 / 3));
  }
);
