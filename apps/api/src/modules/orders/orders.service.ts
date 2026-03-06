import { BadRequestException, Injectable, NotFoundException, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service.js';
import { OrderItemSchema, OrderSchema, OrderStatusEnum } from '@querobroapp/shared';
import { z } from 'zod';

const updateSchema = OrderSchema.partial().omit({ id: true, createdAt: true, items: true });
const replaceItemsSchema = z.object({
  items: z.array(OrderItemSchema.pick({ productId: true, quantity: true })).min(1)
});
const markPaidSchema = z.object({
  method: z.string().trim().min(1).optional(),
  paidAt: z.string().datetime().optional().nullable()
});

const statusTransitions: Record<string, string[]> = {
  ABERTO: ['CONFIRMADO', 'CANCELADO'],
  CONFIRMADO: ['ABERTO', 'EM_PREPARACAO', 'CANCELADO'],
  EM_PREPARACAO: ['CONFIRMADO', 'PRONTO', 'CANCELADO'],
  PRONTO: ['EM_PREPARACAO', 'ENTREGUE', 'CANCELADO'],
  ENTREGUE: ['PRONTO', 'CANCELADO'],
  CANCELADO: []
};

const MASS_PREP_EVENT_SCOPE = 'MASS_PREP_EVENT';
const MASS_PREP_EVENT_NAME = 'FAZER MASSA';
const MASS_PREP_EVENT_DURATION_MINUTES = 60;
const MASS_READY_ITEM_NAME = 'MASSA PRONTA';
const MASS_READY_BROAS_PER_RECIPE = 28;
const ORDER_BOX_UNITS = 7;
const FILLING_GRAMS_PER_BROA = 5;
const ORDER_BOX_PRICE_CUSTOM = 52;
const ORDER_BOX_PRICE_TRADITIONAL = 40;
const ORDER_BOX_PRICE_MIXED_GOIABADA = 45;
const ORDER_BOX_PRICE_MIXED_OTHER = 47;
const ORDER_BOX_PRICE_GOIABADA = 50;
const MASS_PREP_SOURCE = 'MASS_PREP';
const MASS_PREP_SOURCE_LABEL_PREFIX = 'ORDER_';
const ORDER_FORMULA_SOURCE_MASS_READY = 'MASS_READY';
const ORDER_FORMULA_SOURCE_FILLING = 'ORDER_FILLING';
const ORDER_FORMULA_SOURCES = [ORDER_FORMULA_SOURCE_MASS_READY, ORDER_FORMULA_SOURCE_FILLING] as const;

const massPrepEventStatusSchema = z.enum(['INGREDIENTES', 'PREPARO', 'PRONTA']);
const massPrepEventStatusTransitions: Record<z.infer<typeof massPrepEventStatusSchema>, z.infer<typeof massPrepEventStatusSchema>[]> = {
  INGREDIENTES: ['PREPARO'],
  PREPARO: ['PRONTA'],
  PRONTA: []
};

const massPrepEventSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  eventName: z.literal(MASS_PREP_EVENT_NAME),
  orderId: z.number().int().positive(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  durationMinutes: z.number().int().positive(),
  massRecipes: z.number().int().positive(),
  status: massPrepEventStatusSchema.default('INGREDIENTES'),
  createdAt: z.string().datetime()
});

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

const orderFillingIngredientsByFlavorCode = {
  G: {
    canonicalName: 'GOIABADA',
    aliases: ['GOIABADA'],
    unit: 'g',
    purchasePackSize: 1000,
    purchasePackCost: 19
  },
  D: {
    canonicalName: 'DOCE DE LEITE',
    aliases: ['DOCE DE LEITE'],
    unit: 'g',
    purchasePackSize: 1000,
    purchasePackCost: 24
  },
  Q: {
    canonicalName: 'QUEIJO',
    aliases: ['QUEIJO'],
    unit: 'g',
    purchasePackSize: 1000,
    purchasePackCost: 35
  },
  R: {
    canonicalName: 'REQUEIJAO DE CORTE',
    aliases: ['REQUEIJAO DE CORTE', 'REQUEIJÃO DE CORTE'],
    unit: 'g',
    purchasePackSize: 1000,
    purchasePackCost: 38
  }
} as const;

const massPrepEventStatusPayloadSchema = z.object({
  status: massPrepEventStatusSchema
});

type OrderWithRelations = Prisma.OrderGetPayload<{
  include: { items: true; customer: true; payments: true };
}>;
type TransactionClient = Prisma.TransactionClient;

type MassPrepEvent = z.infer<typeof massPrepEventSchema>;
type OrderFlavorCode = 'T' | 'G' | 'D' | 'Q' | 'R';
type FillingFlavorCode = Exclude<OrderFlavorCode, 'T'>;
type InventoryLookupItem = {
  id: number;
  name: string;
  category: string;
  unit: string;
  purchasePackSize: number;
  purchasePackCost: number;
  createdAt: Date;
};

