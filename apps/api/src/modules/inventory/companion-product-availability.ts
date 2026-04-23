import type { Prisma } from '@prisma/client';
import { normalizeInventoryLookup } from './inventory-formulas.js';

const COMPANION_CATALOG_CATEGORY_KEYS = new Set([
  normalizeInventoryLookup('Amigos da Broa'),
  normalizeInventoryLookup('Amigas da Broa')
]);

function toQty(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function isCompanionCatalogCategory(category?: string | null) {
  return COMPANION_CATALOG_CATEGORY_KEYS.has(normalizeInventoryLookup(category ?? ''));
}

function buildBalanceByItemId(
  movements: Array<{
    itemId: number;
    type: string;
    quantity: number;
  }>
) {
  const balanceByItem = new Map<number, number>();

  for (const movement of movements) {
    const current = balanceByItem.get(movement.itemId) || 0;
    if (movement.type === 'IN') {
      balanceByItem.set(movement.itemId, toQty(current + movement.quantity));
    } else if (movement.type === 'OUT') {
      balanceByItem.set(movement.itemId, toQty(current - movement.quantity));
    } else if (movement.type === 'ADJUST') {
      balanceByItem.set(movement.itemId, toQty(movement.quantity));
    }
  }

  return balanceByItem;
}

type AvailabilityClient = Prisma.TransactionClient | { product: Prisma.TransactionClient['product']; inventoryMovement: Prisma.TransactionClient['inventoryMovement'] };

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
      active: true,
      inventoryItemId: true
    }
  })).filter((product) => isCompanionCatalogCategory(product.category));

  if (products.length === 0) {
    return {
      activatedIds: [] as number[],
      deactivatedIds: [] as number[]
    };
  }

  const trackedItemIds = Array.from(
    new Set(
      products
        .map((product) => product.inventoryItemId)
        .filter((itemId): itemId is number => typeof itemId === 'number' && itemId > 0)
    )
  );
  const movements = await client.inventoryMovement.findMany({
    where: {
      itemId: { in: trackedItemIds }
    },
    select: {
      itemId: true,
      type: true,
      quantity: true
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
  });
  const balanceByItemId = buildBalanceByItemId(movements);

  const activateIds: number[] = [];
  const deactivateIds: number[] = [];

  for (const product of products) {
    const itemId = product.inventoryItemId;
    if (!(typeof itemId === 'number' && itemId > 0)) continue;
    const balance = toQty(balanceByItemId.get(itemId) || 0);
    const shouldBeActive = balance > 0;
    if (shouldBeActive && product.active === false) {
      activateIds.push(product.id);
    } else if (!shouldBeActive && product.active !== false) {
      deactivateIds.push(product.id);
    }
  }

  if (activateIds.length > 0) {
    await client.product.updateMany({
      where: {
        id: { in: activateIds },
        active: false
      },
      data: { active: true }
    });
  }

  if (deactivateIds.length > 0) {
    await client.product.updateMany({
      where: {
        id: { in: deactivateIds },
        active: true
      },
      data: { active: false }
    });
  }

  return {
    activatedIds: activateIds,
    deactivatedIds: deactivateIds
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

