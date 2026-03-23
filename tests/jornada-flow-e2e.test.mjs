import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request, requestExpectError } from './lib/api-server.mjs';

test(
  'jornada completa: catalogo -> cliente -> pedido -> entrega -> pagamento',
  { timeout: 180000 },
  async (t) => {
    const { apiUrl, shutdown } = await ensureApiServer();
    const created = {
      paymentId: null,
      orderId: null,
      customerId: null,
      bomId: null,
      productId: null
    };

    t.after(async () => {
      const cleanupSteps = [
        created.paymentId
          ? () => request(apiUrl, `/payments/${created.paymentId}`, { method: 'DELETE' })
          : null,
        created.orderId ? () => request(apiUrl, `/orders/${created.orderId}`, { method: 'DELETE' }) : null,
        created.customerId
          ? () => request(apiUrl, `/customers/${created.customerId}`, { method: 'DELETE' })
          : null,
        created.bomId ? () => request(apiUrl, `/boms/${created.bomId}`, { method: 'DELETE' }) : null,
        created.productId
          ? () => request(apiUrl, `/inventory-products/${created.productId}`, { method: 'DELETE' })
          : null
      ].filter(Boolean);

      for (const cleanup of cleanupSteps) {
        try {
          await cleanup();
        } catch {
          // melhor esforco; o teste principal ja falha no ponto certo
        }
      }

      await shutdown();
    });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const product = await request(apiUrl, '/inventory-products', {
      method: 'POST',
      body: {
        name: `Broa E2E [TESTE_E2E] ${suffix}`,
        category: 'Broas',
        unit: 'un',
        price: 12.5,
        active: true
      }
    });
    created.productId = product.id;
    assert.ok(product.id > 0);

    const bom = await request(apiUrl, '/boms', {
      method: 'POST',
      body: {
        productId: product.id,
        name: `Receita E2E [TESTE_E2E] ${suffix}`,
        saleUnitLabel: 'Caixa com 7 broas',
        yieldUnits: 7,
        items: []
      }
    });
    created.bomId = bom.id;
    assert.ok(bom.id > 0);

    const customer = await request(apiUrl, '/customers', {
      method: 'POST',
      body: {
        name: `Cliente E2E [TESTE_E2E] ${suffix}`,
        phone: '11999999999',
        address: 'Rua Teste, 1'
      }
    });
    created.customerId = customer.id;
    assert.ok(customer.id > 0);

    const scheduledAt = new Date(Date.UTC(2030, 0, 15, 14, 30, 0)).toISOString();

    const createdOrder = await request(apiUrl, '/orders', {
      method: 'POST',
      body: {
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 1 }],
        discount: 0,
        scheduledAt
      }
    });
    created.orderId = createdOrder.id;

    assert.equal(createdOrder.status, 'ABERTO');
    assert.equal(createdOrder.paymentStatus, 'PENDENTE');
    assert.ok(createdOrder.total > 0);
    assert.equal(createdOrder.scheduledAt, scheduledAt);

    const notedOrder = await request(apiUrl, `/orders/${createdOrder.id}`, {
      method: 'PUT',
      body: {
        notes: 'Observacao E2E'
      }
    });
    assert.equal(notedOrder.notes, 'Observacao E2E');

    const clearedNotesOrder = await request(apiUrl, `/orders/${createdOrder.id}`, {
      method: 'PUT',
      body: {
        notes: null
      }
    });
    assert.equal(clearedNotesOrder.notes, null);

    await requestExpectError(apiUrl, `/deliveries/orders/${createdOrder.id}/start`, 400, {
      method: 'POST'
    });

    const rescheduledAt = new Date(Date.UTC(2030, 0, 16, 9, 45, 0)).toISOString();
    const updatedOrder = await request(apiUrl, `/orders/${createdOrder.id}`, {
      method: 'PUT',
      body: {
        scheduledAt: rescheduledAt
      }
    });
    assert.equal(updatedOrder.scheduledAt, rescheduledAt);

    const transitions = ['CONFIRMADO', 'EM_PREPARACAO', 'PRONTO', 'ENTREGUE'];
    let lastOrder = updatedOrder;

    for (const status of transitions) {
      lastOrder = await request(apiUrl, `/orders/${createdOrder.id}/status`, {
        method: 'PATCH',
        body: { status }
      });
      assert.equal(lastOrder.status, status);
    }

    const payment = await request(apiUrl, '/payments', {
      method: 'POST',
      body: {
        orderId: createdOrder.id,
        amount: lastOrder.total,
        method: 'pix',
        status: 'PAGO'
      }
    });
    created.paymentId = payment.id;
    assert.ok(payment.id > 0);

    const finalOrder = await request(apiUrl, `/orders/${createdOrder.id}`);
    assert.equal(finalOrder.status, 'ENTREGUE');
    assert.equal(finalOrder.paymentStatus, 'PAGO');
    assert.equal(Number(finalOrder.balanceDue), 0);
    assert.ok(Array.isArray(finalOrder.payments));
    assert.ok(finalOrder.payments.some((entry) => entry.id === payment.id));
  }
);
