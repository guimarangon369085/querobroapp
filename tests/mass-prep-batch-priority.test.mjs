import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

const TEST_REASON = '[TESTE_E2E] mass-prep-batch-priority';

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

function approxEqual(actual, expected, epsilon = 0.0001) {
  return Math.abs(Number(actual) - Number(expected)) <= epsilon;
}

test(
  'massa usa prioridade 2 ou 1 receita conforme estoque no evento e no preparo manual',
  { timeout: 180000 },
  async (t) => {
    const { apiUrl, shutdown } = await ensureApiServer();
    const created = {
      customerId: null,
      orderId: null,
      productTraditionalId: null
    };
    const baselineByRepresentativeId = new Map();

    const recipeIngredients = [
      {
        canonicalName: 'LEITE',
        aliases: ['LEITE'],
        category: 'INGREDIENTE',
        unit: 'ml',
        purchasePackSize: 1000,
        purchasePackCost: 4.19,
        oneRecipeQty: 480
      },
      {
        canonicalName: 'MANTEIGA',
        aliases: ['MANTEIGA', 'MANTEIGA COM SAL'],
        category: 'INGREDIENTE',
        unit: 'g',
        purchasePackSize: 500,
        purchasePackCost: 24.9,
        oneRecipeQty: 300
      },
      {
        canonicalName: 'AÇÚCAR',
        aliases: ['AÇÚCAR', 'ACUCAR'],
        category: 'INGREDIENTE',
        unit: 'g',
        purchasePackSize: 1000,
        purchasePackCost: 5.69,
        oneRecipeQty: 240
      },
      {
        canonicalName: 'FARINHA DE TRIGO',
        aliases: ['FARINHA DE TRIGO'],
        category: 'INGREDIENTE',
        unit: 'g',
        purchasePackSize: 1000,
        purchasePackCost: 6.49,
        oneRecipeQty: 260
      },
      {
        canonicalName: 'FUBÁ DE CANJICA',
        aliases: ['FUBÁ DE CANJICA', 'FUBA DE CANJICA'],
        category: 'INGREDIENTE',
        unit: 'g',
        purchasePackSize: 1000,
        purchasePackCost: 6,
        oneRecipeQty: 260
      },
      {
        canonicalName: 'OVOS',
        aliases: ['OVOS'],
        category: 'INGREDIENTE',
        unit: 'uni',
        purchasePackSize: 20,
        purchasePackCost: 23.9,
        oneRecipeQty: 12
      }
    ];

    const ensureFamilyRepresentative = async (config) => {
      const inventoryItems = await request(apiUrl, '/inventory-items');
      let rawItem = findByAliases(inventoryItems, config.aliases);
      if (!rawItem) {
        rawItem = await request(apiUrl, '/inventory-items', {
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

      const overview = await request(apiUrl, '/inventory-overview');
      const representative = findByAliases(overview.items, config.aliases);
      assert.ok(representative, `Representante de estoque nao encontrado para ${config.canonicalName}`);

      if (!baselineByRepresentativeId.has(representative.id)) {
        baselineByRepresentativeId.set(representative.id, Number(representative.balance || 0));
      }

      return representative;
    };

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

      for (const [itemId, baseline] of baselineByRepresentativeId.entries()) {
        try {
          await request(apiUrl, `/inventory-items/${itemId}/effective-balance`, {
            method: 'POST',
            body: {
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

    const massReadyRepresentative = await ensureFamilyRepresentative({
      canonicalName: 'MASSA PRONTA',
      aliases: ['MASSA PRONTA'],
      category: 'INGREDIENTE',
      unit: 'receita',
      purchasePackSize: 1,
      purchasePackCost: 0
    });

    for (const ingredient of recipeIngredients) {
      const representative = await ensureFamilyRepresentative(ingredient);
      await request(apiUrl, `/inventory-items/${representative.id}/effective-balance`, {
        method: 'POST',
        body: {
          quantity: ingredient.oneRecipeQty,
          reason: `${TEST_REASON} setup one recipe`
        }
      });
    }

    await request(apiUrl, `/inventory-items/${massReadyRepresentative.id}/effective-balance`, {
      method: 'POST',
      body: {
        quantity: 0,
        reason: `${TEST_REASON} setup zero mass ready`
      }
    });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
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
        name: `Cliente Prioridade Batida [TESTE_E2E] ${suffix}`,
        phone: '11999990000',
        address: 'Rua Batida, 21'
      }
    });
    created.customerId = customer.id;

    const scheduleSeed = Number(suffix.split('-')[1] || 0);
    const scheduledAt = new Date(
      Date.UTC(
        2030,
        3,
        10 + (scheduleSeed % 20),
        9 + (scheduleSeed % 6),
        (Math.floor(scheduleSeed / 20) % 4) * 15,
        0
      )
    ).toISOString();
    const order = await request(apiUrl, '/orders', {
      method: 'POST',
      body: {
        customerId: customer.id,
        scheduledAt,
        items: [{ productId: productTraditional.id, quantity: 7 }]
      }
    });
    created.orderId = order.id;

    const eventsAfterCreate = await request(apiUrl, '/orders/mass-prep-events');
    const createdEvent = eventsAfterCreate.find((event) => event.orderId === order.id);
    assert.ok(createdEvent, 'Evento FAZER MASSA deveria existir');
    assert.equal(createdEvent.massRecipes, 1);

    const eventInPreparo = await request(apiUrl, `/orders/${order.id}/mass-prep-event/status`, {
      method: 'PATCH',
      body: { status: 'PREPARO' }
    });
    assert.equal(eventInPreparo.status, 'PREPARO');
    assert.equal(eventInPreparo.massRecipes, 1);

    const movementsAfterEventPrepare = await request(apiUrl, '/inventory-movements');
    const eventMassReadyIn = movementsAfterEventPrepare.find(
      (movement) =>
        movement.orderId === order.id &&
        movement.itemId === massReadyRepresentative.id &&
        movement.source === 'MASS_PREP' &&
        movement.type === 'IN'
    );
    assert.ok(eventMassReadyIn, 'Entrada de MASSA PRONTA do evento nao encontrada');
    assert.ok(approxEqual(eventMassReadyIn.quantity, 1));

    for (const ingredient of recipeIngredients) {
      const representative = await ensureFamilyRepresentative(ingredient);
      await request(apiUrl, `/inventory-items/${representative.id}/effective-balance`, {
        method: 'POST',
        body: {
          quantity: ingredient.oneRecipeQty,
          reason: `${TEST_REASON} reset one recipe for manual`
        }
      });
    }
    await request(apiUrl, `/inventory-items/${massReadyRepresentative.id}/effective-balance`, {
      method: 'POST',
      body: {
        quantity: 0,
        reason: `${TEST_REASON} reset mass ready for manual`
      }
    });

    const manualPrepareReason = `${TEST_REASON} manual ${suffix}`;
    const manualPrepareRequest = {
      recipes: 2,
      reason: manualPrepareReason,
      requestKey: `${suffix}-manual-prepare`
    };
    const manualPrepare = await request(apiUrl, '/inventory-mass-ready/prepare', {
      method: 'POST',
      body: manualPrepareRequest
    });
    assert.equal(manualPrepare.ok, true);
    assert.equal(manualPrepare.recipesPrepared, 1);

    const repeatedManualPrepare = await request(apiUrl, '/inventory-mass-ready/prepare', {
      method: 'POST',
      body: manualPrepareRequest
    });
    assert.deepEqual(repeatedManualPrepare, manualPrepare);

    const movementsAfterManualPrepare = await request(apiUrl, '/inventory-movements');
    const manualPrepareMovements = movementsAfterManualPrepare.filter(
      (movement) =>
        movement.orderId == null &&
        movement.source === 'MASS_PREP' &&
        movement.sourceLabel === 'MANUAL_POPUP' &&
        String(movement.reason || '') === manualPrepareReason
    );
    assert.equal(
      manualPrepareMovements.length,
      7,
      `Preparo manual deduplicado deveria gerar 7 movimentos, recebeu ${manualPrepareMovements.length}`
    );
    const manualMassReadyIn = movementsAfterManualPrepare.find(
      (movement) =>
        movement.orderId == null &&
        movement.itemId === massReadyRepresentative.id &&
        movement.source === 'MASS_PREP' &&
        movement.sourceLabel === 'MANUAL_POPUP' &&
        movement.type === 'IN' &&
        String(movement.reason || '').includes(TEST_REASON)
    );
    assert.ok(manualMassReadyIn, 'Entrada manual de MASSA PRONTA nao encontrada');
    assert.ok(approxEqual(manualMassReadyIn.quantity, 1));
  }
);
