import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

test(
  'amigas da broa continuam visiveis sem estoque, bloqueiam nova compra e liberam apos reposicao',
  { timeout: 180000 },
  async (t) => {
    const { apiUrl, shutdown } = await ensureApiServer();
    const created = {
      orderIds: [],
      customerIds: [],
      productId: null,
      inventoryItemId: null,
      replenishMovementId: null
    };

    t.after(async () => {
      try {
        const movements = await request(apiUrl, '/inventory-movements');
        const cleanupMovements = movements
          .filter(
            (movement) =>
              created.orderIds.includes(movement.orderId) || movement.itemId === created.inventoryItemId
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
        ...created.orderIds.map((orderId) => () => request(apiUrl, `/orders/${orderId}`, { method: 'DELETE' })),
        created.productId
          ? () => request(apiUrl, `/inventory-products/${created.productId}`, { method: 'DELETE' })
          : null,
        ...created.customerIds.map((customerId) => () => request(apiUrl, `/customers/${customerId}`, { method: 'DELETE' })),
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

      await shutdown();
    });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const product = await request(apiUrl, '/inventory-products', {
      method: 'POST',
      body: {
        name: `Produto Amigas [TESTE_E2E] ${suffix}`,
        category: 'Amigas da Broa',
        unit: 'unidade',
        price: 28,
        active: true,
        imageUrl: '/querobroa-brand/cardapio/sabores-caixa.jpg',
        inventoryQtyPerSaleUnit: 90,
        companionInventory: {
          balance: 180,
          unit: 'g',
          purchasePackSize: 500,
          purchasePackCost: 25
        }
      }
    });
    created.productId = product.id;
    created.inventoryItemId = product.inventoryItemId;

    assert.equal(product.active, true);

    const scheduledAt = new Date(Date.UTC(2033, 0, 12, 15, 0, 0)).toISOString();
    const intake = await request(apiUrl, '/orders/intake', {
      method: 'POST',
      body: {
        version: 1,
        intent: 'CONFIRMED',
        customer: {
          name: `Cliente Amigas ${suffix}`,
          phone: '11999998888',
          address: 'Rua das Amigas, 10'
        },
        fulfillment: {
          mode: 'PICKUP',
          scheduledAt
        },
        order: {
          items: [{ productId: product.id, quantity: 2 }]
        },
        payment: {
          method: 'pix',
          status: 'PENDENTE'
        },
        source: {
          channel: 'CUSTOMER_LINK',
          externalId: `amigas-${suffix}`,
          idempotencyKey: `amigas-${suffix}`
        }
      }
    });

    created.orderIds.push(intake.order.id);
    created.customerIds.push(intake.intake.customerId);

    const depletedProduct = await request(apiUrl, `/inventory-products/${product.id}`);
    assert.equal(depletedProduct.active, true);

    const movementsAfterOrder = await request(apiUrl, '/inventory-movements');
    const reservationMovement = movementsAfterOrder.find(
      (movement) =>
        movement.orderId === created.orderIds[0] &&
        movement.itemId === created.inventoryItemId &&
        movement.source === 'ORDER_COMPANION' &&
        movement.type === 'OUT'
    );
    assert.ok(reservationMovement, 'Baixa direta do produto deveria existir no pedido');
    assert.equal(Number(reservationMovement.quantity), 180);

    await assert.rejects(
      () =>
        request(apiUrl, '/orders/intake', {
          method: 'POST',
          body: {
            version: 1,
            intent: 'CONFIRMED',
            customer: {
              name: `Cliente Amigas 2 ${suffix}`,
              phone: '11999997777',
              address: 'Rua das Amigas, 20'
            },
            fulfillment: {
              mode: 'PICKUP',
              scheduledAt: new Date(Date.UTC(2033, 0, 12, 16, 0, 0)).toISOString()
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
              externalId: `amigas-out-${suffix}`,
              idempotencyKey: `amigas-out-${suffix}`
            }
          }
        }),
      /temporariamente sem estoque/i
    );

    const replenishMovement = await request(apiUrl, '/inventory-movements', {
      method: 'POST',
      body: {
        itemId: created.inventoryItemId,
        type: 'IN',
        quantity: 500,
        reason: 'Reposicao manual [TESTE_E2E]'
      }
    });
    created.replenishMovementId = replenishMovement.id;

    const replenishedProduct = await request(apiUrl, `/inventory-products/${product.id}`);
    assert.equal(replenishedProduct.active, true);

    const replenishedIntake = await request(apiUrl, '/orders/intake', {
      method: 'POST',
      body: {
        version: 1,
        intent: 'CONFIRMED',
        customer: {
          name: `Cliente Amigas 3 ${suffix}`,
          phone: '11999996666',
          address: 'Rua das Amigas, 30'
        },
        fulfillment: {
          mode: 'PICKUP',
          scheduledAt: new Date(Date.UTC(2033, 0, 12, 17, 0, 0)).toISOString()
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
          externalId: `amigas-restock-${suffix}`,
          idempotencyKey: `amigas-restock-${suffix}`
        }
      }
    });
    created.orderIds.push(replenishedIntake.order.id);
    created.customerIds.push(replenishedIntake.intake.customerId);
    assert.ok(replenishedIntake.order?.id);
  }
);
