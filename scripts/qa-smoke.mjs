const API_URL = process.env.API_URL || 'http://127.0.0.1:3001';

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
  await api('/products');
  await api('/orders');
  await api('/inventory-items');
  await api('/inventory-movements');
  await api('/boms');

  const tempCustomer = await api('/customers', {
    method: 'POST',
    body: JSON.stringify({ name: `QA Temp ${Date.now()}`, phone: '11999999999', address: 'Rua QA, 1' })
  });

  const tempProduct = await api('/products', {
    method: 'POST',
    body: JSON.stringify({ name: `QA Produto ${Date.now()}`, category: 'QA', unit: 'un', price: 1.5, active: true })
  });

  const tempOrder = await api('/orders', {
    method: 'POST',
    body: JSON.stringify({
      customerId: tempCustomer.id,
      items: [{ productId: tempProduct.id, quantity: 1 }]
    })
  });

  await api(`/orders/${tempOrder.id}`, { method: 'DELETE' });
  await api(`/products/${tempProduct.id}`, { method: 'DELETE' });
  await api(`/customers/${tempCustomer.id}`, { method: 'DELETE' });

  console.log('QA Smoke OK');
}

main().catch((err) => {
  console.error('QA Smoke FAILED');
  console.error(err);
  process.exit(1);
});
