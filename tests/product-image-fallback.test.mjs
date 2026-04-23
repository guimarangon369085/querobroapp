import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

function uniqueSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

test('catalog products fall back to canonical static art when managed upload file is missing', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  let productId = null;

  t.after(async () => {
    if (productId) {
      try {
        await request(apiUrl, `/inventory-products/${productId}`, { method: 'DELETE' });
      } catch {}
    }
    await shutdown();
  });

  const suffix = uniqueSuffix();
  const created = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Broa Romeu e Julieta (RJ) ${suffix}`,
      category: 'Sabores',
      unit: 'unidade',
      price: 52,
      active: true,
      imageUrl: '/uploads/products/prd_1234567890abcdef.webp'
    }
  });
  productId = created.id;

  assert.equal(created.imageUrl, '/querobroa-brand/cardapio/romeu-e-julieta.jpg');

  const refreshed = await request(apiUrl, `/inventory-products/${productId}`);
  assert.equal(refreshed.imageUrl, '/querobroa-brand/cardapio/romeu-e-julieta.jpg');

  const products = await request(apiUrl, '/inventory-products');
  const sameProduct = products.find((entry) => entry.id === productId);
  assert.ok(sameProduct);
  assert.equal(sameProduct.imageUrl, '/querobroa-brand/cardapio/romeu-e-julieta.jpg');
});
