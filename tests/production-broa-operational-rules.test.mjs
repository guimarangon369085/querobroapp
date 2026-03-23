import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

const TEST_REASON = '[TESTE_E2E] production-broa-operational-rules';

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
  'D+1 respeita massa pronta disponivel e arredonda embalagem por pedido oficial',
  { timeout: 180000 },
  async (t) => {
    const { apiUrl, shutdown } = await ensureApiServer();
    const created = {
      orderId: null,
      customerId: null,
      productTraditionalId: null,
      productGoiabadaId: null,
      bomTraditionalId: null,
      bomGoiabadaId: null
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
        created.bomTraditionalId
          ? () => request(apiUrl, `/boms/${created.bomTraditionalId}`, { method: 'DELETE' })
          : null,
        created.bomGoiabadaId
          ? () => request(apiUrl, `/boms/${created.bomGoiabadaId}`, { method: 'DELETE' })
          : null,
        created.productTraditionalId
          ? () => request(apiUrl, `/inventory-products/${created.productTraditionalId}`, { method: 'DELETE' })
          : null,
        created.productGoiabadaId
          ? () => request(apiUrl, `/inventory-products/${created.productGoiabadaId}`, { method: 'DELETE' })
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
    const goiabadaItem = await ensureInventoryItem({
      canonicalName: 'GOIABADA',
      aliases: ['GOIABADA'],
      category: 'INGREDIENTE',
      unit: 'g',
      purchasePackSize: 1000,
      purchasePackCost: 19
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
        quantity: 1,
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
    await request(apiUrl, '/inventory-movements', {
      method: 'POST',
      body: {
        itemId: plasticBoxItem.id,
        type: 'ADJUST',
        quantity: 10,
        reason: `${TEST_REASON} setup`
      }
    });
    await request(apiUrl, '/inventory-movements', {
      method: 'POST',
      body: {
        itemId: paperBagItem.id,
        type: 'ADJUST',
        quantity: 10,
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

    const productGoiabada = await request(apiUrl, '/inventory-products', {
      method: 'POST',
      body: {
        name: `Broa Goiabada (G) [TESTE_E2E] ${suffix}`,
        category: 'Sabores',
        unit: 'un',
        price: 12,
        active: true
      }
    });
    created.productGoiabadaId = productGoiabada.id;

    const bomTraditional = await request(apiUrl, '/boms', {
      method: 'POST',
      body: {
        productId: productTraditional.id,
        name: `BOM Tradicional [TESTE_E2E] ${suffix}`,
        saleUnitLabel: 'Caixa com 7 broas',
        yieldUnits: 21,
        items: [{ itemId: plasticBoxItem.id, qtyPerSaleUnit: 1, qtyPerUnit: 1 / 7 }]
      }
    });
    created.bomTraditionalId = bomTraditional.id;

    const bomGoiabada = await request(apiUrl, '/boms', {
      method: 'POST',
      body: {
        productId: productGoiabada.id,
        name: `BOM Goiabada [TESTE_E2E] ${suffix}`,
        saleUnitLabel: 'Caixa com 7 broas',
        yieldUnits: 21,
        items: [{ itemId: goiabadaItem.id, qtyPerSaleUnit: 35, qtyPerUnit: 5 }]
      }
    });
    created.bomGoiabadaId = bomGoiabada.id;

    const customer = await request(apiUrl, '/customers', {
      method: 'POST',
      body: {
        name: `Cliente Regras Operacionais [TESTE_E2E] ${suffix}`,
        phone: '11966665555',
        address: 'Rua Regras, 7'
      }
    });
    created.customerId = customer.id;

    const scheduledAt = new Date(Date.UTC(2030, 2, 10, 9, 0, 0)).toISOString();
    const order = await request(apiUrl, '/orders', {
      method: 'POST',
      body: {
        customerId: customer.id,
        scheduledAt,
        items: [
          { productId: productTraditional.id, quantity: 4 },
          { productId: productGoiabada.id, quantity: 3 }
        ]
      }
    });
    created.orderId = order.id;

    const requirements = await request(apiUrl, '/production/requirements?date=2030-03-10');

    const goiabadaRow = requirements.rows.find((row) => row.ingredientId === goiabadaItem.id);
    assert.ok(goiabadaRow, 'Goiabada deveria aparecer no D+1');
    assert.ok(approxEqual(goiabadaRow.requiredQty, 15));
    assert.ok(Number(goiabadaRow.availableQty) >= 15);
    assert.ok(approxEqual(goiabadaRow.shortageQty, 0));

    const plasticBoxRow = requirements.rows.find((row) => row.ingredientId === plasticBoxItem.id);
    assert.ok(plasticBoxRow, 'Caixa de plastico deveria aparecer no D+1');
    assert.ok(approxEqual(plasticBoxRow.requiredQty, 1));
    assert.ok(Number(plasticBoxRow.availableQty) >= 1);
    assert.ok(approxEqual(plasticBoxRow.shortageQty, 0));

    const paperBagRow = requirements.rows.find((row) => row.ingredientId === paperBagItem.id);
    assert.ok(paperBagRow, 'Sacola deveria aparecer no D+1');
    assert.ok(approxEqual(paperBagRow.requiredQty, 1));
    assert.ok(Number(paperBagRow.availableQty) >= 1);
    assert.ok(approxEqual(paperBagRow.shortageQty, 0));

    const butterPaperRow = requirements.rows.find((row) => row.ingredientId === butterPaperItem.id);
    assert.ok(butterPaperRow, 'Papel manteiga deveria aparecer no D+1');
    assert.ok(approxEqual(butterPaperRow.requiredQty, 16));
    assert.ok(Number(butterPaperRow.availableQty) >= 16);
    assert.ok(approxEqual(butterPaperRow.shortageQty, 0));

    const blockedMassIngredientNames = new Set([
      'LEITE',
      'MANTEIGA',
      'ACUCAR',
      'AÇÚCAR',
      'FARINHA DE TRIGO',
      'FUBA DE CANJICA',
      'FUBÁ DE CANJICA',
      'OVOS'
    ]);
    const hasMassIngredientRows = requirements.rows.some((row) =>
      blockedMassIngredientNames.has(normalizeLookup(row.name))
    );
    assert.equal(
      hasMassIngredientRows,
      false,
      'Com MASSA PRONTA suficiente, D+1 nao deveria pedir ingredientes base da massa'
    );
  }
);
