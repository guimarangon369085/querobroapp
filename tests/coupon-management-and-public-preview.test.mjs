import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request, requestExpectError } from './lib/api-server.mjs';

test('coupon management: CRUD interno e resolve publico', async (t) => {
  const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  const { apiUrl, shutdown } = await ensureApiServer();

  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const created = await request(apiUrl, '/dashboard/coupons', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: `broa ${suffix}`,
      discountPct: 12.5,
      usageLimitPerCustomer: 1,
      active: true
    }
  });

  assert.equal(created.code, `BROA ${suffix}`.toUpperCase());
  assert.equal(created.discountPct, 12.5);
  assert.equal(created.usageLimitPerCustomer, 1);
  assert.equal(created.active, true);

  const resolved = await request(apiUrl, '/dashboard/coupons/resolve', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: created.code.toLowerCase(),
      subtotal: 80,
      customerPhone: '31999999998'
    }
  });

  assert.equal(resolved.code, created.code);
  assert.equal(resolved.discountPct, 12.5);
  assert.equal(resolved.discountAmount, 10);
  assert.equal(resolved.subtotalAfterDiscount, 70);

  const updated = await request(apiUrl, `/dashboard/coupons/${created.id}`, {
    method: 'PUT',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: created.code,
      discountPct: 15,
      usageLimitPerCustomer: 2,
      active: false
    }
  });

  assert.equal(updated.discountPct, 15);
  assert.equal(updated.usageLimitPerCustomer, 2);
  assert.equal(updated.active, false);

  const invalidResolve = await requestExpectError(apiUrl, '/dashboard/coupons/resolve', 400, {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: created.code,
      subtotal: 80
    }
  });

  assert.equal(invalidResolve.message, `Cupom ${created.code} esta inativo.`);

  const removed = await request(apiUrl, `/dashboard/coupons/${created.id}`, {
    method: 'DELETE',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined
  });

  assert.deepEqual(removed, { ok: true });

  const noActiveCoupons = await requestExpectError(apiUrl, '/dashboard/coupons/resolve', 400, {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: 'DEVA',
      subtotal: 80
    }
  });

  assert.equal(noActiveCoupons.message, 'Nenhum cupom ativo cadastrado no momento.');
});

test('coupon management: aceita variacoes acentuadas e bloqueia duplicidade semantica', async (t) => {
  const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  const { apiUrl, shutdown } = await ensureApiServer();

  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const canonicalCode = `ASASHAEDABROA-${suffix}`;
  const accentedInput = `ASASHAÉDABROA-${suffix}`;

  const created = await request(apiUrl, '/dashboard/coupons', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: canonicalCode,
      discountPct: 10,
      usageLimitPerCustomer: 2,
      active: true
    }
  });

  assert.equal(created.code, canonicalCode);

  const resolved = await request(apiUrl, '/dashboard/coupons/resolve', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: accentedInput,
      subtotal: 80,
      customerPhone: '31999999990'
    }
  });

  assert.equal(resolved.code, canonicalCode);
  assert.equal(resolved.discountAmount, 8);
  assert.equal(resolved.subtotalAfterDiscount, 72);

  const scheduledAt = new Date(Date.UTC(2030, 2, 19, 15, 0, 0)).toISOString();
  const intake = await request(apiUrl, '/orders/intake/customer-form', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      version: 1,
      customer: {
        name: `Cliente Acento ${suffix}`,
        phone: '31999999990'
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt
      },
      flavors: {
        T: 7,
        G: 0,
        D: 0,
        Q: 0,
        R: 0
      },
      couponCode: accentedInput,
      source: {
        externalId: `customer-form-coupon-accent-${suffix}`
      }
    }
  });

  assert.equal(intake.order.couponCode, canonicalCode);
  assert.match(String(intake.order.notes || ''), new RegExp(`Cupom aplicado: ${canonicalCode} \\(10%\\)`));

  const duplicateCreate = await requestExpectError(apiUrl, '/dashboard/coupons', 409, {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: accentedInput,
      discountPct: 5,
      usageLimitPerCustomer: 1,
      active: true
    }
  });

  assert.equal(duplicateCreate.message, 'Código do cupom já cadastrado.');
});

