import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request, requestExpectError } from './lib/api-server.mjs';

const TEST_REASON = '[TESTE_E2E] production-quantity-semantics';

function approxEqual(actual, expected, epsilon = 0.0001) {
  return Math.abs(Number(actual) - Number(expected)) <= epsilon;
}

test(
  'producao trata quantidade do pedido como broas e baixa apenas o que sobra para a fornada',
  { timeout: 180000 },
  async (t) => {
    const { apiUrl, shutdown } = await ensureApiServer();
    const created = {
      inventoryItemId: null,
      batchId: null,
      orderId: null,
      customerId: null,
      bomId: null,
      productId: null
    };

    t.after(async () => {
      if (created.batchId) {
        try {
          await request(apiUrl, `/production/batches/${created.batchId}/complete`, { method: 'POST' });
        } catch {
          // melhor esforco
        }
      }

      try {
        const movements = await request(apiUrl, '/inventory-movements');
        const cleanupMovements = movements
          .filter(
            (movement) =>
              movement.orderId === created.orderId || movement.itemId === created.inventoryItemId
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

      const cleanupSteps = [
        created.orderId ? () => request(apiUrl, `/orders/${created.orderId}`, { method: 'DELETE' }) : null,
        created.bomId ? () => request(apiUrl, `/boms/${created.bomId}`, { method: 'DELETE' }) : null,
        created.productId ? () => request(apiUrl, `/inventory-products/${created.productId}`, { method: 'DELETE' }) : null,
        created.customerId
          ? () => request(apiUrl, `/customers/${created.customerId}`, { method: 'DELETE' })
          : null,
        created.inventoryItemId
          ? () => request(apiUrl, `/inventory-items/${created.inventoryItemId}`, { method: 'DELETE' })
          : null
      ].filter(Boolean);

      for (const cleanup of cleanupSteps) {
        try {
          await cleanup();
        } catch {
          // melhor esforco
        }
      }

      try {
        await request(apiUrl, '/production/queue');
      } catch {
        // melhor esforco
      }

      await shutdown();
    });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const inventoryItem = await request(apiUrl, '/inventory-items', {
      method: 'POST',
      body: {
        name: `INSUMO BASE [TESTE_E2E] ${suffix}`,
        category: 'INGREDIENTE',
        unit: 'g',
        purchasePackSize: 1000,
        purchasePackCost: 10
      }
    });
    created.inventoryItemId = inventoryItem.id;

    await request(apiUrl, '/inventory-movements', {
      method: 'POST',
      body: {
        itemId: inventoryItem.id,
        type: 'ADJUST',
        quantity: 1000,
        reason: `${TEST_REASON} setup`
      }
    });

    const product = await request(apiUrl, '/inventory-products', {
      method: 'POST',
      body: {
        name: `Broa Tradicional Semantica [TESTE_E2E] ${suffix}`,
        category: 'Sabores',
        unit: 'un',
        price: 10,
        active: true
      }
    });
    created.productId = product.id;

    const existingBoms = await request(apiUrl, '/boms');
    const existingBom = existingBoms.find((entry) => entry.productId === product.id) || null;
    const bomPayload = {
      productId: product.id,
      name: `Receita Semantica [TESTE_E2E] ${suffix}`,
      saleUnitLabel: 'Caixa com 7 broas',
      yieldUnits: 7,
      items: [
        {
          itemId: inventoryItem.id,
          qtyPerSaleUnit: 35,
          qtyPerUnit: 5
        }
      ]
    };
    const bom = existingBom
      ? await request(apiUrl, `/boms/${existingBom.id}`, {
          method: 'PUT',
          body: bomPayload
        })
      : await request(apiUrl, '/boms', {
          method: 'POST',
          body: bomPayload
        });
    created.bomId = bom.id;

    const customer = await request(apiUrl, '/customers', {
      method: 'POST',
      body: {
        name: `Cliente Producao Semantica [TESTE_E2E] ${suffix}`,
        phone: '11977776666',
        address: 'Rua Producao, 42'
      }
    });
    created.customerId = customer.id;

    const scheduledAt = new Date(Date.UTC(2032, 0, 15, 9, 0, 0)).toISOString();
    const order = await request(apiUrl, '/orders', {
      method: 'POST',
      body: {
        customerId: customer.id,
        scheduledAt,
        items: [{ productId: product.id, quantity: 4 }]
      }
    });
    created.orderId = order.id;

    const requirements = await request(apiUrl, '/production/requirements?date=2032-01-15');
    const requirementRow = requirements.rows.find((row) => row.ingredientId === inventoryItem.id);
    assert.ok(requirementRow, 'Item customizado deveria aparecer no D+1');
    assert.ok(approxEqual(requirementRow.requiredQty, 20));
    assert.ok(approxEqual(requirementRow.availableQty, 1000));
    assert.ok(approxEqual(requirementRow.shortageQty, 0));

    await request(apiUrl, `/orders/${order.id}/status`, {
      method: 'PATCH',
      body: { status: 'CONFIRMADO' }
    });

    const queue = await request(apiUrl, '/production/queue');
    const queueRow = queue.queue.find((entry) => entry.orderId === order.id);
    assert.ok(queueRow, 'Pedido confirmado deveria entrar na fila de producao');
    assert.ok(approxEqual(queueRow.totalBroas, 4));
    assert.ok(approxEqual(queueRow.remainingBroas, 4));

    const batch = await request(apiUrl, '/production/batches/start-next', {
      method: 'POST',
      body: {
        triggerLabel: TEST_REASON
      }
    });
    created.batchId = batch.batchId;

    const allocation = batch.allocations.find((entry) => entry.orderId === order.id);
    assert.ok(allocation, 'Pedido deveria ter alocacao na fornada');
    assert.ok(approxEqual(allocation.broasPlanned, 4));
    assert.ok(approxEqual(allocation.saleUnitsApprox, 4 / 7));

    const movementsAfterBatch = await request(apiUrl, '/inventory-movements');
    const batchMovement = movementsAfterBatch.find(
      (movement) =>
        movement.orderId === order.id &&
        movement.itemId === inventoryItem.id &&
        movement.source === 'PRODUCTION_BATCH' &&
        movement.type === 'OUT'
    );
    assert.ok(batchMovement, 'Baixa da fornada deveria existir para item customizado');
    assert.ok(approxEqual(batchMovement.quantity, 20));

    const requirementsAfterBatch = await request(apiUrl, '/production/requirements?date=2032-01-15');
    const requirementRowAfterBatch = requirementsAfterBatch.rows.find(
      (row) => row.ingredientId === inventoryItem.id
    );
    assert.equal(
      requirementRowAfterBatch,
      undefined,
      'Item consumido integralmente na fornada nao deveria continuar aparecendo no D+1'
    );

    await requestExpectError(apiUrl, `/orders/${order.id}`, 400, {
      method: 'DELETE'
    });
  }
);
