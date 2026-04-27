import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

function approxEqual(left, right, epsilon = 0.0001) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= epsilon;
}

test('internal dashboard intake converte desconto percentual em investimento de marketing/amostras', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const summaryBefore = await request(apiUrl, '/dashboard/summary?days=30');

  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Broa Marketing ${suffix}`,
      category: 'Teste',
      unit: 'cx',
      price: 40,
      active: true
    }
  });

  const intake = await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      version: 1,
      intent: 'CONFIRMED',
      customer: {
        name: `Cliente Marketing ${suffix}`,
        phone: '11999990000',
        address: 'Rua das Amostras, 50'
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt: new Date(Date.UTC(2034, 0, 10, 15, 0, 0)).toISOString()
      },
      order: {
        items: [{ productId: product.id, quantity: 2 }],
        discountPct: 50,
        notes: 'Amostra de degustacao'
      },
      payment: {
        method: 'pix',
        status: 'PENDENTE'
      },
      source: {
        channel: 'INTERNAL_DASHBOARD',
        originLabel: 'test.discount-pct.marketing'
      }
    }
  });

  assert.equal(approxEqual(intake.order.discount, Number(intake.order.subtotal || 0) * 0.5), true);
  assert.equal(
    approxEqual(intake.order.total, Math.max(Number(intake.order.subtotal || 0) - Number(intake.order.discount || 0), 0)),
    true
  );
  assert.equal(approxEqual(intake.order.balanceDue, intake.order.total), true);
  assert.equal(intake.order.paymentStatus, 'PENDENTE');

  const updated = await request(apiUrl, `/orders/${intake.order.id}`, {
    method: 'PUT',
    body: {
      notes: 'Obs revista'
    }
  });

  assert.match(String(updated.notes || ''), /Obs revista/);
  assert.match(String(updated.notes || ''), /Investimento de marketing: AMOSTRAS \(50%\)/);

  const summaryAfter = await request(apiUrl, '/dashboard/summary?days=30');
  assert.equal(
    approxEqual(
      summaryAfter.business.kpis.marketingSamplesInvestmentInRange -
        summaryBefore.business.kpis.marketingSamplesInvestmentInRange,
      intake.order.discount
    ),
    true
  );
  assert.equal(
    approxEqual(
      summaryAfter.business.kpis.outstandingBalance - summaryBefore.business.kpis.outstandingBalance,
      intake.order.total
    ),
    true
  );
});

test('desconto de 100% zera o pedido e nao deixa cobranca pix pendente', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Broa Amostra Total ${suffix}`,
      category: 'Teste',
      unit: 'cx',
      price: 40,
      active: true
    }
  });

  const intake = await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      version: 1,
      intent: 'CONFIRMED',
      customer: {
        name: `Cliente Amostra Total ${suffix}`,
        phone: '11999990001',
        address: 'Rua das Amostras, 100'
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt: new Date(Date.UTC(2034, 0, 11, 15, 0, 0)).toISOString()
      },
      order: {
        items: [{ productId: product.id, quantity: 1 }],
        discountPct: 100,
        notes: 'Amostra integral'
      },
      payment: {
        method: 'pix',
        status: 'PENDENTE'
      },
      source: {
        channel: 'INTERNAL_DASHBOARD',
        originLabel: 'test.discount-pct.full'
      }
    }
  });

  assert.equal(approxEqual(intake.order.discount, intake.order.subtotal), true);
  assert.equal(approxEqual(intake.order.total, 0), true);
  assert.equal(approxEqual(intake.order.balanceDue, 0), true);
  assert.equal(intake.order.paymentStatus, 'PAGO');
  assert.equal(intake.intake.pixStatus, 'PAGO');
  assert.equal(intake.intake.pixCharge, null);
});

