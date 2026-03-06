import { Injectable, Inject, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { InventoryCategoryEnum, StockMovementTypeEnum } from '@querobroapp/shared';
import { parseLocaleNumber } from '../../common/normalize.js';
import { parseWithSchema } from '../../common/validation.js';
import { z } from 'zod';

const nonNegativeNumberInputSchema = z.preprocess((value) => {
  const parsed = parseLocaleNumber(value as string | number | null | undefined);
  return parsed === null ? value : parsed;
}, z.number().nonnegative());

const optionalNonNegativeNumberInputSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  const parsed = parseLocaleNumber(value as string | number | null | undefined);
  return parsed === null ? value : parsed;
}, z.number().nonnegative().optional());

const optionalNullableNonNegativeNumberInputSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = parseLocaleNumber(value as string | number | null | undefined);
  return parsed === null ? value : parsed;
}, z.number().nonnegative().nullable().optional());

const inventoryItemCreateSchema = z.object({
  name: z.string().trim().min(1),
  category: InventoryCategoryEnum,
  unit: z.string().trim().min(1),
  purchasePackSize: nonNegativeNumberInputSchema,
  purchasePackCost: optionalNonNegativeNumberInputSchema
});

const inventoryItemUpdateSchema = inventoryItemCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo para atualizar.'
  });

const inventoryMovementCreateSchema = z.object({
  itemId: z.coerce.number().int().positive(),
  orderId: z.coerce.number().int().positive().optional().nullable(),
  type: StockMovementTypeEnum,
  quantity: nonNegativeNumberInputSchema,
  reason: z.string().trim().optional().nullable(),
  source: z.string().trim().min(1).max(40).optional().nullable(),
  sourceLabel: z.string().trim().min(1).max(140).optional().nullable(),
  unitCost: optionalNullableNonNegativeNumberInputSchema
});

const MASS_READY_ITEM_NAME = 'MASSA PRONTA';
const MASS_PREP_SOURCE = 'MASS_PREP';
const MASS_PREP_SOURCE_LABEL = 'MANUAL_POPUP';

const massPrepRecipeIngredients = [
  {
    canonicalName: 'LEITE',
    aliases: ['LEITE'],
    unit: 'ml',
    qtyPerRecipe: 480,
    purchasePackSize: 1000,
    purchasePackCost: 4.19
  },
  {
    canonicalName: 'MANTEIGA COM SAL',
    aliases: ['MANTEIGA COM SAL', 'MANTEIGA'],
    unit: 'g',
    qtyPerRecipe: 300,
    purchasePackSize: 500,
    purchasePackCost: 24.9
  },
  {
    canonicalName: 'ACUCAR',
    aliases: ['ACUCAR', 'AÇÚCAR'],
    unit: 'g',
    qtyPerRecipe: 240,
    purchasePackSize: 1000,
    purchasePackCost: 5.69
  },
  {
    canonicalName: 'FARINHA DE TRIGO',
    aliases: ['FARINHA DE TRIGO'],
    unit: 'g',
    qtyPerRecipe: 260,
    purchasePackSize: 1000,
    purchasePackCost: 6.49
  },
  {
    canonicalName: 'FUBA DE CANJICA',
    aliases: ['FUBA DE CANJICA', 'FUBÁ DE CANJICA'],
    unit: 'g',
    qtyPerRecipe: 260,
    purchasePackSize: 1000,
    purchasePackCost: 6
  },
  {
    canonicalName: 'OVOS',
    aliases: ['OVOS'],
    unit: 'uni',
    qtyPerRecipe: 12,
    purchasePackSize: 20,
    purchasePackCost: 23.9
  }
] as const;

const prepareMassReadySchema = z.object({
  recipes: z.coerce.number().int().positive().max(500),
  orderId: z.coerce.number().int().positive().optional().nullable(),
  reason: z.string().trim().optional().nullable()
});

type InventoryItemLookupEntry = {
  id: number;
  name: string;
  category: string;
  unit: string;
  purchasePackSize: number;
  purchasePackCost: number;
  createdAt: Date;
};

