#!/usr/bin/env node

const API_BASE_DEFAULT = 'http://127.0.0.1:3001';
const DEFAULT_TAGS = ['[TESTE_E2E]'];

function normalizeBaseUrl(value) {
  return (value || API_BASE_DEFAULT).trim().replace(/\/+$/, '');
}

function resolveTags(value) {
  const tags = (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return tags.length > 0 ? tags : DEFAULT_TAGS;
}

function hasAnyTag(value, tags) {
  const normalized = String(value || '').toLowerCase();
  return tags.some((tag) => normalized.includes(tag.toLowerCase()));
}

async function apiRequest(baseUrl, path, options = {}) {
  const token = (process.env.QB_APP_TOKEN || process.env.APP_AUTH_TOKEN || '').trim();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'x-app-token': token } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${options.method || 'GET'} ${path} -> HTTP ${response.status} ${response.statusText} ${body}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function main() {
  const baseUrl = normalizeBaseUrl(process.env.QB_API_URL || process.env.NEXT_PUBLIC_API_URL || '');
  const tags = resolveTags(process.env.QB_TEST_TAGS);

  const summary = {
    removedOrders: 0,
    removedCustomers: 0,
    skippedCustomersWithOrders: 0,
    errors: []
  };

  console.log(`[cleanup-test-data] API: ${baseUrl}`);
  console.log(`[cleanup-test-data] Tags: ${tags.join(', ')}`);

  const [orders, customers] = await Promise.all([
    apiRequest(baseUrl, '/orders'),
    apiRequest(baseUrl, '/customers')
  ]);

  const taggedCustomerIds = new Set(
    customers
      .filter((customer) => hasAnyTag(customer.name, tags) || hasAnyTag(customer.deliveryNotes, tags))
      .map((customer) => customer.id)
      .filter((id) => Number.isFinite(id))
  );

  const orderIdsToDelete = orders
    .filter((order) => hasAnyTag(order.notes, tags) || taggedCustomerIds.has(order.customerId))
    .map((order) => order.id)
    .filter((id) => Number.isFinite(id))
    .sort((a, b) => b - a);

  for (const orderId of orderIdsToDelete) {
    try {
      await apiRequest(baseUrl, `/orders/${orderId}`, { method: 'DELETE' });
      summary.removedOrders += 1;
    } catch (error) {
      summary.errors.push(`pedido #${orderId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const [remainingOrders, refreshedCustomers] = await Promise.all([
    apiRequest(baseUrl, '/orders'),
    apiRequest(baseUrl, '/customers')
  ]);
  const customersWithOrders = new Set(remainingOrders.map((order) => order.customerId));

  const customerIdsToDelete = refreshedCustomers
    .filter((customer) => {
      if (!Number.isFinite(customer.id)) return false;
      if (!hasAnyTag(customer.name, tags) && !hasAnyTag(customer.deliveryNotes, tags)) return false;
      if (customersWithOrders.has(customer.id)) {
        summary.skippedCustomersWithOrders += 1;
        return false;
      }
      return true;
    })
    .map((customer) => customer.id)
    .sort((a, b) => b - a);

  for (const customerId of customerIdsToDelete) {
    try {
      await apiRequest(baseUrl, `/customers/${customerId}`, { method: 'DELETE' });
      summary.removedCustomers += 1;
    } catch (error) {
      summary.errors.push(`cliente #${customerId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(
    `[cleanup-test-data] Removidos: ${summary.removedOrders} pedido(s), ${summary.removedCustomers} cliente(s).`
  );
  if (summary.skippedCustomersWithOrders > 0) {
    console.log(
      `[cleanup-test-data] Clientes com pedidos ainda vinculados (nao removidos): ${summary.skippedCustomersWithOrders}.`
    );
  }

  if (summary.errors.length > 0) {
    console.error(`[cleanup-test-data] Erros: ${summary.errors.length}`);
    for (const message of summary.errors) {
      console.error(`- ${message}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[cleanup-test-data] Falha: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
