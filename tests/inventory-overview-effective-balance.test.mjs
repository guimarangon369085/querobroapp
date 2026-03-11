import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

const TEST_REASON = '[TESTE_E2E] inventory-overview-effective-balance';

function normalizeLookup(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

test(
  'inventory-overview consolida aliases legados e permite ajuste de saldo efetivo',
  { timeout: 180000 },
  async (t) => {
    const { apiUrl, shutdown } = await ensureApiServer();
    let createdAliasItemId = null;
    let familyItemIds = [];
    let originalMovementIds = new Set();

    t.after(async () => {
      try {
        const movements = await request(apiUrl, '/inventory-movements');
        const cleanupMovements = movements
          .filter(
            (movement) =>
              familyItemIds.includes(movement.itemId) && !originalMovementIds.has(movement.id)
          )
          .sort((left, right) => right.id - left.id);

        for (const movement of cleanupMovements) {
          try {
            await request(apiUrl, `/inventory-movements/${movement.id}`, { method: 'DELETE' });
          } catch {
            // melhor esforco
          }
        }
      } catch {
        // melhor esforco
      }

      if (createdAliasItemId) {
        try {
          await request(apiUrl, `/inventory-items/${createdAliasItemId}`, { method: 'DELETE' });
        } catch {
          // melhor esforco
        }
      }

      await shutdown();
    });

    const items = await request(apiUrl, '/inventory-items');
    const canonicalItem = items.find((item) => normalizeLookup(item.name) === 'MANTEIGA');
    assert.ok(canonicalItem, 'Item canônico MANTEIGA deveria existir');

    let aliasItem = items.find((item) => normalizeLookup(item.name) === 'MANTEIGA COM SAL') || null;
    if (!aliasItem) {
      aliasItem = await request(apiUrl, '/inventory-items', {
        method: 'POST',
        body: {
          name: 'MANTEIGA COM SAL',
          category: 'INGREDIENTE',
          unit: 'g',
          purchasePackSize: 500,
          purchasePackCost: 24.9
        }
      });
      createdAliasItemId = aliasItem.id;
    }

    familyItemIds = [canonicalItem.id, aliasItem.id];

    const originalMovements = await request(apiUrl, '/inventory-movements');
    originalMovementIds = new Set(
      originalMovements
        .filter((movement) => familyItemIds.includes(movement.itemId))
        .map((movement) => movement.id)
    );

    const overviewBefore = await request(apiUrl, '/inventory-overview');
    const butterRowBefore = overviewBefore.items.find(
      (item) => normalizeLookup(item.name) === 'MANTEIGA'
    );
    assert.ok(butterRowBefore, 'MANTEIGA deveria aparecer na visao canonica');
    assert.ok(
      !overviewBefore.items.some((item) => normalizeLookup(item.name) === 'MANTEIGA COM SAL'),
      'Alias legado MANTEIGA COM SAL nao deveria aparecer como item separado'
    );
    assert.ok(
      butterRowBefore.rawItemIds.includes(canonicalItem.id) &&
        butterRowBefore.rawItemIds.includes(aliasItem.id),
      'Visao canonica deveria apontar para os ids crus da familia'
    );

    await request(apiUrl, `/inventory-items/${butterRowBefore.id}/effective-balance`, {
      method: 'POST',
      body: {
        quantity: 321,
        reason: TEST_REASON
      }
    });

    const overviewAfter = await request(apiUrl, '/inventory-overview');
    const butterRowAfter = overviewAfter.items.find(
      (item) => normalizeLookup(item.name) === 'MANTEIGA'
    );
    assert.ok(butterRowAfter, 'MANTEIGA deveria continuar visivel');
    assert.equal(Number(butterRowAfter.balance), 321);
    assert.ok(
      !overviewAfter.items.some((item) => normalizeLookup(item.name) === 'MANTEIGA COM SAL'),
      'Alias legado nao deveria reaparecer apos ajuste efetivo'
    );
  }
);
