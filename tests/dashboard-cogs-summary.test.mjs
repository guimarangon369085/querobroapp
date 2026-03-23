import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

function approxEqual(left, right, epsilon = 0.0001) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= epsilon;
}

test('dashboard summary calcula COGS por pedido a partir dos ingredientes da ficha técnica', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  const created = {
    ingredientAId: null,
    ingredientBId: null,
    productAId: null,
    productBId: null,
    customerId: null,
    orderId: null
  };

  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const summaryBefore = await request(apiUrl, '/dashboard/summary?days=30');

  const ingredientA = await request(apiUrl, '/inventory-items', {
    method: 'POST',
    body: {
      name: `INGREDIENTE A COGS [TESTE_E2E] ${suffix}`,
      category: 'INGREDIENTE',
      unit: 'g',
      purchasePackSize: 100,
      purchasePackCost: 50
    }
  });
  created.ingredientAId = ingredientA.id;

  const ingredientB = await request(apiUrl, '/inventory-items', {
    method: 'POST',
    body: {
      name: `INGREDIENTE B COGS [TESTE_E2E] ${suffix}`,
      category: 'INGREDIENTE',
      unit: 'ml',
      purchasePackSize: 100,
      purchasePackCost: 20
    }
  });
  created.ingredientBId = ingredientB.id;

  for (const item of [ingredientA, ingredientB]) {
    await request(apiUrl, '/inventory-movements', {
      method: 'POST',
      body: {
        itemId: item.id,
        type: 'ADJUST',
        quantity: 1000,
        reason: `DASHBOARD_COGS_SUMMARY_TEST setup ${suffix}`
      }
    });
  }

  const productA = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Produto COGS A [TESTE_E2E] ${suffix}`,
      category: 'Sabores',
      unit: 'un',
      price: 10,
      active: true
    }
  });
  created.productAId = productA.id;

  const productB = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Produto COGS B [TESTE_E2E] ${suffix}`,
      category: 'Sabores',
      unit: 'un',
      price: 12,
      active: true
    }
  });
  created.productBId = productB.id;

  const existingBoms = await request(apiUrl, '/boms');
  const productABom = existingBoms.find((entry) => entry.productId === productA.id) || null;
  const productBBom = existingBoms.find((entry) => entry.productId === productB.id) || null;

  const productABomPayload = {
    productId: productA.id,
    name: `BOM COGS A [TESTE_E2E] ${suffix}`,
    saleUnitLabel: 'Unidade',
    yieldUnits: 1,
    items: [
      { itemId: ingredientA.id, qtyPerSaleUnit: 3 },
      { itemId: ingredientB.id, qtyPerSaleUnit: 2 }
    ]
  };
  const productBBomPayload = {
    productId: productB.id,
    name: `BOM COGS B [TESTE_E2E] ${suffix}`,
    saleUnitLabel: 'Unidade',
    yieldUnits: 1,
    items: [{ itemId: ingredientA.id, qtyPerSaleUnit: 4 }]
  };

  await (productABom
    ? request(apiUrl, `/boms/${productABom.id}`, { method: 'PUT', body: productABomPayload })
    : request(apiUrl, '/boms', { method: 'POST', body: productABomPayload }));

  await (productBBom
    ? request(apiUrl, `/boms/${productBBom.id}`, { method: 'PUT', body: productBBomPayload })
    : request(apiUrl, '/boms', { method: 'POST', body: productBBomPayload }));

  const customer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: `Cliente Dashboard COGS [TESTE_E2E] ${suffix}`,
      phone: '11988887777',
      address: 'Rua Dashboard, 10'
    }
  });
  created.customerId = customer.id;

  const order = await request(apiUrl, '/orders', {
    method: 'POST',
    body: {
      customerId: customer.id,
      scheduledAt: new Date(Date.UTC(2032, 0, 10, 14, 0, 0)).toISOString(),
      items: [
        { productId: productA.id, quantity: 2 },
        { productId: productB.id, quantity: 1 }
      ]
    }
  });
  created.orderId = order.id;

  const summaryAfter = await request(apiUrl, '/dashboard/summary?days=30');
  const expectedOrderCogs = 5.8;
  const expectedIngredientAAmount = 5;
  const expectedIngredientBAmount = 0.8;
  const expectedOrderRevenue = Math.max(Number(order.subtotal || 0) - Number(order.discount || 0), 0);
  const expectedGrossProfit = expectedOrderRevenue - expectedOrderCogs;

  assert.equal(
    approxEqual(
      summaryAfter.business.kpis.estimatedCogsInRange - summaryBefore.business.kpis.estimatedCogsInRange,
      expectedOrderCogs
    ),
    true
  );
  assert.equal(
    summaryAfter.business.kpis.costedOrdersInRange - summaryBefore.business.kpis.costedOrdersInRange,
    1
  );
  assert.equal(
    summaryAfter.business.cogsAudit.ordersCount - summaryBefore.business.cogsAudit.ordersCount,
    1
  );
  assert.equal(
    approxEqual(summaryAfter.business.cogsAudit.cogs - summaryBefore.business.cogsAudit.cogs, expectedOrderCogs),
    true
  );

  const createdOrderEntry = summaryAfter.business.cogsByOrder.find((entry) => entry.orderId === order.id);
  assert.ok(createdOrderEntry, 'pedido criado deveria aparecer no detalhamento de COGS');
  assert.equal(createdOrderEntry.customerName, customer.name);
  assert.equal(createdOrderEntry.units, 3);
  assert.equal(approxEqual(createdOrderEntry.revenue, expectedOrderRevenue), true);
  assert.equal(approxEqual(createdOrderEntry.cogs, expectedOrderCogs), true);
  assert.equal(approxEqual(createdOrderEntry.grossProfit, expectedGrossProfit), true);
  assert.equal(createdOrderEntry.warnings.length, 0);

  const ingredientAEntry = createdOrderEntry.ingredients.find((entry) => entry.ingredientId === ingredientA.id);
  assert.ok(ingredientAEntry, 'ingrediente A deveria aparecer no pedido');
  assert.equal(approxEqual(ingredientAEntry.quantity, 10), true);
  assert.equal(approxEqual(ingredientAEntry.amount, expectedIngredientAAmount), true);

  const ingredientBEntry = createdOrderEntry.ingredients.find((entry) => entry.ingredientId === ingredientB.id);
  assert.ok(ingredientBEntry, 'ingrediente B deveria aparecer no pedido');
  assert.equal(approxEqual(ingredientBEntry.quantity, 4), true);
  assert.equal(approxEqual(ingredientBEntry.amount, expectedIngredientBAmount), true);

  const aggregateIngredientA = summaryAfter.business.cogsByIngredient.find((entry) => entry.ingredientId === ingredientA.id);
  assert.ok(aggregateIngredientA, 'ingrediente A deveria aparecer no agregado');
  assert.equal(approxEqual(aggregateIngredientA.amount, expectedIngredientAAmount), true);
  assert.equal(aggregateIngredientA.orderCount >= 1, true);

  const aggregateIngredientB = summaryAfter.business.cogsByIngredient.find((entry) => entry.ingredientId === ingredientB.id);
  assert.ok(aggregateIngredientB, 'ingrediente B deveria aparecer no agregado');
  assert.equal(approxEqual(aggregateIngredientB.amount, expectedIngredientBAmount), true);
});