@Injectable()
export class OrdersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private toMoney(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private toUnitPrice(value: number | null | undefined) {
    const parsed = Number(value ?? 0);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
  }

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

  private massPrepEventIdemKey(orderId: number) {
    return `ORDER_${orderId}`;
  }

  private buildInventoryItemLookup(
    items: Array<{
      id: number;
      name: string;
      category: string;
      unit: string;
      purchasePackSize: number;
      purchasePackCost: number;
      createdAt: Date;
    }>
  ) {
    const byName = new Map<string, (typeof items)[number]>();
    for (const item of items) {
      byName.set(this.normalizeLookup(item.name), item);
    }
    return byName;
  }

  private findInventoryByAliases(
    byName: Map<string, {
      id: number;
      name: string;
      category: string;
      unit: string;
      purchasePackSize: number;
      purchasePackCost: number;
      createdAt: Date;
    }>,
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

  private massPrepEventDate(order: Pick<OrderWithRelations, 'scheduledAt' | 'createdAt'>) {
    return order.scheduledAt ? new Date(order.scheduledAt) : new Date(order.createdAt);
  }

  private async saveMassPrepEvent(tx: TransactionClient, event: MassPrepEvent) {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 10);
    const idemKey = this.massPrepEventIdemKey(event.orderId);

    await tx.idempotencyRecord.upsert({
      where: {
        scope_idemKey: {
          scope: MASS_PREP_EVENT_SCOPE,
          idemKey
        }
      },
      update: {
        requestHash: event.id,
        responseJson: JSON.stringify(event),
        expiresAt
      },
      create: {
        scope: MASS_PREP_EVENT_SCOPE,
        idemKey,
        requestHash: event.id,
        responseJson: JSON.stringify(event),
        expiresAt
      }
    });
  }

  private parseMassPrepEvent(raw: string): MassPrepEvent | null {
    try {
      return massPrepEventSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private orderFormulaSourceLabel(orderId: number) {
    return `${MASS_PREP_SOURCE_LABEL_PREFIX}${orderId}`;
  }

  private resolveOrderFlavorCodeFromProductName(value?: string | null): OrderFlavorCode | null {
    const normalized = (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
    if (!normalized) return null;
    if (normalized.includes('tradicional')) return 'T';
    if (normalized.includes('goiabada')) return 'G';
    if (normalized.includes('doce')) return 'D';
    if (normalized.includes('queijo') && !normalized.includes('requeij')) return 'Q';
    if (normalized.includes('requeij')) return 'R';
    return null;
  }

  private orderBroasFromItems(items: Array<{ quantity: number }>) {
    return items.reduce((sum, item) => sum + Math.max(Math.floor(item.quantity || 0), 0), 0);
  }

  private buildFlavorSummaryFromItems(
    items: Array<{ productId: number; quantity: number }>,
    productNameById: Map<number, string>
  ) {
    const flavorCounts: Record<OrderFlavorCode, number> = {
      T: 0,
      G: 0,
      D: 0,
      Q: 0,
      R: 0
    };
    let totalUnits = 0;

    for (const item of items) {
      const quantity = Math.max(Math.floor(item.quantity || 0), 0);
      if (quantity <= 0) continue;
      totalUnits += quantity;
      const flavorCode = this.resolveOrderFlavorCodeFromProductName(productNameById.get(item.productId));
      if (!flavorCode) continue;
      flavorCounts[flavorCode] += quantity;
    }

    return { totalUnits, flavorCounts };
  }

  private calculateSubtotalFromFlavorSummary(params: {
    totalUnits: number;
    flavorCounts: Record<OrderFlavorCode, number>;
  }) {
    const { totalUnits, flavorCounts } = params;
    if (totalUnits <= 0) return 0;

    const fullBoxes = Math.floor(totalUnits / ORDER_BOX_UNITS);
    const openUnits = totalUnits % ORDER_BOX_UNITS;
    if (fullBoxes <= 0) {
      return this.toMoney((ORDER_BOX_PRICE_CUSTOM / ORDER_BOX_UNITS) * openUnits);
    }

    const countTraditional = Math.max(Math.floor(flavorCounts.T || 0), 0);
    const countGoiabada = Math.max(Math.floor(flavorCounts.G || 0), 0);
    const countDoce = Math.max(Math.floor(flavorCounts.D || 0), 0);
    const countQueijo = Math.max(Math.floor(flavorCounts.Q || 0), 0);
    const countRequeijao = Math.max(Math.floor(flavorCounts.R || 0), 0);

    const goiabadaTriplets = Math.floor(countGoiabada / 3);
    const otherTriplets =
      Math.floor(countDoce / 3) +
      Math.floor(countQueijo / 3) +
      Math.floor(countRequeijao / 3);

    const discountTraditional = ORDER_BOX_PRICE_CUSTOM - ORDER_BOX_PRICE_TRADITIONAL;
    const discountMixedGoiabada = ORDER_BOX_PRICE_CUSTOM - ORDER_BOX_PRICE_MIXED_GOIABADA;
    const discountMixedOther = ORDER_BOX_PRICE_CUSTOM - ORDER_BOX_PRICE_MIXED_OTHER;
    const discountGoiabada = ORDER_BOX_PRICE_CUSTOM - ORDER_BOX_PRICE_GOIABADA;

    let bestDiscount = 0;

    const maxMixedGoiabada = Math.min(
      goiabadaTriplets,
      Math.floor(countTraditional / 4),
      fullBoxes
    );
    for (let mixedGoiabada = 0; mixedGoiabada <= maxMixedGoiabada; mixedGoiabada += 1) {
      const remainingTraditionalAfterMixedGoiabada = countTraditional - mixedGoiabada * 4;
      const maxMixedOther = Math.min(
        otherTriplets,
        Math.floor(remainingTraditionalAfterMixedGoiabada / 4),
        fullBoxes - mixedGoiabada
      );

      for (let mixedOther = 0; mixedOther <= maxMixedOther; mixedOther += 1) {
        const remainingTraditional = remainingTraditionalAfterMixedGoiabada - mixedOther * 4;
        const maxTraditionalBoxes = Math.min(
          Math.floor(remainingTraditional / ORDER_BOX_UNITS),
          fullBoxes - mixedGoiabada - mixedOther
        );

        for (let traditionalBoxes = 0; traditionalBoxes <= maxTraditionalBoxes; traditionalBoxes += 1) {
          const usedBoxes = mixedGoiabada + mixedOther + traditionalBoxes;
          const remainingBoxSlots = fullBoxes - usedBoxes;
          const remainingGoiabada = countGoiabada - mixedGoiabada * 3;
          const goiabadaBoxes = Math.min(
            Math.floor(remainingGoiabada / ORDER_BOX_UNITS),
            remainingBoxSlots
          );

          const discount =
            mixedGoiabada * discountMixedGoiabada +
            mixedOther * discountMixedOther +
            traditionalBoxes * discountTraditional +
            goiabadaBoxes * discountGoiabada;

          if (discount > bestDiscount) {
            bestDiscount = discount;
          }
        }
      }
    }

    const fullBoxesSubtotal = fullBoxes * ORDER_BOX_PRICE_CUSTOM - bestDiscount;
    const openBoxSubtotal =
      openUnits > 0 ? this.toMoney((ORDER_BOX_PRICE_CUSTOM / ORDER_BOX_UNITS) * openUnits) : 0;

    return this.toMoney(fullBoxesSubtotal + openBoxSubtotal);
  }

  private async calculateOrderSubtotalFromItems(
    tx: TransactionClient,
    items: Array<{ productId: number; quantity: number }>
  ) {
    if (items.length <= 0) return 0;
    const productIds = Array.from(new Set(items.map((item) => item.productId)));
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true }
    });
    const productNameById = new Map(products.map((product) => [product.id, product.name]));
    const summary = this.buildFlavorSummaryFromItems(items, productNameById);
    return this.calculateSubtotalFromFlavorSummary(summary);
  }

  private async ensureInventoryItemByAliases(
    tx: TransactionClient,
    inventoryByLookup: Map<string, InventoryLookupItem>,
    params: {
      canonicalName: string;
      aliases: readonly string[];
      unit: string;
      purchasePackSize: number;
      purchasePackCost: number;
    }
  ) {
    const found = this.findInventoryByAliases(inventoryByLookup, params.aliases);
    if (found) return found;

    const created = await tx.inventoryItem.create({
      data: {
        name: params.canonicalName,
        category: 'INGREDIENTE',
        unit: params.unit,
        purchasePackSize: params.purchasePackSize,
        purchasePackCost: params.purchasePackCost
      }
    });
    inventoryByLookup.set(this.normalizeLookup(created.name), created);
    return created;
  }

  private async loadInventoryBalance(
    tx: TransactionClient,
    itemId: number,
    where?: Prisma.InventoryMovementWhereInput
  ) {
    const movements = await tx.inventoryMovement.findMany({
      where: {
        itemId,
        ...(where || {})
      },
      select: { type: true, quantity: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    return this.inventoryBalanceFromMovements(movements);
  }

  private async getMassPrepEventRecord(tx: TransactionClient, orderId: number) {
    return tx.idempotencyRecord.findUnique({
      where: {
        scope_idemKey: {
          scope: MASS_PREP_EVENT_SCOPE,
          idemKey: this.massPrepEventIdemKey(orderId)
        }
      }
    });
  }

  private async getMassPrepEvent(tx: TransactionClient, orderId: number) {
    const record = await this.getMassPrepEventRecord(tx, orderId);
    if (!record) return null;
    return this.parseMassPrepEvent(record.responseJson);
  }

  private async resolveOrderFillingBroasByFlavorCode(
    tx: TransactionClient,
    items: Array<{ productId: number; quantity: number }>
  ) {
    const byFlavorCode: Record<FillingFlavorCode, number> = { G: 0, D: 0, Q: 0, R: 0 };
    if (items.length === 0) return byFlavorCode;

    const productIds = Array.from(new Set(items.map((item) => item.productId)));
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true }
    });
    const productById = new Map(products.map((product) => [product.id, product]));

    for (const item of items) {
      const quantity = Math.max(Math.floor(item.quantity || 0), 0);
      if (quantity <= 0) continue;
      const flavorCode = this.resolveOrderFlavorCodeFromProductName(
        productById.get(item.productId)?.name
      );
      if (!flavorCode || flavorCode === 'T') continue;
      byFlavorCode[flavorCode] += quantity;
    }

    return byFlavorCode;
  }

  private async syncOrderFormulaInventory(
    tx: TransactionClient,
    order: Pick<OrderWithRelations, 'id' | 'items'>
  ) {
    const inventoryItems = await tx.inventoryItem.findMany({ orderBy: { id: 'asc' } });
    const inventoryByLookup = this.buildInventoryItemLookup(inventoryItems);
    const sourceLabel = this.orderFormulaSourceLabel(order.id);

    const massReadyItem = await this.ensureInventoryItemByAliases(tx, inventoryByLookup, {
      canonicalName: MASS_READY_ITEM_NAME,
      aliases: [MASS_READY_ITEM_NAME],
      unit: 'receita',
      purchasePackSize: 1,
      purchasePackCost: 0
    });

    const totalBroas = this.orderBroasFromItems(order.items || []);
    const massReadyRecipes = this.toQty(totalBroas / MASS_READY_BROAS_PER_RECIPE);
    const fillingBroasByCode = await this.resolveOrderFillingBroasByFlavorCode(tx, order.items || []);

    await tx.inventoryMovement.deleteMany({
      where: {
        orderId: order.id,
        source: { in: [...ORDER_FORMULA_SOURCES] }
      }
    });

    if (massReadyRecipes > 0) {
      await tx.inventoryMovement.create({
        data: {
          itemId: massReadyItem.id,
          orderId: order.id,
          type: 'OUT',
          quantity: massReadyRecipes,
          reason: `Consumo de MASSA PRONTA por pedido (${totalBroas} broa(s))`,
          source: ORDER_FORMULA_SOURCE_MASS_READY,
          sourceLabel
        }
      });
    }

    for (const [code, broasQty] of Object.entries(fillingBroasByCode) as Array<[FillingFlavorCode, number]>) {
      const definition = orderFillingIngredientsByFlavorCode[code];
      const fillingQty = this.toQty(Math.max(broasQty, 0) * FILLING_GRAMS_PER_BROA);
      if (fillingQty <= 0) continue;

      const item = await this.ensureInventoryItemByAliases(tx, inventoryByLookup, {
        canonicalName: definition.canonicalName,
        aliases: definition.aliases,
        unit: definition.unit,
        purchasePackSize: definition.purchasePackSize,
        purchasePackCost: definition.purchasePackCost
      });

      await tx.inventoryMovement.create({
        data: {
          itemId: item.id,
          orderId: order.id,
          type: 'OUT',
          quantity: fillingQty,
          reason: `Consumo de recheio por pedido (${definition.canonicalName})`,
          source: ORDER_FORMULA_SOURCE_FILLING,
          sourceLabel
        }
      });
    }

    return {
      massReadyItem,
      requiredMassRecipes: massReadyRecipes
    };
  }

  private async syncMassPrepEventForOrder(
    tx: TransactionClient,
    order: Pick<OrderWithRelations, 'id' | 'scheduledAt' | 'createdAt'>,
    massReadyItemId: number,
    requiredMassRecipes: number
  ) {
    const existingEvent = await this.getMassPrepEvent(tx, order.id);
    const orderReferenceDate = this.massPrepEventDate(order);
    const startsAt = new Date(orderReferenceDate.getTime() - MASS_PREP_EVENT_DURATION_MINUTES * 60_000);
    const endsAt = new Date(orderReferenceDate);

    const massReadyMovements = await tx.inventoryMovement.findMany({
      where: { itemId: massReadyItemId },
      select: { type: true, quantity: true, orderId: true, source: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    const availableMassReadyExcludingOrderFormula = this.toQty(
      this.inventoryBalanceFromMovements(
        massReadyMovements.filter(
          (movement) =>
            !(movement.orderId === order.id && movement.source === ORDER_FORMULA_SOURCE_MASS_READY)
        )
      )
    );
    const missingMassRecipes = Math.max(
      this.toQty(requiredMassRecipes - availableMassReadyExcludingOrderFormula),
      0
    );
    const recipesToPrepare = missingMassRecipes > 0 ? Math.max(Math.ceil(missingMassRecipes), 1) : 0;

    if (!existingEvent) {
      if (recipesToPrepare <= 0) return null;
      const createdEvent = massPrepEventSchema.parse({
        version: 1,
        id: `mass-prep-${randomUUID()}`,
        eventName: MASS_PREP_EVENT_NAME,
        orderId: order.id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        durationMinutes: MASS_PREP_EVENT_DURATION_MINUTES,
        massRecipes: recipesToPrepare,
        status: 'INGREDIENTES',
        createdAt: new Date().toISOString()
      });
      await this.saveMassPrepEvent(tx, createdEvent);
      return createdEvent;
    }

    let changed = false;
    const nextEvent: MassPrepEvent = { ...existingEvent };
    const nextStartsAtIso = startsAt.toISOString();
    const nextEndsAtIso = endsAt.toISOString();

    if (nextEvent.startsAt !== nextStartsAtIso) {
      nextEvent.startsAt = nextStartsAtIso;
      changed = true;
    }
    if (nextEvent.endsAt !== nextEndsAtIso) {
      nextEvent.endsAt = nextEndsAtIso;
      changed = true;
    }
    if (
      nextEvent.status === 'INGREDIENTES' &&
      recipesToPrepare > 0 &&
      nextEvent.massRecipes !== recipesToPrepare
    ) {
      nextEvent.massRecipes = recipesToPrepare;
      changed = true;
    }

    if (!changed) return nextEvent;
    const parsedEvent = massPrepEventSchema.parse(nextEvent);
    await this.saveMassPrepEvent(tx, parsedEvent);
    return parsedEvent;
  }

  private async syncOrderInventoryAndMassPrepEvent(
    tx: TransactionClient,
    order: Pick<OrderWithRelations, 'id' | 'scheduledAt' | 'createdAt' | 'items'>
  ) {
    const formula = await this.syncOrderFormulaInventory(tx, order);
    await this.syncMassPrepEventForOrder(tx, order, formula.massReadyItem.id, formula.requiredMassRecipes);
  }

  private async syncMassPrepEventScheduleAndCoverage(
    tx: TransactionClient,
    order: Pick<OrderWithRelations, 'id' | 'scheduledAt' | 'createdAt' | 'items'>
  ) {
    const inventoryItems = await tx.inventoryItem.findMany({ orderBy: { id: 'asc' } });
    const inventoryByLookup = this.buildInventoryItemLookup(inventoryItems);
    const massReadyItem = await this.ensureInventoryItemByAliases(tx, inventoryByLookup, {
      canonicalName: MASS_READY_ITEM_NAME,
      aliases: [MASS_READY_ITEM_NAME],
      unit: 'receita',
      purchasePackSize: 1,
      purchasePackCost: 0
    });
    const requiredMassRecipes = this.toQty(
      this.orderBroasFromItems(order.items || []) / MASS_READY_BROAS_PER_RECIPE
    );
    await this.syncMassPrepEventForOrder(tx, order, massReadyItem.id, requiredMassRecipes);
  }

  private async prepareMassForEvent(
    tx: TransactionClient,
    event: Pick<MassPrepEvent, 'orderId' | 'massRecipes'>
  ) {
    const recipes = Math.max(Math.floor(event.massRecipes || 0), 0);
    if (recipes <= 0) {
      throw new BadRequestException('Evento FAZER MASSA sem receitas para preparar.');
    }

    const inventoryItems = await tx.inventoryItem.findMany({ orderBy: { id: 'asc' } });
    const inventoryByLookup = this.buildInventoryItemLookup(inventoryItems);
    const sourceLabel = this.orderFormulaSourceLabel(event.orderId);

    const massReadyItem = await this.ensureInventoryItemByAliases(tx, inventoryByLookup, {
      canonicalName: MASS_READY_ITEM_NAME,
      aliases: [MASS_READY_ITEM_NAME],
      unit: 'receita',
      purchasePackSize: 1,
      purchasePackCost: 0
    });

    const plan: Array<{
      item: InventoryLookupItem;
      requiredQty: number;
      availableQty: number;
      displayName: string;
      unit: string;
    }> = [];
    const missingIngredients: string[] = [];

    for (const ingredient of massPrepRecipeIngredients) {
      const item = await this.ensureInventoryItemByAliases(tx, inventoryByLookup, {
        canonicalName: ingredient.canonicalName,
        aliases: ingredient.aliases,
        unit: ingredient.unit,
        purchasePackSize: ingredient.purchasePackSize,
        purchasePackCost: ingredient.purchasePackCost
      });
      const requiredQty = this.toQty(ingredient.qtyPerRecipe * recipes);
      const availableQty = this.toQty(await this.loadInventoryBalance(tx, item.id));
      if (availableQty + 0.00001 < requiredQty) {
        missingIngredients.push(
          `${ingredient.canonicalName}: disponivel ${availableQty} ${ingredient.unit}, necessario ${requiredQty} ${ingredient.unit}`
        );
      }
      plan.push({
        item,
        requiredQty,
        availableQty,
        displayName: ingredient.canonicalName,
        unit: ingredient.unit
      });
    }

    if (missingIngredients.length > 0) {
      throw new BadRequestException(
        `Nao ha insumos suficientes para iniciar PREPARO. ${missingIngredients.join(' | ')}`
      );
    }

    for (const ingredient of plan) {
      await tx.inventoryMovement.create({
        data: {
          itemId: ingredient.item.id,
          orderId: event.orderId,
          type: 'OUT',
          quantity: ingredient.requiredQty,
          reason: `Consumo de insumos para MASSA PRONTA (${recipes} receita(s))`,
          source: MASS_PREP_SOURCE,
          sourceLabel
        }
      });
    }

    await tx.inventoryMovement.create({
      data: {
        itemId: massReadyItem.id,
        orderId: event.orderId,
        type: 'IN',
        quantity: recipes,
        reason: `Reposicao de MASSA PRONTA (${recipes} receita(s))`,
        source: MASS_PREP_SOURCE,
        sourceLabel
      }
    });
  }

  private async markMassPrepEventReadyOnOrderOven(
    tx: TransactionClient,
    orderId: number
  ) {
    const event = await this.getMassPrepEvent(tx, orderId);
    if (!event || event.status !== 'PREPARO') return null;

    const updatedEvent = massPrepEventSchema.parse({
      ...event,
      status: 'PRONTA'
    });
    await this.saveMassPrepEvent(tx, updatedEvent);
    return updatedEvent;
  }

  private getPaidAmount(
    payments: Array<{
      amount: number;
      status: string;
      paidAt: Date | null;
    }>
  ) {
    return this.toMoney(
      payments.reduce((sum, payment) => {
        const isPaid = payment.status === 'PAGO' || Boolean(payment.paidAt);
        return isPaid ? sum + payment.amount : sum;
      }, 0)
    );
  }

  private deriveOrderPaymentStatus(total: number, amountPaid: number) {
    if (amountPaid <= 0) return 'PENDENTE';
    if (amountPaid + 0.00001 >= total) return 'PAGO';
    return 'PARCIAL';
  }

  private ensureOrderTotalCoversPaid(total: number, amountPaid: number) {
    const normalizedTotal = this.toMoney(total);
    const normalizedAmountPaid = this.toMoney(amountPaid);
    if (normalizedAmountPaid > normalizedTotal + 0.00001) {
      throw new BadRequestException(
        `Total do pedido nao pode ficar abaixo do valor ja pago. Total=${normalizedTotal} Pago=${normalizedAmountPaid}`
      );
    }
  }

  private parseOptionalDateTime(value: string | null | undefined) {
    if (value == null) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Data/hora do pedido invalida.');
    }
    return parsed;
  }

  private withFinancial(order: OrderWithRelations) {
    const total = this.toMoney(order.total ?? 0);
    const amountPaid = this.getPaidAmount(order.payments || []);
    const balanceDue = this.toMoney(Math.max(total - amountPaid, 0));
    const paymentStatus = this.deriveOrderPaymentStatus(total, amountPaid);
    return {
      ...order,
      amountPaid,
      balanceDue,
      paymentStatus
    };
  }

  private async getRaw(id: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true, customer: true, payments: true }
    });
    if (!order) throw new NotFoundException('Pedido nao encontrado');
    return order;
  }

  async list() {
    const orders = await this.prisma.order.findMany({
      include: { items: true, customer: true, payments: true },
      orderBy: { id: 'desc' }
    });
    return orders.map((order) => this.withFinancial(order));
  }

  async get(id: number) {
    const order = await this.getRaw(id);
    return this.withFinancial(order);
  }

  async repriceAllOrdersToOfficialScheme() {
    return this.prisma.$transaction(async (tx) => {
      const orders = await tx.order.findMany({
        include: { items: true },
        orderBy: { id: 'asc' }
      });

      let updated = 0;
      let unchanged = 0;
      let subtotalDelta = 0;
      let totalDelta = 0;

      for (const order of orders) {
        const normalizedItems = (order.items || [])
          .map((item) => ({
            productId: item.productId,
            quantity: Math.max(Math.floor(item.quantity || 0), 0)
          }))
          .filter((item) => item.quantity > 0);

        const nextSubtotal = await this.calculateOrderSubtotalFromItems(tx, normalizedItems);
        const nextTotal = this.toMoney(Math.max(nextSubtotal - this.toMoney(order.discount ?? 0), 0));
        const previousSubtotal = this.toMoney(order.subtotal ?? 0);
        const previousTotal = this.toMoney(order.total ?? 0);
        const subtotalChanged = Math.abs(previousSubtotal - nextSubtotal) > 0.00001;
        const totalChanged = Math.abs(previousTotal - nextTotal) > 0.00001;

        if (!subtotalChanged && !totalChanged) {
          unchanged += 1;
          continue;
        }

        await tx.order.update({
          where: { id: order.id },
          data: {
            subtotal: nextSubtotal,
            total: nextTotal
          }
        });

        updated += 1;
        subtotalDelta = this.toMoney(subtotalDelta + (nextSubtotal - previousSubtotal));
        totalDelta = this.toMoney(totalDelta + (nextTotal - previousTotal));
      }

      return {
        scanned: orders.length,
        updated,
        unchanged,
        subtotalDelta,
        totalDelta
      };
    });
  }

  async listMassPrepEvents() {
    const records = await this.prisma.idempotencyRecord.findMany({
      where: { scope: MASS_PREP_EVENT_SCOPE },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });

    const events = records
      .map((record) => this.parseMassPrepEvent(record.responseJson))
      .filter((entry): entry is MassPrepEvent => Boolean(entry));

    return events.sort((left, right) => {
      const leftTime = new Date(left.startsAt).getTime();
      const rightTime = new Date(right.startsAt).getTime();
      return leftTime - rightTime;
    });
  }

  async removeMassPrepEvent(orderId: number) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
    if (!order) throw new NotFoundException('Pedido nao encontrado');

    await this.prisma.idempotencyRecord.deleteMany({
      where: {
        scope: MASS_PREP_EVENT_SCOPE,
        idemKey: this.massPrepEventIdemKey(orderId)
      }
    });
  }

  async updateMassPrepEventStatus(orderId: number, payload: unknown) {
    const data = massPrepEventStatusPayloadSchema.parse(payload ?? {});

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true } });
      if (!order) throw new NotFoundException('Pedido nao encontrado');

      const event = await this.getMassPrepEvent(tx, orderId);
      if (!event) {
        throw new NotFoundException('Evento FAZER MASSA nao encontrado para este pedido.');
      }

      if (event.status === data.status) {
        return event;
      }

      const allowed = massPrepEventStatusTransitions[event.status] || [];
      if (!allowed.includes(data.status)) {
        throw new BadRequestException(`Transicao invalida: ${event.status} -> ${data.status}`);
      }

      if (event.status === 'INGREDIENTES' && data.status === 'PREPARO') {
        await this.prepareMassForEvent(tx, event);
      }

      const updated = massPrepEventSchema.parse({
        ...event,
        status: data.status
      });
      await this.saveMassPrepEvent(tx, updated);
      return updated;
    });
  }

  async create(payload: unknown) {
    const data = OrderSchema.pick({ customerId: true, notes: true, discount: true, scheduledAt: true, items: true }).parse(
      payload
    );
    const items = data.items ?? [];
    if (items.length === 0) {
      throw new BadRequestException('Itens sao obrigatorios');
    }

    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: data.customerId } });
      if (!customer) throw new NotFoundException('Cliente nao encontrado');
      if (customer.deletedAt) {
        throw new BadRequestException('Cliente foi excluido e nao pode receber novos pedidos.');
      }

      const parsedItems = items.map((item) =>
        OrderItemSchema.pick({ productId: true, quantity: true }).parse(item)
      );

      const productIds = Array.from(new Set(parsedItems.map((item) => item.productId)));
      const products = await tx.product.findMany({ where: { id: { in: productIds } } });
      const productMap = new Map(products.map((product) => [product.id, product]));

      const itemsData = [] as Array<{ productId: number; quantity: number; unitPrice: number; total: number }>;
      for (const item of parsedItems) {
        const product = productMap.get(item.productId);
        if (!product) throw new NotFoundException('Produto nao encontrado');
        const unitPrice = this.toUnitPrice(product.price);
        const total = this.toMoney(unitPrice * item.quantity);
        itemsData.push({ productId: item.productId, quantity: item.quantity, unitPrice, total });
      }

      const subtotal = await this.calculateOrderSubtotalFromItems(tx, parsedItems);
      const discount = this.toMoney(data.discount ?? 0);
      const total = this.toMoney(Math.max(subtotal - discount, 0));

      const createdOrder = await tx.order.create({
        data: {
          customerId: data.customerId,
          notes: data.notes ?? null,
          scheduledAt: this.parseOptionalDateTime(data.scheduledAt),
          subtotal,
          discount,
          total,
          items: {
            create: itemsData
          }
        },
        include: { items: true, customer: true, payments: true }
      });

      await this.syncOrderInventoryAndMassPrepEvent(tx, createdOrder);

      return this.withFinancial(createdOrder);
    });
  }

  async update(id: number, payload: unknown) {
    const data = updateSchema.parse(payload);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({
        where: { id },
        include: { items: true, customer: true, payments: true }
      });
      if (!existing) throw new NotFoundException('Pedido nao encontrado');

      const nextScheduledAt = Object.prototype.hasOwnProperty.call(data, 'scheduledAt')
        ? this.parseOptionalDateTime(data.scheduledAt)
        : undefined;

      const subtotal = await this.calculateOrderSubtotalFromItems(
        tx,
        existing.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity
        }))
      );
      const discount = this.toMoney(data.discount ?? existing.discount ?? 0);
      const total = this.toMoney(Math.max(subtotal - discount, 0));
      const amountPaid = this.getPaidAmount(existing.payments || []);
      this.ensureOrderTotalCoversPaid(total, amountPaid);

      const updated = await tx.order.update({
        where: { id },
        data: {
          ...(Object.prototype.hasOwnProperty.call(data, 'notes') ? { notes: data.notes ?? null } : {}),
          discount,
          subtotal,
          total,
          ...(nextScheduledAt !== undefined ? { scheduledAt: nextScheduledAt } : {})
        },
        include: { items: true, customer: true, payments: true }
      });

      await this.syncMassPrepEventScheduleAndCoverage(tx, updated);
      return this.withFinancial(updated);
    });
  }

  async remove(id: number) {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Pedido nao encontrado');

      await tx.inventoryMovement.deleteMany({
        where: {
          orderId: id,
          source: {
            in: [...ORDER_FORMULA_SOURCES, 'MASS_READY']
          }
        }
      });
      await tx.order.delete({ where: { id } });
      await tx.idempotencyRecord.deleteMany({
        where: {
          scope: MASS_PREP_EVENT_SCOPE,
          idemKey: this.massPrepEventIdemKey(id)
        }
      });
    });
  }

  async addItem(orderId: number, payload: unknown) {
    const data = OrderItemSchema.pick({ productId: true, quantity: true }).parse(payload);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!order) throw new NotFoundException('Pedido nao encontrado');
      if (['CANCELADO', 'ENTREGUE'].includes(order.status)) {
        throw new BadRequestException('Pedido nao permite alterar itens neste status');
      }

      const product = await tx.product.findUnique({ where: { id: data.productId } });
      if (!product) throw new NotFoundException('Produto nao encontrado');

      const unitPrice = this.toUnitPrice(product.price);
      const total = this.toMoney(unitPrice * data.quantity);

      await tx.orderItem.create({
        data: {
          orderId,
          productId: data.productId,
          quantity: data.quantity,
          unitPrice,
          total
        }
      });

      const nextSubtotalItems = [
        ...order.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity
        })),
        {
          productId: data.productId,
          quantity: data.quantity
        }
      ];
      const newSubtotal = await this.calculateOrderSubtotalFromItems(tx, nextSubtotalItems);
      const newTotal = this.toMoney(Math.max(newSubtotal - order.discount, 0));
      await tx.order.update({ where: { id: orderId }, data: { subtotal: newSubtotal, total: newTotal } });

      const updatedOrder = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, customer: true, payments: true }
      });
      if (!updatedOrder) throw new NotFoundException('Pedido nao encontrado');
      await this.syncOrderInventoryAndMassPrepEvent(tx, updatedOrder);
      return this.withFinancial(updatedOrder);
    });
  }

  async replaceItems(orderId: number, payload: unknown) {
    const data = replaceItemsSchema.parse(payload ?? {});
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, payments: true }
      });
      if (!order) throw new NotFoundException('Pedido nao encontrado');
      if (['CANCELADO', 'ENTREGUE'].includes(order.status)) {
        throw new BadRequestException('Pedido nao permite alterar itens neste status');
      }

      const quantityByProductId = new Map<number, number>();
      for (const item of data.items) {
        const current = quantityByProductId.get(item.productId) || 0;
        quantityByProductId.set(item.productId, current + item.quantity);
      }

      const normalizedItems = Array.from(quantityByProductId.entries())
        .map(([productId, quantity]) => ({ productId, quantity }))
        .filter((item) => item.quantity > 0);
      if (normalizedItems.length === 0) {
        throw new BadRequestException('Itens sao obrigatorios');
      }

      const productIds = normalizedItems.map((item) => item.productId);
      const products = await tx.product.findMany({ where: { id: { in: productIds } } });
      const productMap = new Map(products.map((product) => [product.id, product]));

      const itemsData = [] as Array<{ productId: number; quantity: number; unitPrice: number; total: number }>;
      for (const item of normalizedItems) {
        const product = productMap.get(item.productId);
        if (!product) throw new NotFoundException('Produto nao encontrado');
        const unitPrice = this.toUnitPrice(product.price);
        const total = this.toMoney(unitPrice * item.quantity);
        itemsData.push({ productId: item.productId, quantity: item.quantity, unitPrice, total });
      }

      const subtotal = await this.calculateOrderSubtotalFromItems(tx, normalizedItems);
      const total = this.toMoney(Math.max(subtotal - order.discount, 0));
      const amountPaid = this.getPaidAmount(order.payments || []);
      this.ensureOrderTotalCoversPaid(total, amountPaid);

      await tx.orderItem.deleteMany({ where: { orderId } });
      await tx.orderItem.createMany({
        data: itemsData.map((item) => ({
          orderId,
          ...item
        }))
      });

      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: { subtotal, total },
        include: { items: true, customer: true, payments: true }
      });

      await this.syncOrderInventoryAndMassPrepEvent(tx, updatedOrder);
      return this.withFinancial(updatedOrder);
    });
  }

  async removeItem(orderId: number, itemId: number) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, payments: true }
      });
      if (!order) throw new NotFoundException('Pedido nao encontrado');
      if (['CANCELADO', 'ENTREGUE'].includes(order.status)) {
        throw new BadRequestException('Pedido nao permite alterar itens neste status');
      }

      const item = await tx.orderItem.findUnique({ where: { id: itemId } });
      if (!item || item.orderId !== orderId) throw new NotFoundException('Item nao encontrado');

      await tx.orderItem.delete({ where: { id: itemId } });

      const remaining = order.items.filter((i) => i.id !== itemId);
      const newSubtotal = await this.calculateOrderSubtotalFromItems(
        tx,
        remaining.map((entry) => ({
          productId: entry.productId,
          quantity: entry.quantity
        }))
      );
      const newTotal = this.toMoney(Math.max(newSubtotal - order.discount, 0));
      const amountPaid = this.getPaidAmount(order.payments || []);
      this.ensureOrderTotalCoversPaid(newTotal, amountPaid);

      await tx.order.update({ where: { id: orderId }, data: { subtotal: newSubtotal, total: newTotal } });

      const updatedOrder = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, customer: true, payments: true }
      });
      if (!updatedOrder) throw new NotFoundException('Pedido nao encontrado');
      await this.syncOrderInventoryAndMassPrepEvent(tx, updatedOrder);
      return this.withFinancial(updatedOrder);
    });
  }

  async updateStatus(orderId: number, nextStatus: unknown) {
    const status = OrderStatusEnum.parse(nextStatus);
    const order = await this.getRaw(orderId);

    const allowed = statusTransitions[order.status] || [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(`Transicao invalida: ${order.status} -> ${status}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: { status },
        include: { items: true, customer: true, payments: true }
      });
      if (status === 'EM_PREPARACAO') {
        await this.markMassPrepEventReadyOnOrderOven(tx, orderId);
      }
      return this.withFinancial(updatedOrder);
    });
  }

  async markPaid(orderId: number, payload: unknown) {
    const data = markPaidSchema.parse(payload ?? {});

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, customer: true, payments: true }
      });
      if (!order) throw new NotFoundException('Pedido nao encontrado');
      if (order.status === 'CANCELADO') {
        throw new BadRequestException('Nao e possivel registrar pagamento para pedido cancelado.');
      }

      const total = this.toMoney(order.total ?? 0);
      const amountPaid = this.getPaidAmount(order.payments || []);
      const balanceDue = this.toMoney(Math.max(total - amountPaid, 0));

      if (balanceDue <= 0) {
        return this.withFinancial(order);
      }

      await tx.payment.create({
        data: {
          orderId: order.id,
          amount: balanceDue,
          method: data.method?.trim() || 'pix',
          status: 'PAGO',
          paidAt: data.paidAt ? new Date(data.paidAt) : new Date()
        }
      });

      const updated = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, customer: true, payments: true }
      });
      if (!updated) throw new NotFoundException('Pedido nao encontrado');
      return this.withFinancial(updated);
    });
  }
}