test('coupon limit por cliente bloqueia nova utilizacao e aparece no detalhe do cliente', async (t) => {
  const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  const { apiUrl, shutdown } = await ensureApiServer();

  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const coupon = await request(apiUrl, '/dashboard/coupons', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: `BROASVINDAS-${suffix}`,
      discountPct: 10,
      usageLimitPerCustomer: 1,
      active: true
    }
  });

  const scheduledAt = new Date(Date.UTC(2030, 2, 18, 15, 0, 0)).toISOString();
  const first = await request(apiUrl, '/orders/intake/customer-form', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      version: 1,
      customer: {
        name: `Cliente Boas Vindas ${suffix}`,
        phone: '31999999999'
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt
      },
      flavors: {
        T: 7,
        G: 0,
        D: 0,
        Q: 0,
        R: 0
      },
      couponCode: coupon.code,
      source: {
        externalId: `customer-form-coupon-intake-${suffix}`
      }
    }
  });

  assert.equal(first.order.couponCode, coupon.code);
  assert.equal(first.order.discount, 4);

  const secondResolve = await requestExpectError(apiUrl, '/dashboard/coupons/resolve', 400, {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: coupon.code,
      subtotal: 40,
      customerPhone: '31999999999'
    }
  });

  assert.equal(
    secondResolve.message,
    `Cupom ${coupon.code} já atingiu o limite de 1 uso(s) para este cliente.`
  );

  const customer = await request(apiUrl, `/customers/${first.order.customerId}`, {
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined
  });

  assert.deepEqual(customer.couponUsage, [
    {
      code: coupon.code,
      uses: 1,
      lastUsedAt: customer.couponUsage[0].lastUsedAt
    }
  ]);
  assert.ok(customer.couponUsage[0].lastUsedAt);
});

test('coupon analytics consolida usos, clientes e investimento do desconto', async (t) => {
  const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  const { apiUrl, shutdown } = await ensureApiServer();

  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const coupon = await request(apiUrl, '/dashboard/coupons', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: `ANALYTICS-${suffix}`,
      discountPct: 15,
      usageLimitPerCustomer: 3,
      active: true,
    },
  });

  const firstScheduledAt = new Date(Date.UTC(2030, 2, 20, 13, 0, 0)).toISOString();
  const secondScheduledAt = new Date(Date.UTC(2030, 2, 21, 14, 30, 0)).toISOString();

  const first = await request(apiUrl, '/orders/intake/customer-form', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      version: 1,
      customer: {
        name: `Cliente Analytics A ${suffix}`,
        phone: '31999999991',
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt: firstScheduledAt,
      },
      flavors: {
        T: 7,
        G: 0,
        D: 0,
        Q: 0,
        R: 0,
      },
      couponCode: coupon.code,
      source: {
        externalId: `coupon-analytics-a-${suffix}`,
      },
    },
  });

  const second = await request(apiUrl, '/orders/intake/customer-form', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      version: 1,
      customer: {
        name: `Cliente Analytics B ${suffix}`,
        phone: '31999999992',
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt: secondScheduledAt,
      },
      flavors: {
        T: 4,
        G: 3,
        D: 0,
        Q: 0,
        R: 0,
      },
      couponCode: coupon.code,
      source: {
        externalId: `coupon-analytics-b-${suffix}`,
      },
    },
  });

  const analytics = await request(apiUrl, '/dashboard/coupons/analytics', {
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
  });

  const record = analytics.find((entry) => entry.code === coupon.code);
  assert.ok(record);
  assert.equal(record.historicalOnly, false);
  assert.equal(record.active, true);
  assert.equal(record.discountPct, 15);
  assert.equal(record.usageLimitPerCustomer, 3);
  assert.equal(record.metrics.uses, 2);
  assert.equal(record.metrics.distinctCustomers, 2);
  assert.equal(record.metrics.discountInvestmentTotal, 12.75);
  assert.equal(record.metrics.subtotalTotal, 85);
  assert.equal(record.metrics.netRevenueTotal, 72.25);
  assert.equal(record.customers.length, 2);
  assert.equal(record.recentOrders.length, 2);
  assert.equal(record.recentOrders.some((entry) => entry.orderId === first.order.id), true);
  assert.equal(record.recentOrders.some((entry) => entry.orderId === second.order.id), true);
  assert.equal(
    record.customers.some((entry) => entry.customerName === `Cliente Analytics A ${suffix}`),
    true,
  );
  assert.equal(
    record.customers.some((entry) => entry.customerName === `Cliente Analytics B ${suffix}`),
    true,
  );
});

