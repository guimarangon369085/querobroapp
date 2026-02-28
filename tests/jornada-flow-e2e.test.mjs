import assert from 'node:assert/strict';
import test from 'node:test';

const API_URL = process.env.QBAPP_E2E_API_URL || 'http://127.0.0.1:3001';

async function request(path, init = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {})
    },
    body: init.body ? JSON.stringify(init.body) : undefined
  });

  const raw = await response.text();
  const body = raw ? JSON.parse(raw) : null;

  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${path} -> ${response.status} ${response.statusText}\n${raw}`);
  }

  return body;
}

async function isApiOnline() {
  try {
    const response = await fetch(`${API_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

test(
  'jornada completa: catalogo -> cliente -> pedido -> entrega -> pagamento',
  { timeout: 120000 },
  async (t) => {
    const online = await isApiOnline();
    if (!online) {
      t.skip(`API offline em ${API_URL}`);
      return;
    }

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const product = await request('/products', {
      method: 'POST',
      body: {
        name: `Broa E2E ${suffix}`,
        category: 'Broas',
        unit: 'un',
        price: 12.5,
        active: true
      }
    });
    assert.ok(product.id > 0);

    const bom = await request('/boms', {
      method: 'POST',
      body: {
        productId: product.id,
        name: `Receita E2E ${suffix}`,
        saleUnitLabel: 'Caixa com 7 broas',
        yieldUnits: 7,
        items: []
      }
    });
    assert.ok(bom.id > 0);

    const customer = await request('/customers', {
      method: 'POST',
      body: {
        name: `Cliente E2E ${suffix}`,
        phone: '11999999999',
        address: 'Rua Teste, 1'
      }
    });
    assert.ok(customer.id > 0);

    const scheduledAt = new Date(Date.UTC(2030, 0, 15, 14, 30, 0)).toISOString();

    const createdOrder = await request('/orders', {
      method: 'POST',
      body: {
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 1 }],
        discount: 0,
        scheduledAt
      }
    });

    assert.equal(createdOrder.status, 'ABERTO');
    assert.equal(createdOrder.paymentStatus, 'PENDENTE');
    assert.ok(createdOrder.total > 0);
    assert.equal(createdOrder.scheduledAt, scheduledAt);

    const rescheduledAt = new Date(Date.UTC(2030, 0, 16, 9, 45, 0)).toISOString();
    const updatedOrder = await request(`/orders/${createdOrder.id}`, {
      method: 'PUT',
      body: {
        scheduledAt: rescheduledAt
      }
    });
    assert.equal(updatedOrder.scheduledAt, rescheduledAt);

    const transitions = ['CONFIRMADO', 'EM_PREPARACAO', 'PRONTO', 'ENTREGUE'];
    let lastOrder = updatedOrder;

    for (const status of transitions) {
      lastOrder = await request(`/orders/${createdOrder.id}/status`, {
        method: 'PATCH',
        body: { status }
      });
      assert.equal(lastOrder.status, status);
    }

    const payment = await request('/payments', {
      method: 'POST',
      body: {
        orderId: createdOrder.id,
        amount: lastOrder.total,
        method: 'pix',
        status: 'PAGO'
      }
    });
    assert.ok(payment.id > 0);

    const finalOrder = await request(`/orders/${createdOrder.id}`);
    assert.equal(finalOrder.status, 'ENTREGUE');
    assert.equal(finalOrder.paymentStatus, 'PAGO');
    assert.equal(Number(finalOrder.balanceDue), 0);
    assert.ok(Array.isArray(finalOrder.payments));
    assert.ok(finalOrder.payments.some((entry) => entry.id === payment.id));
  }
);
