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

  assert.equal(created.imageUrl, '/querobroa-brand/cardapio/romeu-e-julieta.jpg?v=20260414-rj2');

  const refreshed = await request(apiUrl, `/inventory-products/${productId}`);
  assert.equal(refreshed.imageUrl, '/querobroa-brand/cardapio/romeu-e-julieta.jpg?v=20260414-rj2');

  const products = await request(apiUrl, '/inventory-products');
  const sameProduct = products.find((entry) => entry.id === productId);
  assert.ok(sameProduct);
  assert.equal(sameProduct.imageUrl, '/querobroa-brand/cardapio/romeu-e-julieta.jpg?v=20260414-rj2');
});

test('amigas da broa fall back to canonical static art when image url is missing', async (t) => {
  const { apiUrl, shutdown } = await ensureApiServer();
  let productId = null;
  let inventoryItemId = null;

  t.after(async () => {
    if (productId) {
      try {
        await request(apiUrl, `/inventory-products/${productId}`, { method: 'DELETE' });
      } catch {}
    }
    if (inventoryItemId) {
      try {
        await request(apiUrl, `/inventory-items/${inventoryItemId}`, { method: 'DELETE' });
      } catch {}
    }
    await shutdown();
  });

  const suffix = uniqueSuffix();
  const created = await request(apiUrl, '/inventory-products', {
    method: 'POST',
    body: {
      name: `Café torrado e moído • Torra média - Catucaí Amarelo 24/137 • Fazenda Dona Luiza - Cambuquira/MG ${suffix}`,
      category: 'Amigas da Broa',
      unit: 'unidade',
      price: 59,
      active: true,
      inventoryQtyPerSaleUnit: 1,
      companionInventory: {
        balance: 20,
        unit: 'un',
        purchasePackSize: 10,
        purchasePackCost: 50
      }
    }
  });
  productId = created.id;
  inventoryItemId = created.inventoryItemId;

  assert.equal(
    created.imageUrl,
    '/querobroa-brand/amigas-da-broa/cafe-torrado-e-moido-dona-luiza.webp?v=20260424-amigas1'
  );

  const refreshed = await request(apiUrl, `/inventory-products/${productId}`);
  assert.equal(
    refreshed.imageUrl,
    '/querobroa-brand/amigas-da-broa/cafe-torrado-e-moido-dona-luiza.webp?v=20260424-amigas1'
  );

  const products = await request(apiUrl, '/inventory-products');
  const sameProduct = products.find((entry) => entry.id === productId);
  assert.ok(sameProduct);
  assert.equal(
    sameProduct.imageUrl,
    '/querobroa-brand/amigas-da-broa/cafe-torrado-e-moido-dona-luiza.webp?v=20260424-amigas1'
  );
});