test('desconto de 100% em entrega zera o frete a receber e contabiliza frete como marketing', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const summaryBefore = await request(apiUrl, '/dashboard/summary?days=30');

  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Broa Amostra Entrega ${suffix}`,
      category: 'Teste',
      unit: 'cx',
      price: 40,
      active: true
    }
  });

  const scheduledAt = new Date(Date.UTC(2034, 0, 11, 15, 0, 0)).toISOString();
  const draftQuote = await request(apiUrl, '/deliveries/quotes/internal', {
    method: 'POST',
    body: {
      mode: 'DELIVERY',
      scheduledAt,
      customer: {
        name: `Cliente Amostra Entrega ${suffix}`,
        phone: '11999990009',
        address: 'Rua das Amostras, 120'
      },
      manifest: {
        items: [{ name: product.name, quantity: 1 }],
        subtotal: 40,
        totalUnits: 1
      }
    }
  });

  const intake = await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      version: 1,
      intent: 'CONFIRMED',
      customer: {
        name: `Cliente Amostra Entrega ${suffix}`,
        phone: '11999990009',
        address: 'Rua das Amostras, 120'
      },
      fulfillment: {
        mode: 'DELIVERY',
        scheduledAt
      },
      order: {
        items: [{ productId: product.id, quantity: 1 }],
        discountPct: 100,
        notes: 'Amostra integral com entrega'
      },
      payment: {
        method: 'pix',
        status: 'PENDENTE'
      },
      source: {
        channel: 'INTERNAL_DASHBOARD',
        originLabel: 'test.discount-pct.full-delivery'
      }
    }
  });

  assert.equal(approxEqual(intake.order.discount, intake.order.subtotal), true);
  assert.equal(approxEqual(intake.order.deliveryFee, 0), true);
  assert.equal(approxEqual(intake.order.total, 0), true);
  assert.equal(approxEqual(intake.order.balanceDue, 0), true);
  assert.equal(intake.order.paymentStatus, 'PAGO');
  assert.equal(intake.intake.pixStatus, 'PAGO');
  assert.equal(intake.intake.pixCharge, null);
  assert.match(String(intake.order.notes || ''), /Investimento de marketing: AMOSTRAS \(100%, frete R\$/);

  const summaryAfter = await request(apiUrl, '/dashboard/summary?days=30');
  assert.equal(
    approxEqual(
      summaryAfter.business.kpis.marketingSamplesInvestmentInRange -
        summaryBefore.business.kpis.marketingSamplesInvestmentInRange,
      Number(intake.order.discount || 0) + Number(draftQuote.fee || 0)
    ),
    true
  );
  assert.equal(
    approxEqual(
      summaryAfter.business.kpis.outstandingBalance - summaryBefore.business.kpis.outstandingBalance,
      0
    ),
    true
  );
});

test('editar pedido interno permite incluir e remover desconto percentual de amostras', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  t.after(async () => {
    await shutdown();
  });

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const product = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Broa Edicao Desconto ${suffix}`,
      category: 'Teste',
      unit: 'cx',
      price: 40,
      active: true
    }
  });

  const intake = await request(apiUrl, '/orders/intake', {
    method: 'POST',
    body: {
      version: 1,
      intent: 'CONFIRMED',
      customer: {
        name: `Cliente Edicao ${suffix}`,
        phone: '11999990002',
        address: 'Rua da Edicao, 200'
      },
      fulfillment: {
        mode: 'PICKUP',
        scheduledAt: new Date(Date.UTC(2034, 0, 12, 15, 0, 0)).toISOString()
      },
      order: {
        items: [{ productId: product.id, quantity: 2 }],
        notes: 'Pedido interno sem desconto'
      },
      payment: {
        method: 'pix',
        status: 'PENDENTE'
      },
      source: {
        channel: 'INTERNAL_DASHBOARD',
        originLabel: 'test.discount-pct.edit'
      }
    }
  });

  assert.equal(approxEqual(intake.order.discount, 0), true);
  assert.doesNotMatch(String(intake.order.notes || ''), /Investimento de marketing: AMOSTRAS/);

  const discounted = await request(apiUrl, `/orders/${intake.order.id}`, {
    method: 'PUT',
    body: {
      discountPct: 25,
      notes: 'Pedido interno com desconto'
    }
  });

  assert.equal(
    approxEqual(discounted.discount, Math.round(Number(discounted.subtotal || 0) * 25) / 100),
    true
  );
  assert.match(String(discounted.notes || ''), /Pedido interno com desconto/);
  assert.match(String(discounted.notes || ''), /Investimento de marketing: AMOSTRAS \(25%\)/);

  const restored = await request(apiUrl, `/orders/${intake.order.id}`, {
    method: 'PUT',
    body: {
      discountPct: 0,
      notes: 'Pedido interno sem desconto novamente'
    }
  });

  assert.equal(approxEqual(restored.discount, 0), true);
  assert.match(String(restored.notes || ''), /Pedido interno sem desconto novamente/);
  assert.doesNotMatch(String(restored.notes || ''), /Investimento de marketing: AMOSTRAS/);
});
