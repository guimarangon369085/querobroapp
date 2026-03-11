import { Injectable, Inject, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { InventoryCategoryEnum, StockMovementTypeEnum } from '@querobroapp/shared';
import { parseLocaleNumber } from '../../common/normalize.js';
import { parseWithSchema } from '../../common/validation.js';
import { z } from 'zod';
import {
  addInventoryLookupItem,
  buildInventoryItemLookup,
  findInventoryByAliases,
  MASS_READY_BROAS_PER_RECIPE,
  MASS_READY_ITEM_NAME,
  massPrepRecipeIngredients,
  pickInventoryFamilyRepresentative,
  resolveExecutableMassPrepRecipes,
  resolveInventoryDefinition,
  resolveInventoryFamilyItemIds,
  resolveInventoryFamilyKey
} from './inventory-formulas.js';

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

const MASS_PREP_SOURCE = 'MASS_PREP';
const MASS_PREP_SOURCE_LABEL = 'MANUAL_POPUP';

const prepareMassReadySchema = z.object({
  recipes: z.coerce.number().int().positive().max(2),
  orderId: z.coerce.number().int().positive().optional().nullable(),
  reason: z.string().trim().optional().nullable()
});

const setEffectiveBalanceSchema = z.object({
  quantity: nonNegativeNumberInputSchema,
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

  private buildBalanceByItemId(
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
        balanceByItem.set(movement.itemId, this.toQty(current + movement.quantity));
      } else if (movement.type === 'OUT') {
        balanceByItem.set(movement.itemId, this.toQty(current - movement.quantity));
      } else if (movement.type === 'ADJUST') {
        balanceByItem.set(movement.itemId, this.toQty(movement.quantity));
      }
    }

    return balanceByItem;
  }

  private buildEffectiveBalanceByItemId(
    items: InventoryItemLookupEntry[],
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

  private buildInventoryOverviewPayload(
    items: InventoryItemLookupEntry[],
    movements: Array<{
      itemId: number;
      type: string;
      quantity: number;
    }>
  ) {
    const balanceByItem = this.buildBalanceByItemId(movements);
    const groupedByFamily = new Map<string, InventoryItemLookupEntry[]>();

    for (const item of items) {
      const familyKey = resolveInventoryFamilyKey(item.name);
      const current = groupedByFamily.get(familyKey) || [];
      current.push(item);
      groupedByFamily.set(familyKey, current);
    }

    const overviewItems = Array.from(groupedByFamily.entries())
      .map(([_familyKey, familyItems]) => {
        const definition = resolveInventoryDefinition(familyItems[0]?.name || null);
        const representative = pickInventoryFamilyRepresentative(
          familyItems,
          definition?.canonicalName || familyItems[0]?.name || ''
        );
        if (!representative) return null;

        const balance = familyItems.reduce(
          (sum, item) => this.toQty(sum + (balanceByItem.get(item.id) || 0)),
          0
        );

        return {
          id: representative.id,
          name: definition?.canonicalName || representative.name,
          category: definition?.category || representative.category,
          unit: definition?.unit || representative.unit,
          purchasePackSize:
            representative.purchasePackSize || definition?.purchasePackSize || 0,
          purchasePackCost:
            representative.purchasePackCost || definition?.purchasePackCost || 0,
          createdAt: representative.createdAt,
          balance: this.toQty(balance),
          rawItemIds: familyItems.map((item) => item.id).sort((left, right) => left - right)
        };
      })
      .filter(Boolean)
      .sort((left, right) => left!.name.localeCompare(right!.name, 'pt-BR'));

    const overviewByFamilyKey = new Map(
      overviewItems.map((item) => [familyKeyFromDisplayName(item!.name), item!])
    );

    let recipesPossibleFromIngredients = Infinity;
    let limitingIngredientName: string | null = null;

    for (const ingredient of massPrepRecipeIngredients) {
      const overviewItem = overviewByFamilyKey.get(
        familyKeyFromDisplayName(ingredient.canonicalName)
      );
      const availableQty = overviewItem?.balance || 0;
      const possibleRecipes = ingredient.qtyPerRecipe
        ? Math.floor(availableQty / ingredient.qtyPerRecipe)
        : 0;

      if (possibleRecipes < recipesPossibleFromIngredients) {
        recipesPossibleFromIngredients = possibleRecipes;
        limitingIngredientName = ingredient.canonicalName;
      }
    }

    if (!Number.isFinite(recipesPossibleFromIngredients)) {
      recipesPossibleFromIngredients = 0;
      limitingIngredientName = null;
    }

    const massReadyItem =
      overviewByFamilyKey.get(familyKeyFromDisplayName(MASS_READY_ITEM_NAME)) || null;
    const recipesAvailable = this.toQty(massReadyItem?.balance || 0);
    const broasAvailable = this.toQty(recipesAvailable * MASS_READY_BROAS_PER_RECIPE);
    const broasPossibleFromIngredients = this.toQty(
      recipesPossibleFromIngredients * MASS_READY_BROAS_PER_RECIPE
    );

    return {
      items: overviewItems,
      mass: {
        itemId: massReadyItem?.id || null,
        name: MASS_READY_ITEM_NAME,
        recipesAvailable,
        broasAvailable,
        recipesPossibleFromIngredients,
        broasPossibleFromIngredients,
        totalPotentialRecipes: this.toQty(recipesAvailable + recipesPossibleFromIngredients),
        totalPotentialBroas: this.toQty(broasAvailable + broasPossibleFromIngredients),
        limitingIngredientName
      },
      generatedAt: new Date().toISOString()
    };
  }

  listItems() {
    return this.prisma.inventoryItem.findMany({ orderBy: { id: 'asc' } });
  }

  async overview() {
    const [items, movements] = await Promise.all([
      this.prisma.inventoryItem.findMany({ orderBy: { id: 'asc' } }),
      this.prisma.inventoryMovement.findMany({
        select: { itemId: true, type: true, quantity: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
      })
    ]);

    return this.buildInventoryOverviewPayload(items, movements);
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

  async adjustEffectiveBalance(id: number, payload: unknown) {
    const data = parseWithSchema(setEffectiveBalanceSchema, payload ?? {});

    return this.prisma.$transaction(async (tx) => {
      const items = await tx.inventoryItem.findMany({ orderBy: { id: 'asc' } });
      const targetItem = items.find((item) => item.id === id);
      if (!targetItem) throw new NotFoundException('Item nao encontrado');

      const familyDefinition = resolveInventoryDefinition(targetItem.name);
      const familyItemIds = familyDefinition
        ? resolveInventoryFamilyItemIds(items, familyDefinition)
        : items
            .filter((item) => resolveInventoryFamilyKey(item.name) === resolveInventoryFamilyKey(targetItem.name))
            .map((item) => item.id);

      const familyItems = items.filter((item) => familyItemIds.includes(item.id));
      const representative =
        pickInventoryFamilyRepresentative(
          familyItems,
          familyDefinition?.canonicalName || targetItem.name
        ) || targetItem;

      const movements = await tx.inventoryMovement.findMany({
        where: { itemId: { in: familyItemIds } },
        select: { itemId: true, type: true, quantity: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
      });
      const balanceByItem = this.buildBalanceByItemId(movements);
      const effectiveBalanceByItemId = this.buildEffectiveBalanceByItemId(items, balanceByItem);
      const currentEffectiveBalance = this.toQty(
        effectiveBalanceByItemId.get(representative.id) || 0
      );
      const desiredEffectiveBalance = this.toQty(data.quantity);
      const delta = this.toQty(desiredEffectiveBalance - currentEffectiveBalance);

      if (Math.abs(delta) < 0.0001) {
        return {
          ok: true,
          itemId: representative.id,
          effectiveBalance: currentEffectiveBalance,
          appliedType: 'NONE',
          appliedQuantity: 0
        };
      }

      await tx.inventoryMovement.create({
        data: {
          itemId: representative.id,
          type: delta > 0 ? 'IN' : 'OUT',
          quantity: Math.abs(delta),
          reason:
            data.reason?.trim() ||
            `Ajuste efetivo via Estoque (${familyDefinition?.canonicalName || representative.name})`
        }
      });

      return {
        ok: true,
        itemId: representative.id,
        effectiveBalance: desiredEffectiveBalance,
        appliedType: delta > 0 ? 'IN' : 'OUT',
        appliedQuantity: Math.abs(delta)
      };
    });
  }

  async prepareMassReady(payload: unknown) {
    const data = parseWithSchema(prepareMassReadySchema, payload ?? {});

    return this.prisma.$transaction(async (tx) => {
      const inventoryItems = await tx.inventoryItem.findMany({ orderBy: { id: 'asc' } });
      const inventoryByLookup = buildInventoryItemLookup(inventoryItems);

      let massReadyItem = findInventoryByAliases(inventoryByLookup, {
        canonicalName: MASS_READY_ITEM_NAME,
        aliases: [MASS_READY_ITEM_NAME]
      });
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
        addInventoryLookupItem(inventoryByLookup, massReadyItem);
      }

      const ingredientPlan: Array<{
        item: InventoryItemLookupEntry;
        qtyPerRecipe: number;
        availableQty: number;
        canonicalName: string;
        unit: string;
      }> = [];
      let possibleRecipesFromIngredients = Number.POSITIVE_INFINITY;

      for (const ingredient of massPrepRecipeIngredients) {
        let item = findInventoryByAliases(inventoryByLookup, ingredient);
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
          addInventoryLookupItem(inventoryByLookup, item);
        }

        const movements = await tx.inventoryMovement.findMany({
          where: {
            itemId: {
              in: resolveInventoryFamilyItemIds(inventoryItems, ingredient)
            }
          },
          select: { itemId: true, type: true, quantity: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
        });
        const availableQty = this.toQty(
          Array.from(this.buildBalanceByItemId(movements).values()).reduce(
            (sum, value) => this.toQty(sum + value),
            0
          )
        );
        const possibleForIngredient = ingredient.qtyPerRecipe
          ? Math.floor(availableQty / ingredient.qtyPerRecipe)
          : 0;
        possibleRecipesFromIngredients = Math.min(possibleRecipesFromIngredients, possibleForIngredient);

        ingredientPlan.push({
          item,
          qtyPerRecipe: ingredient.qtyPerRecipe,
          availableQty: this.toQty(availableQty),
          canonicalName: ingredient.canonicalName,
          unit: ingredient.unit
        });
      }

      const recipesPrepared = resolveExecutableMassPrepRecipes(
        data.recipes,
        Number.isFinite(possibleRecipesFromIngredients) ? possibleRecipesFromIngredients : 0
      );
      if (recipesPrepared <= 0) {
        const missingIngredients = ingredientPlan.map(
          (ingredient) =>
            `${ingredient.canonicalName}: disponivel ${this.toQty(ingredient.availableQty)} ${ingredient.unit}; necessario ${ingredient.qtyPerRecipe} ${ingredient.unit}.`
        );
        throw new BadRequestException(
          `Estoque insuficiente para preparar MASSA PRONTA. ${missingIngredients.join(' | ')}`
        );
      }

      const consumptionReason =
        data.reason?.trim() ||
        `Consumo de insumos para MASSA PRONTA (${recipesPrepared} receita(s))`;
      const replenishmentReason =
        data.reason?.trim() || `Reposicao manual de MASSA PRONTA (${recipesPrepared} receita(s))`;

      for (const ingredient of ingredientPlan) {
        await tx.inventoryMovement.create({
          data: {
            itemId: ingredient.item.id,
            orderId: data.orderId ?? null,
            type: 'OUT',
            quantity: this.toQty(ingredient.qtyPerRecipe * recipesPrepared),
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
          quantity: recipesPrepared,
          reason: replenishmentReason,
          source: MASS_PREP_SOURCE,
          sourceLabel: MASS_PREP_SOURCE_LABEL
        }
      });

      return {
        ok: true,
        recipesPrepared,
        massReadyItemId: massReadyItem.id,
        consumedIngredients: ingredientPlan.map((ingredient) => ({
          itemId: ingredient.item.id,
          name: ingredient.item.name,
          requiredQty: this.toQty(ingredient.qtyPerRecipe * recipesPrepared),
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

function familyKeyFromDisplayName(value: string) {
  return resolveInventoryFamilyKey(value);
}
