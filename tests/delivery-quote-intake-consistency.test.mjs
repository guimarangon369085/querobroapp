import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

function cleanupMovementTargets(movements, created) {
  return movements
    .filter(
      (movement) =>
        movement.orderId === created.orderId || movement.itemId === created.inventoryItemId
    )
    .sort((left, right) => right.id - left.id);
}

test(
  'customer-form intake aceita quote do preview quando o cupom altera o subtotal',
  { timeout: 180000 },
  async (t) => {
    const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
    const { apiUrl, shutdown } = await ensureApiServer();
    const created = {
      couponId: null,
      productId: null,
      orderId: null,
      customerId: null
    };

    t.after(async () => {
      const cleanupSteps = [
        created.orderId ? () => request(apiUrl, `/orders/${created.orderId}`, { method: 'DELETE' }) : null,
        created.productId
          ? () => request(apiUrl, `/inventory-products/${created.productId}`, { method: 'DELETE' })
          : null,
        created.customerId ? () => request(apiUrl, `/customers/${created.customerId}`, { method: 'DELETE' }) : null,
        created.couponId
          ? () =>
              request(apiUrl, `/dashboard/coupons/${created.couponId}`, {
                method: 'DELETE',
                headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined
              })
          : null
      ].filter(Boolean);

      for (const cleanup of cleanupSteps) {
        try {
          await cleanup();
        } catch {
          // melhor esforço
        }
      }

      await shutdown();
    });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const product = await request(apiUrl, '/inventory-products', {
      method: 'POST',
      body: {
        name: `Broa Tradicional ${suffix}`,
        category: 'Sabores',
        unit: 'unidade',
        price: 6,
        active: true
      }
    });
    created.productId = product.id;

    const coupon = await request(apiUrl, '/dashboard/coupons', {
      method: 'POST',
      headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
      body: {
        code: `FRETE-${suffix}`,
        discountPct: 10,
        active: true
      }
    });
    created.couponId = coupon.id;

    const scheduledAt = new Date(Date.UTC(2033, 0, 12, 15, 0, 0)).toISOString();
    const basePayload = {
      version: 1,
      customer: {
        name: `Cliente Frete ${suffix}`,
        phone: '31999999998',
        address: 'Alameda Jaú, 740',
        addressLine1: 'Alameda Jaú, 740',
        addressLine2: 'Apto 101',
        neighborhood: 'Jardins',
        city: 'São Paulo',
        state: 'SP',
        postalCode: '01420-002',
        country: 'Brasil',
        placeId: `preview-place-${suffix}`,
        lat: -23.5652,
        lng: -46.6559
      },
      fulfillment: {
        mode: 'DELIVERY',
        scheduledAt
      },
      items: [{ productId: product.id, quantity: 7 }],
      couponCode: coupon.code,
      source: {
        externalId: `customer-form-delivery-coupon-${suffix}`
      }
    };

    const preview = await request(apiUrl, '/orders/intake/customer-form/preview', {
      method: 'POST',
      body: basePayload
    });

    assert.ok(preview.delivery?.quoteToken, 'preview deveria devolver quoteToken');

    const intake = await request(apiUrl, '/orders/intake/customer-form', {
      method: 'POST',
      body: {
        ...basePayload,
        delivery: {
          quoteToken: preview.delivery.quoteToken,
          fee: preview.delivery.fee,
          provider: preview.delivery.provider,
          source: preview.delivery.source,
          status: preview.delivery.status,
          expiresAt: preview.delivery.expiresAt
        }
      }
    });

    created.orderId = intake.order.id;
    created.customerId = intake.intake.customerId;

    assert.equal(intake.order.couponCode, coupon.code);
    assert.ok(Number(intake.order.deliveryFee) >= 0);
  }
);

