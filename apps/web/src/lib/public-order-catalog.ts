import type { Product } from '@querobroapp/shared';
import { getApiBaseUrl } from '@/lib/api-base-url';

function normalizeBaseUrl(value?: string | null) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeCatalogProductImageUrl(product: Product, resolvedBaseUrl: string) {
  const imageUrl = String(product.imageUrl || '').trim();
  if (!imageUrl) return product;
  if (/^https?:\/\//i.test(imageUrl)) return product;
  if (!imageUrl.startsWith('/uploads/')) return product;

  return {
    ...product,
    imageUrl: `${resolvedBaseUrl}${imageUrl}`
  } satisfies Product;
}

export function buildPublicOrderCatalogHeaders() {
  const headers = new Headers({
    accept: 'application/json'
  });

  const appToken = String(process.env.APP_API_BRIDGE_TOKEN || process.env.APP_AUTH_TOKEN || '').trim();
  if (appToken) {
    headers.set('x-app-token', appToken);
  }

  const bridgeToken = String(process.env.ORDER_FORM_BRIDGE_TOKEN || '').trim();
  if (bridgeToken) {
    headers.set('authorization', `Bearer ${bridgeToken}`);
  }

  return headers;
}

export async function fetchPublicOrderCatalog(baseUrl?: string | null) {
  const resolvedBaseUrl = normalizeBaseUrl(baseUrl) || normalizeBaseUrl(process.env.ORDER_FORM_API_URL) || getApiBaseUrl();
  const response = await fetch(`${resolvedBaseUrl}/inventory-products`, {
    method: 'GET',
    cache: 'no-store',
    headers: buildPublicOrderCatalogHeaders()
  });

  const raw = await response.text();
  let payload: unknown = null;

  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = raw ? { message: raw } : null;
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : `Falha ao carregar o catálogo público (${response.status}).`;
    throw new Error(message);
  }

  return Array.isArray(payload)
    ? (payload as Product[]).map((product) => normalizeCatalogProductImageUrl(product, resolvedBaseUrl))
    : [];
}
