import type { Prisma } from '@prisma/client';
import { ORDER_BOX_UNITS } from './inventory-formulas.js';

type ProductLimitCarrier = {
  id: number;
  salesLimitEnabled?: boolean | null;
  salesLimitBoxes?: number | null;
  salesLimitActivatedAt?: Date | null;
};

type ProductSalesLimitQueryClient =
  | Prisma.TransactionClient
  | {
      orderItem: {
        findMany: (args: Prisma.OrderItemFindManyArgs) => Promise<
          Array<{
            productId: number;
            quantity: number;
            order: { createdAt: Date } | null;
          }>
        >;
      };
    };

export type ProductSalesLimitState = {
  productId: number;
  enabled: boolean;
  limitBoxes: number | null;
  activatedAt: Date | null;
  limitUnits: number;
  consumedUnits: number;
  consumedBoxes: number;
  remainingUnits: number;
  remainingBoxes: number;
  exhausted: boolean;
};

function roundSalesLimitValue(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export async function loadProductSalesLimitStates(
  client: ProductSalesLimitQueryClient,
  products: readonly ProductLimitCarrier[],
  options?: {
    excludeOrderId?: number | null;
  }
) {
  const limitedProducts = products.filter(
    (product) =>
      product.salesLimitEnabled === true &&
      typeof product.salesLimitBoxes === 'number' &&
      product.salesLimitBoxes > 0 &&
      product.salesLimitActivatedAt instanceof Date
  );

  const states = new Map<number, ProductSalesLimitState>();
  if (limitedProducts.length === 0) return states;

  const earliestActivationAt = limitedProducts.reduce<Date | null>((earliest, product) => {
    if (!(product.salesLimitActivatedAt instanceof Date)) return earliest;
    if (!earliest) return product.salesLimitActivatedAt;
    return product.salesLimitActivatedAt < earliest ? product.salesLimitActivatedAt : earliest;
  }, null);

  if (!earliestActivationAt) return states;

  const relevantMovements = await client.orderItem.findMany({
    where: {
      productId: { in: limitedProducts.map((product) => product.id) },
      ...(typeof options?.excludeOrderId === 'number'
        ? {
            orderId: {
              not: options.excludeOrderId
            }
          }
        : {}),
      order: {
        status: { not: 'CANCELADO' },
        createdAt: { gte: earliestActivationAt }
      }
    },
    select: {
      productId: true,
      quantity: true,
      order: {
        select: {
          createdAt: true
        }
      }
    }
  });

  const consumedUnitsByProductId = new Map<number, number>();

  for (const item of relevantMovements) {
    const product = limitedProducts.find((entry) => entry.id === item.productId);
    const activatedAt = product?.salesLimitActivatedAt;
    if (!product || !(activatedAt instanceof Date)) continue;
    if (!(item.order?.createdAt instanceof Date) || item.order.createdAt < activatedAt) continue;
    consumedUnitsByProductId.set(
      item.productId,
      (consumedUnitsByProductId.get(item.productId) || 0) + Math.max(Math.floor(item.quantity || 0), 0)
    );
  }

  for (const product of limitedProducts) {
    const limitBoxes = product.salesLimitBoxes ?? null;
    const limitUnits =
      typeof limitBoxes === 'number' && Number.isFinite(limitBoxes) && limitBoxes > 0
        ? limitBoxes * ORDER_BOX_UNITS
        : 0;
    const consumedUnits = Math.max(consumedUnitsByProductId.get(product.id) || 0, 0);
    const remainingUnits = Math.max(limitUnits - consumedUnits, 0);
    states.set(product.id, {
      productId: product.id,
      enabled: true,
      limitBoxes,
      activatedAt: product.salesLimitActivatedAt ?? null,
      limitUnits,
      consumedUnits,
      consumedBoxes: roundSalesLimitValue(consumedUnits / ORDER_BOX_UNITS),
      remainingUnits,
      remainingBoxes: roundSalesLimitValue(remainingUnits / ORDER_BOX_UNITS),
      exhausted: remainingUnits <= 0
    });
  }

  return states;
}