test('coupon analytics permite recuperar um cupom que ficou apenas no histórico', async (t) => {
  const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  const { apiUrl, shutdown } = await ensureApiServer();

  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const coupon = await request(apiUrl, '/dashboard/coupons', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: `RECUPERA-${suffix}`,
      discountPct: 12,
      usageLimitPerCustomer: 2,
      active: true,
    },
  });

  const intake = await request(apiUrl, '/orders/intake/customer-form', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      version: 1,
      customer: {
        name: `Cliente Recupera ${suffix}`,
        phone: '31999999993',
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt: new Date(Date.UTC(2030, 2, 22, 13, 0, 0)).toISOString(),
      },
      flavors: {
        T: 7,
        G: 0,
        D: 0,
        Q: 0,
        R: 0,
      },
      couponCode: coupon.code,
      source: {
        externalId: `coupon-recover-${suffix}`,
      },
    },
  });

  assert.equal(intake.order.couponCode, coupon.code);

  await request(apiUrl, `/dashboard/coupons/${coupon.id}`, {
    method: 'DELETE',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
  });

  const historicalAnalytics = await request(apiUrl, '/dashboard/coupons/analytics', {
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
  });

  const historicalRecord = historicalAnalytics.find((entry) => entry.code === coupon.code);
  assert.ok(historicalRecord);
  assert.equal(historicalRecord.historicalOnly, true);
  assert.equal(historicalRecord.id, undefined);
  assert.equal(historicalRecord.metrics.uses, 1);

  const recreated = await request(apiUrl, '/dashboard/coupons', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: coupon.code,
      discountPct: 18,
      usageLimitPerCustomer: 4,
      active: false,
    },
  });

  assert.equal(recreated.code, coupon.code);
  assert.equal(recreated.discountPct, 18);
  assert.equal(recreated.usageLimitPerCustomer, 4);
  assert.equal(recreated.active, false);

  const restoredAnalytics = await request(apiUrl, '/dashboard/coupons/analytics', {
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
  });

  const restoredRecord = restoredAnalytics.find((entry) => entry.code === coupon.code);
  assert.ok(restoredRecord);
  assert.equal(restoredRecord.historicalOnly, false);
  assert.equal(restoredRecord.id, recreated.id);
  assert.equal(restoredRecord.discountPct, 18);
  assert.equal(restoredRecord.usageLimitPerCustomer, 4);
  assert.equal(restoredRecord.active, false);
  assert.equal(restoredRecord.metrics.uses, 1);
});

test('customer-form preview aplica desconto do cupom no total e nas notas', async (t) => {
  const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  const { apiUrl, shutdown } = await ensureApiServer();

  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const coupon = await request(apiUrl, '/dashboard/coupons', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      code: `PROMO${suffix}`,
      discountPct: 10,
      active: true
    }
  });

  const preview = await request(apiUrl, '/orders/intake/customer-form/preview', {
    method: 'POST',
    headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
    body: {
      version: 1,
      customer: {
        name: `Cliente Cupom ${suffix}`,
        phone: '31999999999'
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt: new Date(Date.UTC(2030, 2, 15, 14, 30, 0)).toISOString()
      },
      flavors: {
        T: 4,
        G: 3,
        D: 0,
        Q: 0,
        R: 0
      },
      couponCode: coupon.code,
      notes: 'Preview com cupom',
      source: {
        externalId: `customer-form-coupon-preview-${suffix}`
      }
    }
  });

  assert.equal(preview.fulfillmentMode, 'PICKUP');
  assert.equal(preview.order.subtotal, 45);
  assert.equal(preview.order.discount, 4.5);
  assert.equal(preview.order.deliveryFee, 0);
  assert.equal(preview.order.total, 40.5);
  assert.equal(preview.order.notes.includes(`Cupom aplicado: ${coupon.code} (10%)`), true);
});

