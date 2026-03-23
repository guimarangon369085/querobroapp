import { Injectable, Inject, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service.js';
import { InventoryCategoryEnum, resolveDisplayNumber, StockMovementTypeEnum } from '@querobroapp/shared';
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
import {
  INVENTORY_PRICE_SOURCE_DEFINITIONS,
  fetchInventorySourcePrice
} from './inventory-price-sources.js';

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

const inventoryPriceUpdateSchema = z.object({
  purchasePackCost: nonNegativeNumberInputSchema,
  effectiveAt: z.string().datetime().optional().nullable(),
  sourceName: z.string().trim().min(1).max(120).optional().nullable(),
  sourceUrl: z.string().trim().min(1).max(512).optional().nullable(),
  note: z.string().trim().min(1).max(240).optional().nullable()
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
const MANUAL_MASS_PREP_IDEMPOTENCY_SCOPE = 'INVENTORY_MANUAL_MASS_PREP';

const prepareMassReadySchema = z.object({
  recipes: z.coerce.number().int().positive().max(2),
  orderId: z.coerce.number().int().positive().optional().nullable(),
  reason: z.string().trim().optional().nullable(),
  requestKey: z.string().trim().min(1).max(120).optional().nullable()
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

type InventoryPriceSyncItemResult = {
  id: number;
  name: string;
  purchasePackSize: number;
  previousCost: number;
  nextCost: number;
};

type InventoryPriceSyncSourceResult = {
  canonicalName: string;
  sourceName: string;
  sourceUrl: string;
  sourcePackSize: number;
  sourcePrice: number;
  status: 'UPDATED' | 'FALLBACK' | 'SKIPPED';
  message: string;
  updatedItems: InventoryPriceSyncItemResult[];
};

type PrepareMassReadyResponse = {
  ok: true;
  recipesPrepared: number;
  massReadyItemId: number;
  consumedIngredients: Array<{
    itemId: number;
    name: string;
    requiredQty: number;
    availableQty: number;
    unit: string;
  }>;
};

type InventoryPriceEntryRecord = {
  id: number;
  itemId: number;
  purchasePackSize: number;
  purchasePackCost: number;
  sourceName: string | null;
  sourceUrl: string | null;
  note: string | null;
  effectiveAt: Date;
  createdAt: Date;
};

type InventoryPriceBoardItem = {
  itemId: number;
  name: string;
  category: string;
  unit: string;
  purchasePackSize: number;
  purchasePackCost: number;
  rawItemIds: number[];
  unitCost: number;
  sourceName: string | null;
  sourceUrl: string | null;
  sourcePackSize: number | null;
  livePrice: number | null;
  liveStatus: 'LIVE' | 'FALLBACK' | 'MANUAL' | null;
  liveMessage: string | null;
  firstOrderAt: string | null;
  baselinePackCost: number | null;
  baselineEffectiveAt: string | null;
  priceEntries: Array<{
    id: number;
    itemId: number;
    purchasePackSize: number;
    purchasePackCost: number;
    sourceName: string | null;
    sourceUrl: string | null;
    note: string | null;
    effectiveAt: string;
    createdAt: string;
  }>;
};

type PriceHistoryClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class InventoryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private attachOrderDisplayNumber<
    T extends {
      orderId: number | null;
      order?: {
        id?: number | null;
        publicNumber?: number | null;
      } | null;
    }
  >(movement: T) {
    return {
      ...movement,
      orderDisplayNumber: resolveDisplayNumber(movement.order) ?? movement.orderId ?? null
    };
  }

  private toQty(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.round((value + Number.EPSILON) * 10000) / 10000;
  }

  private roundMoney(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private parsePrepareMassReadyResponse(responseJson: string): PrepareMassReadyResponse {
    try {
      const parsed = JSON.parse(responseJson) as PrepareMassReadyResponse;
      if (
        parsed?.ok === true &&
        typeof parsed.massReadyItemId === 'number' &&
        typeof parsed.recipesPrepared === 'number' &&
        Array.isArray(parsed.consumedIngredients)
      ) {
        return parsed;
      }
    } catch {
      // continua abaixo
    }

    throw new ConflictException('Registro de preparo manual de MASSA PRONTA corrompido.');
  }

  private normalizeInventoryItemName(name: string) {
    const normalized = name.trim();
    return resolveInventoryDefinition(normalized)?.canonicalName || normalized;
  }

  private toUnitCost(purchasePackCost: number, purchasePackSize: number) {
    if (!Number.isFinite(purchasePackCost) || !Number.isFinite(purchasePackSize) || purchasePackSize <= 0) return 0;
    return purchasePackCost / purchasePackSize;
  }

  private buildHistoricalPriceSamples(
    fallbackPrice: number,
    livePrice: number,
    extraSamples: number[] = []
  ) {
    const samples = new Set<number>();
    const push = (value: number | null | undefined) => {
      if (!Number.isFinite(value) || Number(value) <= 0) return;
      samples.add(this.roundMoney(Number(value)));
    };

    push(fallbackPrice);
    push(livePrice);
    for (const sample of extraSamples) push(sample);

    return [...samples.values()];
  }

  private averageHistoricalPrice(samples: number[]) {
    if (samples.length === 0) return 0;
    return this.roundMoney(samples.reduce((sum, value) => sum + value, 0) / samples.length);
  }

  private async firstOrderCreatedAt() {
    const firstOrder = await this.prisma.order.findFirst({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { createdAt: true }
    });
    return firstOrder?.createdAt || null;
  }

  private resolveInventoryFamilyItems(items: InventoryItemLookupEntry[], targetItem: InventoryItemLookupEntry) {
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

    return {
      familyDefinition,
      familyItems,
      representative
    };
  }

  private async createPriceEntryIfChanged(
    client: PriceHistoryClient,
    params: {
      itemId: number;
      purchasePackSize: number;
      purchasePackCost: number;
      effectiveAt: Date;
      sourceName?: string | null;
      sourceUrl?: string | null;
      note?: string | null;
    }
  ) {
    const previous = await client.inventoryPriceEntry.findFirst({
      where: { itemId: params.itemId },
      orderBy: [{ effectiveAt: 'desc' }, { id: 'desc' }]
    });

    if (
      previous &&
      Math.abs((previous.purchasePackCost || 0) - params.purchasePackCost) < 0.01 &&
      Math.abs((previous.purchasePackSize || 0) - params.purchasePackSize) < 0.0001 &&
      previous.effectiveAt.getTime() === params.effectiveAt.getTime() &&
      (previous.sourceName || null) === (params.sourceName || null) &&
      (previous.sourceUrl || null) === (params.sourceUrl || null) &&
      (previous.note || null) === (params.note || null)
    ) {
      return previous;
    }

    return client.inventoryPriceEntry.create({
      data: {
        itemId: params.itemId,
        purchasePackSize: params.purchasePackSize,
        purchasePackCost: params.purchasePackCost,
        sourceName: params.sourceName || null,
        sourceUrl: params.sourceUrl || null,
        note: params.note || null,
        effectiveAt: params.effectiveAt
      }
    });
  }

  private async listPriceEntriesByItemId() {
    const entries = await this.prisma.inventoryPriceEntry.findMany({
      orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }]
    });

    const entriesByItemId = new Map<number, InventoryPriceEntryRecord[]>();
    for (const entry of entries) {
      const current = entriesByItemId.get(entry.itemId) || [];
      current.push(entry);
      entriesByItemId.set(entry.itemId, current);
    }
    return entriesByItemId;
  }

  private buildInventoryPriceBoardPayload(params: {
    items: InventoryItemLookupEntry[];
    entriesByItemId: Map<number, InventoryPriceEntryRecord[]>;
    firstOrderAt: Date | null;
  }) {
    const { items, entriesByItemId, firstOrderAt } = params;
    const groupedByFamily = new Map<string, InventoryItemLookupEntry[]>();

    for (const item of items) {
      const familyKey = resolveInventoryFamilyKey(item.name);
      const current = groupedByFamily.get(familyKey) || [];
      current.push(item);
      groupedByFamily.set(familyKey, current);
    }

    const rawBoardItems = Array.from(groupedByFamily.values())
      .map((familyItems) => {
        const definition = resolveInventoryDefinition(familyItems[0]?.name || null);
        const representative =
          pickInventoryFamilyRepresentative(
            familyItems,
            definition?.canonicalName || familyItems[0]?.name || ''
          ) || familyItems[0];
        if (!representative) return null;

        const priceEntries = familyItems
          .flatMap((item) => entriesByItemId.get(item.id) || [])
          .sort(
            (left, right) =>
              left.effectiveAt.getTime() - right.effectiveAt.getTime() ||
              left.id - right.id
          );
        const latestEntry = priceEntries[priceEntries.length - 1] || null;
        const baselineEntry =
          (firstOrderAt
            ? [...priceEntries]
                .reverse()
                .find((entry) => entry.effectiveAt.getTime() <= firstOrderAt.getTime()) || priceEntries[0]
            : priceEntries[0]) || null;
        const sourceDefinition = definition
          ? INVENTORY_PRICE_SOURCE_DEFINITIONS.find(
              (entry) => resolveInventoryFamilyKey(entry.canonicalName) === resolveInventoryFamilyKey(definition.canonicalName)
            )
          : null;

        const liveStatus: InventoryPriceBoardItem['liveStatus'] = sourceDefinition ? 'MANUAL' : null;
        const boardItem: InventoryPriceBoardItem = {
          itemId: representative.id,
          name: definition?.canonicalName || representative.name,
          category: definition?.category || representative.category,
          unit: definition?.unit || representative.unit,
          purchasePackSize: representative.purchasePackSize,
          purchasePackCost: representative.purchasePackCost,
          rawItemIds: familyItems.map((item) => item.id).sort((left, right) => left - right),
          unitCost: this.roundMoney(this.toUnitCost(representative.purchasePackCost, representative.purchasePackSize)),
          sourceName: latestEntry?.sourceName || sourceDefinition?.sourceName || null,
          sourceUrl: latestEntry?.sourceUrl || sourceDefinition?.url || null,
          sourcePackSize: sourceDefinition?.sourcePackSize || latestEntry?.purchasePackSize || representative.purchasePackSize,
          livePrice: sourceDefinition?.fallbackPrice || null,
          liveStatus,
          liveMessage: sourceDefinition ? 'Referencia cadastrada para consulta online e baseline.' : null,
          firstOrderAt: firstOrderAt?.toISOString() || null,
          baselinePackCost: baselineEntry?.purchasePackCost || null,
          baselineEffectiveAt: baselineEntry?.effectiveAt.toISOString() || null,
          priceEntries: priceEntries.map((entry) => ({
            id: entry.id,
            itemId: entry.itemId,
            purchasePackSize: entry.purchasePackSize,
            purchasePackCost: entry.purchasePackCost,
            sourceName: entry.sourceName || null,
            sourceUrl: entry.sourceUrl || null,
            note: entry.note || null,
            effectiveAt: entry.effectiveAt.toISOString(),
            createdAt: entry.createdAt.toISOString()
          }))
        };

        return boardItem;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const boardItems: InventoryPriceBoardItem[] = rawBoardItems
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));

    return {
      generatedAt: new Date().toISOString(),
      firstOrderAt: firstOrderAt?.toISOString() || null,
      items: boardItems
    };
  }

  private async ensureCanonicalInventoryItemUniqueness(params: {
    id?: number;
    name: string;
    category: string;
    unit: string;
  }) {
    const canonicalName = this.normalizeInventoryItemName(params.name);
    const duplicate = await this.prisma.inventoryItem.findFirst({
      where: {
        ...(typeof params.id === 'number' ? { id: { not: params.id } } : {}),
        name: canonicalName,
        category: params.category,
        unit: params.unit
      },
      orderBy: { id: 'asc' }
    });

    if (duplicate) {
      throw new ConflictException(`Item oficial ${canonicalName} ja existe. Use o cadastro existente.`);
    }

    return canonicalName;
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

  async listPriceBoard() {
    const [items, entriesByItemId, firstOrderAt] = await Promise.all([
      this.prisma.inventoryItem.findMany({ orderBy: { id: 'asc' } }),
      this.listPriceEntriesByItemId(),
      this.firstOrderCreatedAt()
    ]);

    return this.buildInventoryPriceBoardPayload({
      items,
      entriesByItemId,
      firstOrderAt
    });
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

  async createItem(payload: unknown) {
    const data = parseWithSchema(inventoryItemCreateSchema, payload);
    const canonicalName = await this.ensureCanonicalInventoryItemUniqueness({
      name: data.name,
      category: data.category,
      unit: data.unit
    });

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.inventoryItem.create({
        data: {
          ...data,
          name: canonicalName
        }
      });
      await this.createPriceEntryIfChanged(tx, {
        itemId: created.id,
        purchasePackSize: created.purchasePackSize,
        purchasePackCost: this.roundMoney(created.purchasePackCost || 0),
        effectiveAt: created.createdAt,
        note: 'Cadastro inicial do item.'
      });
      return created;
    });
  }

  async updateItem(id: number, payload: unknown) {
    const item = await this.prisma.inventoryItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Item nao encontrado');

    const data = parseWithSchema(inventoryItemUpdateSchema, payload);
    const nextCategory = data.category ?? item.category;
    const nextUnit = data.unit ?? item.unit;
    const nextName = data.name ?? item.name;
    const canonicalName = await this.ensureCanonicalInventoryItemUniqueness({
      id,
      name: nextName,
      category: nextCategory,
      unit: nextUnit
    });

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inventoryItem.update({
        where: { id },
        data: {
          ...data,
          ...(data.name !== undefined ? { name: canonicalName } : {})
        }
      });

      const priceTouched =
        data.purchasePackCost !== undefined || data.purchasePackSize !== undefined;
      if (priceTouched) {
        await this.createPriceEntryIfChanged(tx, {
          itemId: updated.id,
          purchasePackSize: updated.purchasePackSize,
          purchasePackCost: this.roundMoney(updated.purchasePackCost || 0),
          effectiveAt: new Date(),
          note: 'Ajuste manual em Estoque.'
        });
      }

      return updated;
    });
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
      include: {
        item: true,
        order: {
          select: {
            id: true,
            publicNumber: true
          }
        }
      },
      orderBy: { id: 'desc' }
    }).then((movements) => movements.map((movement) => this.attachOrderDisplayNumber(movement)));
  }

  async refreshPurchaseCosts() {
    const items = await this.prisma.inventoryItem.findMany({
      orderBy: [{ id: 'asc' }]
    });

    const results: InventoryPriceSyncSourceResult[] = [];

    for (const definition of INVENTORY_PRICE_SOURCE_DEFINITIONS) {
      const familyKey = resolveInventoryFamilyKey(definition.canonicalName);
      const matchingItems = items.filter((item) => resolveInventoryFamilyKey(item.name) === familyKey);

      if (matchingItems.length === 0) {
        results.push({
          canonicalName: definition.canonicalName,
          sourceName: definition.sourceName,
          sourceUrl: definition.url,
          sourcePackSize: definition.sourcePackSize,
          sourcePrice: definition.fallbackPrice,
          status: 'SKIPPED',
          message: 'Nenhum item correspondente foi encontrado no estoque.',
          updatedItems: []
        });
        continue;
      }

      const fetched = await fetchInventorySourcePrice(definition);
      const sourceUnitCost = fetched.price / definition.sourcePackSize;
      const updatedItems: InventoryPriceSyncItemResult[] = [];

      for (const item of matchingItems) {
        const nextCost = this.roundMoney(sourceUnitCost * item.purchasePackSize);
        if (Math.abs((item.purchasePackCost || 0) - nextCost) >= 0.01) {
          await this.prisma.inventoryItem.update({
            where: { id: item.id },
            data: { purchasePackCost: nextCost }
          });
        }
        await this.createPriceEntryIfChanged(this.prisma, {
          itemId: item.id,
          purchasePackSize: item.purchasePackSize,
          purchasePackCost: nextCost,
          effectiveAt: new Date(),
          sourceName: fetched.sourceName,
          sourceUrl: fetched.sourceUrl,
          note: fetched.status === 'LIVE' ? 'Atualizacao online do estoque.' : fetched.message
        });

        updatedItems.push({
          id: item.id,
          name: item.name,
          purchasePackSize: item.purchasePackSize,
          previousCost: this.roundMoney(item.purchasePackCost || 0),
          nextCost
        });
      }

      results.push({
        canonicalName: definition.canonicalName,
        sourceName: fetched.sourceName,
        sourceUrl: fetched.sourceUrl,
        sourcePackSize: fetched.sourcePackSize,
        sourcePrice: fetched.price,
        status: fetched.status === 'LIVE' ? 'UPDATED' : 'FALLBACK',
        message: fetched.message,
        updatedItems
      });
    }

    const updatedItemCount = results.reduce((sum, entry) => sum + entry.updatedItems.length, 0);
    const updatedSourceCount = results.filter((entry) => entry.status === 'UPDATED').length;
    const fallbackSourceCount = results.filter((entry) => entry.status === 'FALLBACK').length;
    const skippedSourceCount = results.filter((entry) => entry.status === 'SKIPPED').length;

    return {
      updatedAt: new Date().toISOString(),
      totals: {
        sources: results.length,
        updatedSourceCount,
        fallbackSourceCount,
        skippedSourceCount,
        updatedItemCount
      },
      results
    };
  }

  async updatePurchasePrice(id: number, payload: unknown) {
    const data = parseWithSchema(inventoryPriceUpdateSchema, payload ?? {});

    return this.prisma.$transaction(async (tx) => {
      const items = await tx.inventoryItem.findMany({ orderBy: { id: 'asc' } });
      const targetItem = items.find((item) => item.id === id);
      if (!targetItem) throw new NotFoundException('Item nao encontrado');

      const { familyItems, representative } = this.resolveInventoryFamilyItems(items, targetItem);
      const referencePackSize = representative.purchasePackSize;
      if (!referencePackSize || referencePackSize <= 0) {
        throw new BadRequestException('Item sem unidade de compra valida para atualizar preco.');
      }

      const nextUnitCost = data.purchasePackCost / referencePackSize;
      const effectiveAt = data.effectiveAt ? new Date(data.effectiveAt) : new Date();

      const updatedItems = [];
      for (const item of familyItems) {
        const nextCost = this.roundMoney(nextUnitCost * item.purchasePackSize);
        const updated = await tx.inventoryItem.update({
          where: { id: item.id },
          data: { purchasePackCost: nextCost }
        });
        await this.createPriceEntryIfChanged(tx, {
          itemId: item.id,
          purchasePackSize: updated.purchasePackSize,
          purchasePackCost: nextCost,
          effectiveAt,
          sourceName: data.sourceName || 'Manual',
          sourceUrl: data.sourceUrl || null,
          note: data.note || 'Ajuste manual no bloco de Precos.'
        });
        updatedItems.push(updated);
      }

      return {
        ok: true,
        itemId: representative.id,
        rawItemIds: updatedItems.map((item) => item.id),
        purchasePackSize: referencePackSize,
        purchasePackCost: this.roundMoney(data.purchasePackCost),
        effectiveAt: effectiveAt.toISOString()
      };
    });
  }

  async applyResearchPriceBaseline() {
    const firstOrderAt = await this.firstOrderCreatedAt();
    if (!firstOrderAt) {
      throw new BadRequestException('Ainda nao existe pedido para definir a base historica de precos.');
    }

    const items = await this.prisma.inventoryItem.findMany({ orderBy: { id: 'asc' } });
    const results: Array<{
      canonicalName: string;
      sourceName: string;
      sourceUrl: string;
      livePrice: number;
      historicalAveragePrice: number;
      sourcePackSize: number;
      status: 'UPDATED' | 'SKIPPED';
      message: string;
      updatedItemIds: number[];
    }> = [];

    for (const definition of INVENTORY_PRICE_SOURCE_DEFINITIONS) {
      const familyKey = resolveInventoryFamilyKey(definition.canonicalName);
      const matchingItems = items.filter((item) => resolveInventoryFamilyKey(item.name) === familyKey);
      if (matchingItems.length === 0) {
        results.push({
          canonicalName: definition.canonicalName,
          sourceName: definition.sourceName,
          sourceUrl: definition.url,
          livePrice: definition.fallbackPrice,
          historicalAveragePrice: definition.fallbackPrice,
          sourcePackSize: definition.sourcePackSize,
          status: 'SKIPPED',
          message: 'Nenhum item correspondente foi encontrado no estoque.',
          updatedItemIds: []
        });
        continue;
      }

      const fetched = await fetchInventorySourcePrice(definition);
      const historicalSamples = this.buildHistoricalPriceSamples(
        definition.fallbackPrice,
        fetched.price,
        definition.historicalSamplePrices || []
      );
      const historicalAveragePrice = this.averageHistoricalPrice(historicalSamples) || fetched.price;

      await this.prisma.$transaction(async (tx) => {
        for (const item of matchingItems) {
          const baselinePackCost = this.roundMoney(
            this.toUnitCost(historicalAveragePrice, definition.sourcePackSize) * item.purchasePackSize
          );
          const currentPackCost = this.roundMoney(
            this.toUnitCost(fetched.price, definition.sourcePackSize) * item.purchasePackSize
          );

          const existingEntries = await tx.inventoryPriceEntry.findMany({
            where: { itemId: item.id },
            orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }]
          });
          const hasBaselineEntry = existingEntries.some(
            (entry) => entry.effectiveAt.getTime() <= firstOrderAt.getTime()
          );

          if (!hasBaselineEntry) {
            await this.createPriceEntryIfChanged(tx, {
              itemId: item.id,
              purchasePackSize: item.purchasePackSize,
              purchasePackCost: baselinePackCost,
              effectiveAt: firstOrderAt,
              sourceName: definition.sourceName,
              sourceUrl: definition.url,
              note: `Baseline media aplicada desde o primeiro pedido (${historicalSamples.length} amostra(s)).`
            });
          }

          await tx.inventoryItem.update({
            where: { id: item.id },
            data: { purchasePackCost: currentPackCost }
          });

          await this.createPriceEntryIfChanged(tx, {
            itemId: item.id,
            purchasePackSize: item.purchasePackSize,
            purchasePackCost: currentPackCost,
            effectiveAt: new Date(),
            sourceName: fetched.sourceName,
            sourceUrl: fetched.sourceUrl,
            note:
              fetched.status === 'LIVE'
                ? 'Preco atual pesquisado online.'
                : `Preco atual aplicado via fallback. ${fetched.message}`
          });
        }
      });

      results.push({
        canonicalName: definition.canonicalName,
        sourceName: fetched.sourceName,
        sourceUrl: fetched.sourceUrl,
        livePrice: this.roundMoney(fetched.price),
        historicalAveragePrice: this.roundMoney(historicalAveragePrice),
        sourcePackSize: definition.sourcePackSize,
        status: 'UPDATED',
        message:
          fetched.status === 'LIVE'
            ? `Baseline medio + preco atual aplicados a partir de ${historicalSamples.length} amostra(s).`
            : `Fonte online indisponivel; baseline e preco atual ficaram no fallback/medio. ${fetched.message}`,
        updatedItemIds: matchingItems.map((item) => item.id)
      });
    }

    return {
      appliedAt: new Date().toISOString(),
      firstOrderAt: firstOrderAt.toISOString(),
      results
    };
  }

  async createMovement(payload: unknown) {
    const data = parseWithSchema(inventoryMovementCreateSchema, payload);

    const item = await this.prisma.inventoryItem.findUnique({ where: { id: data.itemId } });
    if (!item) throw new NotFoundException('Item nao encontrado');

    if (data.orderId) {
      const order = await this.prisma.order.findUnique({ where: { id: data.orderId } });
      if (!order) throw new NotFoundException('Pedido nao encontrado');
    }

    return this.prisma.inventoryMovement
      .create({
        data,
        include: {
          item: true,
          order: {
            select: {
              id: true,
              publicNumber: true
            }
          }
        }
      })
      .then((movement) => this.attachOrderDisplayNumber(movement));
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
      const adjustments = familyItems
        .map((item) => {
          const currentBalance = this.toQty(balanceByItem.get(item.id) || 0);
          const targetBalance = item.id === representative.id ? desiredEffectiveBalance : 0;
          return {
            itemId: item.id,
            currentBalance,
            targetBalance
          };
        })
        .filter(
          (entry) => Math.abs(this.toQty(entry.currentBalance - entry.targetBalance)) >= 0.0001
        );

      if (adjustments.length === 0) {
        return {
          ok: true,
          itemId: representative.id,
          effectiveBalance: currentEffectiveBalance,
          appliedType: 'NONE',
          appliedQuantity: 0
        };
      }

      const adjustmentReason =
        data.reason?.trim() ||
        `Ajuste efetivo via Estoque (${familyDefinition?.canonicalName || representative.name})`;

      for (const adjustment of adjustments) {
        await tx.inventoryMovement.create({
          data: {
            itemId: adjustment.itemId,
            type: 'ADJUST',
            quantity: adjustment.targetBalance,
            reason: adjustmentReason
          }
        });
      }

      return {
        ok: true,
        itemId: representative.id,
        effectiveBalance: desiredEffectiveBalance,
        appliedType: 'ADJUST',
        appliedQuantity: desiredEffectiveBalance
      };
    });
  }

  async prepareMassReady(payload: unknown) {
    const data = parseWithSchema(prepareMassReadySchema, payload ?? {});
    const requestKey = data.requestKey?.trim() || null;
    const requestHash = JSON.stringify({
      recipes: data.recipes,
      orderId: data.orderId ?? null,
      reason: data.reason?.trim() || null
    });

    if (requestKey) {
      const existing = await this.prisma.idempotencyRecord.findUnique({
        where: {
          scope_idemKey: {
            scope: MANUAL_MASS_PREP_IDEMPOTENCY_SCOPE,
            idemKey: requestKey
          }
        }
      });

      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new BadRequestException(
            'Chave de preparo manual ja foi usada com outro payload.'
          );
        }
        return this.parsePrepareMassReadyResponse(existing.responseJson);
      }
    }

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

      const response: PrepareMassReadyResponse = {
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

      if (requestKey) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        await tx.idempotencyRecord.upsert({
          where: {
            scope_idemKey: {
              scope: MANUAL_MASS_PREP_IDEMPOTENCY_SCOPE,
              idemKey: requestKey
            }
          },
          update: {
            requestHash,
            responseJson: JSON.stringify(response),
            expiresAt
          },
          create: {
            scope: MANUAL_MASS_PREP_IDEMPOTENCY_SCOPE,
            idemKey: requestKey,
            requestHash,
            responseJson: JSON.stringify(response),
            expiresAt
          }
        });
      }

      return response;
    });
  }

  async removeMovement(id: number) {
    const movement = await this.prisma.inventoryMovement.findUnique({ where: { id } });
    if (!movement) throw new NotFoundException('Movimentacao nao encontrada');
    await this.prisma.inventoryMovement.delete({ where: { id } });
  }

  async clearAllMovements() {
    const inventoryResult = await this.prisma.inventoryMovement.deleteMany({});

    return {
      inventoryMovementsDeleted: inventoryResult.count,
      stockMovementsDeleted: 0,
      totalDeleted: inventoryResult.count
    };
  }
}

function familyKeyFromDisplayName(value: string) {
  return resolveInventoryFamilyKey(value);
}
