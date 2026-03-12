const API_URL = process.env.API_URL || 'http://127.0.0.1:3001';
const FORM_TOKEN = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();

async function api(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`${options.method || 'GET'} ${path} -> ${res.status} ${message}`);
  }
  return data;
}

async function main() {
  console.log(`QA Smoke against ${API_URL}`);

  await api('/health');
  await api('/customers');
  await api('/inventory-products');
  await api('/orders');
  await api('/inventory-items');
  await api('/inventory-movements');
  await api('/boms');

  const tempOrderResult = await api('/orders/intake/google-form', {
    method: 'POST',
    ...(FORM_TOKEN ? { headers: { Authorization: `Bearer ${FORM_TOKEN}` } } : {}),
    body: JSON.stringify({
      customer: {
        name: `QA Forms ${Date.now()}`,
        phone: '11999999999',
        address: 'Rua QA, 1'
      },
      fulfillment: {
        mode: 'DELIVERY',
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      },
      flavors: {
        T: 4,
        G: 3,
        D: 0,
        Q: 0,
        R: 0
      },
      notes: 'QA smoke google form',
      source: {
        externalId: `qa-smoke-google-form-${Date.now()}`
      }
    })
  });
  const tempOrder = tempOrderResult.order;
  const tempCustomerId = tempOrderResult.intake.customerId;
  await api(`/orders/${tempOrder.id}/pix-charge`);

  await api(`/orders/${tempOrder.id}`, { method: 'DELETE' });
  await api(`/customers/${tempCustomerId}`, { method: 'DELETE' });

  console.log('QA Smoke OK');
}

main().catch((err) => {
  console.error('QA Smoke FAILED');
  console.error(err);
  process.exit(1);
});
