import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

const TEST_REASON = '[TESTE_E2E] stock-planning-open-orders';

function approxEqual(actual, expected, epsilon = 0.0001) {
  return Math.abs(Number(actual) - Number(expected)) <= epsilon;
}

test(
  'planejamento de estoque projeta falta e sugere compra sem travar pedido aberto',
  { timeout: 180000 },
  async (t) => {
    const { apiUrl, shutdown } = await ensureApiServer();
    const created = {
      itemId: null,
      productId: null,
      bomId: null,
      customerId: null,
      orderId: null
    };

    t.after(async () => {
      try {
        const movements = await request(apiUrl, '/inventory-movements');
        const cleanupMovements = movements
          .filter((movement) => movement.orderId === created.orderId || movement.itemId === created.itemId)
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

      const cleanupSteps = [
        created.orderId ? () => request(apiUrl, `/orders/${created.orderId}`, { method: 'DELETE' }) : null,
        created.bomId ? () => request(apiUrl, `/boms/${created.bomId}`, { method: 'DELETE' }) : null,
        created.productId ? () => request(apiUrl, `/inventory-products/${created.productId}`, { method: 'DELETE' }) : null,
        created.customerId ? () => request(apiUrl, `/customers/${created.customerId}`, { method: 'DELETE' }) : null,
        created.itemId ? () => request(apiUrl, `/inventory-items/${created.itemId}`, { method: 'DELETE' }) : null
      ].filter(Boolean);

      for (const cleanup of cleanupSteps) {
        try {
          await cleanup();
        } catch {
          // melhor esforco
        }
      }

      await shutdown();
    });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const item = await request(apiUrl, '/inventory-items', {
      method: 'POST',
      body: {
        name: `POLVILHO PROJECAO [TESTE_E2E] ${suffix}`,
        category: 'INGREDIENTE',
        unit: 'g',
        purchasePackSize: 1000,
        purchasePackCost: 20,
        leadTimeDays: 2,
        safetyStockQty: 4,
        reorderPointQty: 12,
        targetStockQty: 25,
        perishabilityDays: 7,
        criticality: 'CRITICA',
        preferredSupplier: 'Fornecedor Teste'
      }
    });
    created.itemId = item.id;

    const overview = await request(apiUrl, '/inventory-overview');
    const overviewItem = overview.items.find((entry) => entry.id === item.id);
    assert.ok(overviewItem, 'Item novo deveria aparecer no overview');
    assert.equal(overviewItem.leadTimeDays, 2);
    assert.equal(overviewItem.criticality, 'CRITICA');
    assert.equal(overviewItem.preferredSupplier, 'Fornecedor Teste');

    await request(apiUrl, '/inventory-movements', {
      method: 'POST',
      body: {
        itemId: item.id,
        type: 'ADJUST',
        quantity: 10,
        reason: `${TEST_REASON} setup`
      }
    });

    const product = await request(apiUrl, '/inventory-products', {
      method: 'POST',
      body: {
        name: `Broa Tradicional (T) [TESTE_E2E] ${suffix}`,
        category: 'Sabores',
        unit: 'un',
        price: 11,
        active: true
      }
    });
    created.productId = product.id;

    const existingBoms = await request(apiUrl, '/boms');
    const existingBom = existingBoms.find((entry) => entry.productId === product.id) || null;
    const bomPayload = {
      productId: product.id,
      name: `BOM Planejamento [TESTE_E2E] ${suffix}`,
      saleUnitLabel: 'Caixa com 7 broas',
      yieldUnits: 7,
      items: [
        {
          itemId: item.id,
          qtyPerUnit: 5
        }
      ]
    };
    const bom = existingBom
      ? await request(apiUrl, `/boms/${existingBom.id}`, { method: 'PUT', body: bomPayload })
      : await request(apiUrl, '/boms', { method: 'POST', body: bomPayload });
    created.bomId = bom.id;

    const customer = await request(apiUrl, '/customers', {
      method: 'POST',
      body: {
        name: `Cliente Planejamento [TESTE_E2E] ${suffix}`,
        phone: '11970000000',
        address: 'Rua Estoque, 10'
      }
    });
    created.customerId = customer.id;

    const scheduledAt = new Date(Date.UTC(2032, 0, 16, 9, 0, 0)).toISOString();
    const order = await request(apiUrl, '/orders', {
      method: 'POST',
      body: {
        customerId: customer.id,
        scheduledAt,
        items: [{ productId: product.id, quantity: 3 }]
      }
    });
    created.orderId = order.id;

    const existingOrders = await request(apiUrl, '/orders');
    for (const existingOrder of existingOrders) {
      if (existingOrder.id === order.id) continue;
      if (existingOrder.status === 'CANCELADO' || existingOrder.status === 'ENTREGUE') continue;
      try {
        await request(apiUrl, `/orders/${existingOrder.id}/status`, {
          method: 'PATCH',
          body: { status: 'CANCELADO' }
        });
      } catch {
        // melhor esforco para manter o teste deterministico
      }
    }

    const planning = await request(apiUrl, '/production/stock-planning');
    const shortageItem = planning.shortageItems.find((entry) => entry.itemId === item.id);
    assert.ok(shortageItem, 'Item deveria entrar no planejamento de falta');
    assert.equal(shortageItem.level, 'CRITICO');
    assert.equal(shortageItem.preferredSupplier, 'Fornecedor Teste');
    assert.ok(approxEqual(shortageItem.currentBalance, 10));
    assert.ok(approxEqual(shortageItem.totalRequiredQty, 15));
    assert.ok(approxEqual(shortageItem.shortageQty, 5));
    assert.ok(approxEqual(shortageItem.projectedBalance, -5));

    const purchaseSuggestion = planning.purchaseSuggestions.find((entry) => entry.itemId === item.id);
    assert.ok(purchaseSuggestion, 'Item deveria aparecer em compra sugerida');
    assert.equal(purchaseSuggestion.reason, 'SHORTAGE');
    assert.ok(approxEqual(purchaseSuggestion.recommendedPurchaseQty, 30));

    const orderRisk = planning.orderRisks.find((entry) => entry.orderId === order.id);
    assert.ok(orderRisk, 'Pedido aberto deveria entrar no quadro de risco');
    assert.equal(orderRisk.level, 'CRITICO');
    assert.ok(orderRisk.shortageItemCount >= 1);

    assert.equal(planning.summary.openOrdersCount, 1);
    assert.equal(planning.summary.criticalOrdersCount, 1);
    assert.ok(planning.summary.purchaseSuggestionsCount >= 1);
    assert.equal(planning.summary.bomWarningsCount, 0);
  }
);
