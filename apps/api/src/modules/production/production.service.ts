import { BadRequestException, Injectable, Inject } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  ProductionRequirementBreakdown,
  ProductionRequirementRow,
  ProductionRequirementWarning,
  ProductionRequirementsResponse,
} from '@querobroapp/shared';
import { PrismaService } from '../../prisma.service.js';

type OrderWithItems = Prisma.OrderGetPayload<{
  include: {
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

@Injectable()
export class ProductionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
    return match ? Number(match[1]) : 1;
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
}