@Injectable()
export class InventoryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private toQty(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.round((value + Number.EPSILON) * 10000) / 10000;
  }

  private normalizeLookup(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  private buildInventoryItemLookup(items: InventoryItemLookupEntry[]) {
    const byName = new Map<string, InventoryItemLookupEntry>();
    for (const item of items) {
      byName.set(this.normalizeLookup(item.name), item);
    }
    return byName;
  }

  private findInventoryByAliases(
    byName: Map<string, InventoryItemLookupEntry>,
    aliases: readonly string[]
  ) {
    for (const alias of aliases) {
      const candidate = byName.get(this.normalizeLookup(alias));
      if (candidate) return candidate;
    }
    return null;
  }

  private inventoryBalanceFromMovements(
    movements: Array<{
      type: string;
      quantity: number;
    }>
  ) {
    let balance = 0;
    for (const movement of movements) {
      if (movement.type === 'IN') {
        balance = this.toQty(balance + movement.quantity);
      } else if (movement.type === 'OUT') {
        balance = this.toQty(balance - movement.quantity);
      } else if (movement.type === 'ADJUST') {
        balance = this.toQty(movement.quantity);
      }
    }
    return balance;
  }

  listItems() {
    return this.prisma.inventoryItem.findMany({ orderBy: { id: 'asc' } });
  }

  createItem(payload: unknown) {
    const data = parseWithSchema(inventoryItemCreateSchema, payload);
    return this.prisma.inventoryItem.create({ data });
  }

  async updateItem(id: number, payload: unknown) {
    const item = await this.prisma.inventoryItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Item nao encontrado');

    const data = parseWithSchema(inventoryItemUpdateSchema, payload);
    return this.prisma.inventoryItem.update({ where: { id }, data });
  }

  async removeItem(id: number) {
    const item = await this.prisma.inventoryItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Item nao encontrado');

    const [movementsCount, bomItemsCount] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.count({ where: { itemId: id } }),
      this.prisma.bomItem.count({ where: { itemId: id } })
    ]);

    if (movementsCount > 0 || bomItemsCount > 0) {
      throw new ConflictException('Item possui movimentos ou ficha tecnica vinculada.');
    }

    await this.prisma.inventoryItem.delete({ where: { id } });
  }

  listMovements() {
    return this.prisma.inventoryMovement.findMany({
      include: { item: true },
      orderBy: { id: 'desc' }
    });
  }

  async createMovement(payload: unknown) {
    const data = parseWithSchema(inventoryMovementCreateSchema, payload);

    const item = await this.prisma.inventoryItem.findUnique({ where: { id: data.itemId } });
    if (!item) throw new NotFoundException('Item nao encontrado');

    if (data.orderId) {
      const order = await this.prisma.order.findUnique({ where: { id: data.orderId } });
      if (!order) throw new NotFoundException('Pedido nao encontrado');
    }

    return this.prisma.inventoryMovement.create({ data });
  }

  async prepareMassReady(payload: unknown) {
    const data = parseWithSchema(prepareMassReadySchema, payload ?? {});

    return this.prisma.$transaction(async (tx) => {
      const inventoryItems = await tx.inventoryItem.findMany({ orderBy: { id: 'asc' } });
      const inventoryByLookup = this.buildInventoryItemLookup(inventoryItems);

      let massReadyItem = this.findInventoryByAliases(inventoryByLookup, [MASS_READY_ITEM_NAME]);
      if (!massReadyItem) {
        massReadyItem = await tx.inventoryItem.create({
          data: {
            name: MASS_READY_ITEM_NAME,
            category: 'INGREDIENTE',
            unit: 'receita',
            purchasePackSize: 1,
            purchasePackCost: 0
          }
        });
        inventoryByLookup.set(this.normalizeLookup(massReadyItem.name), massReadyItem);
      }

      const ingredientPlan: Array<{
        item: InventoryItemLookupEntry;
        requiredQty: number;
        availableQty: number;
        canonicalName: string;
        unit: string;
      }> = [];

      for (const ingredient of massPrepRecipeIngredients) {
        let item = this.findInventoryByAliases(inventoryByLookup, ingredient.aliases);
        if (!item) {
          item = await tx.inventoryItem.create({
            data: {
              name: ingredient.canonicalName,
              category: 'INGREDIENTE',
              unit: ingredient.unit,
              purchasePackSize: ingredient.purchasePackSize,
              purchasePackCost: ingredient.purchasePackCost
            }
          });
          inventoryByLookup.set(this.normalizeLookup(item.name), item);
        }

        const movements = await tx.inventoryMovement.findMany({
          where: { itemId: item.id },
          select: { type: true, quantity: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
        });
        const availableQty = this.inventoryBalanceFromMovements(movements);
        const requiredQty = this.toQty(ingredient.qtyPerRecipe * data.recipes);
        if (availableQty + 0.00001 < requiredQty) {
          throw new BadRequestException(
            `Estoque insuficiente para ${ingredient.canonicalName}. Disponivel ${this.toQty(availableQty)} ${ingredient.unit}; necessario ${requiredQty} ${ingredient.unit}.`
          );
        }

        ingredientPlan.push({
          item,
          requiredQty,
          availableQty: this.toQty(availableQty),
          canonicalName: ingredient.canonicalName,
          unit: ingredient.unit
        });
      }

      const consumptionReason =
        data.reason?.trim() || `Consumo de insumos para MASSA PRONTA (${data.recipes} receita(s))`;
      const replenishmentReason =
        data.reason?.trim() || `Reposicao manual de MASSA PRONTA (${data.recipes} receita(s))`;

      for (const ingredient of ingredientPlan) {
        await tx.inventoryMovement.create({
          data: {
            itemId: ingredient.item.id,
            orderId: data.orderId ?? null,
            type: 'OUT',
            quantity: ingredient.requiredQty,
            reason: consumptionReason,
            source: MASS_PREP_SOURCE,
            sourceLabel: MASS_PREP_SOURCE_LABEL
          }
        });
      }

      await tx.inventoryMovement.create({
        data: {
          itemId: massReadyItem.id,
          orderId: data.orderId ?? null,
          type: 'IN',
          quantity: data.recipes,
          reason: replenishmentReason,
          source: MASS_PREP_SOURCE,
          sourceLabel: MASS_PREP_SOURCE_LABEL
        }
      });

      return {
        ok: true,
        recipesPrepared: data.recipes,
        massReadyItemId: massReadyItem.id,
        consumedIngredients: ingredientPlan.map((ingredient) => ({
          itemId: ingredient.item.id,
          name: ingredient.item.name,
          requiredQty: ingredient.requiredQty,
          availableQty: ingredient.availableQty,
          unit: ingredient.unit
        }))
      };
    });
  }

  async removeMovement(id: number) {
    const movement = await this.prisma.inventoryMovement.findUnique({ where: { id } });
    if (!movement) throw new NotFoundException('Movimentacao nao encontrada');
    await this.prisma.inventoryMovement.delete({ where: { id } });
  }

  async clearAllMovements() {
    const [inventoryResult, stockResult] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.deleteMany({}),
      this.prisma.stockMovement.deleteMany({})
    ]);

    return {
      inventoryMovementsDeleted: inventoryResult.count,
      stockMovementsDeleted: stockResult.count,
      totalDeleted: inventoryResult.count + stockResult.count
    };
  }
}
