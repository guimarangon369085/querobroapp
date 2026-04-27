import type { Prisma } from '@prisma/client';
import { normalizeInventoryLookup } from './inventory-formulas.js';

const COMPANION_CATALOG_CATEGORY_KEYS = new Set([
  normalizeInventoryLookup('Amigos da Broa'),
  normalizeInventoryLookup('Amigas da Broa')
]);

function isCompanionCatalogCategory(category?: string | null) {
  return COMPANION_CATALOG_CATEGORY_KEYS.has(normalizeInventoryLookup(category ?? ''));
}

type AvailabilityClient = Prisma.TransactionClient | { product: Prisma.TransactionClient['product'] };

export async function syncCompanionProductActiveStateByItemIds(
  client: AvailabilityClient,
  itemIds: readonly number[]
) {
  const uniqueItemIds = Array.from(new Set(itemIds.filter((itemId) => Number.isInteger(itemId) && itemId > 0)));
  if (uniqueItemIds.length === 0) {
    return {
      activatedIds: [] as number[],
      deactivatedIds: [] as number[]
    };
  }

  const products = (await client.product.findMany({
    where: {
      inventoryItemId: { in: uniqueItemIds }
    },
    select: {
      id: true,
      category: true,
      inventoryItemId: true
    }
  })).filter((product) => isCompanionCatalogCategory(product.category));

  if (products.length === 0) {
    return {
      activatedIds: [] as number[],
      deactivatedIds: [] as number[]
    };
  }

  return {
    activatedIds: [] as number[],
    deactivatedIds: [] as number[]
  };
}

export async function syncCompanionProductActiveStateByProductIds(
  client: AvailabilityClient,
  productIds: readonly number[]
) {
  const uniqueProductIds = Array.from(
    new Set(productIds.filter((productId) => Number.isInteger(productId) && productId > 0))
  );
  if (uniqueProductIds.length === 0) {
    return {
      activatedIds: [] as number[],
      deactivatedIds: [] as number[]
    };
  }

  const itemIds = (
    await client.product.findMany({
      where: {
        id: { in: uniqueProductIds }
      },
      select: {
        inventoryItemId: true,
        category: true
      }
    })
  )
    .filter((product) => isCompanionCatalogCategory(product.category))
    .map((product) => product.inventoryItemId)
    .filter((itemId): itemId is number => typeof itemId === 'number' && itemId > 0);

  return syncCompanionProductActiveStateByItemIds(client, itemIds);
}
