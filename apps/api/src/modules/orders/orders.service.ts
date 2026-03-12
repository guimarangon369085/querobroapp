import { BadRequestException, Injectable, NotFoundException, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service.js';
import {
  ExternalOrderSubmissionSchema,
  OrderIntakeMetaSchema,
  OrderIntakeSchema,
  OrderItemSchema,
  OrderSchema,
  OrderStatusEnum,
  PixChargeSchema
} from '@querobroapp/shared';
import { z } from 'zod';
import {
  addInventoryLookupItem,
  buildOfficialBroaFlavorSummary,
  buildInventoryItemLookup,
  computeBroaPaperBagCount,
  computeBroaPackagingPlan,
  findInventoryByAliases,
  MASS_PREP_DEFAULT_BATCH_RECIPES,
  MASS_READY_BROAS_PER_RECIPE,
  MASS_READY_ITEM_NAME,
  massPrepRecipeIngredients,
  ORDER_BOX_UNITS,
  orderFillingIngredientsByFlavorCode,
  resolveExecutableMassPrepRecipes,
  resolveInventoryDefinition,
  resolveInventoryFamilyItemIds,
  resolvePlannedMassPrepRecipes
} from '../inventory/inventory-formulas.js';
import { normalizePhone, normalizeText, normalizeTitle } from '../../common/normalize.js';
import { PaymentsService } from '../payments/payments.service.js';
import { WhatsAppService } from '../whatsapp/whatsapp.service.js';

const updateSchema = OrderSchema.partial().omit({ id: true, createdAt: true, items: true });
const replaceItemsSchema = z.object({
  items: z.array(OrderItemSchema.pick({ productId: true, quantity: true })).min(1)
});
const markPaidSchema = z.object({
  paidAt: z.string().datetime().optional().nullable()
});

const whatsappFlowIntakeSchema = OrderIntakeSchema.omit({ source: true }).extend({
  source: z
    .object({
      externalId: z.string().trim().min(1).max(160).optional().nullable(),
      idempotencyKey: z.string().trim().min(1).max(160).optional().nullable(),
      originLabel: z.string().trim().min(1).max(160).optional().nullable()
    })
    .default({})
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
const ORDER_INTAKE_SCOPE = 'ORDER_INTAKE';
const MASS_PREP_EVENT_NAME = 'FAZER MASSA';
const MASS_PREP_EVENT_DURATION_MINUTES = 60;
const ORDER_BOX_PRICE_CUSTOM = 52;
const ORDER_BOX_PRICE_TRADITIONAL = 40;
const ORDER_BOX_PRICE_MIXED_GOIABADA = 45;
const ORDER_BOX_PRICE_MIXED_OTHER = 47;
const ORDER_BOX_PRICE_GOIABADA = 50;
const MASS_PREP_SOURCE = 'MASS_PREP';
const MASS_PREP_SOURCE_LABEL_PREFIX = 'ORDER_';
const ORDER_FORMULA_SOURCE_MASS_READY = 'MASS_READY';
const ORDER_FORMULA_SOURCE_FILLING = 'ORDER_FILLING';
const ORDER_FORMULA_SOURCE_PACKAGING = 'ORDER_PACKAGING';
const ORDER_FORMULA_SOURCES = [
  ORDER_FORMULA_SOURCE_MASS_READY,
  ORDER_FORMULA_SOURCE_FILLING,
  ORDER_FORMULA_SOURCE_PACKAGING
] as const;

const massPrepEventStatusSchema = z.enum(['INGREDIENTES', 'PREPARO', 'NO_FORNO', 'PRONTA']);
const massPrepEventStatusTransitions: Record<z.infer<typeof massPrepEventStatusSchema>, z.infer<typeof massPrepEventStatusSchema>[]> = {
  INGREDIENTES: ['PREPARO'],
  PREPARO: ['NO_FORNO'],
  NO_FORNO: ['PRONTA'],
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

const massPrepEventStatusPayloadSchema = z.object({
  status: massPrepEventStatusSchema
});

type OrderWithRelations = Prisma.OrderGetPayload<{
  include: { items: true; customer: true; payments: true };
}>;
type TransactionClient = Prisma.TransactionClient;
type OrderIntakePayload = z.infer<typeof OrderIntakeSchema>;
type OrderIntakeMeta = z.infer<typeof OrderIntakeMetaSchema>;
type PixCharge = z.infer<typeof PixChargeSchema>;
type ExternalOrderSubmissionPayload = z.infer<typeof ExternalOrderSubmissionSchema>;

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
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentsService) private readonly paymentsService: PaymentsService,
    @Inject(WhatsAppService) private readonly whatsAppService: WhatsAppService
  ) {}

  private toMoney(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private formatCurrencyBR(value: number) {
    return this.toMoney(value).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
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

  private massPrepEventIdemKey(orderId: number) {
    return `ORDER_${orderId}`;
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

  private formatDate(value: Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private orderTargetDate(order: Pick<OrderWithRelations, 'createdAt' | 'scheduledAt'>) {
    if (order.scheduledAt) {
      const scheduled = new Date(order.scheduledAt);
      if (!Number.isNaN(scheduled.getTime())) {
        return {
          date: this.formatDate(scheduled),
          basis: 'deliveryDate' as const
        };
      }
    }

    const base = new Date(order.createdAt);
    const productionDate = new Date(base);
    productionDate.setHours(0, 0, 0, 0);
    productionDate.setDate(productionDate.getDate() + 1);
    return {
      date: this.formatDate(productionDate),
      basis: 'createdAtPlus1' as const
    };
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

  private buildOfficialBroaSummaryFromItems(
    items: Array<{ productId: number; quantity: number }>,
    productNameById: Map<number, string>
  ) {
    return buildOfficialBroaFlavorSummary(items, productNameById);
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
    inventoryByLookup: Map<string, InventoryLookupItem[]>,
    params: {
      canonicalName: string;
      aliases: readonly string[];
      category?: string;
      unit: string;
      purchasePackSize: number;
      purchasePackCost: number;
    }
  ) {
    const found = findInventoryByAliases(inventoryByLookup, params);
    if (found) return found;

    const created = await tx.inventoryItem.create({
      data: {
        name: params.canonicalName,
        category: params.category || 'INGREDIENTE',
        unit: params.unit,
        purchasePackSize: params.purchasePackSize,
        purchasePackCost: params.purchasePackCost
      }
    });
    addInventoryLookupItem(inventoryByLookup, created);
    return created;
  }

  private async loadInventoryFamilyBalance(
    tx: TransactionClient,
    itemIds: number[],
    where?: Prisma.InventoryMovementWhereInput
  ) {
    if (itemIds.length === 0) return 0;
    const movements = await tx.inventoryMovement.findMany({
      where: {
        itemId: { in: itemIds },
        ...(where || {})
      },
      select: { itemId: true, type: true, quantity: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });

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

    return this.toQty(
      Array.from(balanceByItem.values()).reduce((sum, value) => this.toQty(sum + value), 0)
    );
  }

  private async resolveMassPrepRecipesPossibleFromIngredients(tx: TransactionClient) {
    const inventoryItems = await tx.inventoryItem.findMany({ orderBy: { id: 'asc' } });
    let possibleRecipes = Number.POSITIVE_INFINITY;

    for (const ingredient of massPrepRecipeIngredients) {
      const availableQty = this.toQty(
        await this.loadInventoryFamilyBalance(
          tx,
          resolveInventoryFamilyItemIds(inventoryItems, ingredient)
        )
      );
      const possibleForIngredient = ingredient.qtyPerRecipe
        ? Math.floor(availableQty / ingredient.qtyPerRecipe)
        : 0;
      possibleRecipes = Math.min(possibleRecipes, possibleForIngredient);
    }

    return Number.isFinite(possibleRecipes) ? Math.max(possibleRecipes, 0) : 0;
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
    const productNameById = new Map(products.map((product) => [product.id, product.name]));
    const summary = this.buildOfficialBroaSummaryFromItems(items, productNameById);

    for (const code of ['G', 'D', 'Q', 'R'] as const) {
      byFlavorCode[code] = summary.flavorCounts[code] || 0;
    }

    return byFlavorCode;
  }

  private async clearOrderFormulaArtifacts(tx: TransactionClient, orderId: number) {
    await tx.inventoryMovement.deleteMany({
      where: {
        orderId,
        source: { in: [...ORDER_FORMULA_SOURCES] }
      }
    });
  }

  private async clearMassPrepEventArtifact(tx: TransactionClient, orderId: number) {
    await tx.idempotencyRecord.deleteMany({
      where: {
        scope: MASS_PREP_EVENT_SCOPE,
        idemKey: this.massPrepEventIdemKey(orderId)
      }
    });
  }

  private async syncPaperBagReservationsForCustomerDateGroup(
    tx: TransactionClient,
    params: { customerId: number; targetDate: string }
  ) {
    const candidateOrders = await tx.order.findMany({
      where: {
        customerId: params.customerId,
        status: { not: 'CANCELADO' }
      },
      include: {
        items: {
          include: {
            product: true
          }
        }
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });

    const groupedOrders = candidateOrders.filter(
      (order) => this.orderTargetDate(order).date === params.targetDate
    );
    if (groupedOrders.length === 0) return;

    const packagingByOrder = groupedOrders.map((order) => {
      const productNameById = new Map(
        order.items.map((item) => [item.productId, item.product?.name || `Produto ${item.productId}`])
      );
      const broaSummary = this.buildOfficialBroaSummaryFromItems(order.items || [], productNameById);
      return {
        order,
        packagingPlan: computeBroaPackagingPlan(broaSummary.totalBroas)
      };
    });

    const inventoryItems = await tx.inventoryItem.findMany({ orderBy: { id: 'asc' } });
    const inventoryByLookup = buildInventoryItemLookup(inventoryItems);
    const paperBagDefinition = resolveInventoryDefinition('SACOLA');
    if (!paperBagDefinition) return;

    const paperBagItemIds = resolveInventoryFamilyItemIds(inventoryItems, paperBagDefinition);
    if (paperBagItemIds.length > 0) {
      await tx.inventoryMovement.deleteMany({
        where: {
          orderId: { in: groupedOrders.map((order) => order.id) },
          itemId: { in: paperBagItemIds },
          source: ORDER_FORMULA_SOURCE_PACKAGING
        }
      });
    }

    const totalPlasticBoxes = packagingByOrder.reduce(
      (sum, entry) => this.toQty(sum + entry.packagingPlan.plasticBoxes),
      0
    );
    if (totalPlasticBoxes <= 0) return;

    const paperBagItem = await this.ensureInventoryItemByAliases(tx, inventoryByLookup, {
      canonicalName: paperBagDefinition.canonicalName,
      aliases: paperBagDefinition.aliases,
      category: paperBagDefinition.category,
      unit: paperBagDefinition.unit,
      purchasePackSize: paperBagDefinition.purchasePackSize,
      purchasePackCost: paperBagDefinition.purchasePackCost
    });

    let accumulatedBoxes = 0;
    for (const entry of packagingByOrder) {
      const nextAccumulatedBoxes = accumulatedBoxes + entry.packagingPlan.plasticBoxes;
      const paperBagsForOrder =
        computeBroaPaperBagCount(nextAccumulatedBoxes) -
        computeBroaPaperBagCount(accumulatedBoxes);
      accumulatedBoxes = nextAccumulatedBoxes;

      if (paperBagsForOrder <= 0) continue;

      await tx.inventoryMovement.create({
        data: {
          itemId: paperBagItem.id,
          orderId: entry.order.id,
          type: 'OUT',
          quantity: paperBagsForOrder,
          reason: `Reserva de embalagem por pedido (${paperBagsForOrder} sacola(s))`,
          source: ORDER_FORMULA_SOURCE_PACKAGING,
          sourceLabel: this.orderFormulaSourceLabel(entry.order.id)
        }
      });
    }
  }

  private async syncOrderFormulaInventory(
    tx: TransactionClient,
    order: Pick<OrderWithRelations, 'id' | 'items'>
  ) {
    const inventoryItems = await tx.inventoryItem.findMany({ orderBy: { id: 'asc' } });
    const inventoryByLookup = buildInventoryItemLookup(inventoryItems);
    const sourceLabel = this.orderFormulaSourceLabel(order.id);
    const productIds = Array.from(new Set((order.items || []).map((item) => item.productId)));
    const products = productIds.length
      ? await tx.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true }
        })
      : [];
    const productNameById = new Map(products.map((product) => [product.id, product.name]));

    const massReadyItem = await this.ensureInventoryItemByAliases(tx, inventoryByLookup, {
      canonicalName: MASS_READY_ITEM_NAME,
      aliases: [MASS_READY_ITEM_NAME],
      category: 'INGREDIENTE',
      unit: 'receita',
      purchasePackSize: 1,
      purchasePackCost: 0
    });

    const broaSummary = this.buildOfficialBroaSummaryFromItems(order.items || [], productNameById);
    const totalBroas = broaSummary.totalBroas;
    const massReadyRecipes = this.toQty(totalBroas / MASS_READY_BROAS_PER_RECIPE);
    const fillingBroasByCode = await this.resolveOrderFillingBroasByFlavorCode(tx, order.items || []);
    const packagingPlan = computeBroaPackagingPlan(totalBroas);

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
      const fillingQty = this.toQty(Math.max(broasQty, 0) * (definition.qtyPerUnit ?? 0));
      if (fillingQty <= 0) continue;

      const item = await this.ensureInventoryItemByAliases(tx, inventoryByLookup, {
        canonicalName: definition.canonicalName,
        aliases: definition.aliases,
        category: definition.category,
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

    const plasticBoxDefinition = resolveInventoryDefinition('CAIXA DE PLÁSTICO');
    const butterPaperDefinition = resolveInventoryDefinition('PAPEL MANTEIGA');

    const packagingMovements = [
      plasticBoxDefinition && packagingPlan.plasticBoxes > 0
        ? {
            definition: plasticBoxDefinition,
            quantity: packagingPlan.plasticBoxes,
            reason: `Reserva de embalagem por pedido (${packagingPlan.plasticBoxes} caixa(s) plastica(s))`
          }
        : null,
      butterPaperDefinition && packagingPlan.paperButterCm > 0
        ? {
            definition: butterPaperDefinition,
            quantity: packagingPlan.paperButterCm,
            reason: `Reserva de embalagem por pedido (${packagingPlan.paperButterCm} cm de papel manteiga)`
          }
        : null
    ].filter(Boolean) as Array<{
      definition: NonNullable<ReturnType<typeof resolveInventoryDefinition>>;
      quantity: number;
      reason: string;
    }>;

    for (const packagingMovement of packagingMovements) {
      const item = await this.ensureInventoryItemByAliases(tx, inventoryByLookup, {
        canonicalName: packagingMovement.definition.canonicalName,
        aliases: packagingMovement.definition.aliases,
        category: packagingMovement.definition.category,
        unit: packagingMovement.definition.unit,
        purchasePackSize: packagingMovement.definition.purchasePackSize,
        purchasePackCost: packagingMovement.definition.purchasePackCost
      });

      await tx.inventoryMovement.create({
        data: {
          itemId: item.id,
          orderId: order.id,
          type: 'OUT',
          quantity: packagingMovement.quantity,
          reason: packagingMovement.reason,
          source: ORDER_FORMULA_SOURCE_PACKAGING,
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
    const possibleRecipesFromIngredients =
      missingMassRecipes > 0
        ? await this.resolveMassPrepRecipesPossibleFromIngredients(tx)
        : 0;
    const recipesToPrepare = resolvePlannedMassPrepRecipes(
      missingMassRecipes,
      possibleRecipesFromIngredients
    );

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
    order: Pick<OrderWithRelations, 'id' | 'customerId' | 'scheduledAt' | 'createdAt' | 'items'>
  ) {
    const formula = await this.syncOrderFormulaInventory(tx, order);
    await this.syncMassPrepEventForOrder(tx, order, formula.massReadyItem.id, formula.requiredMassRecipes);
    await this.syncPaperBagReservationsForCustomerDateGroup(tx, {
      customerId: order.customerId,
      targetDate: this.orderTargetDate(order).date
    });
  }

  private async syncMassPrepEventScheduleAndCoverage(
    tx: TransactionClient,
    order: Pick<OrderWithRelations, 'id' | 'scheduledAt' | 'createdAt' | 'items'>
  ) {
    const inventoryItems = await tx.inventoryItem.findMany({ orderBy: { id: 'asc' } });
    const inventoryByLookup = buildInventoryItemLookup(inventoryItems);
    const productIds = Array.from(new Set((order.items || []).map((item) => item.productId)));
    const products = productIds.length
      ? await tx.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true }
        })
      : [];
    const productNameById = new Map(products.map((product) => [product.id, product.name]));
    const massReadyItem = await this.ensureInventoryItemByAliases(tx, inventoryByLookup, {
      canonicalName: MASS_READY_ITEM_NAME,
      aliases: [MASS_READY_ITEM_NAME],
      category: 'INGREDIENTE',
      unit: 'receita',
      purchasePackSize: 1,
      purchasePackCost: 0
    });
    const broaSummary = this.buildOfficialBroaSummaryFromItems(order.items || [], productNameById);
    const requiredMassRecipes = this.toQty(
      broaSummary.totalBroas / MASS_READY_BROAS_PER_RECIPE
    );
    await this.syncMassPrepEventForOrder(tx, order, massReadyItem.id, requiredMassRecipes);
  }

  private async prepareMassForEvent(
    tx: TransactionClient,
    event: Pick<MassPrepEvent, 'orderId' | 'massRecipes'>
  ) {
    const plannedRecipes = Math.max(Math.floor(event.massRecipes || 0), 0);
    if (plannedRecipes <= 0) {
      throw new BadRequestException('Evento FAZER MASSA sem receitas para preparar.');
    }

    const inventoryItems = await tx.inventoryItem.findMany({ orderBy: { id: 'asc' } });
    const inventoryByLookup = buildInventoryItemLookup(inventoryItems);
    const sourceLabel = this.orderFormulaSourceLabel(event.orderId);

    const massReadyItem = await this.ensureInventoryItemByAliases(tx, inventoryByLookup, {
      canonicalName: MASS_READY_ITEM_NAME,
      aliases: [MASS_READY_ITEM_NAME],
      category: 'INGREDIENTE',
      unit: 'receita',
      purchasePackSize: 1,
      purchasePackCost: 0
    });

    const plan: Array<{
      item: InventoryLookupItem;
      qtyPerRecipe: number;
      availableQty: number;
      displayName: string;
      unit: string;
    }> = [];
    let possibleRecipesFromIngredients = Number.POSITIVE_INFINITY;

    for (const ingredient of massPrepRecipeIngredients) {
      const item = await this.ensureInventoryItemByAliases(tx, inventoryByLookup, {
        canonicalName: ingredient.canonicalName,
        aliases: ingredient.aliases,
        category: ingredient.category,
        unit: ingredient.unit,
        purchasePackSize: ingredient.purchasePackSize,
        purchasePackCost: ingredient.purchasePackCost
      });
      const availableQty = this.toQty(
        await this.loadInventoryFamilyBalance(
          tx,
          resolveInventoryFamilyItemIds(inventoryItems, ingredient)
        )
      );
      const possibleForIngredient = ingredient.qtyPerRecipe
        ? Math.floor(availableQty / ingredient.qtyPerRecipe)
        : 0;
      possibleRecipesFromIngredients = Math.min(possibleRecipesFromIngredients, possibleForIngredient);
      plan.push({
        item,
        qtyPerRecipe: ingredient.qtyPerRecipe,
        availableQty,
        displayName: ingredient.canonicalName,
        unit: ingredient.unit
      });
    }

    const recipes = resolveExecutableMassPrepRecipes(
      MASS_PREP_DEFAULT_BATCH_RECIPES,
      Number.isFinite(possibleRecipesFromIngredients) ? possibleRecipesFromIngredients : 0
    );
    if (recipes <= 0) {
      const missingIngredients = plan.map(
        (ingredient) =>
          `${ingredient.displayName}: disponivel ${ingredient.availableQty} ${ingredient.unit}, necessario ${ingredient.qtyPerRecipe} ${ingredient.unit}`
      );
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
          quantity: this.toQty(ingredient.qtyPerRecipe * recipes),
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

    return recipes;
  }

  private async syncMassPrepEventStatusFromOrderStatus(
    tx: TransactionClient,
    orderId: number,
    orderStatus: string
  ) {
    const event = await this.getMassPrepEvent(tx, orderId);
    if (!event) return null;

    let nextStatus = event.status;

    if (orderStatus === 'EM_PREPARACAO' && event.status === 'PREPARO') {
      nextStatus = 'NO_FORNO';
    }

    if ((orderStatus === 'PRONTO' || orderStatus === 'ENTREGUE') && event.status !== 'PRONTA') {
      nextStatus = 'PRONTA';
    }

    if (nextStatus === event.status) {
      return event;
    }

    const updatedEvent = massPrepEventSchema.parse({
      ...event,
      status: nextStatus
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

  private intakeIdemKey(payload: OrderIntakePayload) {
    const rawKey = payload.source.idempotencyKey?.trim() || payload.source.externalId?.trim();
    if (!rawKey) return null;
    return `${payload.source.channel}:${rawKey}`;
  }

  private intakeRequestHash(payload: OrderIntakePayload) {
    return JSON.stringify(payload);
  }

  private intakeRecordExpiry() {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 10);
    return expiresAt;
  }

  private parseExternalOrderSubmission(
    payload: unknown,
    params: {
      defaultChannel: 'GOOGLE_FORM' | 'PUBLIC_FORM' | 'WHATSAPP_FLOW';
      defaultOriginLabel: string;
    }
  ) {
    const raw = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const source =
      raw.source && typeof raw.source === 'object' ? (raw.source as Record<string, unknown>) : {};

    return ExternalOrderSubmissionSchema.parse({
      ...raw,
      source: {
        ...source,
        channel: source.channel ?? params.defaultChannel,
        originLabel: source.originLabel ?? params.defaultOriginLabel
      }
    });
  }

  private async resolveActiveFlavorProductIdByCode() {
    const products = await this.prisma.product.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { id: 'asc' }
    });
    const productIdByCode = new Map<OrderFlavorCode, number>();

    for (const product of products) {
      const code = this.resolveOrderFlavorCodeFromProductName(product.name);
      if (!code || productIdByCode.has(code)) continue;
      productIdByCode.set(code, product.id);
    }

    return productIdByCode;
  }

  private buildOrderItemsFromFlavorCounts(
    flavorCounts: ExternalOrderSubmissionPayload['flavors'],
    productIdByCode: Map<OrderFlavorCode, number>
  ) {
    return (['T', 'G', 'D', 'Q', 'R'] as const)
      .map((code) => {
        const quantity = Math.max(Math.floor(flavorCounts[code] || 0), 0);
        if (quantity <= 0) return null;
        const productId = productIdByCode.get(code);
        if (!productId) {
          throw new BadRequestException(`Produto ativo nao encontrado para o sabor ${code}.`);
        }
        return { productId, quantity };
      })
      .filter((item): item is { productId: number; quantity: number } => Boolean(item));
  }

  private async intakeExternalSubmission(
    data: ExternalOrderSubmissionPayload,
    params: {
      intakeChannel: 'CUSTOMER_LINK' | 'WHATSAPP_FLOW';
    }
  ) {
    const productIdByCode = await this.resolveActiveFlavorProductIdByCode();
    const items = this.buildOrderItemsFromFlavorCounts(data.flavors, productIdByCode);

    return this.intake({
      version: 1,
      intent: 'CONFIRMED',
      customer: {
        name: data.customer.name,
        phone: data.customer.phone ?? null,
        address: data.customer.address ?? null,
        deliveryNotes: data.customer.deliveryNotes ?? null
      },
      fulfillment: {
        mode: data.fulfillment.mode,
        scheduledAt: data.fulfillment.scheduledAt
      },
      order: {
        items,
        notes: data.notes ?? undefined
      },
      payment: {
        method: 'pix',
        status: 'PENDENTE',
        dueAt: data.fulfillment.scheduledAt
      },
      source: {
        channel: params.intakeChannel,
        externalId: data.source.externalId ?? null,
        idempotencyKey: data.source.idempotencyKey ?? data.source.externalId ?? null,
        originLabel: data.source.originLabel ?? null
      }
    });
  }

  private normalizeCustomerName(value?: string | null) {
    return normalizeTitle(value ?? undefined) ?? normalizeText(value ?? undefined) ?? null;
  }

  private async resolveIntakeCustomer(
    tx: TransactionClient,
    customer: OrderIntakePayload['customer']
  ) {
    if ('customerId' in customer) {
      const existing = await tx.customer.findUnique({ where: { id: customer.customerId } });
      if (!existing) throw new NotFoundException('Cliente nao encontrado');
      if (existing.deletedAt) {
        throw new BadRequestException('Cliente foi excluido e nao pode receber novos pedidos.');
      }
      return existing;
    }

    const normalizedName = this.normalizeCustomerName(customer.name);
    if (!normalizedName) {
      throw new BadRequestException('Nome do cliente e obrigatorio.');
    }

    const normalizedPhone = normalizePhone(customer.phone);
    const normalizedAddress = normalizeTitle(customer.address ?? undefined) ?? null;
    const normalizedDeliveryNotes = normalizeText(customer.deliveryNotes ?? undefined);

    let existing = normalizedPhone
      ? await tx.customer.findFirst({
          where: {
            deletedAt: null,
            phone: normalizedPhone
          },
          orderBy: { id: 'desc' }
        })
      : null;

    if (!existing) {
      existing = await tx.customer.findFirst({
        where: {
          deletedAt: null,
          name: normalizedName
        },
        orderBy: { id: 'desc' }
      });
    }

    if (existing) {
      const shouldUpdate =
        (normalizedPhone && !existing.phone) ||
        (normalizedAddress && !existing.address) ||
        (normalizedDeliveryNotes && !existing.deliveryNotes);
      if (!shouldUpdate) return existing;

      return tx.customer.update({
        where: { id: existing.id },
        data: {
          phone: existing.phone || normalizedPhone,
          address: existing.address || normalizedAddress,
          deliveryNotes: existing.deliveryNotes || normalizedDeliveryNotes
        }
      });
    }

    return tx.customer.create({
      data: {
        name: normalizedName,
        firstName: normalizedName.split(' ')[0] || null,
        lastName: normalizedName.includes(' ') ? normalizedName.split(' ').slice(1).join(' ') : null,
        email: null,
        phone: normalizedPhone,
        address: normalizedAddress,
        addressLine1: normalizedAddress,
        addressLine2: null,
        neighborhood: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
        placeId: null,
        lat: null,
        lng: null,
        deliveryNotes: normalizedDeliveryNotes
      }
    });
  }

  private async priceOrderItems(
    tx: TransactionClient,
    items: Array<{ productId: number; quantity: number }>
  ) {
    const parsedItems = items.map((item) =>
      OrderItemSchema.pick({ productId: true, quantity: true }).parse(item)
    );
    const productIds = Array.from(new Set(parsedItems.map((item) => item.productId)));
    const products = await tx.product.findMany({ where: { id: { in: productIds } } });
    const productMap = new Map(products.map((product) => [product.id, product]));

    const itemsData: Array<{ productId: number; quantity: number; unitPrice: number; total: number }> = [];
    for (const item of parsedItems) {
      const product = productMap.get(item.productId);
      if (!product) throw new NotFoundException('Produto nao encontrado');
      const unitPrice = this.toUnitPrice(product.price);
      const total = this.toMoney(unitPrice * item.quantity);
      itemsData.push({ productId: item.productId, quantity: item.quantity, unitPrice, total });
    }

    const subtotal = await this.calculateOrderSubtotalFromItems(tx, parsedItems);
    return { parsedItems, itemsData, subtotal };
  }

  private intakeStageFrom(
    payload: OrderIntakePayload,
    order: ReturnType<OrdersService['withFinancial']>,
    payment: {
      id: number;
      status: string;
      paidAt: Date | null;
      dueDate: Date | null;
      providerRef: string | null;
      method: string;
    } | null
  ) {
    if (payload.intent === 'DRAFT') return 'DRAFT' as const;

    const pixStatus = payment && (payment.status === 'PAGO' || payment.paidAt) ? 'PAGO' : 'PENDENTE';
    if (payment && pixStatus === 'PENDENTE') return 'PIX_PENDING' as const;
    if (payment && pixStatus === 'PAGO' && order.scheduledAt) return 'SCHEDULED' as const;
    if (payment && pixStatus === 'PAGO') return 'PAID' as const;
    return 'CONFIRMED' as const;
  }

  private buildOrderIntakeMeta(
    payload: OrderIntakePayload,
    order: ReturnType<OrdersService['withFinancial']>,
    payment: {
      id: number;
      status: string;
      paidAt: Date | null;
      dueDate: Date | null;
      providerRef: string | null;
      method: string;
    } | null,
    pixCharge: PixCharge | null
  ) {
    const pixStatus = payment && (payment.status === 'PAGO' || payment.paidAt) ? 'PAGO' : 'PENDENTE';
    return OrderIntakeMetaSchema.parse({
      version: 1,
      channel: payload.source.channel,
      intent: payload.intent,
      stage: this.intakeStageFrom(payload, order, payment),
      fulfillmentMode: payload.fulfillment.mode,
      paymentMethod: 'pix',
      pixStatus,
      paymentId: payment?.id ?? null,
      dueAt: payment?.dueDate?.toISOString() ?? null,
      paidAt: payment?.paidAt?.toISOString() ?? null,
      providerRef: payment?.providerRef ?? null,
      pixCharge,
      orderId: order.id!,
      customerId: order.customerId
    });
  }

  private async findStoredIntakeResult(
    tx: TransactionClient,
    idemKey: string
  ): Promise<{ order: ReturnType<OrdersService['withFinancial']>; intake: OrderIntakeMeta } | null> {
    const record = await tx.idempotencyRecord.findUnique({
      where: {
        scope_idemKey: {
          scope: ORDER_INTAKE_SCOPE,
          idemKey
        }
      }
    });
    if (!record?.responseJson) return null;

    try {
      const parsed = JSON.parse(record.responseJson) as {
        orderId?: number;
        intake?: unknown;
      };
      if (!parsed.orderId || !parsed.intake) return null;
      const order = await tx.order.findUnique({
        where: { id: parsed.orderId },
        include: { items: true, customer: true, payments: true }
      });
      if (!order) return null;
      return {
        order: this.withFinancial(order),
        intake: OrderIntakeMetaSchema.parse({
          pixCharge: null,
          ...(typeof parsed.intake === 'object' && parsed.intake ? parsed.intake : {})
        })
      };
    } catch {
      return null;
    }
  }

  private async saveIntakeResult(
    tx: TransactionClient,
    idemKey: string,
    requestHash: string,
    result: { order: ReturnType<OrdersService['withFinancial']>; intake: OrderIntakeMeta }
  ) {
    await tx.idempotencyRecord.upsert({
      where: {
        scope_idemKey: {
          scope: ORDER_INTAKE_SCOPE,
          idemKey
        }
      },
      update: {
        requestHash,
        responseJson: JSON.stringify({
          orderId: result.order.id,
          intake: result.intake
        }),
        expiresAt: this.intakeRecordExpiry()
      },
      create: {
        scope: ORDER_INTAKE_SCOPE,
        idemKey,
        requestHash,
        responseJson: JSON.stringify({
          orderId: result.order.id,
          intake: result.intake
        }),
        expiresAt: this.intakeRecordExpiry()
      }
    });
  }

  async intake(payload: unknown) {
    const data = OrderIntakeSchema.parse(payload);

    return this.prisma.$transaction(async (tx) => {
      const idemKey = this.intakeIdemKey(data);
      const requestHash = this.intakeRequestHash(data);

      if (idemKey) {
        const existingRecord = await tx.idempotencyRecord.findUnique({
          where: {
            scope_idemKey: {
              scope: ORDER_INTAKE_SCOPE,
              idemKey
            }
          }
        });

        if (existingRecord) {
          if (existingRecord.requestHash !== requestHash) {
            throw new BadRequestException('Chave de idempotencia reutilizada com payload diferente.');
          }
          const stored = await this.findStoredIntakeResult(tx, idemKey);
          if (stored) return stored;
        }
      }

      const customer = await this.resolveIntakeCustomer(tx, data.customer);
      const { itemsData, subtotal } = await this.priceOrderItems(tx, data.order.items);
      const discount = this.toMoney(data.order.discount ?? 0);
      const total = this.toMoney(Math.max(subtotal - discount, 0));
      const scheduledAt = this.parseOptionalDateTime(data.fulfillment.scheduledAt);

      const createdOrder = await tx.order.create({
        data: {
          customerId: customer.id,
          status: 'ABERTO',
          notes: data.order.notes ?? null,
          scheduledAt,
          subtotal,
          discount,
          total,
          items: {
            create: itemsData
          }
        },
        include: { items: true, customer: true, payments: true }
      });

      let paymentRecord: {
        id: number;
        orderId: number;
        amount: number;
        status: string;
        paidAt: Date | null;
        dueDate: Date | null;
        providerRef: string | null;
        method: string;
      } | null = null;

      if (data.intent !== 'DRAFT' && data.payment) {
        paymentRecord = await tx.payment.create({
          data: {
            orderId: createdOrder.id,
            amount: total,
            method: 'pix',
            status: data.payment.status,
            dueDate: data.payment.dueAt ? new Date(data.payment.dueAt) : scheduledAt,
            paidAt:
              data.payment.status === 'PAGO'
                ? data.payment.paidAt
                  ? new Date(data.payment.paidAt)
                  : new Date()
                : null,
            providerRef: data.payment.providerRef ?? null
          }
        });

        if (paymentRecord.status !== 'PAGO' && !paymentRecord.paidAt) {
          paymentRecord = await this.paymentsService.ensurePixChargeOnRecord(tx, paymentRecord);
        }
      }

      const hydratedOrder = await tx.order.findUnique({
        where: { id: createdOrder.id },
        include: { items: true, customer: true, payments: true }
      });
      if (!hydratedOrder) throw new NotFoundException('Pedido nao encontrado');

      await this.syncOrderInventoryAndMassPrepEvent(tx, hydratedOrder);

      const freshOrder = await tx.order.findUnique({
        where: { id: createdOrder.id },
        include: { items: true, customer: true, payments: true }
      });
      if (!freshOrder) throw new NotFoundException('Pedido nao encontrado');

      const order = this.withFinancial(freshOrder);
      const latestPayment =
        paymentRecord
          ? freshOrder.payments.find((entry) => entry.id === paymentRecord?.id) ?? paymentRecord
          : null;
      const pixCharge =
        latestPayment && latestPayment.method === 'pix'
          ? this.paymentsService.buildPixCharge(latestPayment)
          : null;
      const result = {
        order,
        intake: this.buildOrderIntakeMeta(data, order, latestPayment, pixCharge)
      };

      if (idemKey) {
        await this.saveIntakeResult(tx, idemKey, requestHash, result);
      }

      return result;
    });
  }

  async intakeWhatsAppFlow(payload: unknown) {
    const data = whatsappFlowIntakeSchema.parse(payload);
    return this.intake({
      ...data,
      payment: data.payment ?? {
        method: 'pix',
        status: 'PENDENTE',
        dueAt: data.fulfillment.scheduledAt ?? null
      },
      source: {
        channel: 'WHATSAPP_FLOW',
        externalId: data.source.externalId ?? null,
        idempotencyKey: data.source.idempotencyKey ?? data.source.externalId ?? null,
        originLabel: data.source.originLabel ?? 'whatsapp-flow'
      }
    });
  }

  async intakeCustomerForm(payload: unknown) {
    const data = this.parseExternalOrderSubmission(payload, {
      defaultChannel: 'PUBLIC_FORM',
      defaultOriginLabel: 'customer-form'
    });
    return this.intakeExternalSubmission(data, {
      intakeChannel: data.source.channel === 'WHATSAPP_FLOW' ? 'WHATSAPP_FLOW' : 'CUSTOMER_LINK'
    });
  }

  async intakeGoogleForm(payload: unknown) {
    const data = this.parseExternalOrderSubmission(payload, {
      defaultChannel: 'GOOGLE_FORM',
      defaultOriginLabel: 'google-form'
    });
    return this.intakeExternalSubmission(data, {
      intakeChannel: 'CUSTOMER_LINK'
    });
  }

  async getPixCharge(orderId: number) {
    return this.paymentsService.getOrderPixCharge(orderId);
  }

  async sendPixChargeWhatsApp(orderId: number) {
    const order = await this.getRaw(orderId);
    const financialOrder = this.withFinancial(order);
    if (financialOrder.paymentStatus === 'PAGO') {
      throw new BadRequestException('Pedido ja esta pago. Nao ha PIX para enviar.');
    }

    const phone = normalizePhone(order.customer?.phone);
    if (!phone) {
      throw new BadRequestException('Cliente sem telefone valido para WhatsApp.');
    }

    const pixCharge = await this.paymentsService.getOrderPixCharge(orderId);
    if (!pixCharge.payable) {
      throw new BadRequestException('Cobranca PIX ainda nao esta pronta para envio.');
    }

    const amount = financialOrder.balanceDue > 0 ? financialOrder.balanceDue : financialOrder.total;
    const customerName =
      normalizeTitle(order.customer?.firstName || order.customer?.name || undefined) ?? 'cliente';

    return this.whatsAppService.sendPixCharge({
      customerName,
      phone,
      orderId: order.id,
      amountLabel: this.formatCurrencyBR(amount),
      copyPasteCode: pixCharge.copyPasteCode
    });
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
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true }
      });
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

      let preparedRecipes = event.massRecipes;
      if (event.status === 'INGREDIENTES' && data.status === 'PREPARO') {
        preparedRecipes = await this.prepareMassForEvent(tx, event);
      }

      const updated = massPrepEventSchema.parse({
        ...event,
        massRecipes: preparedRecipes,
        status: data.status
      });
      await this.saveMassPrepEvent(tx, updated);

      if (data.status === 'NO_FORNO' && order.status !== 'EM_PREPARACAO') {
        const allowedOrderStatuses = statusTransitions[order.status] || [];
        if (!allowedOrderStatuses.includes('EM_PREPARACAO')) {
          throw new BadRequestException(
            `Pedido nao pode sincronizar para NO FORNO a partir de ${order.status}.`
          );
        }
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'EM_PREPARACAO' }
        });
      }

      if (data.status === 'PRONTA' && order.status !== 'PRONTO') {
        const allowedOrderStatuses = statusTransitions[order.status] || [];
        if (!allowedOrderStatuses.includes('PRONTO')) {
          throw new BadRequestException(
            `Pedido nao pode sincronizar para PRONTO a partir de ${order.status}.`
          );
        }
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'PRONTO' }
        });
      }

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
    const result = await this.intake({
      version: 1,
      intent: 'CONFIRMED',
      customer: {
        customerId: data.customerId
      },
      fulfillment: {
        mode: 'DELIVERY',
        scheduledAt: data.scheduledAt ?? undefined
      },
      order: {
        items,
        discount: data.discount ?? 0,
        notes: data.notes ?? undefined
      },
      payment: {
        method: 'pix',
        status: 'PENDENTE',
        dueAt: data.scheduledAt ?? undefined
      },
      source: {
        channel: 'INTERNAL_DASHBOARD',
        originLabel: 'legacy-post-orders'
      }
    });

    return result.order;
  }

  async update(id: number, payload: unknown) {
    const data = updateSchema.parse(payload);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({
        where: { id },
        include: { items: true, customer: true, payments: true }
      });
      if (!existing) throw new NotFoundException('Pedido nao encontrado');
      const previousTargetDate = this.orderTargetDate(existing).date;

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

      await this.syncOrderInventoryAndMassPrepEvent(tx, updated);
      const nextTargetDate = this.orderTargetDate(updated).date;
      if (nextTargetDate !== previousTargetDate) {
        await this.syncPaperBagReservationsForCustomerDateGroup(tx, {
          customerId: updated.customerId,
          targetDate: previousTargetDate
        });
      }
      return this.withFinancial(updated);
    });
  }

  async remove(id: number) {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Pedido nao encontrado');
      const targetDate = this.orderTargetDate(order).date;

      await this.clearOrderFormulaArtifacts(tx, id);
      await tx.order.delete({ where: { id } });
      await this.clearMassPrepEventArtifact(tx, id);
      await this.syncPaperBagReservationsForCustomerDateGroup(tx, {
        customerId: order.customerId,
        targetDate
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
      if (status === 'CANCELADO') {
        await this.clearOrderFormulaArtifacts(tx, orderId);
        await this.clearMassPrepEventArtifact(tx, orderId);
        await this.syncPaperBagReservationsForCustomerDateGroup(tx, {
          customerId: updatedOrder.customerId,
          targetDate: this.orderTargetDate(updatedOrder).date
        });
      }
      if (status === 'EM_PREPARACAO' || status === 'PRONTO' || status === 'ENTREGUE') {
        await this.syncMassPrepEventStatusFromOrderStatus(tx, orderId, status);
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

      const reusablePendingPayment = order.payments.find(
        (payment) =>
          payment.status !== 'PAGO' &&
          !payment.paidAt &&
          payment.method.trim().toLowerCase() === 'pix' &&
          Math.abs(this.toMoney(payment.amount) - balanceDue) <= 0.00001
      );

      if (reusablePendingPayment) {
        await tx.payment.update({
          where: { id: reusablePendingPayment.id },
          data: {
            status: 'PAGO',
            paidAt: data.paidAt ? new Date(data.paidAt) : new Date()
          }
        });
      } else {
        await tx.payment.create({
          data: {
            orderId: order.id,
            amount: balanceDue,
            method: 'pix',
            status: 'PAGO',
            paidAt: data.paidAt ? new Date(data.paidAt) : new Date()
          }
        });
      }

      const updated = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, customer: true, payments: true }
      });
      if (!updated) throw new NotFoundException('Pedido nao encontrado');
      return this.withFinancial(updated);
    });
  }
}