test(
  'customer-form aplica cupom apenas sobre broas quando pedido inclui amigas da broa',
  { timeout: 180000 },
  async (t) => {
    const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
    const { apiUrl, shutdown } = await ensureApiServer();
    const created = {
      couponId: null,
      traditionalProductId: null,
      goiabadaProductId: null,
      companionProductId: null,
      inventoryItemId: null,
      previewExternalId: null,
      orderId: null,
      customerId: null
    };

    t.after(async () => {
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
        created.couponId
          ? () =>
              request(apiUrl, `/dashboard/coupons/${created.couponId}`, {
                method: 'DELETE',
                headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined
              })
          : null,
        created.companionProductId
          ? () => request(apiUrl, `/inventory-products/${created.companionProductId}`, { method: 'DELETE' })
          : null,
        created.goiabadaProductId
          ? () => request(apiUrl, `/inventory-products/${created.goiabadaProductId}`, { method: 'DELETE' })
          : null,
        created.traditionalProductId
          ? () => request(apiUrl, `/inventory-products/${created.traditionalProductId}`, { method: 'DELETE' })
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
          // melhor esforco
        }
      }

      await shutdown();
    });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const coupon = await request(apiUrl, '/dashboard/coupons', {
      method: 'POST',
      headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
      body: {
        code: `AMIGAS${suffix}`,
        discountPct: 10,
        active: true
      }
    });
    created.couponId = coupon.id;

    const traditionalProduct = await request(apiUrl, '/inventory-products', {
      method: 'POST',
      body: {
        name: `Broa Tradicional (T) [TESTE_E2E] ${suffix}`,
        category: 'Sabores',
        unit: 'unidade',
        price: 40,
        active: true
      }
    });
    created.traditionalProductId = traditionalProduct.id;

    const goiabadaProduct = await request(apiUrl, '/inventory-products', {
      method: 'POST',
      body: {
        name: `Broa Goiabada (G) [TESTE_E2E] ${suffix}`,
        category: 'Sabores',
        unit: 'unidade',
        price: 50,
        active: true
      }
    });
    created.goiabadaProductId = goiabadaProduct.id;

    const companionProduct = await request(apiUrl, '/inventory-products', {
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
          balance: 900,
          unit: 'g',
          purchasePackSize: 500,
          purchasePackCost: 25
        }
      }
    });
    created.companionProductId = companionProduct.id;
    created.inventoryItemId = companionProduct.inventoryItemId;

    const scheduledAt = new Date(Date.UTC(2030, 2, 15, 14, 30, 0)).toISOString();
    const preview = await request(apiUrl, '/orders/intake/customer-form/preview', {
      method: 'POST',
      headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
      body: {
        version: 1,
        customer: {
          name: `Cliente Mix Cupom ${suffix}`,
          phone: '31999999997'
        },
        fulfillment: {
          mode: 'PICKUP',
          scheduledAt
        },
        items: [
          { productId: traditionalProduct.id, quantity: 4 },
          { productId: goiabadaProduct.id, quantity: 3 },
          { productId: companionProduct.id, quantity: 1 }
        ],
        couponCode: coupon.code,
        source: {
          externalId: `customer-form-coupon-amigas-preview-${suffix}`
        }
      }
    });

    assert.equal(preview.order.subtotal, 73);
    assert.equal(preview.order.discount, 4.5);
    assert.equal(preview.order.total, 68.5);

    const intake = await request(apiUrl, '/orders/intake/customer-form', {
      method: 'POST',
      headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
      body: {
        version: 1,
        customer: {
          name: `Cliente Mix Cupom ${suffix}`,
          phone: '31999999997'
        },
        fulfillment: {
          mode: 'PICKUP',
          scheduledAt
        },
        items: [
          { productId: traditionalProduct.id, quantity: 4 },
          { productId: goiabadaProduct.id, quantity: 3 },
          { productId: companionProduct.id, quantity: 1 }
        ],
        couponCode: coupon.code,
        source: {
          externalId: `customer-form-coupon-amigas-intake-${suffix}`,
          idempotencyKey: `customer-form-coupon-amigas-intake-${suffix}`
        }
      }
    });

    created.orderId = intake.order.id;
    created.customerId = intake.intake.customerId;

    assert.equal(intake.order.subtotal, 73);
    assert.equal(intake.order.discount, 4.5);
    assert.equal(intake.order.total, 68.5);
  }
);

