import { BadRequestException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type {
  ProductionRequirementBreakdown,
  ProductionRequirementRow,
  ProductionRequirementWarning,
  ProductionRequirementsResponse,
} from '@querobroapp/shared';
import { PrismaService } from '../../prisma.service.js';
import { DeliveriesService } from '../deliveries/deliveries.service.js';

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
  triggerSource: 'ALEXA' | 'MANUAL';
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
  waitingAlexaTrigger: boolean;
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

const OVEN_CAPACITY_BROAS = 14;
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
    const unitsPerSale = this.parseSaleUnits(bom?.saleUnitLabel);
    return this.toQty(item.quantity * unitsPerSale);
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
        remainingBroas,
        waitingAlexaTrigger: order.status === 'CONFIRMADO' && remainingBroas > 0
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
          await this.deliveriesService.dispatchOrderToUber(orderId);
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

    const [orders, boms, movements] = await Promise.all([
      this.prisma.order.findMany({
        where: { status: { not: 'CANCELADO' } },
        include: { items: { include: { product: true } } },
      }),
      this.prisma.bom.findMany({
        include: { product: true, items: { include: { item: true } } },
        orderBy: { id: 'asc' },
      }),
      this.prisma.inventoryMovement.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const availableByItem = this.buildAvailableQtyMap(movements);
    const bomByProductId = new Map<number, BomWithItems>();
    for (const bom of boms) {
      if (!bomByProductId.has(bom.productId)) {
        bomByProductId.set(bom.productId, bom);
      }
    }

    const warnings: ProductionRequirementWarning[] = [];
    const byIngredient = new Map<number, RequirementAccumulator>();

    let basis: 'deliveryDate' | 'createdAtPlus1' = 'createdAtPlus1';

    for (const order of orders) {
      const orderTarget = this.orderTargetDate(order);
      if (orderTarget.date !== targetDate) continue;
      if (orderTarget.basis === 'deliveryDate') {
        basis = 'deliveryDate';
      }

      for (const item of order.items) {
        const bom = bomByProductId.get(item.productId);
        if (!bom || bom.items.length === 0) {
          warnings.push({
            type: 'BOM_MISSING',
            orderId: order.id,
            productId: item.productId,
            productName: item.product?.name || `Produto ${item.productId}`,
            message: 'Produto sem BOM cadastrada para calcular necessidade D+1.',
          });
          continue;
        }

        for (const bomItem of bom.items) {
          const perSale = this.perSaleQty(bom, bomItem);
          if (perSale == null) {
            warnings.push({
              type: 'BOM_ITEM_MISSING_QTY',
              orderId: order.id,
              productId: item.productId,
              productName: item.product?.name || `Produto ${item.productId}`,
              message: `BOM sem quantidade definida para o insumo ${bomItem.item?.name || bomItem.itemId}.`,
            });
            continue;
          }

          const requiredQty = this.toQty(perSale * item.quantity);
          const breakdownItem: ProductionRequirementBreakdown = {
            productId: item.productId,
            productName: item.product?.name || `Produto ${item.productId}`,
            orderId: order.id,
            orderItemId: item.id,
            quantity: requiredQty,
          };

          const current = byIngredient.get(bomItem.itemId);
          if (!current) {
            byIngredient.set(bomItem.itemId, {
              ingredientId: bomItem.itemId,
              name: bomItem.item?.name || `Insumo ${bomItem.itemId}`,
              unit: bomItem.item?.unit || 'un',
              requiredQty,
              breakdown: [breakdownItem],
            });
            continue;
          }

          current.requiredQty = this.toQty(current.requiredQty + requiredQty);
          current.breakdown.push(breakdownItem);
        }
      }
    }

    const rows: ProductionRequirementRow[] = Array.from(byIngredient.values())
      .map((entry) => {
        const availableQty = this.toQty(availableByItem.get(entry.ingredientId) || 0);
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

    await this.prisma.$transaction(async (tx) => {
      for (const allocation of allocations) {
        const order = orderById.get(allocation.orderId);
        const item = order?.items.find((entry) => entry.id === allocation.orderItemId);
        if (!order || !item) continue;
        const bom = bomByProductId.get(allocation.productId);
        if (!bom) continue;
        const unitsPerSale = this.parseSaleUnits(bom.saleUnitLabel);

        for (const bomItem of bom.items) {
          const perSale = this.perSaleQty(bom, bomItem);
          if (perSale == null) continue;
          const perBroa = perSale / unitsPerSale;
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
      triggerSource: payload.triggerSource === 'ALEXA' ? 'ALEXA' : 'MANUAL',
      triggerLabel: (payload.triggerLabel || '').trim() || 'Inicio manual da fornada',
      requestedTimerMinutes:
        Number.isFinite(payload.requestedTimerMinutes) && (payload.requestedTimerMinutes || 0) > 0
          ? Math.round(payload.requestedTimerMinutes as number)
          : null,
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

  async rebalanceLegacyOrderConsumption() {
    const orders = await this.prisma.order.findMany({
      where: {
        status: {
          in: ['ABERTO', 'CONFIRMADO', 'EM_PREPARACAO', 'PRONTO']
        }
      },
      select: { id: true }
    });
    const orderIds = orders.map((order) => order.id);
    if (orderIds.length === 0) {
      return {
        adjustedCount: 0
      };
    }

    const legacyMovements = await this.prisma.inventoryMovement.findMany({
      where: {
        orderId: { in: orderIds },
        source: null,
        reason: 'Consumo por pedido'
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });

    let adjustedCount = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const movement of legacyMovements) {
        const sourceLabel = `legacy-order-movement-${movement.id}`;
        const alreadyCompensated = await tx.inventoryMovement.findFirst({
          where: {
            source: 'FLOW_REALIGN',
            sourceLabel
          }
        });
        if (alreadyCompensated) continue;

        await tx.inventoryMovement.create({
          data: {
            itemId: movement.itemId,
            orderId: movement.orderId,
            type: 'IN',
            quantity: movement.quantity,
            reason: 'Normalizacao: estoque agora baixa apenas quando a fornada inicia',
            source: 'FLOW_REALIGN',
            sourceLabel
          }
        });
        adjustedCount += 1;
      }
    });

    return {
      adjustedCount
    };
  }
}