test(
  'quote de delivery normaliza totalUnits a partir dos itens e nao quebra intake com amigas da broa',
  { timeout: 180000 },
  async (t) => {
    const { apiUrl, shutdown } = await ensureApiServer();
    const created = {
      productId: null,
      orderId: null,
      customerId: null,
      inventoryItemId: null
    };

    t.after(async () => {
      try {
        const movements = await request(apiUrl, '/inventory-movements');
        const cleanupMovements = cleanupMovementTargets(movements, created);
        for (const movement of cleanupMovements) {
          try {
            await request(apiUrl, `/inventory-movements/${movement.id}`, { method: 'DELETE' });
          } catch {
            // melhor esforço
          }
        }
      } catch {
        // melhor esforço
      }

      const cleanupSteps = [
        created.orderId ? () => request(apiUrl, `/orders/${created.orderId}`, { method: 'DELETE' }) : null,
        created.productId
          ? () => request(apiUrl, `/inventory-products/${created.productId}`, { method: 'DELETE' })
          : null,
        created.customerId ? () => request(apiUrl, `/customers/${created.customerId}`, { method: 'DELETE' }) : null,
        created.inventoryItemId
          ? () => request(apiUrl, `/inventory-items/${created.inventoryItemId}`, { method: 'DELETE' })
          : null
      ].filter(Boolean);

      for (const cleanup of cleanupSteps) {
        try {
          await cleanup();
        } catch {
          // melhor esforço
        }
      }

      await shutdown();
    });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const product = await request(apiUrl, '/inventory-products', {
      method: 'POST',
      body: {
        name: `Produto Amigas Frete [TESTE_E2E] ${suffix}`,
        category: 'Amigas da Broa',
        unit: 'unidade',
        price: 28,
        active: true,
        inventoryQtyPerSaleUnit: 100,
        companionInventory: {
          balance: 300,
          unit: 'g',
          purchasePackSize: 500,
          purchasePackCost: 25
        }
      }
    });
    created.productId = product.id;
    created.inventoryItemId = product.inventoryItemId;

    const scheduledAt = new Date(Date.UTC(2033, 0, 13, 15, 0, 0)).toISOString();
    const quote = await request(apiUrl, '/deliveries/quotes', {
      method: 'POST',
      body: {
        mode: 'DELIVERY',
        scheduledAt,
        customer: {
          name: `Cliente Amigas Frete ${suffix}`,
          phone: '31999999997',
          address: 'Rua das Amigas, 10',
          addressLine1: 'Rua das Amigas, 10',
          neighborhood: 'Centro',
          city: 'Belo Horizonte',
          state: 'MG',
          postalCode: '30110-000',
          country: 'Brasil'
        },
        manifest: {
          items: [{ name: product.name, quantity: 1 }],
          subtotal: 28,
          totalUnits: 0
        }
      }
    });

    assert.ok(quote.quoteToken, 'quote deveria devolver quoteToken');

    const intake = await request(apiUrl, '/orders/intake', {
      method: 'POST',
      body: {
        version: 1,
        intent: 'CONFIRMED',
        customer: {
          name: `Cliente Amigas Frete ${suffix}`,
          phone: '31999999997',
          address: 'Rua das Amigas, 10',
          addressLine1: 'Rua das Amigas, 10',
          neighborhood: 'Centro',
          city: 'Belo Horizonte',
          state: 'MG',
          postalCode: '30110-000',
          country: 'Brasil'
        },
        fulfillment: {
          mode: 'DELIVERY',
          scheduledAt
        },
        delivery: {
          quoteToken: quote.quoteToken,
          fee: quote.fee,
          provider: quote.provider,
          source: quote.source,
          status: quote.status,
          expiresAt: quote.expiresAt
        },
        order: {
          items: [{ productId: product.id, quantity: 1 }]
        },
        payment: {
          method: 'pix',
          status: 'PENDENTE',
          dueAt: scheduledAt
        },
        source: {
          channel: 'CUSTOMER_LINK',
          externalId: `amigas-delivery-quote-${suffix}`,
          idempotencyKey: `amigas-delivery-quote-${suffix}`
        }
      }
    });

    created.orderId = intake.order.id;
    created.customerId = intake.intake.customerId;

    assert.equal(intake.order.fulfillmentMode, 'DELIVERY');
    assert.ok(Number(intake.order.deliveryFee) >= 0);
  }
);

