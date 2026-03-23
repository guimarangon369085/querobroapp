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

test('dashboard summary respeita historico de preco do ingrediente na data de cada pedido', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const ingredient = await request(apiUrl, '/inventory-items', {
    method: 'POST',
    body: {
      name: `INGREDIENTE HISTORICO COGS [TESTE_E2E] ${suffix}`,
      category: 'INGREDIENTE',
      unit: 'g',
      purchasePackSize: 100,
      purchasePackCost: 10
    }
  });

  await request(apiUrl, '/inventory-movements', {
    method: 'POST',
    body: {
      itemId: ingredient.id,
      type: 'ADJUST',
      quantity: 1000,
      reason: `DASHBOARD_COGS_PRICE_HISTORY_TEST setup ${suffix}`
    }
  });

  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Produto Historico COGS [TESTE_E2E] ${suffix}`,
      category: 'Sabores',
      unit: 'un',
      price: 15,
      active: true
    }
  });

  const existingBoms = await request(apiUrl, '/boms');
  const existingBom = existingBoms.find((entry) => entry.productId === product.id) || null;
  const bomPayload = {
    productId: product.id,
    name: `BOM HISTORICO COGS [TESTE_E2E] ${suffix}`,
    saleUnitLabel: 'Unidade',
    yieldUnits: 1,
    items: [{ itemId: ingredient.id, qtyPerSaleUnit: 10 }]
  };

  await (existingBom
    ? request(apiUrl, `/boms/${existingBom.id}`, { method: 'PUT', body: bomPayload })
    : request(apiUrl, '/boms', { method: 'POST', body: bomPayload }));

  const customer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: `Cliente Historico COGS [TESTE_E2E] ${suffix}`,
      phone: `119${String(Date.now()).slice(-8)}`,
      address: 'Rua Historico, 20'
    }
  });

  const firstOrder = await request(apiUrl, '/orders', {
    method: 'POST',
    body: {
      customerId: customer.id,
      scheduledAt: new Date(Date.UTC(2032, 0, 11, 14, 0, 0)).toISOString(),
      items: [{ productId: product.id, quantity: 1 }]
    }
  });

  const priceChangeEffectiveAt = new Date().toISOString();
  await request(apiUrl, `/inventory-items/${ingredient.id}/purchase-price`, {
    method: 'PUT',
    body: {
      purchasePackCost: 20,
      effectiveAt: priceChangeEffectiveAt,
      sourceName: 'Teste',
      note: 'Virada de custo para validar historico.'
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 1_200));

  const secondOrder = await request(apiUrl, '/orders', {
    method: 'POST',
    body: {
      customerId: customer.id,
      scheduledAt: new Date(Date.UTC(2032, 0, 12, 14, 0, 0)).toISOString(),
      items: [{ productId: product.id, quantity: 1 }]
    }
  });

  const summary = await request(apiUrl, '/dashboard/summary');
  const firstOrderEntry = summary.business.cogsByOrder.find((entry) => entry.orderId === firstOrder.id);
  const secondOrderEntry = summary.business.cogsByOrder.find((entry) => entry.orderId === secondOrder.id);

  assert.ok(firstOrderEntry, 'primeiro pedido deveria aparecer no COGS');
  assert.ok(secondOrderEntry, 'segundo pedido deveria aparecer no COGS');
  assert.equal(approxEqual(firstOrderEntry.cogs, 1), true);
  assert.equal(approxEqual(secondOrderEntry.cogs, 2), true);

  const priceBoard = await request(apiUrl, '/inventory-price-board');
  const ingredientEntry = priceBoard.items.find((entry) => entry.rawItemIds.includes(ingredient.id));
  assert.ok(ingredientEntry, 'ingrediente deveria aparecer no bloco de precos');
  assert.equal(ingredientEntry.purchasePackSize, 100);
  assert.equal(approxEqual(ingredientEntry.purchasePackCost, 20), true);
  assert.equal(ingredientEntry.priceEntries.length >= 2, true);
});

test('dashboard summary reconstitui caixas historicas importadas sem warnings de BOM', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  t.after(async () => {
    await shutdown();
  });

  const summaryBefore = await request(apiUrl, '/dashboard/summary');
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const flavorCosts = {
    T: 1,
    G: 2,
    D: 3,
    Q: 4,
    R: 5
  };

  const ingredientsByCode = {};
  for (const [code, packCost] of Object.entries(flavorCosts)) {
    const ingredient = await request(apiUrl, '/inventory-items', {
      method: 'POST',
      body: {
        name: `INGREDIENTE LEGADO ${code} [TESTE_E2E] ${suffix}`,
        category: 'INGREDIENTE',
        unit: 'g',
        purchasePackSize: 1,
        purchasePackCost: packCost
      }
    });
    ingredientsByCode[code] = ingredient;
    await request(apiUrl, '/inventory-movements', {
      method: 'POST',
      body: {
        itemId: ingredient.id,
        type: 'ADJUST',
        quantity: 500,
        reason: `DASHBOARD_COGS_LEGACY_TEST setup ${suffix} ${code}`
      }
    });
  }

  const products = await request(apiUrl, '/inventory-products');
  const officialProductsByCode = {
    T: products.find((entry) => /tradicional/i.test(entry.name)),
    G: products.find((entry) => /goiabada/i.test(entry.name)),
    D: products.find((entry) => /doce/i.test(entry.name)),
    Q: products.find((entry) => /queijo/i.test(entry.name) && /requeij/i.test(entry.name) === false),
    R: products.find((entry) => /requeij/i.test(entry.name))
  };

  const existingBoms = await request(apiUrl, '/boms');
  for (const code of Object.keys(officialProductsByCode)) {
    const product = officialProductsByCode[code];
    assert.ok(product, `produto oficial ${code} deveria existir`);
    const existingBom = existingBoms.find((entry) => entry.productId === product.id) || null;
    const bomPayload = {
      productId: product.id,
      name: `BOM LEGADO ${code} [TESTE_E2E] ${suffix}`,
      saleUnitLabel: 'Unidade',
      yieldUnits: 1,
      items: [{ itemId: ingredientsByCode[code].id, qtyPerSaleUnit: 1 }]
    };
    await (existingBom
      ? request(apiUrl, `/boms/${existingBom.id}`, { method: 'PUT', body: bomPayload })
      : request(apiUrl, '/boms', { method: 'POST', body: bomPayload }));
  }

  const historicalProduct = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: 'Caixa historica sem composicao',
      category: 'Historico',
      unit: 'cx',
      price: 52,
      active: true
    }
  });
  const refreshedBoms = await request(apiUrl, '/boms');
  const historicalBom = refreshedBoms.find((entry) => entry.productId === historicalProduct.id) || null;
  if (historicalBom) {
    await request(apiUrl, `/boms/${historicalBom.id}`, { method: 'DELETE' });
  }

  const customer = await request(apiUrl, '/customers', {
    method: 'POST',
    body: {
      name: `Cliente Legado Dashboard [TESTE_E2E] ${suffix}`,
      phone: `119${String(Date.now()).slice(-8)}`,
      address: 'Rua Legado, 52'
    }
  });

  const genericLegacyOrder = await request(apiUrl, '/orders', {
    method: 'POST',
    body: {
      customerId: customer.id,
      scheduledAt: new Date(Date.UTC(2032, 0, 13, 14, 0, 0)).toISOString(),
      notes: `[IMPORTADO_PLANILHA_LEGADA] key=${suffix}|generico origem=TESTE caixas=Sabores`,
      items: [{ productId: historicalProduct.id, quantity: 1 }]
    }
  });

  const specificLegacyOrder = await request(apiUrl, '/orders', {
    method: 'POST',
    body: {
      customerId: customer.id,
      scheduledAt: new Date(Date.UTC(2032, 0, 14, 14, 0, 0)).toISOString(),
      notes: `[IMPORTADO_PLANILHA_LEGADA] key=${suffix}|especifico origem=TESTE caixas=R + D`,
      items: [{ productId: historicalProduct.id, quantity: 1 }]
    }
  });

  const summaryAfter = await request(apiUrl, '/dashboard/summary');
  assert.equal(
    summaryAfter.business.cogsAudit.warningsCount <= summaryBefore.business.cogsAudit.warningsCount,
    true
  );

  const genericLegacyEntry = summaryAfter.business.cogsByOrder.find((entry) => entry.orderId === genericLegacyOrder.id);
  assert.ok(genericLegacyEntry, 'pedido legado generico deveria aparecer no dashboard');
  assert.equal(genericLegacyEntry.units, 7);
  assert.equal(genericLegacyEntry.warnings.length, 0);
  assert.equal(genericLegacyEntry.cogs > 0, true);

  const specificLegacyEntry = summaryAfter.business.cogsByOrder.find((entry) => entry.orderId === specificLegacyOrder.id);
  assert.ok(specificLegacyEntry, 'pedido legado especifico deveria aparecer no dashboard');
  assert.equal(specificLegacyEntry.units, 7);
  assert.equal(specificLegacyEntry.warnings.length, 0);
  assert.equal(approxEqual(specificLegacyEntry.cogs, 29), true);

  const requeijaoEntry = specificLegacyEntry.ingredients.find(
    (entry) => entry.ingredientId === ingredientsByCode.R.id
  );
  assert.ok(requeijaoEntry, 'requeijao deveria entrar na composicao historica');
  assert.equal(approxEqual(requeijaoEntry.quantity, 4), true);
  assert.equal(approxEqual(requeijaoEntry.amount, 20), true);

  const doceEntry = specificLegacyEntry.ingredients.find(
    (entry) => entry.ingredientId === ingredientsByCode.D.id
  );
  assert.ok(doceEntry, 'doce de leite deveria entrar na composicao historica');
  assert.equal(approxEqual(doceEntry.quantity, 3), true);
  assert.equal(approxEqual(doceEntry.amount, 9), true);
});
