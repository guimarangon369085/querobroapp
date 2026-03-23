import { BadRequestException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type {
  ProductionRequirementBreakdown,
  ProductionRequirementRow,
  ProductionRequirementWarning,
  ProductionRequirementsResponse,
} from '@querobroapp/shared';
import { resolveDisplayNumber } from '@querobroapp/shared';
import { PrismaService } from '../../prisma.service.js';
import { DeliveriesService } from '../deliveries/deliveries.service.js';
import {
  buildOfficialBroaFlavorSummary,
  computeBroaPaperBagCount,
  computeBroaPackagingPlan,
  isMassPrepIngredientName,
  isOrderFillingIngredientName,
  isPackagingIngredientName,
  MASS_READY_ITEM_NAME,
  MASS_READY_BROAS_PER_RECIPE,
  massPrepRecipeIngredients,
  OVEN_CAPACITY_BROAS,
  orderFillingIngredientsByFlavorCode,
  resolveOfficialBroaFlavorCodeFromProductName,
  resolveInventoryFamilyKey,
  resolvePlannedMassPrepRecipes
} from '../inventory/inventory-formulas.js';

type OrderWithItems = Prisma.OrderGetPayload<{
  include: {
    customer: true;
    items: {
      include: {
        product: true;
      };
    };
  };
}>;

type BomWithItems = Prisma.BomGetPayload<{
  include: {
    product: true;
    items: {
      include: {
        item: true;
      };
    };
  };
}>;

type RequirementAccumulator = {
  ingredientId: number;
  name: string;
  unit: string;
  requiredQty: number;
  breakdown: ProductionRequirementBreakdown[];
};

type ProductionBatchAllocation = {
  orderId: number;
  orderItemId: number;
  productId: number;
  productName: string;
  broasPlanned: number;
  saleUnitsApprox: number;
};

type ProductionBatchRecord = {
  id: string;
  triggerSource: 'MANUAL';
  triggerLabel: string;
  requestedTimerMinutes: number | null;
  bakeTimerMinutes: number;
  ovenCapacityBroas: number;
  startedAt: string;
  readyAt: string;
  status: 'BAKING' | 'READY' | 'DISPATCHED' | 'DELIVERED';
  linkedOrderIds: number[];
  allocations: ProductionBatchAllocation[];
};

type ProductionRuntimeState = {
  version: 1;
  updatedAt: string;
  batches: ProductionBatchRecord[];
};

type ProductionQueueRow = {
  orderId: number;
  customerName: string;
  scheduledAt: string | null;
  status: string;
  totalBroas: number;
  producedBroas: number;
  remainingBroas: number;
};

type ProductionBoardResponse = {
  oven: {
    capacityBroas: number;
    bakeTimerMinutes: number;
    activeBatch: ProductionBatchRecord | null;
    busy: boolean;
  };
  queue: ProductionQueueRow[];
  recentBatches: ProductionBatchRecord[];
};

const OVEN_BAKE_TIMER_MINUTES = 50;

@Injectable()
export class ProductionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DeliveriesService) private readonly deliveriesService: DeliveriesService
  ) {}

  private toQty(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.round((value + Number.EPSILON) * 10000) / 10000;
  }

  private formatDate(date: Date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseDateParam(date?: string) {
    if (!date) {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return this.formatDate(tomorrow);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Formato de data invalido. Use YYYY-MM-DD.');
    }
    const [yearRaw, monthRaw, dayRaw] = date.split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    const parsed = new Date(year, month - 1, day);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      throw new BadRequestException('Data invalida.');
    }
    return this.formatDate(parsed);
  }

  private parseSaleUnits(label?: string | null) {
    if (!label) return 1;
    const match = label.match(/(\d+)/);
    const parsed = match ? Number(match[1]) : 1;
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return parsed;
  }

  private perSaleQty(
    bom: BomWithItems,
    bomItem: BomWithItems['items'][number]
  ): number | null {
    if (bomItem.qtyPerSaleUnit != null) return bomItem.qtyPerSaleUnit;

    const unitsPerSale = this.parseSaleUnits(bom.saleUnitLabel);
    if (bomItem.qtyPerUnit != null) {
      return bomItem.qtyPerUnit * unitsPerSale;
    }
    if (bomItem.qtyPerRecipe != null && bom.yieldUnits && bom.yieldUnits > 0) {
      return bomItem.qtyPerRecipe / bom.yieldUnits;
    }
    return null;
  }

  private perBroaQty(
    bom: BomWithItems,
    bomItem: BomWithItems['items'][number]
  ): number | null {
    if (bomItem.qtyPerUnit != null) return bomItem.qtyPerUnit;

    const perSale = this.perSaleQty(bom, bomItem);
    const unitsPerSale = this.parseSaleUnits(bom.saleUnitLabel);
    if (perSale != null && unitsPerSale > 0) {
      return perSale / unitsPerSale;
    }
    if (bomItem.qtyPerRecipe != null && bom.yieldUnits && bom.yieldUnits > 0) {
      return bomItem.qtyPerRecipe / bom.yieldUnits;
    }
    return null;
  }

  private orderTargetDate(order: Pick<OrderWithItems, 'createdAt' | 'scheduledAt'>) {
    if (order.scheduledAt) {
      const scheduled = new Date(order.scheduledAt);
      if (!Number.isNaN(scheduled.getTime())) {
        return {
          date: this.formatDate(scheduled),
          basis: 'deliveryDate' as const,
        };
      }
    }

    const base = new Date(order.createdAt);
    const productionDate = new Date(base);
    productionDate.setHours(0, 0, 0, 0);
    productionDate.setDate(productionDate.getDate() + 1);
    return {
      date: this.formatDate(productionDate),
      basis: 'createdAtPlus1' as const,
    };
  }

  private buildAvailableQtyMap(
    movements: Array<{ itemId: number; type: string; quantity: number }>
  ) {
    const map = new Map<number, number>();
    for (const movement of movements) {
      const current = map.get(movement.itemId) || 0;
      if (movement.type === 'IN') {
        map.set(movement.itemId, this.toQty(current + movement.quantity));
      } else if (movement.type === 'OUT') {
        map.set(movement.itemId, this.toQty(current - movement.quantity));
      } else if (movement.type === 'ADJUST') {
        map.set(movement.itemId, this.toQty(movement.quantity));
      }
    }
    return map;
  }

  private buildEffectiveBalanceByItemId(
    items: Array<{ id: number; name: string }>,
    balanceByItem: Map<number, number>
  ) {
    const itemIdsByFamilyKey = new Map<string, number[]>();
    for (const item of items) {
      const familyKey = resolveInventoryFamilyKey(item.name);
      const current = itemIdsByFamilyKey.get(familyKey) || [];
      current.push(item.id);
      itemIdsByFamilyKey.set(familyKey, current);
    }

    const effectiveBalanceByItemId = new Map<number, number>();
    for (const itemIds of itemIdsByFamilyKey.values()) {
      const familyBalance = itemIds.reduce(
        (sum, itemId) => this.toQty(sum + (balanceByItem.get(itemId) || 0)),
        0
      );
      for (const itemId of itemIds) {
        effectiveBalanceByItemId.set(itemId, familyBalance);
      }
    }

    return effectiveBalanceByItemId;
  }

  private async loadProductionRuntime() {
    const record = await this.prisma.idempotencyRecord.findUnique({
      where: {
        scope_idemKey: {
          scope: 'PRODUCTION_RUNTIME',
          idemKey: 'PRIMARY_OVEN'
        }
      }
    });
    if (!record) {
      return {
        version: 1,
        updatedAt: new Date().toISOString(),
        batches: []
      } satisfies ProductionRuntimeState;
    }

    try {
      const parsed = JSON.parse(record.responseJson) as ProductionRuntimeState;
      if (Array.isArray(parsed.batches)) {
        return parsed;
      }
    } catch {
      return {
        version: 1,
        updatedAt: new Date().toISOString(),
        batches: []
      } satisfies ProductionRuntimeState;
    }

    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      batches: []
    } satisfies ProductionRuntimeState;
  }

  private async saveProductionRuntime(state: ProductionRuntimeState) {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 10);
    await this.prisma.idempotencyRecord.upsert({
      where: {
        scope_idemKey: {
          scope: 'PRODUCTION_RUNTIME',
          idemKey: 'PRIMARY_OVEN'
        }
      },
      update: {
        requestHash: state.updatedAt,
        responseJson: JSON.stringify(state),
        expiresAt
      },
      create: {
        scope: 'PRODUCTION_RUNTIME',
        idemKey: 'PRIMARY_OVEN',
        requestHash: state.updatedAt,
        responseJson: JSON.stringify(state),
        expiresAt
      }
    });
    return state;
  }

  private async loadOrdersAndBoms() {
    const [orders, boms] = await Promise.all([
      this.prisma.order.findMany({
        where: { status: { not: 'CANCELADO' } },
        include: {
          customer: true,
          items: {
            include: {
              product: true
            }
          }
        },
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }]
      }),
      this.prisma.bom.findMany({
        include: { product: true, items: { include: { item: true } } },
        orderBy: { id: 'asc' }
      })
    ]);

    const bomByProductId = new Map<number, BomWithItems>();
    for (const bom of boms) {
      if (!bomByProductId.has(bom.productId)) {
        bomByProductId.set(bom.productId, bom);
      }
    }

    return { orders, bomByProductId };
  }

  private producedBroasByOrderItem(state: ProductionRuntimeState) {
    const map = new Map<number, number>();
    for (const batch of state.batches) {
      for (const allocation of batch.allocations) {
        const current = map.get(allocation.orderItemId) || 0;
        map.set(allocation.orderItemId, this.toQty(current + allocation.broasPlanned));
      }
    }
    return map;
  }

  private totalBroasForItem(item: OrderWithItems['items'][number], bom?: BomWithItems) {
    void bom;
    return this.toQty(Math.max(Math.floor(item.quantity || 0), 0));
  }

  private remainingBroasForItem(
    item: OrderWithItems['items'][number],
    bom: BomWithItems | undefined,
    producedByOrderItem: Map<number, number>
  ) {
    const totalBroas = this.totalBroasForItem(item, bom);
    const producedBroas = Math.min(totalBroas, producedByOrderItem.get(item.id) || 0);
    return this.toQty(Math.max(totalBroas - producedBroas, 0));
  }

  private isOfficialBroaItem(item: Pick<OrderWithItems['items'][number], 'product'>) {
    return Boolean(resolveOfficialBroaFlavorCodeFromProductName(item.product?.name));
  }

  private shouldConsumeOnBatch(
    orderItem: Pick<OrderWithItems['items'][number], 'product'>,
    bomItem: BomWithItems['items'][number]
  ) {
    const itemName = bomItem.item?.name || '';
    if (isMassPrepIngredientName(itemName) || isOrderFillingIngredientName(itemName)) {
      return false;
    }

    if (this.isOfficialBroaItem(orderItem) && isPackagingIngredientName(itemName)) {
      return false;
    }

    return true;
  }

  private appendRequirementRow(
    byIngredient: Map<number, RequirementAccumulator>,
    entry: {
      ingredientId: number;
      name: string;
      unit: string;
      requiredQty: number;
      breakdown?: ProductionRequirementBreakdown;
    }
  ) {
    const current = byIngredient.get(entry.ingredientId);
    if (!current) {
      byIngredient.set(entry.ingredientId, {
        ingredientId: entry.ingredientId,
        name: entry.name,
        unit: entry.unit,
        requiredQty: this.toQty(entry.requiredQty),
        breakdown: entry.breakdown ? [entry.breakdown] : []
      });
      return;
    }

    current.requiredQty = this.toQty(current.requiredQty + entry.requiredQty);
    if (entry.breakdown) {
      current.breakdown.push(entry.breakdown);
    }
  }

  private buildQueueRows(
    orders: OrderWithItems[],
    bomByProductId: Map<number, BomWithItems>,
    producedByOrderItem: Map<number, number>
  ) {
    const rows: ProductionQueueRow[] = [];

    for (const order of orders) {
      if (!['CONFIRMADO', 'EM_PREPARACAO', 'PRONTO', 'ENTREGUE'].includes(order.status)) continue;

      let totalBroas = 0;
      let producedBroas = 0;
      for (const item of order.items) {
        const bom = bomByProductId.get(item.productId);
        const itemTotalBroas = this.totalBroasForItem(item, bom);
        totalBroas += itemTotalBroas;
        producedBroas += Math.min(itemTotalBroas, producedByOrderItem.get(item.id) || 0);
      }

      totalBroas = this.toQty(totalBroas);
      producedBroas = this.toQty(producedBroas);
      const remainingBroas = this.toQty(Math.max(totalBroas - producedBroas, 0));

      rows.push({
        orderId: order.id,
        customerName: (order.customer?.name || '').trim() || `Cliente ${order.customerId}`,
        scheduledAt: order.scheduledAt ? order.scheduledAt.toISOString() : null,
        status: order.status,
        totalBroas,
        producedBroas,
        remainingBroas
      });
    }

    return rows
      .filter((row) => row.totalBroas > 0)
      .sort((a, b) => {
        const left = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
        const right = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
        if (left !== right) return left - right;
        return a.orderId - b.orderId;
      });
  }

  private async syncRuntimeState(state: ProductionRuntimeState) {
    const { orders, bomByProductId } = await this.loadOrdersAndBoms();
    const orderById = new Map(orders.map((order) => [order.id, order]));
    const producedByOrderItem = this.producedBroasByOrderItem(state);
    let changed = false;
    const now = Date.now();

    for (const batch of state.batches) {
      const validLinkedOrderIds = batch.linkedOrderIds.filter((orderId) => orderById.has(orderId));
      if (validLinkedOrderIds.length !== batch.linkedOrderIds.length) {
        const validOrderIdSet = new Set(validLinkedOrderIds);
        batch.linkedOrderIds = validLinkedOrderIds;
        batch.allocations = batch.allocations.filter((entry) => validOrderIdSet.has(entry.orderId));
        changed = true;
      }

      if (batch.linkedOrderIds.length === 0) {
        if (batch.status !== 'DELIVERED') {
          batch.status = 'DELIVERED';
          changed = true;
        }
        continue;
      }

      if (batch.status === 'BAKING' && new Date(batch.readyAt).getTime() <= now) {
        batch.status = 'READY';
        changed = true;
      }

      if (batch.status === 'READY') {
        const readyOrderIds = new Set<number>();
        for (const orderId of batch.linkedOrderIds) {
          const order = orderById.get(orderId);
          if (!order) continue;

          let fullyProduced = true;
          for (const item of order.items) {
            const bom = bomByProductId.get(item.productId);
            const totalBroas = this.totalBroasForItem(item, bom);
            const producedBroas = Math.min(totalBroas, producedByOrderItem.get(item.id) || 0);
            if (producedBroas + 0.00001 < totalBroas) {
              fullyProduced = false;
              break;
            }
          }

          if (fullyProduced) {
            readyOrderIds.add(orderId);
            if (order.status !== 'PRONTO' && order.status !== 'ENTREGUE') {
              await this.prisma.order.update({
                where: { id: orderId },
                data: { status: 'PRONTO' }
              });
            }
          }
        }

        for (const orderId of readyOrderIds) {
          await this.deliveriesService.startOrderDelivery(orderId);
        }

        batch.status = 'DISPATCHED';
        changed = true;
      }

      if (batch.status === 'DISPATCHED') {
        let everyOrderDelivered = batch.linkedOrderIds.length > 0;
        for (const orderId of batch.linkedOrderIds) {
          const tracking = await this.deliveriesService.getOrderTracking(orderId);
          if (!tracking.exists || tracking.tracking?.status !== 'DELIVERED') {
            everyOrderDelivered = false;
          }
        }

        if (everyOrderDelivered) {
          batch.status = 'DELIVERED';
          changed = true;
        }
      }
    }

    if (changed) {
      state.updatedAt = new Date().toISOString();
      await this.saveProductionRuntime(state);
    }

    return state;
  }

  async requirements(date?: string): Promise<ProductionRequirementsResponse> {
    const targetDate = this.parseDateParam(date);
    const runtime = await this.syncRuntimeState(await this.loadProductionRuntime());
    const producedByOrderItem = this.producedBroasByOrderItem(runtime);

    const [orders, boms, items, movements] = await Promise.all([
      this.prisma.order.findMany({
        where: { status: { not: 'CANCELADO' } },
        include: { items: { include: { product: true } } },
      }),
      this.prisma.bom.findMany({
        include: { product: true, items: { include: { item: true } } },
        orderBy: { id: 'asc' },
      }),
      this.prisma.inventoryItem.findMany({
        select: { id: true, name: true, unit: true },
        orderBy: { id: 'asc' }
      }),
      this.prisma.inventoryMovement.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const availableByItem = this.buildAvailableQtyMap(movements);
    const effectiveAvailableByItem = this.buildEffectiveBalanceByItemId(items, availableByItem);
    const bomByProductId = new Map<number, BomWithItems>();
    for (const bom of boms) {
      if (!bomByProductId.has(bom.productId)) {
        bomByProductId.set(bom.productId, bom);
      }
    }

    const warnings: ProductionRequirementWarning[] = [];
    const byIngredient = new Map<number, RequirementAccumulator>();
    const itemByFamilyKey = new Map<string, { id: number; name: string; unit: string }>();
    for (const item of items) {
      const familyKey = resolveInventoryFamilyKey(item.name);
      if (!itemByFamilyKey.has(familyKey)) {
        itemByFamilyKey.set(familyKey, item);
      }
    }

    let basis: 'deliveryDate' | 'createdAtPlus1' = 'createdAtPlus1';
    const targetOrderIds = new Set<number>();
    const plasticBoxesByCustomerId = new Map<number, number>();
    let requiredMassRecipes = 0;

    for (const order of orders) {
      const orderTarget = this.orderTargetDate(order);
      if (orderTarget.date !== targetDate) continue;
      targetOrderIds.add(order.id);
      if (orderTarget.basis === 'deliveryDate') {
        basis = 'deliveryDate';
      }

      const productNameById = new Map(
        order.items.map((item) => [item.productId, item.product?.name || `Produto ${item.productId}`])
      );
      const remainingOrderItems = order.items
        .map((item) => {
          const bom = bomByProductId.get(item.productId);
          const remainingBroas = this.remainingBroasForItem(item, bom, producedByOrderItem);
          return {
            productId: item.productId,
            quantity: remainingBroas
          };
        })
        .filter((item) => item.quantity > 0);
      const broaSummary = buildOfficialBroaFlavorSummary(
        order.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity
        })),
        productNameById
      );
      const remainingBroaSummary = buildOfficialBroaFlavorSummary(remainingOrderItems, productNameById);
      requiredMassRecipes = this.toQty(
        requiredMassRecipes + remainingBroaSummary.totalBroas / MASS_READY_BROAS_PER_RECIPE
      );

      if (broaSummary.totalBroas > 0) {
        const packagingPlan = computeBroaPackagingPlan(broaSummary.totalBroas);
        const plasticBoxItem =
          itemByFamilyKey.get(resolveInventoryFamilyKey('CAIXA DE PLÁSTICO')) || null;
        const butterPaperItem =
          itemByFamilyKey.get(resolveInventoryFamilyKey('PAPEL MANTEIGA')) || null;

        if (plasticBoxItem && packagingPlan.plasticBoxes > 0) {
          this.appendRequirementRow(byIngredient, {
            ingredientId: plasticBoxItem.id,
            name: plasticBoxItem.name,
            unit: plasticBoxItem.unit,
            requiredQty: packagingPlan.plasticBoxes
          });
        }

        if (packagingPlan.plasticBoxes > 0) {
          const currentCustomerBoxes = plasticBoxesByCustomerId.get(order.customerId) || 0;
          plasticBoxesByCustomerId.set(
            order.customerId,
            this.toQty(currentCustomerBoxes + packagingPlan.plasticBoxes)
          );
        }

        if (butterPaperItem && packagingPlan.paperButterCm > 0) {
          this.appendRequirementRow(byIngredient, {
            ingredientId: butterPaperItem.id,
            name: butterPaperItem.name,
            unit: butterPaperItem.unit,
            requiredQty: packagingPlan.paperButterCm
          });
        }

        for (const code of ['G', 'D', 'Q', 'R'] as const) {
          const broasQty = remainingBroaSummary.flavorCounts[code] || 0;
          if (broasQty <= 0) continue;
          const definition = orderFillingIngredientsByFlavorCode[code];
          const fillingItem =
            itemByFamilyKey.get(resolveInventoryFamilyKey(definition.canonicalName)) || null;
          if (!fillingItem) continue;

          this.appendRequirementRow(byIngredient, {
            ingredientId: fillingItem.id,
            name: fillingItem.name,
            unit: fillingItem.unit,
            requiredQty: this.toQty(broasQty * (definition.qtyPerUnit ?? 0))
          });
        }
      }

      for (const item of order.items) {
        const bom = bomByProductId.get(item.productId);
        const remainingBroas = this.remainingBroasForItem(item, bom, producedByOrderItem);
        if (!bom || bom.items.length === 0) {
          warnings.push({
            type: 'BOM_MISSING',
            orderId: order.id,
            orderPublicNumber: resolveDisplayNumber(order),
            productId: item.productId,
            productName: item.product?.name || `Produto ${item.productId}`,
            message: 'Produto sem BOM cadastrada para calcular necessidade D+1.',
          });
          continue;
        }

        for (const bomItem of bom.items) {
          const isOfficialBroaItem = this.isOfficialBroaItem(item);
          const itemName = bomItem.item?.name || '';
          if (
            isOfficialBroaItem &&
            (isMassPrepIngredientName(itemName) ||
              isOrderFillingIngredientName(itemName) ||
              isPackagingIngredientName(itemName))
          ) {
            continue;
          }

          const perBroa = this.perBroaQty(bom, bomItem);
          if (perBroa == null) {
            warnings.push({
              type: 'BOM_ITEM_MISSING_QTY',
              orderId: order.id,
              orderPublicNumber: resolveDisplayNumber(order),
              productId: item.productId,
              productName: item.product?.name || `Produto ${item.productId}`,
              message: `BOM sem quantidade definida para o insumo ${bomItem.item?.name || bomItem.itemId}.`,
            });
            continue;
          }

          const requiredUnits = this.shouldConsumeOnBatch(item, bomItem) ? remainingBroas : item.quantity;
          const requiredQty = this.toQty(perBroa * requiredUnits);
          if (requiredQty <= 0) {
            continue;
          }
          const breakdownItem: ProductionRequirementBreakdown = {
            productId: item.productId,
            productName: item.product?.name || `Produto ${item.productId}`,
            orderId: order.id,
            orderItemId: item.id,
            quantity: requiredQty,
          };
          this.appendRequirementRow(byIngredient, {
            ingredientId: bomItem.itemId,
            name: bomItem.item?.name || `Insumo ${bomItem.itemId}`,
            unit: bomItem.item?.unit || 'un',
            requiredQty,
            breakdown: breakdownItem
          });
        }
      }
    }

    const paperBagItem = itemByFamilyKey.get(resolveInventoryFamilyKey('SACOLA')) || null;
    if (paperBagItem) {
      for (const totalPlasticBoxes of plasticBoxesByCustomerId.values()) {
        const paperBagsRequired = computeBroaPaperBagCount(totalPlasticBoxes);
        if (paperBagsRequired <= 0) continue;
        this.appendRequirementRow(byIngredient, {
          ingredientId: paperBagItem.id,
          name: paperBagItem.name,
          unit: paperBagItem.unit,
          requiredQty: paperBagsRequired
        });
      }
    }

    const restoredOrderReservationByItem = new Map<number, number>();
    for (const movement of movements) {
      if (!movement.orderId || !targetOrderIds.has(movement.orderId)) continue;
      if (
        movement.source !== 'ORDER_FILLING' &&
        movement.source !== 'ORDER_PACKAGING' &&
        movement.source !== 'MASS_READY'
      ) {
        continue;
      }

      const current = restoredOrderReservationByItem.get(movement.itemId) || 0;
      if (movement.type === 'OUT') {
        restoredOrderReservationByItem.set(
          movement.itemId,
          this.toQty(current + movement.quantity)
        );
      } else if (movement.type === 'IN') {
        restoredOrderReservationByItem.set(
          movement.itemId,
          this.toQty(current - movement.quantity)
        );
      }
    }
    const effectiveRestoredReservationByItem = this.buildEffectiveBalanceByItemId(
      items,
      restoredOrderReservationByItem
    );

    const massReadyItem = itemByFamilyKey.get(resolveInventoryFamilyKey(MASS_READY_ITEM_NAME)) || null;
    const availableMassRecipes = massReadyItem
      ? this.toQty(
          (effectiveAvailableByItem.get(massReadyItem.id) || 0) +
            (effectiveRestoredReservationByItem.get(massReadyItem.id) || 0)
        )
      : 0;
    const missingMassRecipes = this.toQty(
      Math.max(requiredMassRecipes - availableMassRecipes, 0)
    );
    let possibleMassPrepRecipesFromIngredients = Number.POSITIVE_INFINITY;
    for (const ingredient of massPrepRecipeIngredients) {
      const ingredientItem =
        itemByFamilyKey.get(resolveInventoryFamilyKey(ingredient.canonicalName)) || null;
      const availableQty = ingredientItem
        ? this.toQty(
            (effectiveAvailableByItem.get(ingredientItem.id) || 0) +
              (effectiveRestoredReservationByItem.get(ingredientItem.id) || 0)
          )
        : 0;
      const possibleForIngredient = ingredient.qtyPerRecipe
        ? Math.floor(availableQty / ingredient.qtyPerRecipe)
        : 0;
      possibleMassPrepRecipesFromIngredients = Math.min(
        possibleMassPrepRecipesFromIngredients,
        possibleForIngredient
      );
    }
    const plannedMassRecipes = resolvePlannedMassPrepRecipes(
      missingMassRecipes,
      Number.isFinite(possibleMassPrepRecipesFromIngredients)
        ? possibleMassPrepRecipesFromIngredients
        : 0
    );

    if (plannedMassRecipes > 0) {
      for (const ingredient of massPrepRecipeIngredients) {
        const ingredientItem =
          itemByFamilyKey.get(resolveInventoryFamilyKey(ingredient.canonicalName)) || null;
        if (!ingredientItem) continue;

        this.appendRequirementRow(byIngredient, {
          ingredientId: ingredientItem.id,
          name: ingredientItem.name,
          unit: ingredientItem.unit,
          requiredQty: this.toQty(ingredient.qtyPerRecipe * plannedMassRecipes)
        });
      }
    }

    const rows: ProductionRequirementRow[] = Array.from(byIngredient.values())
      .map((entry) => {
        const availableQty = this.toQty(
          (effectiveAvailableByItem.get(entry.ingredientId) || 0) +
            (effectiveRestoredReservationByItem.get(entry.ingredientId) || 0)
        );
        const requiredQty = this.toQty(entry.requiredQty);
        const shortageQty = this.toQty(Math.max(0, requiredQty - availableQty));
        return {
          ingredientId: entry.ingredientId,
          name: entry.name,
          unit: entry.unit,
          requiredQty,
          availableQty,
          shortageQty,
          breakdown: entry.breakdown,
        };
      })
      .sort((a, b) => {
        if (b.shortageQty !== a.shortageQty) return b.shortageQty - a.shortageQty;
        return a.name.localeCompare(b.name, 'pt-BR');
      });

    return {
      date: targetDate,
      basis,
      rows,
      warnings,
    };
  }

  async queue(): Promise<ProductionBoardResponse> {
    const runtime = await this.syncRuntimeState(await this.loadProductionRuntime());
    const { orders, bomByProductId } = await this.loadOrdersAndBoms();
    const producedByOrderItem = this.producedBroasByOrderItem(runtime);
    const queue = this.buildQueueRows(orders, bomByProductId, producedByOrderItem).filter(
      (row) => row.remainingBroas > 0 || row.status === 'PRONTO' || row.status === 'ENTREGUE'
    );
    const activeBatch = runtime.batches.find((batch) => batch.status === 'BAKING') || null;

    return {
      oven: {
        capacityBroas: OVEN_CAPACITY_BROAS,
        bakeTimerMinutes: OVEN_BAKE_TIMER_MINUTES,
        activeBatch,
        busy: Boolean(activeBatch)
      },
      queue,
      recentBatches: runtime.batches.slice(0, 8)
    };
  }

  async startNextBatch(payload: {
    triggerSource?: string;
    triggerLabel?: string;
    requestedTimerMinutes?: number;
  } = {}) {
    const runtime = await this.syncRuntimeState(await this.loadProductionRuntime());
    if (runtime.batches.some((batch) => batch.status === 'BAKING')) {
      throw new BadRequestException('O forno ja esta ocupado com uma fornada em andamento.');
    }

    const { orders, bomByProductId } = await this.loadOrdersAndBoms();
    const producedByOrderItem = this.producedBroasByOrderItem(runtime);
    const queue = this.buildQueueRows(orders, bomByProductId, producedByOrderItem).filter(
      (row) => row.remainingBroas > 0 && ['CONFIRMADO', 'EM_PREPARACAO'].includes(row.status)
    );

    if (queue.length === 0) {
      throw new BadRequestException('Nao ha pedidos confirmados aguardando entrada em producao.');
    }

    const orderById = new Map(orders.map((order) => [order.id, order]));
    let remainingCapacity = OVEN_CAPACITY_BROAS;
    const allocations: ProductionBatchAllocation[] = [];

    for (const row of queue) {
      if (remainingCapacity <= 0) break;
      const order = orderById.get(row.orderId);
      if (!order) continue;

      for (const item of order.items) {
        if (remainingCapacity <= 0) break;
        const bom = bomByProductId.get(item.productId);
        const unitsPerSale = this.parseSaleUnits(bom?.saleUnitLabel);
        const totalBroas = this.totalBroasForItem(item, bom);
        const producedBroas = Math.min(totalBroas, producedByOrderItem.get(item.id) || 0);
        const remainingBroas = this.toQty(Math.max(totalBroas - producedBroas, 0));
        if (remainingBroas <= 0) continue;

        const broasPlanned = Math.min(remainingBroas, remainingCapacity);
        remainingCapacity = this.toQty(remainingCapacity - broasPlanned);
        allocations.push({
          orderId: order.id,
          orderItemId: item.id,
          productId: item.productId,
          productName: item.product?.name || `Produto ${item.productId}`,
          broasPlanned,
          saleUnitsApprox: this.toQty(broasPlanned / unitsPerSale)
        });
      }
    }

    if (allocations.length === 0) {
      throw new BadRequestException('Nao foi possivel montar a proxima fornada com os pedidos atuais.');
    }

    const batchId = `oven-${randomUUID()}`;
    const now = new Date();
    const readyAt = new Date(now.getTime() + OVEN_BAKE_TIMER_MINUTES * 60_000);
    const touchedOrderIds = Array.from(new Set(allocations.map((entry) => entry.orderId)));
    const triggerLabel =
      typeof payload.triggerLabel === 'string' ? payload.triggerLabel.trim() : '';
    const requestedTimerMinutes =
      typeof payload.requestedTimerMinutes === 'number' &&
      Number.isFinite(payload.requestedTimerMinutes) &&
      payload.requestedTimerMinutes > 0
        ? Math.round(payload.requestedTimerMinutes)
        : null;

    await this.prisma.$transaction(async (tx) => {
      for (const allocation of allocations) {
        const order = orderById.get(allocation.orderId);
        const item = order?.items.find((entry) => entry.id === allocation.orderItemId);
        if (!order || !item) continue;
        const bom = bomByProductId.get(allocation.productId);
        if (!bom) continue;

        for (const bomItem of bom.items) {
          if (!this.shouldConsumeOnBatch(item, bomItem)) continue;
          const perBroa = this.perBroaQty(bom, bomItem);
          if (perBroa == null) continue;
          const quantity = this.toQty(perBroa * allocation.broasPlanned);
          if (quantity <= 0) continue;

          await tx.inventoryMovement.create({
            data: {
              itemId: bomItem.itemId,
              orderId: allocation.orderId,
              type: 'OUT',
              quantity,
              reason: 'Consumo por fornada',
              source: 'PRODUCTION_BATCH',
              sourceLabel: batchId
            }
          });
        }
      }

      for (const orderId of touchedOrderIds) {
        await tx.order.update({
          where: { id: orderId },
          data: { status: 'EM_PREPARACAO' }
        });
      }
    });

    runtime.batches.unshift({
      id: batchId,
      triggerSource: 'MANUAL',
      triggerLabel: triggerLabel || 'Inicio manual da fornada',
      requestedTimerMinutes,
      bakeTimerMinutes: OVEN_BAKE_TIMER_MINUTES,
      ovenCapacityBroas: OVEN_CAPACITY_BROAS,
      startedAt: now.toISOString(),
      readyAt: readyAt.toISOString(),
      status: 'BAKING',
      linkedOrderIds: touchedOrderIds,
      allocations
    });
    runtime.updatedAt = new Date().toISOString();
    await this.saveProductionRuntime(runtime);

    return {
      batchId,
      readyAt: readyAt.toISOString(),
      allocations,
      board: await this.queue()
    };
  }

  async completeBatch(batchId: string) {
    const runtime = await this.loadProductionRuntime();
    const batch = runtime.batches.find((entry) => entry.id === batchId);
    if (!batch) {
      throw new NotFoundException('Fornada nao encontrada.');
    }

    if (batch.status === 'DELIVERED') {
      return {
        batch,
        board: await this.queue()
      };
    }

    batch.readyAt = new Date().toISOString();
    batch.status = 'READY';
    runtime.updatedAt = new Date().toISOString();
    await this.saveProductionRuntime(runtime);

    const synced = await this.syncRuntimeState(runtime);
    return {
      batch: synced.batches.find((entry) => entry.id === batchId) || batch,
      board: await this.queue()
    };
  }
}
