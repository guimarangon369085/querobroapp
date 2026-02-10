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
    return date.toISOString().slice(0, 10);
  }

  private parseDateParam(date?: string) {
    if (!date) {
      const now = new Date();
      const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      return this.formatDate(tomorrow);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Formato de data invalido. Use YYYY-MM-DD.');
    }
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
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

  private orderProductionDate(order: Pick<OrderWithItems, 'createdAt'>) {
    const base = new Date(order.createdAt);
    const productionDate = new Date(
      Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + 1)
    );
    return this.formatDate(productionDate);
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

    for (const order of orders) {
      if (this.orderProductionDate(order) !== targetDate) continue;

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
      basis: 'createdAtPlus1',
      rows,
      warnings,
    };
  }
}
