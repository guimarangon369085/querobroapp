import { BadRequestException, Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Customer as PrismaCustomer, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service.js';
import {
  compareMoney,
  ExternalOrderScheduleAvailabilitySchema,
  ExternalOrderSubmissionPreviewSchema,
  ExternalOrderSubmissionSchema,
  moneyFromMinorUnits,
  moneyToMinorUnits,
  OrderIntakeMetaSchema,
  OrderIntakeSchema,
  OrderItemSchema,
  OrderSchema,
  OrderStatusEnum,
  PixChargeSchema,
  roundMoney
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
import {
  externalOrderScheduleAvailabilityErrorMessage,
  externalOrderScheduleErrorMessage,
  isExternalOrderScheduleAllowed,
  resolveExternalOrderScheduleAvailability
} from '../../common/external-order-schedule.js';
import { allocateNextPublicNumber } from '../../common/public-sequence.js';
import { PaymentsService } from '../payments/payments.service.js';
import { WhatsAppService } from '../whatsapp/whatsapp.service.js';
import { DeliveriesService } from '../deliveries/deliveries.service.js';
import { OrderNotificationsService } from './order-notifications.service.js';

const updateSchema = OrderSchema.partial().omit({ id: true, publicNumber: true, createdAt: true, items: true });
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
const ORDER_WORKFLOW_STATUSES = ['ABERTO', 'CONFIRMADO', 'EM_PREPARACAO', 'PRONTO', 'ENTREGUE'] as const;

type OrderStatusValue = z.infer<typeof OrderStatusEnum>;
type OrderWorkflowStatus = (typeof ORDER_WORKFLOW_STATUSES)[number];

function isOrderWorkflowStatus(status: string): status is OrderWorkflowStatus {
  return ORDER_WORKFLOW_STATUSES.includes(status as OrderWorkflowStatus);
}

function resolveOrderStatusPath(currentStatus: string, targetStatus: OrderStatusValue) {
  if (currentStatus === targetStatus) {
    return [] as OrderStatusValue[];
  }

  const directTransitions = statusTransitions[currentStatus] || [];
  if (directTransitions.includes(targetStatus)) {
    return [targetStatus];
  }

  if (!isOrderWorkflowStatus(currentStatus) || !isOrderWorkflowStatus(targetStatus)) {
    throw new BadRequestException(`Transicao invalida: ${currentStatus} -> ${targetStatus}`);
  }

  const currentIndex = ORDER_WORKFLOW_STATUSES.indexOf(currentStatus);
  const targetIndex = ORDER_WORKFLOW_STATUSES.indexOf(targetStatus);
  if (currentIndex < 0 || targetIndex < 0) {
    throw new BadRequestException(`Transicao invalida: ${currentStatus} -> ${targetStatus}`);
  }

  const direction = targetIndex > currentIndex ? 1 : -1;
  const path: OrderStatusValue[] = [];
  let cursor = currentStatus;

  for (
    let index = currentIndex + direction;
    direction > 0 ? index <= targetIndex : index >= targetIndex;
    index += direction
  ) {
    const candidate = ORDER_WORKFLOW_STATUSES[index];
    if (!candidate) {
      break;
    }

    const allowedTransitions = statusTransitions[cursor] || [];
    if (!allowedTransitions.includes(candidate)) {
      throw new BadRequestException(`Transicao invalida: ${currentStatus} -> ${targetStatus}`);
    }

    path.push(candidate);
    cursor = candidate;
  }

  if (path[path.length - 1] !== targetStatus) {
    throw new BadRequestException(`Transicao invalida: ${currentStatus} -> ${targetStatus}`);
  }

  return path;
}

const MASS_PREP_EVENT_SCOPE = 'MASS_PREP_EVENT';
const ORDER_INTAKE_SCOPE = 'ORDER_INTAKE';
const MASS_PREP_EVENT_NAME = 'FAZER MASSA';
const MASS_PREP_EVENT_DURATION_MINUTES = 60;
const ORDER_BOX_PRICE_CUSTOM = 52;
const ORDER_BOX_PRICE_TRADITIONAL = 40;
const ORDER_BOX_PRICE_MIXED_GOIABADA = 45;
const ORDER_BOX_PRICE_MIXED_OTHER = 47;
const ORDER_BOX_PRICE_GOIABADA = 50;
const ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS = moneyToMinorUnits(ORDER_BOX_PRICE_CUSTOM);
const ORDER_BOX_PRICE_TRADITIONAL_MINOR_UNITS = moneyToMinorUnits(ORDER_BOX_PRICE_TRADITIONAL);
const ORDER_BOX_PRICE_MIXED_GOIABADA_MINOR_UNITS = moneyToMinorUnits(ORDER_BOX_PRICE_MIXED_GOIABADA);
const ORDER_BOX_PRICE_MIXED_OTHER_MINOR_UNITS = moneyToMinorUnits(ORDER_BOX_PRICE_MIXED_OTHER);
const ORDER_BOX_PRICE_GOIABADA_MINOR_UNITS = moneyToMinorUnits(ORDER_BOX_PRICE_GOIABADA);
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
type OrderScheduleQueryClient = Pick<PrismaService | TransactionClient, 'order'>;
type OrderIntakePayload = z.infer<typeof OrderIntakeSchema>;
type OrderIntakeMeta = z.infer<typeof OrderIntakeMetaSchema>;
type PixCharge = z.infer<typeof PixChargeSchema>;
type ExternalOrderSubmissionPayload = z.infer<typeof ExternalOrderSubmissionSchema>;
type ExternalOrderSubmissionPreview = z.infer<typeof ExternalOrderSubmissionPreviewSchema>;

type MassPrepEvent = z.infer<typeof massPrepEventSchema>;
type OrderFlavorCode = 'T' | 'G' | 'D' | 'Q' | 'R';
type FillingFlavorCode = Exclude<OrderFlavorCode, 'T'>;
type OrderPricingFlavorKind = 'TRADITIONAL' | 'GOIABADA' | 'PREMIUM';
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
    @Inject(forwardRef(() => WhatsAppService)) private readonly whatsAppService: WhatsAppService,
    @Inject(DeliveriesService) private readonly deliveriesService: DeliveriesService,
    @Inject(OrderNotificationsService) private readonly orderNotificationsService: OrderNotificationsService
  ) {}

  private toMoney(value: number) {
    return roundMoney(value);
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
    return roundMoney(parsed);
  }

  private computeOrderTotal(subtotal: number, discount: number, deliveryFee: number) {
    const subtotalAfterDiscount = Math.max(
      moneyToMinorUnits(subtotal) - moneyToMinorUnits(discount),
      0
    );
    return moneyFromMinorUnits(subtotalAfterDiscount + moneyToMinorUnits(deliveryFee));
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

  private resolveOrderPricingFlavorKindFromProductName(value?: string | null): OrderPricingFlavorKind {
    const flavorCode = this.resolveOrderFlavorCodeFromProductName(value);
    if (flavorCode === 'T') return 'TRADITIONAL';
    if (flavorCode === 'G') return 'GOIABADA';
    return 'PREMIUM';
  }

  private buildOfficialBroaSummaryFromItems(
    items: Array<{ productId: number; quantity: number }>,
    productNameById: Map<number, string>
  ) {
    return buildOfficialBroaFlavorSummary(items, productNameById);
  }

  private sumTripletsByCounts(counts: number[]) {
    return counts.reduce((sum, quantity) => sum + Math.floor(Math.max(quantity || 0, 0) / 3), 0);
  }

  private maxSameFlavorFullBoxesAfterTriplets(counts: number[], tripletsToUse: number) {
    const normalizedCounts = counts.map((quantity) => Math.max(Math.floor(quantity || 0), 0));
    const memo = new Map<string, number>();

    const walk = (index: number, remainingTriplets: number): number => {
      const memoKey = `${index}:${remainingTriplets}`;
      const cached = memo.get(memoKey);
      if (typeof cached === 'number') return cached;

      if (index >= normalizedCounts.length) {
        return remainingTriplets === 0 ? 0 : Number.NEGATIVE_INFINITY;
      }

      const quantity = normalizedCounts[index] || 0;
      const maxTripletsHere = Math.min(Math.floor(quantity / 3), remainingTriplets);
      let best = Number.NEGATIVE_INFINITY;
      for (let usedTriplets = 0; usedTriplets <= maxTripletsHere; usedTriplets += 1) {
        const remainingBoxes = walk(index + 1, remainingTriplets - usedTriplets);
        if (!Number.isFinite(remainingBoxes)) continue;
        const totalBoxes = Math.floor((quantity - usedTriplets * 3) / ORDER_BOX_UNITS) + remainingBoxes;
        if (totalBoxes > best) best = totalBoxes;
      }

      memo.set(memoKey, best);
      return best;
    };

    const result = walk(0, Math.max(Math.floor(tripletsToUse || 0), 0));
    return Number.isFinite(result) ? result : 0;
  }

  private calculateSubtotalFromProductQuantities(params: {
    totalUnits: number;
    quantityByProductId: Map<number, number>;
    productNameById: Map<number, string>;
  }) {
    const { totalUnits, quantityByProductId, productNameById } = params;
    if (totalUnits <= 0) return 0;

    const fullBoxes = Math.floor(totalUnits / ORDER_BOX_UNITS);
    const openUnits = totalUnits % ORDER_BOX_UNITS;
    if (fullBoxes <= 0) {
      return moneyFromMinorUnits(Math.round((ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS / ORDER_BOX_UNITS) * openUnits));
    }

    let countTraditional = 0;
    const goiabadaCounts: number[] = [];
    const premiumCounts: number[] = [];

    for (const [productId, quantity] of quantityByProductId.entries()) {
      const kind = this.resolveOrderPricingFlavorKindFromProductName(productNameById.get(productId));
      if (kind === 'TRADITIONAL') {
        countTraditional += quantity;
        continue;
      }
      if (kind === 'GOIABADA') {
        goiabadaCounts.push(quantity);
        continue;
      }
      premiumCounts.push(quantity);
    }

    const goiabadaTriplets = this.sumTripletsByCounts(goiabadaCounts);
    const otherTriplets = this.sumTripletsByCounts(premiumCounts);

    const discountTraditional = ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS - ORDER_BOX_PRICE_TRADITIONAL_MINOR_UNITS;
    const discountMixedGoiabada =
      ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS - ORDER_BOX_PRICE_MIXED_GOIABADA_MINOR_UNITS;
    const discountMixedOther = ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS - ORDER_BOX_PRICE_MIXED_OTHER_MINOR_UNITS;
    const discountGoiabada = ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS - ORDER_BOX_PRICE_GOIABADA_MINOR_UNITS;

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
          const goiabadaBoxes = Math.min(
            this.maxSameFlavorFullBoxesAfterTriplets(goiabadaCounts, mixedGoiabada),
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

    const fullBoxesSubtotal = fullBoxes * ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS - bestDiscount;
    const openBoxSubtotal =
      openUnits > 0 ? Math.round((ORDER_BOX_PRICE_CUSTOM_MINOR_UNITS / ORDER_BOX_UNITS) * openUnits) : 0;

    return moneyFromMinorUnits(fullBoxesSubtotal + openBoxSubtotal);
  }

  private async calculateOrderSubtotalFromItems(
    tx: TransactionClient | PrismaService,
    items: Array<{ productId: number; quantity: number }>
  ) {
    if (items.length <= 0) return 0;
    const productIds = Array.from(new Set(items.map((item) => item.productId)));
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true }
    });
    const productNameById = new Map(products.map((product) => [product.id, product.name]));
    const quantityByProductId = new Map<number, number>();
    let totalUnits = 0;

    for (const item of items) {
      const quantity = Math.max(Math.floor(item.quantity || 0), 0);
      if (quantity <= 0) continue;
      totalUnits += quantity;
      quantityByProductId.set(item.productId, (quantityByProductId.get(item.productId) || 0) + quantity);
    }

    return this.calculateSubtotalFromProductQuantities({
      totalUnits,
      quantityByProductId,
      productNameById
    });
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

  private async hasPhysicalInventoryMovements(tx: TransactionClient, orderId: number) {
    const movements = await tx.inventoryMovement.count({
      where: {
        orderId,
        OR: [{ source: null }, { source: { notIn: [...ORDER_FORMULA_SOURCES] } }]
      }
    });
    return movements > 0;
  }

  private async assertOrderItemsMutable(
    tx: TransactionClient,
    order: Pick<OrderWithRelations, 'id' | 'status'>
  ) {
    if (!['ABERTO', 'CONFIRMADO'].includes(order.status)) {
      throw new BadRequestException('Pedido nao permite alterar itens neste status');
    }
    if (await this.hasPhysicalInventoryMovements(tx, order.id)) {
      throw new BadRequestException(
        'Pedido nao permite alterar itens apos gerar movimentacoes fisicas de estoque.'
      );
    }
  }

  private async assertOrderRemovable(tx: TransactionClient, orderId: number) {
    if (await this.hasPhysicalInventoryMovements(tx, orderId)) {
      throw new BadRequestException(
        'Pedido com movimentacoes fisicas de estoque nao pode ser excluido.'
      );
    }
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
    return moneyFromMinorUnits(
      payments.reduce((sum, payment) => {
        const isPaid = payment.status === 'PAGO' || Boolean(payment.paidAt);
        return isPaid ? sum + moneyToMinorUnits(payment.amount) : sum;
      }, 0)
    );
  }

  private deriveOrderPaymentStatus(total: number, amountPaid: number) {
    if (compareMoney(amountPaid, 0) <= 0) return 'PENDENTE';
    if (compareMoney(amountPaid, total) >= 0) return 'PAGO';
    return 'PARCIAL';
  }

  private ensureOrderTotalCoversPaid(total: number, amountPaid: number) {
    const normalizedTotal = moneyToMinorUnits(total);
    const normalizedAmountPaid = moneyToMinorUnits(amountPaid);
    if (normalizedAmountPaid > normalizedTotal) {
      throw new BadRequestException(
        `Total do pedido nao pode ficar abaixo do valor ja pago. Total=${moneyFromMinorUnits(normalizedTotal)} Pago=${moneyFromMinorUnits(normalizedAmountPaid)}`
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

  private async buildExternalOrderScheduleAvailability(
    client: OrderScheduleQueryClient,
    options: {
      requestedAt?: Date | null;
      excludeOrderId?: number | null;
      reference?: Date;
    }
  ) {
    const scheduledOrders = await client.order.findMany({
      where: {
        scheduledAt: { not: null },
        status: { not: 'CANCELADO' },
        ...(options.excludeOrderId ? { id: { not: options.excludeOrderId } } : {})
      },
      select: { scheduledAt: true }
    });

    const availability = resolveExternalOrderScheduleAvailability({
      scheduledOrders: scheduledOrders.map((entry) => entry.scheduledAt),
      requestedAt: options.requestedAt ?? null,
      reference: options.reference
    });

    return ExternalOrderScheduleAvailabilitySchema.parse({
      minimumAllowedAt: availability.minimumAllowedAt.toISOString(),
      nextAvailableAt: availability.nextAvailableAt.toISOString(),
      requestedAt: availability.requestedAt ? availability.requestedAt.toISOString() : null,
      requestedAvailable: availability.requestedAvailable,
      reason: availability.reason,
      dailyLimit: availability.dailyLimit,
      slotMinutes: availability.slotMinutes,
      dayOrderCount: availability.dayOrderCount,
      slotTaken: availability.slotTaken
    });
  }

  private async ensureOrderScheduleCapacityAllowed(
    client: OrderScheduleQueryClient,
    scheduledAt: Date | null,
    options: {
      excludeOrderId?: number | null;
      reference?: Date;
    } = {}
  ) {
    if (!scheduledAt) {
      throw new BadRequestException('Data/hora do pedido invalida.');
    }
    const availability = await this.buildExternalOrderScheduleAvailability(client, {
      requestedAt: scheduledAt,
      excludeOrderId: options.excludeOrderId,
      reference: options.reference
    });
    if (availability.requestedAvailable) return availability;
    throw new BadRequestException({
      message: externalOrderScheduleAvailabilityErrorMessage(availability),
      nextAvailableAt: availability.nextAvailableAt,
      reason: availability.reason,
      dailyLimit: availability.dailyLimit
    });
  }

  private async ensurePublicOrderScheduleAllowed(
    scheduledAt: Date | null,
    options: {
      excludeOrderId?: number | null;
      reference?: Date;
    } = {}
  ) {
    if (!scheduledAt) {
      throw new BadRequestException('Data/hora do pedido invalida.');
    }
    if (!isExternalOrderScheduleAllowed(scheduledAt, options.reference)) {
      throw new BadRequestException(externalOrderScheduleErrorMessage(options.reference));
    }
    return this.ensureOrderScheduleCapacityAllowed(this.prisma, scheduledAt, options);
  }

  async getPublicScheduleAvailability(requestedAt?: string | null) {
    const parsedRequestedAt = this.parseOptionalDateTime(requestedAt ?? null);
    return this.buildExternalOrderScheduleAvailability(this.prisma, {
      requestedAt: parsedRequestedAt
    });
  }

  private withFinancial(order: OrderWithRelations) {
    const total = this.toMoney(order.total ?? 0);
    const amountPaid = this.getPaidAmount(order.payments || []);
    const balanceDue = moneyFromMinorUnits(Math.max(moneyToMinorUnits(total) - moneyToMinorUnits(amountPaid), 0));
    const paymentStatus = this.deriveOrderPaymentStatus(total, amountPaid);
    return {
      ...order,
      deliveryProvider: this.normalizeDeliveryProvider(order.deliveryProvider),
      deliveryFeeSource: this.normalizeDeliveryFeeSource(order.deliveryFeeSource),
      deliveryQuoteStatus: this.normalizeDeliveryQuoteStatus(order.deliveryQuoteStatus),
      amountPaid,
      balanceDue,
      paymentStatus
    };
  }

  private normalizeDeliveryProvider(provider: string | null | undefined) {
    if (provider === 'NONE' || provider === 'LOCAL') {
      return provider;
    }
    return 'NONE';
  }

  private normalizeDeliveryFeeSource(source: string | null | undefined) {
    if (source === 'NONE' || source === 'MANUAL_FALLBACK') {
      return source;
    }
    return 'NONE';
  }

  private normalizeDeliveryQuoteStatus(status: string | null | undefined) {
    if (
      status === 'NOT_REQUIRED' ||
      status === 'PENDING' ||
      status === 'QUOTED' ||
      status === 'FALLBACK' ||
      status === 'EXPIRED' ||
      status === 'FAILED'
    ) {
      return status;
    }
    return 'NOT_REQUIRED';
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

  private normalizeExternalSubmissionItems(
    items?: Array<{ productId: number; quantity?: number | null }>
  ) {
    const quantityByProductId = new Map<number, number>();

    for (const item of items || []) {
      const productId = Number(item.productId || 0);
      const quantity = Math.max(Math.floor(item.quantity || 0), 0);
      if (!Number.isFinite(productId) || productId <= 0 || quantity <= 0) continue;
      quantityByProductId.set(productId, (quantityByProductId.get(productId) || 0) + quantity);
    }

    return Array.from(quantityByProductId.entries()).map(([productId, quantity]) => ({
      productId,
      quantity
    }));
  }

  private async resolveExternalSubmissionItems(data: ExternalOrderSubmissionPayload) {
    const explicitItems = this.normalizeExternalSubmissionItems(
      (data as ExternalOrderSubmissionPayload & {
        items?: Array<{ productId: number; quantity?: number | null }>;
      }).items
    );
    if (explicitItems.length > 0) return explicitItems;

    const productIdByCode = await this.resolveActiveFlavorProductIdByCode();
    return this.buildOrderItemsFromFlavorCounts(data.flavors, productIdByCode);
  }

  private async intakeExternalSubmission(
    data: ExternalOrderSubmissionPayload,
    params: {
      intakeChannel: 'CUSTOMER_LINK' | 'WHATSAPP_FLOW';
    }
  ) {
    await this.ensurePublicOrderScheduleAllowed(this.parseOptionalDateTime(data.fulfillment.scheduledAt));
    const items = await this.resolveExternalSubmissionItems(data);

    return this.intake({
      version: 1,
      intent: 'CONFIRMED',
      customer: {
        name: data.customer.name,
        phone: data.customer.phone ?? null,
        address: data.customer.address ?? null,
        placeId: data.customer.placeId ?? null,
        lat: data.customer.lat ?? null,
        lng: data.customer.lng ?? null,
        deliveryNotes: data.customer.deliveryNotes ?? null
      },
      fulfillment: {
        mode: data.fulfillment.mode,
        scheduledAt: data.fulfillment.scheduledAt
      },
      delivery: data.delivery,
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

  private async previewExternalSubmission(
    data: ExternalOrderSubmissionPayload,
    params: {
      intakeChannel: 'CUSTOMER_LINK' | 'WHATSAPP_FLOW';
    }
  ): Promise<ExternalOrderSubmissionPreview> {
    await this.ensurePublicOrderScheduleAllowed(this.parseOptionalDateTime(data.fulfillment.scheduledAt));

    const items = await this.resolveExternalSubmissionItems(data);
    const pricedOrder = await this.priceOrderItems(this.prisma, items);
    const scheduledAt = this.parseOptionalDateTime(data.fulfillment.scheduledAt);
    const deliveryQuote = await this.deliveriesService.resolveDeliverySelection(
      data.delivery,
      this.buildDeliveryQuoteDraft({
        fulfillmentMode: data.fulfillment.mode,
        scheduledAt: scheduledAt?.toISOString() ?? data.fulfillment.scheduledAt ?? null,
        customerName: data.customer.name,
        customerPhone: data.customer.phone ?? null,
        customerAddress: data.customer.address ?? null,
        customerPlaceId: data.customer.placeId ?? null,
        customerLat: data.customer.lat ?? null,
        customerLng: data.customer.lng ?? null,
        customerDeliveryNotes: data.customer.deliveryNotes ?? null,
        items: pricedOrder.manifestItems,
        subtotal: pricedOrder.subtotal
      }),
      {
        enforceExternalSchedule: true,
        allowManualFallback: false
      }
    );

    const deliveryFee = this.toMoney(deliveryQuote.fee ?? 0);
    const discount = 0;
    const total = this.computeOrderTotal(pricedOrder.subtotal, discount, deliveryFee);

    return ExternalOrderSubmissionPreviewSchema.parse({
      version: 1,
      channel: params.intakeChannel,
      expectedStage: 'PIX_PENDING',
      fulfillmentMode: data.fulfillment.mode,
      scheduledAt: data.fulfillment.scheduledAt,
      customer: {
        name: data.customer.name,
        phone: data.customer.phone ?? null,
        address: data.customer.address ?? null,
        placeId: data.customer.placeId ?? null,
        lat: data.customer.lat ?? null,
        lng: data.customer.lng ?? null,
        deliveryNotes: data.customer.deliveryNotes ?? null
      },
      order: {
        items: pricedOrder.itemsData.map((item) => ({
          ...item,
          name: pricedOrder.manifestItems.find((entry) => entry.productId === item.productId)?.name || 'Produto'
        })),
        totalUnits: pricedOrder.parsedItems.reduce((sum, item) => sum + Math.max(item.quantity || 0, 0), 0),
        subtotal: pricedOrder.subtotal,
        discount,
        deliveryFee,
        total,
        notes: data.notes ?? null
      },
      delivery: deliveryQuote,
      payment: {
        method: 'pix',
        status: 'PENDENTE',
        payable: false,
        dueAt: data.fulfillment.scheduledAt
      },
      source: {
        channel: data.source.channel,
        externalId: data.source.externalId ?? null,
        idempotencyKey: data.source.idempotencyKey ?? data.source.externalId ?? null,
        originLabel: data.source.originLabel ?? null
      }
    });
  }

  private buildDeliveryQuoteDraft(input: {
    fulfillmentMode: 'DELIVERY' | 'PICKUP';
    scheduledAt?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    customerAddress?: string | null;
    customerPlaceId?: string | null;
    customerLat?: number | null;
    customerLng?: number | null;
    customerDeliveryNotes?: string | null;
    subtotal: number;
    items: Array<{ productId: number; quantity: number; name?: string | null }>;
  }) {
    return {
      mode: input.fulfillmentMode,
      scheduledAt: input.scheduledAt || new Date().toISOString(),
      customer: {
        name: input.customerName ?? null,
        phone: input.customerPhone ?? null,
        address: input.customerAddress ?? null,
        placeId: input.customerPlaceId ?? null,
        lat: input.customerLat ?? null,
        lng: input.customerLng ?? null,
        deliveryNotes: input.customerDeliveryNotes ?? null
      },
      manifest: {
        items: input.items.map((item) => ({
          name: item.name || `Produto ${item.productId}`,
          quantity: item.quantity
        })),
        subtotal: this.toMoney(input.subtotal),
        totalUnits: input.items.reduce((sum, item) => sum + Math.max(Math.floor(item.quantity || 0), 0), 0)
      }
    };
  }

  private normalizeCustomerName(value?: string | null) {
    return normalizeTitle(value ?? undefined) ?? normalizeText(value ?? undefined) ?? null;
  }

  private async ensureCustomerPublicNumber(tx: TransactionClient, customer: PrismaCustomer) {
    if (customer.publicNumber) return customer;
    return tx.customer.update({
      where: { id: customer.id },
      data: {
        publicNumber: await allocateNextPublicNumber(tx, 'CUSTOMER')
      }
    });
  }

  private customerIdentityScore(customer: {
    phone?: string | null;
    address?: string | null;
    placeId?: string | null;
    lat?: number | null;
    lng?: number | null;
    deliveryNotes?: string | null;
  }) {
    let score = 0;
    if (customer.phone) score += 4;
    if (customer.placeId) score += 4;
    if (customer.address) score += 3;
    if (typeof customer.lat === 'number' && Number.isFinite(customer.lat)) score += 2;
    if (typeof customer.lng === 'number' && Number.isFinite(customer.lng)) score += 2;
    if (customer.deliveryNotes) score += 1;
    return score;
  }

  private async mergeCustomersByPhone(
    tx: TransactionClient,
    customers: Array<{
      id: number;
      publicNumber: number | null;
      name: string;
      firstName: string | null;
      lastName: string | null;
      activePhoneKey: string | null;
      phone: string | null;
      address: string | null;
      addressLine1: string | null;
      addressLine2: string | null;
      neighborhood: string | null;
      city: string | null;
      state: string | null;
      postalCode: string | null;
      country: string | null;
      placeId: string | null;
      lat: number | null;
      lng: number | null;
      deliveryNotes: string | null;
      createdAt: Date;
      deletedAt: Date | null;
    }>
  ) {
    if (customers.length === 0) return null;

    const ordered = [...customers].sort((left, right) => {
      const scoreDelta = this.customerIdentityScore(right) - this.customerIdentityScore(left);
      if (scoreDelta !== 0) return scoreDelta;
      return left.id - right.id;
    });
    const canonical = ordered[0];
    const duplicates = ordered.slice(1);
    if (duplicates.length === 0) return canonical;

    const duplicateIds = duplicates.map((entry) => entry.id);
    const merged = await tx.customer.update({
      where: { id: canonical.id },
      data: {
        firstName: canonical.firstName || duplicates.map((entry) => entry.firstName).find(Boolean) || null,
        lastName: canonical.lastName || duplicates.map((entry) => entry.lastName).find(Boolean) || null,
        phone: canonical.phone || duplicates.map((entry) => entry.phone).find(Boolean) || null,
        activePhoneKey:
          canonical.activePhoneKey || duplicates.map((entry) => entry.activePhoneKey).find(Boolean) || null,
        address: canonical.address || duplicates.map((entry) => entry.address).find(Boolean) || null,
        addressLine1:
          canonical.addressLine1 || duplicates.map((entry) => entry.addressLine1).find(Boolean) || null,
        addressLine2:
          canonical.addressLine2 || duplicates.map((entry) => entry.addressLine2).find(Boolean) || null,
        neighborhood:
          canonical.neighborhood || duplicates.map((entry) => entry.neighborhood).find(Boolean) || null,
        city: canonical.city || duplicates.map((entry) => entry.city).find(Boolean) || null,
        state: canonical.state || duplicates.map((entry) => entry.state).find(Boolean) || null,
        postalCode:
          canonical.postalCode || duplicates.map((entry) => entry.postalCode).find(Boolean) || null,
        country: canonical.country || duplicates.map((entry) => entry.country).find(Boolean) || null,
        placeId: canonical.placeId || duplicates.map((entry) => entry.placeId).find(Boolean) || null,
        lat:
          canonical.lat ??
          duplicates.find((entry) => typeof entry.lat === 'number' && Number.isFinite(entry.lat))?.lat ??
          null,
        lng:
          canonical.lng ??
          duplicates.find((entry) => typeof entry.lng === 'number' && Number.isFinite(entry.lng))?.lng ??
          null,
        deliveryNotes:
          canonical.deliveryNotes || duplicates.map((entry) => entry.deliveryNotes).find(Boolean) || null
      }
    });

    await tx.order.updateMany({
      where: { customerId: { in: duplicateIds } },
      data: { customerId: canonical.id }
    });
    await tx.customer.updateMany({
      where: { id: { in: duplicateIds } },
      data: {
        deletedAt: new Date(),
        activePhoneKey: null,
        phone: null,
        placeId: null
      }
    });

    return merged;
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
      return this.ensureCustomerPublicNumber(tx, existing);
    }

    const normalizedName = this.normalizeCustomerName(customer.name);
    if (!normalizedName) {
      throw new BadRequestException('Nome do cliente e obrigatorio.');
    }

    const normalizedPhone = normalizePhone(customer.phone);
    const normalizedAddress = normalizeTitle(customer.address ?? undefined) ?? null;
    const normalizedPlaceId = normalizeText(('placeId' in customer ? customer.placeId : null) ?? undefined);
    const normalizedLat =
      'lat' in customer && typeof customer.lat === 'number' && Number.isFinite(customer.lat) ? customer.lat : null;
    const normalizedLng =
      'lng' in customer && typeof customer.lng === 'number' && Number.isFinite(customer.lng) ? customer.lng : null;
    const normalizedDeliveryNotes = normalizeText(customer.deliveryNotes ?? undefined);

    let existing = normalizedPhone
      ? await tx.customer
          .findMany({
            where: {
              deletedAt: null,
              phone: normalizedPhone
            },
            orderBy: [{ id: 'asc' }]
          })
          .then((records) => this.mergeCustomersByPhone(tx, records))
      : null;

    if (!existing && normalizedPlaceId) {
      existing = await tx.customer.findFirst({
        where: {
          deletedAt: null,
          placeId: normalizedPlaceId
        },
        orderBy: { id: 'desc' }
      });
    }

    if (!existing && normalizedAddress) {
      existing = await tx.customer.findFirst({
        where: {
          deletedAt: null,
          name: normalizedName,
          address: normalizedAddress
        },
        orderBy: { id: 'desc' }
      });
    }

    if (existing) {
      const shouldUpdate =
        (normalizedPhone && !existing.phone) ||
        (normalizedAddress && !existing.address) ||
        (normalizedPlaceId && !existing.placeId) ||
        (normalizedLat !== null && existing.lat === null) ||
        (normalizedLng !== null && existing.lng === null) ||
        (normalizedDeliveryNotes && !existing.deliveryNotes);
      if (!shouldUpdate) return existing;

      return tx.customer.update({
        where: { id: existing.id },
        data: {
          publicNumber: existing.publicNumber ?? (await allocateNextPublicNumber(tx, 'CUSTOMER')),
          activePhoneKey: existing.activePhoneKey || normalizedPhone,
          phone: existing.phone || normalizedPhone,
          address: existing.address || normalizedAddress,
          placeId: existing.placeId || normalizedPlaceId,
          lat: existing.lat ?? normalizedLat,
          lng: existing.lng ?? normalizedLng,
          deliveryNotes: existing.deliveryNotes || normalizedDeliveryNotes
        }
      });
    }

    return tx.customer.create({
      data: {
        publicNumber: await allocateNextPublicNumber(tx, 'CUSTOMER'),
        name: normalizedName,
        firstName: normalizedName.split(' ')[0] || null,
        lastName: normalizedName.includes(' ') ? normalizedName.split(' ').slice(1).join(' ') : null,
        activePhoneKey: normalizedPhone,
        phone: normalizedPhone,
        address: normalizedAddress,
        addressLine1: normalizedAddress,
        addressLine2: null,
        neighborhood: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
        placeId: normalizedPlaceId,
        lat: normalizedLat,
        lng: normalizedLng,
        deliveryNotes: normalizedDeliveryNotes
      }
    });
  }

  private async resolveDeliveryQuoteCustomer(customer: OrderIntakePayload['customer']) {
    if ('customerId' in customer) {
      const existing = await this.prisma.customer.findUnique({ where: { id: customer.customerId } });
      if (!existing) throw new NotFoundException('Cliente nao encontrado');
      return {
        name: existing.name,
        phone: existing.phone ?? null,
        address: existing.address ?? null,
        placeId: existing.placeId ?? null,
        lat: existing.lat ?? null,
        lng: existing.lng ?? null,
        deliveryNotes: existing.deliveryNotes ?? null
      };
    }

    return {
      name: customer.name,
      phone: customer.phone ?? null,
      address: customer.address ?? null,
      placeId: 'placeId' in customer ? customer.placeId ?? null : null,
      lat: 'lat' in customer ? customer.lat ?? null : null,
      lng: 'lng' in customer ? customer.lng ?? null : null,
      deliveryNotes: customer.deliveryNotes ?? null
    };
  }

  private async priceOrderItems(
    tx: TransactionClient | PrismaService,
    items: Array<{ productId: number; quantity: number }>
  ) {
    const parsedItems = items.map((item) =>
      OrderItemSchema.pick({ productId: true, quantity: true }).parse(item)
    );
    const productIds = Array.from(new Set(parsedItems.map((item) => item.productId)));
    const products = await tx.product.findMany({ where: { id: { in: productIds } } });
    const productMap = new Map(products.map((product) => [product.id, product]));

    const itemsData: Array<{ productId: number; quantity: number; unitPrice: number; total: number }> = [];
    const manifestItems: Array<{ productId: number; quantity: number; name: string }> = [];
    for (const item of parsedItems) {
      const product = productMap.get(item.productId);
      if (!product) throw new NotFoundException('Produto nao encontrado');
      const unitPrice = this.toUnitPrice(product.price);
      const total = this.toMoney(unitPrice * item.quantity);
      itemsData.push({ productId: item.productId, quantity: item.quantity, unitPrice, total });
      manifestItems.push({
        productId: item.productId,
        quantity: item.quantity,
        name: product.name
      });
    }

    const subtotal = await this.calculateOrderSubtotalFromItems(tx, parsedItems);
    return { parsedItems, itemsData, subtotal, manifestItems };
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
      deliveryFee: this.toMoney(order.deliveryFee ?? 0),
      deliveryProvider: this.normalizeDeliveryProvider(order.deliveryProvider),
      deliveryFeeSource: this.normalizeDeliveryFeeSource(order.deliveryFeeSource),
      deliveryQuoteStatus: this.normalizeDeliveryQuoteStatus(order.deliveryQuoteStatus),
      deliveryQuoteExpiresAt: order.deliveryQuoteExpiresAt?.toISOString() ?? null,
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
      const intakePayload =
        typeof parsed.intake === 'object' && parsed.intake ? (parsed.intake as Record<string, unknown>) : {};
      return {
        order: this.withFinancial(order),
        intake: OrderIntakeMetaSchema.parse({
          pixCharge: null,
          ...intakePayload,
          deliveryProvider: this.normalizeDeliveryProvider(intakePayload.deliveryProvider as string | null | undefined),
          deliveryFeeSource: this.normalizeDeliveryFeeSource(intakePayload.deliveryFeeSource as string | null | undefined),
          deliveryQuoteStatus: this.normalizeDeliveryQuoteStatus(
            intakePayload.deliveryQuoteStatus as string | null | undefined
          )
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
    const isExternalIntakeChannel =
      data.source.channel === 'CUSTOMER_LINK' || data.source.channel === 'WHATSAPP_FLOW';
    const quoteCustomer = await this.resolveDeliveryQuoteCustomer(data.customer);
    const pricedOrder = await this.priceOrderItems(this.prisma, data.order.items);
    const scheduledAt = this.parseOptionalDateTime(data.fulfillment.scheduledAt);
    const deliveryQuote = await this.deliveriesService.resolveDeliverySelection(
      data.delivery,
      this.buildDeliveryQuoteDraft({
        fulfillmentMode: data.fulfillment.mode,
        scheduledAt: scheduledAt?.toISOString() ?? data.fulfillment.scheduledAt ?? null,
        customerName: quoteCustomer.name,
        customerPhone: quoteCustomer.phone,
        customerAddress: quoteCustomer.address,
        customerPlaceId: quoteCustomer.placeId,
        customerLat: quoteCustomer.lat,
        customerLng: quoteCustomer.lng,
        customerDeliveryNotes: quoteCustomer.deliveryNotes,
        subtotal: pricedOrder.subtotal,
        items: pricedOrder.manifestItems
      }),
      {
        enforceExternalSchedule: isExternalIntakeChannel,
        allowManualFallback: !isExternalIntakeChannel
      }
    );

    let createdFreshResult:
      | {
          order: ReturnType<OrdersService['withFinancial']>;
          intake: OrderIntakeMeta;
        }
      | null = null;

    const result = await this.prisma.$transaction(async (tx) => {
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
      const { itemsData, subtotal } = pricedOrder;
      const discount = this.toMoney(data.order.discount ?? 0);
      const deliveryFee = this.toMoney(deliveryQuote.fee ?? 0);
      const total = this.computeOrderTotal(subtotal, discount, deliveryFee);

      if (isExternalIntakeChannel) {
        await this.ensureOrderScheduleCapacityAllowed(tx, scheduledAt, {
          reference: new Date()
        });
      }

      const createdOrder = await tx.order.create({
        data: {
          publicNumber: await allocateNextPublicNumber(tx, 'ORDER'),
          customerId: customer.id,
          status: 'ABERTO',
          fulfillmentMode: data.fulfillment.mode,
          notes: data.order.notes ?? null,
          scheduledAt,
          subtotal,
          deliveryFee,
          deliveryProvider: deliveryQuote.provider,
          deliveryFeeSource: deliveryQuote.source,
          deliveryQuoteStatus: deliveryQuote.status,
          deliveryQuoteRef: deliveryQuote.quoteToken ?? null,
          deliveryQuoteExpiresAt: this.parseOptionalDateTime(deliveryQuote.expiresAt ?? null),
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

      if (data.intent !== 'DRAFT') {
        createdFreshResult = result;
      }

      if (idemKey) {
        await this.saveIntakeResult(tx, idemKey, requestHash, result);
      }

      return result;
    });

    if (createdFreshResult) {
      void this.orderNotificationsService.notifyNewOrder(createdFreshResult);
    }

    return result;
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

  async previewCustomerForm(payload: unknown) {
    const data = this.parseExternalOrderSubmission(payload, {
      defaultChannel: 'PUBLIC_FORM',
      defaultOriginLabel: 'customer-form'
    });
    return this.previewExternalSubmission(data, {
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

  async previewGoogleForm(payload: unknown) {
    const data = this.parseExternalOrderSubmission(payload, {
      defaultChannel: 'GOOGLE_FORM',
      defaultOriginLabel: 'google-form'
    });
    return this.previewExternalSubmission(data, {
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
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
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
        const nextTotal = this.computeOrderTotal(
          nextSubtotal,
          this.toMoney(order.discount ?? 0),
          this.toMoney(order.deliveryFee ?? 0)
        );
        const previousSubtotal = this.toMoney(order.subtotal ?? 0);
        const previousTotal = this.toMoney(order.total ?? 0);
        const subtotalChanged = compareMoney(previousSubtotal, nextSubtotal) !== 0;
        const totalChanged = compareMoney(previousTotal, nextTotal) !== 0;

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
    const data = OrderSchema.pick({ customerId: true, notes: true, discount: true, scheduledAt: true, items: true, fulfillmentMode: true }).parse(
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
        mode: data.fulfillmentMode ?? 'DELIVERY',
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
      const total = this.computeOrderTotal(subtotal, discount, this.toMoney(existing.deliveryFee ?? 0));
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
      await this.assertOrderRemovable(tx, id);

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
      await this.assertOrderItemsMutable(tx, order);

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
      const newTotal = this.computeOrderTotal(newSubtotal, order.discount, this.toMoney(order.deliveryFee ?? 0));
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
      await this.assertOrderItemsMutable(tx, order);

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
      const total = this.computeOrderTotal(subtotal, order.discount, this.toMoney(order.deliveryFee ?? 0));
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
      await this.assertOrderItemsMutable(tx, order);

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
      const newTotal = this.computeOrderTotal(newSubtotal, order.discount, this.toMoney(order.deliveryFee ?? 0));
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

    return this.prisma.$transaction(async (tx) => {
      const existingOrder = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, customer: true, payments: true }
      });
      if (!existingOrder) {
        throw new NotFoundException('Pedido nao encontrado');
      }

      const path = resolveOrderStatusPath(existingOrder.status, status);
      if (path.length === 0) {
        return this.withFinancial(existingOrder);
      }

      let updatedOrder = existingOrder;

      for (const stepStatus of path) {
        updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: { status: stepStatus },
          include: { items: true, customer: true, payments: true }
        });
        if (stepStatus === 'CANCELADO') {
          await this.clearOrderFormulaArtifacts(tx, orderId);
          await this.clearMassPrepEventArtifact(tx, orderId);
          await this.syncPaperBagReservationsForCustomerDateGroup(tx, {
            customerId: updatedOrder.customerId,
            targetDate: this.orderTargetDate(updatedOrder).date
          });
        }
        if (stepStatus === 'EM_PREPARACAO' || stepStatus === 'PRONTO' || stepStatus === 'ENTREGUE') {
          await this.syncMassPrepEventStatusFromOrderStatus(tx, orderId, stepStatus);
        }
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
      const balanceDue = moneyFromMinorUnits(Math.max(moneyToMinorUnits(total) - moneyToMinorUnits(amountPaid), 0));

      if (compareMoney(balanceDue, 0) <= 0) {
        return this.withFinancial(order);
      }

      const reusablePendingPayment = order.payments.find(
        (payment) =>
          payment.status !== 'PAGO' &&
          !payment.paidAt &&
          payment.method.trim().toLowerCase() === 'pix' &&
          compareMoney(payment.amount, balanceDue) === 0
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