test(
  'dashboard interno aceita pedido com 100% de desconto e trata o frete como marketing',
  { timeout: 180000 },
  async (t) => {
    const { apiUrl, shutdown } = await ensureApiServer();
    const created = {
      productId: null,
      orderId: null,
      customerId: null
    };

    t.after(async () => {
      const cleanupSteps = [
        created.orderId ? () => request(apiUrl, `/orders/${created.orderId}`, { method: 'DELETE' }) : null,
        created.productId
          ? () => request(apiUrl, `/inventory-products/${created.productId}`, { method: 'DELETE' })
          : null,
        created.customerId ? () => request(apiUrl, `/customers/${created.customerId}`, { method: 'DELETE' }) : null
      ].filter(Boolean);

      for (const cleanup of cleanupSteps) {
        try {
          await cleanup();
        } catch {
          // melhor esforço
        }
      }

      await shutdown();
    });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const customer = await request(apiUrl, '/customers', {
      method: 'POST',
      body: {
        name: `Cliente Interno ${suffix}`,
        phone: '31999999991',
        address: 'Rua dos Testes, 100',
        addressLine1: 'Rua dos Testes, 100',
        neighborhood: 'Centro',
        city: 'Belo Horizonte',
        state: 'MG',
        postalCode: '30110-000',
        country: 'Brasil'
      }
    });
    created.customerId = customer.id;

    const product = await request(apiUrl, '/inventory-products', {
      method: 'POST',
      body: {
        name: `Produto Interno ${suffix}`,
        category: 'Sabores',
        unit: 'unidade',
        price: 10,
        active: true
      }
    });
    created.productId = product.id;

    const scheduledAt = new Date(Date.UTC(2033, 0, 12, 15, 0, 0)).toISOString();
    const quote = await request(apiUrl, '/deliveries/quotes/internal', {
      method: 'POST',
      body: {
        mode: 'DELIVERY',
        scheduledAt,
        customer: {
          name: customer.name,
          phone: customer.phone,
          address: customer.address,
          addressLine1: customer.addressLine1,
          neighborhood: customer.neighborhood,
          city: customer.city,
          state: customer.state,
          postalCode: customer.postalCode,
          country: customer.country
        },
        manifest: {
          items: [{ name: product.name, quantity: 7 }],
          subtotal: 0,
          totalUnits: 7
        }
      }
    });

    const intake = await request(apiUrl, '/orders/intake', {
      method: 'POST',
      body: {
        version: 1,
        intent: 'CONFIRMED',
        customer: {
          customerId: customer.id,
          address: customer.address,
          addressLine1: customer.addressLine1,
          neighborhood: customer.neighborhood,
          city: customer.city,
          state: customer.state,
          postalCode: customer.postalCode,
          country: customer.country
        },
        fulfillment: {
          mode: 'DELIVERY',
          scheduledAt
        },
        delivery: {
          quoteToken: quote.quoteToken,
          fee: quote.fee,
          provider: quote.provider,
          source: quote.source,
          status: quote.status,
          expiresAt: quote.expiresAt
        },
        order: {
          items: [{ productId: product.id, quantity: 7 }],
          discountPct: 100
        },
        payment: {
          method: 'pix',
          status: 'PENDENTE',
          dueAt: scheduledAt
        },
        source: {
          channel: 'INTERNAL_DASHBOARD'
        }
      }
    });

    created.orderId = intake.order.id;

    assert.equal(Number(intake.order.subtotal), 70);
    assert.equal(Number(intake.order.discount), 70);
    assert.equal(Number(intake.order.deliveryFee), 0);
    assert.equal(Number(intake.order.total), 0);
    assert.match(String(intake.order.notes || ''), /Investimento de marketing:/);
    assert.match(String(intake.order.notes || ''), /frete/i);
  }
);
