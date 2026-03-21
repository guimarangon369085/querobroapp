import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureApiServer, request } from './lib/api-server.mjs';

const TEST_REASON = '[TESTE_E2E] inventory-product-default-bom-template';

test(
  'novo ingrediente fica disponivel no estoque e produto novo nasce com ficha clonada da Tradicional',
  { timeout: 180000 },
  async (t) => {
    const { apiUrl, shutdown } = await ensureApiServer();
    const created = {
      ingredientId: null,
      traditionalProductId: null,
      traditionalBomId: null,
      newProductId: null,
      newProductBomId: null
    };

    t.after(async () => {
      const cleanupSteps = [
        created.newProductBomId ? () => request(apiUrl, `/boms/${created.newProductBomId}`, { method: 'DELETE' }) : null,
        created.traditionalBomId ? () => request(apiUrl, `/boms/${created.traditionalBomId}`, { method: 'DELETE' }) : null,
        created.newProductId
          ? () => request(apiUrl, `/inventory-products/${created.newProductId}`, { method: 'DELETE' })
          : null,
        created.traditionalProductId
          ? () => request(apiUrl, `/inventory-products/${created.traditionalProductId}`, { method: 'DELETE' })
          : null,
        created.ingredientId
          ? () => request(apiUrl, `/inventory-items/${created.ingredientId}`, { method: 'DELETE' })
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

    const ingredient = await request(apiUrl, '/inventory-items', {
      method: 'POST',
      body: {
        name: `FARINHA DE MILHO AZUL [TESTE_E2E] ${suffix}`,
        category: 'INGREDIENTE',
        unit: 'g',
        purchasePackSize: 1000,
        purchasePackCost: 29.9
      }
    });
    created.ingredientId = ingredient.id;

    const overview = await request(apiUrl, '/inventory-overview');
    const overviewIngredient = overview.items.find((item) => item.id === ingredient.id);
    assert.ok(overviewIngredient, 'Ingrediente novo deveria aparecer no overview do estoque');
    assert.equal(overviewIngredient.name, ingredient.name);

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

    const existingTraditionalBom = (await request(apiUrl, '/boms')).find(
      (entry) => entry.productId === traditionalProduct.id
    );
    assert.ok(existingTraditionalBom, 'Produto tradicional deveria nascer com uma BOM');

    const traditionalBom = await request(apiUrl, `/boms/${existingTraditionalBom.id}`, {
      method: 'PUT',
      body: {
        productId: traditionalProduct.id,
        name: traditionalProduct.name,
        saleUnitLabel: 'Caixa com 7 broas',
        yieldUnits: 21,
        items: [
          {
            itemId: ingredient.id,
            qtyPerRecipe: 210,
            qtyPerSaleUnit: 70,
            qtyPerUnit: 10
          }
        ]
      }
    });
    created.traditionalBomId = traditionalBom.id;

    const newProduct = await request(apiUrl, '/inventory-products', {
      method: 'POST',
      body: {
        name: `Broa Especial [TESTE_E2E] ${suffix}`,
        category: 'Sabores',
        unit: 'unidade',
        price: 55,
        active: true
      }
    });
    created.newProductId = newProduct.id;

    const newProductBom = (await request(apiUrl, '/boms')).find((entry) => entry.productId === newProduct.id);
    assert.ok(newProductBom, 'Produto novo deveria nascer com BOM clonada da Tradicional');
    created.newProductBomId = newProductBom.id;

    assert.equal(newProductBom.name, newProduct.name);
    assert.equal(newProductBom.saleUnitLabel, 'Caixa com 7 broas');
    assert.equal(newProductBom.yieldUnits, 21);

    const clonedIngredient = (newProductBom.items || []).find((item) => item.itemId === ingredient.id);
    assert.ok(
      clonedIngredient,
      'Ingrediente novo presente na ficha da Tradicional deveria ser copiado para o produto novo'
    );
    assert.equal(clonedIngredient.qtyPerRecipe, 210);
    assert.equal(clonedIngredient.qtyPerSaleUnit, 70);
    assert.equal(clonedIngredient.qtyPerUnit, 10);
    assert.ok(
      newProductBom.items.some((item) => item.item?.name === ingredient.name),
      'BOM clonada deveria expor o nome do ingrediente novo'
    );
  }
);