test(
  'editar itens preserva cupom so na parte Broa ao adicionar Amigas da Broa',
  { timeout: 180000 },
  async (t) => {
    const formToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
    const { apiUrl, shutdown } = await ensureApiServer();
    const created = {
      couponId: null,
      traditionalProductId: null,
      companionProductId: null,
      inventoryItemId: null,
      orderId: null,
      customerId: null
    };

    t.after(async () => {
      const cleanupSteps = [
        created.orderId ? () => request(apiUrl, `/orders/${created.orderId}`, { method: 'DELETE' }) : null,
        created.traditionalProductId
          ? () => request(apiUrl, `/inventory-products/${created.traditionalProductId}`, { method: 'DELETE' })
          : null,
        created.companionProductId
          ? () => request(apiUrl, `/inventory-products/${created.companionProductId}`, { method: 'DELETE' })
          : null,
        created.customerId ? () => request(apiUrl, `/customers/${created.customerId}`, { method: 'DELETE' }) : null,
        created.inventoryItemId
          ? () => request(apiUrl, `/inventory-items/${created.inventoryItemId}`, { method: 'DELETE' })
          : null,
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
    const coupon = await request(apiUrl, '/dashboard/coupons', {
      method: 'POST',
      headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
      body: {
        code: `EDITA-AMIGAS-${suffix}`,
        discountPct: 10,
        active: true
      }
    });
    created.couponId = coupon.id;

    const traditionalProduct = await request(apiUrl, '/inventory-products', {
      method: 'POST',
      body: {
        name: `Broa Tradicional Edicao ${suffix}`,
        category: 'Sabores',
        unit: 'unidade',
        price: 40,
        active: true
      }
    });
    created.traditionalProductId = traditionalProduct.id;

    const companionProduct = await request(apiUrl, '/inventory-products', {
      method: 'POST',
      body: {
        name: `Companion Edicao ${suffix}`,
        category: 'Amigas da Broa',
        unit: 'unidade',
        price: 28,
        active: true,
        inventoryQtyPerSaleUnit: 90,
        companionInventory: {
          balance: 900,
          unit: 'g',
          purchasePackSize: 500,
          purchasePackCost: 25
        }
      }
    });
    created.companionProductId = companionProduct.id;
    created.inventoryItemId = companionProduct.inventoryItemId;

    const scheduledAt = new Date(Date.UTC(2030, 2, 19, 15, 0, 0)).toISOString();
    const intake = await request(apiUrl, '/orders/intake/customer-form', {
      method: 'POST',
      headers: formToken ? { Authorization: `Bearer ${formToken}` } : undefined,
      body: {
        version: 1,
        customer: {
          name: `Cliente Edita Amigas ${suffix}`,
          phone: '31999999996'
        },
        fulfillment: {
          mode: 'PICKUP',
          scheduledAt
        },
        items: [{ productId: traditionalProduct.id, quantity: 7 }],
        couponCode: coupon.code,
        source: {
          externalId: `customer-form-coupon-edit-amigas-${suffix}`,
          idempotencyKey: `customer-form-coupon-edit-amigas-${suffix}`
        }
      }
    });

    created.orderId = intake.order.id;
    created.customerId = intake.intake.customerId;

    assert.equal(intake.order.subtotal, 40);
    assert.equal(intake.order.discount, 4);
    assert.equal(intake.order.total, 36);

    const updated = await request(apiUrl, `/orders/${intake.order.id}/items`, {
      method: 'PUT',
      body: {
        items: [
          { productId: traditionalProduct.id, quantity: 7 },
          { productId: companionProduct.id, quantity: 1 }
        ]
      }
    });

    assert.equal(updated.subtotal, 68);
    assert.equal(updated.discount, 4);
    assert.equal(updated.total, 64);
    assert.equal(updated.couponCode, coupon.code);
    assert.match(String(updated.notes || ''), new RegExp(`Cupom aplicado: ${coupon.code} \\(10%\\)`));
  }
);
