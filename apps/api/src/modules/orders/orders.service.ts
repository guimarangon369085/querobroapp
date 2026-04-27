import { BadRequestException, Injectable, NotFoundException, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Customer as PrismaCustomer } from '@prisma/client';
import { PrismaService } from '../../prisma.service.js';
import {
  type CardCheckout,
  compareMoney,
  computeSumUpCardPayableTotal,
  ExternalOrderDeliveryWindowKeyEnum,
  ExternalOrderScheduleAvailabilitySchema,
  ExternalOrderSubmissionPreviewSchema,
  ExternalOrderSubmissionSchema,
  mergeMarketingSamplesIntoNotes,
  moneyFromMinorUnits,
  moneyToMinorUnits,
  OrderIntakeMetaSchema,
  OrderIntakeSchema,
  OrderCustomerSnapshotSchema,
  OrderItemSchema,
  OrderSchema,
  OrderStatusEnum,
  normalizeOrderStatus,
  parseMarketingSamplesDiscountPct,
  parseMarketingSamplesSponsoredDeliveryFee,
  type PaymentMethod,
  preserveOrderNoteMetadata,
  PixChargeSchema,
  roundMoney,
  stripOrderNoteMetadata
} from '@querobroapp/shared';
import { z } from 'zod';
import {
  addInventoryLookupItem,
  buildOfficialBroaFlavorSummary,
  buildInventoryItemLookup,
  computeBroaPaperBagCount,
  computeBroaPackagingPlan,
  findInventoryByAliases,
  MASS_READY_BROAS_PER_RECIPE,
  MASS_READY_ITEM_NAME,
  ORDER_BOX_UNITS,
  orderFillingIngredientsByFlavorCode,
  resolveInventoryDefinition,
  resolveInventoryFamilyItemIds
} from '../inventory/inventory-formulas.js';
import { syncCompanionProductActiveStateByProductIds } from '../inventory/companion-product-availability.js';
import { loadProductSalesLimitStates } from '../inventory/product-sales-limit.js';
import { normalizePhone, normalizeText, normalizeTitle } from '../../common/normalize.js';
import {
  customerAddressIdentityKey,
  inferAddressLine1,
  normalizeCustomerAddressPayload,
  normalizeNeighborhood
} from '../../common/customer-profile.js';
import {
  EXTERNAL_ORDER_DELIVERY_WINDOWS,
  externalOrderScheduleAvailabilityErrorMessage,
  externalOrderScheduleErrorMessage,
  resolveExternalOrderDeliveryWindowKeyForDate,
  resolveExternalOrderDeliveryWindowLabel,
  isExternalOrderScheduleAllowed,
  resolveExternalOrderScheduleAvailability
} from '../../common/external-order-schedule.js';
import {
  countCouponUsageForCustomer,
  findCouponByNormalizedCode,
  mergeAppliedCouponIntoNotes,
  normalizeCouponCode,
  parseAppliedCouponFromNotes,
  resolveStoredCouponCode
} from '../../common/coupons.js';
import { allocateNextPublicNumber } from '../../common/public-sequence.js';
import { PaymentsService } from '../payments/payments.service.js';
import { DeliveriesService } from '../deliveries/deliveries.service.js';
import { OrderNotificationsService } from './order-notifications.service.js';

const updateSchema = z
  .object({
    scheduledAt: OrderSchema.shape.scheduledAt.optional(),
    notes: OrderSchema.shape.notes.optional(),
    discount: OrderSchema.shape.discount.optional(),
    discountPct: OrderSchema.shape.discountPct.optional(),
    fulfillmentMode: OrderSchema.shape.fulfillmentMode.optional(),
    customerSnapshot: OrderCustomerSnapshotSchema.partial().optional().nullable()
  })
  .strict();
const replaceItemsSchema = z.object({
  items: z.array(OrderItemSchema.pick({ productId: true, quantity: true })).min(1)
});
const markPaidSchema = z.object({
  paid: z.boolean().optional().default(true),
  paidAt: z.string().datetime().optional().nullable()
});
const orderScheduleDayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const statusTransitions: Record<string, string[]> = {
  ABERTO: ['PRONTO', 'CANCELADO'],
  PRONTO: ['ABERTO', 'ENTREGUE', 'CANCELADO'],
  ENTREGUE: ['PRONTO', 'CANCELADO'],
  CANCELADO: []
};
const ORDER_WORKFLOW_STATUSES = ['ABERTO', 'PRONTO', 'ENTREGUE'] as const;
const STREET_NUMBER_IN_ADDRESS_LINE_PATTERN =
  /(?:,\s*|^)(?:(?:n(?:[.o]|o|umero)?\s*)?\d+[a-z]?(?:[-/]\d+[a-z]?)?|s\/?n|sem numero)$/i;

type OrderStatusValue = z.infer<typeof OrderStatusEnum>;
type OrderWorkflowStatus = (typeof ORDER_WORKFLOW_STATUSES)[number];

function isOrderWorkflowStatus(status: string): status is OrderWorkflowStatus {
  return ORDER_WORKFLOW_STATUSES.includes(status as OrderWorkflowStatus);
}

function normalizeOrderPricingLookup(value?: string | null) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function isCouponCompanionCategory(value?: string | null) {
  const normalized = normalizeOrderPricingLookup(value);
  return normalized.includes('amigos da broa') || normalized.includes('amigas da broa');
}

function isCouponEligibleBroaProduct(product?: { name?: string | null; category?: string | null } | null) {
  const normalizedName = normalizeOrderPricingLookup(product?.name);
  const normalizedCategory = normalizeOrderPricingLookup(product?.category);
  return (
    normalizedName.startsWith('broa ') &&
    !normalizedName.includes('mista') &&
    (normalizedCategory === 'sabores' || (!normalizedCategory && !isCouponCompanionCategory(product?.category)))
  );
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
    throw new BadRequestException(`Transição inválida: ${currentStatus} -> ${targetStatus}`);
  }

  const currentIndex = ORDER_WORKFLOW_STATUSES.indexOf(currentStatus);
  const targetIndex = ORDER_WORKFLOW_STATUSES.indexOf(targetStatus);
  if (currentIndex < 0 || targetIndex < 0) {
    throw new BadRequestException(`Transição inválida: ${currentStatus} -> ${targetStatus}`);
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
      throw new BadRequestException(`Transição inválida: ${currentStatus} -> ${targetStatus}`);
    }

    path.push(candidate);
    cursor = candidate;
  }

  if (path[path.length - 1] !== targetStatus) {
    throw new BadRequestException(`Transição inválida: ${currentStatus} -> ${targetStatus}`);
  }

  return path;
}

const ORDER_INTAKE_SCOPE = 'ORDER_INTAKE';
const ORDER_EXTERNAL_INTAKE_SCOPE = 'ORDER_INTAKE_EXTERNAL';
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
const ORDER_FORMULA_SOURCE_LABEL_PREFIX = 'ORDER_';
const ORDER_FORMULA_SOURCE_MASS_READY = 'MASS_READY';
const ORDER_FORMULA_SOURCE_FILLING = 'ORDER_FILLING';
const ORDER_FORMULA_SOURCE_PACKAGING = 'ORDER_PACKAGING';
const ORDER_FORMULA_SOURCE_COMPANION = 'ORDER_COMPANION';
const ORDER_FORMULA_SOURCES = [
  ORDER_FORMULA_SOURCE_MASS_READY,
  ORDER_FORMULA_SOURCE_FILLING,
  ORDER_FORMULA_SOURCE_PACKAGING,
  ORDER_FORMULA_SOURCE_COMPANION
] as const;

const orderWithRelationsInclude = Prisma.validator<Prisma.OrderInclude>()({
  items: true,
  customer: {
    include: {
      addresses: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
      }
    }
  },
  payments: true
});

type OrderWithRelations = Prisma.OrderGetPayload<{
  include: typeof orderWithRelationsInclude;
}>;
type TransactionClient = Prisma.TransactionClient;
type OrderScheduleQueryClient = Pick<
  PrismaService | TransactionClient,
  'order' | 'orderScheduleDayAvailability'
>;
type OrderIntakePayload = z.infer<typeof OrderIntakeSchema>;
type OrderIntakeMeta = z.infer<typeof OrderIntakeMetaSchema>;
type PixCharge = z.infer<typeof PixChargeSchema>;
type CheckoutCard = CardCheckout;
type ExternalOrderSubmissionPayload = z.infer<typeof ExternalOrderSubmissionSchema>;
type ExternalOrderSubmissionPreview = z.infer<typeof ExternalOrderSubmissionPreviewSchema>;
type ExternalOrderDeliveryWindowKey = z.infer<typeof ExternalOrderDeliveryWindowKeyEnum>;
type OrderCustomerSnapshotPayload = z.infer<typeof OrderCustomerSnapshotSchema>;
type OrderScheduleDayAvailabilitySummary = {
  dayKey: string;
  blockedWindows: ExternalOrderDeliveryWindowKey[];
  windows: Array<{
    key: ExternalOrderDeliveryWindowKey;
    label: string;
    startLabel: string;
    endLabel: string;
    isOpen: boolean;
  }>;
  updatedAt: string | null;
};
type OrderFlavorCode = 'T' | 'G' | 'D' | 'Q' | 'R' | 'RJ';
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

function formatScheduleDayKeyFromDate(date: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

const ORDER_SCHEDULE_BLOCK_ALL_DAY_WINDOW_KEY = 'ALL_DAY';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentsService) private readonly paymentsService: PaymentsService,
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

  private resolveMarketingSponsoredDeliveryFee(input: {
    quotedDeliveryFee: number;
    discountPct: number;
    fulfillmentMode: string | null | undefined;
    allowSponsoredDelivery: boolean;
  }) {
    if (!input.allowSponsoredDelivery) return 0;
    if (input.fulfillmentMode !== 'DELIVERY') return 0;
    if (compareMoney(input.discountPct, 100) < 0) return 0;
    return this.toMoney(Math.max(input.quotedDeliveryFee || 0, 0));
  }

  private resolveOrderDiscountInput(
    subtotal: number,
    input: {
      discount?: number | null;
      discountPct?: number | null;
    }
  ) {
    const hasDiscountAmount = typeof input.discount === 'number';
    const hasDiscountPct = typeof input.discountPct === 'number';
    const discountAmount = this.toMoney(Math.max(input.discount ?? 0, 0));
    const discountPct = this.toMoney(Math.max(input.discountPct ?? 0, 0));
    const discountAmountFromPct = this.toMoney((subtotal * discountPct) / 100);

    if (hasDiscountAmount && hasDiscountPct && compareMoney(discountAmount, discountAmountFromPct) !== 0) {
      throw new BadRequestException('Informe o desconto em reais ou em percentual, não os dois com valores diferentes.');
    }

    if (hasDiscountPct) {
      return {
        discount: discountAmountFromPct,
        discountPct
      };
    }

    const derivedDiscountPct =
      compareMoney(subtotal, 0) > 0 ? this.toMoney((discountAmount / subtotal) * 100) : 0;

    return {
      discount: discountAmount,
      discountPct: derivedDiscountPct
    };
  }

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

  private orderFormulaSourceLabel(orderId: number) {
    return `${ORDER_FORMULA_SOURCE_LABEL_PREFIX}${orderId}`;
  }

  private normalizeOrderProductDescriptor(value?: string | null) {
    return (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private resolveOrderFlavorCodeFromProductName(value?: string | null): OrderFlavorCode | null {
    const normalized = this.normalizeOrderProductDescriptor(value);
    if (!normalized) return null;
    if (normalized.includes('tradicional')) return 'T';
    if (normalized.includes('goiabada')) return 'G';
    if (normalized.includes('doce')) return 'D';
    if (normalized.includes('romeu') || normalized.includes('julieta')) return 'RJ';
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

  private resolveOrderProductionBroaCount(
    items: Array<{
      quantity: number;
      productName?: string | null;
      productUnit?: string | null;
    }>
  ) {
    return items.reduce((sum, item) => {
      const quantity = Math.max(Math.floor(item.quantity || 0), 0);
      if (quantity <= 0) return sum;

      const productName = this.normalizeOrderProductDescriptor(item.productName);
      const productUnit = this.normalizeOrderProductDescriptor(item.productUnit);
      const looksLikeOfficialBroa = Boolean(this.resolveOrderFlavorCodeFromProductName(productName));
      const looksLikeBox =
        productUnit === 'cx' ||
        productUnit === 'caixa' ||
        productUnit === 'caixas' ||
        productName.includes('caixa');

      if (looksLikeOfficialBroa) return sum + quantity;
      if (looksLikeBox) return sum + quantity * ORDER_BOX_UNITS;
      return sum;
    }, 0);
  }

  private async resolveOrderProductionBroaCountForItems(
    tx: TransactionClient | PrismaService,
    items: Array<{ productId: number; quantity: number }>
  ) {
    const productIds = Array.from(new Set(items.map((item) => item.productId))).filter((id) => Number.isFinite(id));
    if (productIds.length <= 0) return 0;
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, unit: true }
    });
    const productMetaById = new Map(products.map((product) => [product.id, product] as const));
    return this.resolveOrderProductionBroaCount(
      items.map((item) => ({
        quantity: item.quantity,
        productName: productMetaById.get(item.productId)?.name ?? null,
        productUnit: productMetaById.get(item.productId)?.unit ?? null
      }))
    );
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
    return (await this.calculateOrderSubtotalsFromItems(tx, items)).subtotal;
  }

  private async calculateOrderSubtotalsFromItems(
    tx: TransactionClient | PrismaService,
    items: Array<{ productId: number; quantity: number }>
  ) {
    if (items.length <= 0) {
      return {
        subtotal: 0,
        couponEligibleSubtotal: 0
      };
    }
    const productIds = Array.from(new Set(items.map((item) => item.productId)));
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, category: true, price: true }
    });
    const productNameById = new Map(products.map((product) => [product.id, product.name]));
    const productById = new Map(products.map((product) => [product.id, product]));
    const quantityByProductId = new Map<number, number>();
    let totalUnits = 0;
    let directSubtotalMinorUnits = 0;

    for (const item of items) {
      const quantity = Math.max(Math.floor(item.quantity || 0), 0);
      if (quantity <= 0) continue;
      const product = productById.get(item.productId);
      if (isCouponEligibleBroaProduct(product)) {
        totalUnits += quantity;
        quantityByProductId.set(item.productId, (quantityByProductId.get(item.productId) || 0) + quantity);
        continue;
      }
      directSubtotalMinorUnits += moneyToMinorUnits(Number(product?.price || 0)) * quantity;
    }

    const broaSubtotal = this.calculateSubtotalFromProductQuantities({
      totalUnits,
      quantityByProductId,
      productNameById
    });

    return {
      subtotal: moneyFromMinorUnits(moneyToMinorUnits(broaSubtotal) + directSubtotalMinorUnits),
      couponEligibleSubtotal: broaSubtotal
    };
  }

  private async resolveExistingOrderItemsPricing(
    tx: TransactionClient | PrismaService,
    order: {
      id: number;
      customerId: number;
      customer?: {
        name?: string | null;
        phone?: string | null;
        address?: string | null;
        addressLine1?: string | null;
        addressLine2?: string | null;
        neighborhood?: string | null;
        city?: string | null;
        state?: string | null;
        postalCode?: string | null;
        country?: string | null;
        placeId?: string | null;
        lat?: number | null;
        lng?: number | null;
        deliveryNotes?: string | null;
      } | null;
      customerName?: string | null;
      customerPhone?: string | null;
      customerAddress?: string | null;
      customerAddressLine1?: string | null;
      customerAddressLine2?: string | null;
      customerNeighborhood?: string | null;
      customerCity?: string | null;
      customerState?: string | null;
      customerPostalCode?: string | null;
      customerCountry?: string | null;
      customerPlaceId?: string | null;
      customerLat?: number | null;
      customerLng?: number | null;
      customerDeliveryNotes?: string | null;
      discount?: number | null;
      deliveryFee?: number | null;
      couponCode?: string | null;
      notes?: string | null;
    },
    items: Array<{ productId: number; quantity: number }>
  ) {
    const { subtotal, couponEligibleSubtotal } = await this.calculateOrderSubtotalsFromItems(tx, items);
    const storedCouponCode = resolveStoredCouponCode(order.couponCode, order.notes);
    const customerSnapshot = this.extractOrderCustomerSnapshot(order);
    const storedCouponNote = parseAppliedCouponFromNotes(order.notes ?? null);
    const resolvedCoupon =
      storedCouponCode &&
      storedCouponNote?.code === storedCouponCode &&
      typeof storedCouponNote.discountPct === 'number' &&
      storedCouponNote.discountPct > 0
        ? {
            code: storedCouponCode,
            discountPct: this.toMoney(storedCouponNote.discountPct),
            discountAmount: this.toMoney(
              (couponEligibleSubtotal * this.toMoney(storedCouponNote.discountPct)) / 100
            ),
            subtotalAfterDiscount: this.toMoney(
              Math.max(
                couponEligibleSubtotal -
                  this.toMoney((couponEligibleSubtotal * this.toMoney(storedCouponNote.discountPct)) / 100),
                0
              )
            )
          }
        : storedCouponCode
          ? await this.resolveCouponDiscount({
              couponCode: storedCouponCode,
              subtotal: couponEligibleSubtotal,
              customerId: order.customerId ?? null,
              customerPhone: customerSnapshot.phone ?? null,
              client: tx,
              excludeOrderId: order.id
            })
          : null;
    const storedMarketingDiscountPct = this.toMoney(
      Math.max(parseMarketingSamplesDiscountPct(order.notes ?? null) ?? 0, 0)
    );
    const manualDiscountResolution = resolvedCoupon
      ? null
      : compareMoney(storedMarketingDiscountPct, 0) > 0
        ? this.resolveOrderDiscountInput(subtotal, { discountPct: storedMarketingDiscountPct })
        : this.resolveOrderDiscountInput(subtotal, { discount: order.discount ?? 0 });
    const discount = resolvedCoupon ? resolvedCoupon.discountAmount : manualDiscountResolution?.discount ?? 0;
    const discountPct = resolvedCoupon ? resolvedCoupon.discountPct : manualDiscountResolution?.discountPct ?? 0;
    const deliveryFee = this.toMoney(order.deliveryFee ?? 0);
    const total = this.computeOrderTotal(subtotal, discount, deliveryFee);

    let notes = mergeAppliedCouponIntoNotes(
      order.notes ?? null,
      resolvedCoupon?.code
        ? {
            code: resolvedCoupon.code,
            discountPct: resolvedCoupon.discountPct
          }
        : null
    );
    notes = mergeMarketingSamplesIntoNotes(
      notes,
      !resolvedCoupon && compareMoney(discountPct, 0) > 0
        ? {
            discountPct,
            sponsoredDeliveryFee: parseMarketingSamplesSponsoredDeliveryFee(order.notes ?? null)
          }
        : null
    );

    return {
      subtotal,
      discount,
      discountPct,
      deliveryFee,
      total,
      couponCode: resolvedCoupon?.code ?? null,
      notes
    };
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

  private async resolveOrderFillingBroasByFlavorCode(
    tx: TransactionClient,
    items: Array<{ productId: number; quantity: number }>
  ) {
    const byFlavorCode: Record<FillingFlavorCode, number> = { G: 0, D: 0, Q: 0, R: 0, RJ: 0 };
    if (items.length === 0) return byFlavorCode;

    const productIds = Array.from(new Set(items.map((item) => item.productId)));
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true }
    });
    const productNameById = new Map(products.map((product) => [product.id, product.name]));
    const summary = this.buildOfficialBroaSummaryFromItems(items, productNameById);

    for (const code of ['G', 'D', 'Q', 'R', 'RJ'] as const) {
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
    if (normalizeOrderStatus(order.status) !== 'ABERTO') {
      throw new BadRequestException('Pedido não permite alterar itens neste status');
    }
    if (await this.hasPhysicalInventoryMovements(tx, order.id)) {
      throw new BadRequestException(
        'Pedido não permite alterar itens após gerar movimentações físicas de estoque.'
      );
    }
  }

  private async assertOrderRemovable(tx: TransactionClient, orderId: number) {
    if (await this.hasPhysicalInventoryMovements(tx, orderId)) {
      throw new BadRequestException(
        'Pedido com movimentações físicas de estoque não pode ser excluído.'
      );
    }
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
          select: {
            id: true,
            name: true,
            inventoryItemId: true,
            inventoryQtyPerSaleUnit: true
          }
        })
      : [];
    const productNameById = new Map(products.map((product) => [product.id, product.name]));
    const productById = new Map(products.map((product) => [product.id, product]));

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
      for (const definition of orderFillingIngredientsByFlavorCode[code]) {
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

    for (const orderItem of order.items || []) {
      const product = productById.get(orderItem.productId);
      if (!product?.inventoryItemId || !product.inventoryQtyPerSaleUnit) continue;

      const companionQty = this.toQty(
        Math.max(orderItem.quantity || 0, 0) * product.inventoryQtyPerSaleUnit
      );
      if (companionQty <= 0) continue;

      await tx.inventoryMovement.create({
        data: {
          itemId: product.inventoryItemId,
          orderId: order.id,
          type: 'OUT',
          quantity: companionQty,
          reason: `Reserva direta do produto ${product.name}`,
          source: ORDER_FORMULA_SOURCE_COMPANION,
          sourceLabel
        }
      });
    }

    return {
      massReadyItem,
      requiredMassRecipes: massReadyRecipes
    };
  }

  private async syncOrderInventoryArtifacts(
    tx: TransactionClient,
    order: Pick<OrderWithRelations, 'id' | 'customerId' | 'scheduledAt' | 'createdAt' | 'items'>
  ) {
    await this.syncOrderFormulaInventory(tx, order);
    await this.syncPaperBagReservationsForCustomerDateGroup(tx, {
      customerId: order.customerId,
      targetDate: this.orderTargetDate(order).date
    });
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
    if (compareMoney(total, 0) <= 0) return 'PAGO';
    if (compareMoney(amountPaid, 0) <= 0) return 'PENDENTE';
    if (compareMoney(amountPaid, total) >= 0) return 'PAGO';
    return 'PARCIAL';
  }

  private ensureOrderTotalCoversPaid(total: number, amountPaid: number) {
    const normalizedTotal = moneyToMinorUnits(total);
    const normalizedAmountPaid = moneyToMinorUnits(amountPaid);
    if (normalizedAmountPaid > normalizedTotal) {
      throw new BadRequestException(
        `Total do pedido não pode ficar abaixo do valor já pago. Total=${moneyFromMinorUnits(normalizedTotal)} Pago=${moneyFromMinorUnits(normalizedAmountPaid)}`
      );
    }
  }

  private parseOptionalDateTime(value: string | null | undefined) {
    if (value == null) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Data/hora do pedido inválida.');
    }
    return parsed;
  }

  private normalizeScheduleDayKey(dayKey: string) {
    return orderScheduleDayKeySchema.parse(String(dayKey || '').trim());
  }

  private async loadBlockedScheduleWindows(client: OrderScheduleQueryClient) {
    const blockedEntries = await client.orderScheduleDayAvailability.findMany({
      where: { isOpen: false },
      select: {
        dayKey: true,
        windowKey: true
      },
      orderBy: [{ dayKey: 'asc' }, { windowKey: 'asc' }],
    });

    const blockedByDay = new Map<string, Set<ExternalOrderDeliveryWindowKey>>();

    for (const entry of blockedEntries) {
      let normalizedDayKey: string | null = null;
      try {
        normalizedDayKey = this.normalizeScheduleDayKey(entry.dayKey);
      } catch {
        normalizedDayKey = null;
      }
      if (!normalizedDayKey) continue;

      const bucket = blockedByDay.get(normalizedDayKey) || new Set<ExternalOrderDeliveryWindowKey>();
      if (entry.windowKey === ORDER_SCHEDULE_BLOCK_ALL_DAY_WINDOW_KEY) {
        for (const window of EXTERNAL_ORDER_DELIVERY_WINDOWS) {
          bucket.add(window.key);
        }
        blockedByDay.set(normalizedDayKey, bucket);
        continue;
      }

      const parsedWindowKey = ExternalOrderDeliveryWindowKeyEnum.safeParse(entry.windowKey);
      if (!parsedWindowKey.success) continue;
      bucket.add(parsedWindowKey.data);
      blockedByDay.set(normalizedDayKey, bucket);
    }

    return blockedByDay;
  }

  private async resolveScheduleDayAvailability(
    client: Pick<PrismaService | TransactionClient, 'orderScheduleDayAvailability'>,
    dayKey: string,
  ) {
    const normalizedDayKey = this.normalizeScheduleDayKey(dayKey);
    const existing = await client.orderScheduleDayAvailability.findMany({
      where: { dayKey: normalizedDayKey },
      select: {
        windowKey: true,
        isOpen: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }]
    });
    const blockedWindows = new Set<ExternalOrderDeliveryWindowKey>();
    let latestUpdatedAt: Date | null = null;

    for (const entry of existing) {
      if (entry.updatedAt && (!latestUpdatedAt || entry.updatedAt.getTime() > latestUpdatedAt.getTime())) {
        latestUpdatedAt = entry.updatedAt;
      }
      if (entry.isOpen !== false) continue;
      if (entry.windowKey === ORDER_SCHEDULE_BLOCK_ALL_DAY_WINDOW_KEY) {
        for (const window of EXTERNAL_ORDER_DELIVERY_WINDOWS) {
          blockedWindows.add(window.key);
        }
        continue;
      }
      const parsedWindowKey = ExternalOrderDeliveryWindowKeyEnum.safeParse(entry.windowKey);
      if (parsedWindowKey.success) {
        blockedWindows.add(parsedWindowKey.data);
      }
    }

    return {
      dayKey: normalizedDayKey,
      blockedWindows: EXTERNAL_ORDER_DELIVERY_WINDOWS.filter((window) => blockedWindows.has(window.key)).map(
        (window) => window.key
      ),
      windows: EXTERNAL_ORDER_DELIVERY_WINDOWS.map((window) => ({
        key: window.key,
        label: window.label,
        startLabel: `${window.startHour}h`,
        endLabel: `${window.endHour}h`,
        isOpen: !blockedWindows.has(window.key),
      })),
      updatedAt: latestUpdatedAt?.toISOString() ?? null,
    } satisfies OrderScheduleDayAvailabilitySummary;
  }

  private async buildExternalOrderScheduleAvailability(
    client: OrderScheduleQueryClient,
    options: {
      requestedAt?: Date | null;
      requestedDate?: string | null;
      requestedWindowKey?: string | null;
      requestedTotalBroas?: number | null;
      excludeOrderId?: number | null;
      reference?: Date;
    }
  ) {
    const blockedWindowsByDay = await this.loadBlockedScheduleWindows(client);
    const scheduledOrders = await client.order.findMany({
      where: {
        scheduledAt: { not: null },
        status: { not: 'CANCELADO' },
        ...(options.excludeOrderId ? { id: { not: options.excludeOrderId } } : {})
      },
      select: {
        scheduledAt: true,
        items: {
          select: {
            quantity: true,
            product: {
              select: {
                name: true,
                unit: true
              }
            }
          }
        }
      }
    });

    const parsedRequestedWindowKey = ExternalOrderDeliveryWindowKeyEnum.safeParse(options.requestedWindowKey ?? null);
    const requestedWindowKey = parsedRequestedWindowKey.success ? parsedRequestedWindowKey.data : null;

    const availability = resolveExternalOrderScheduleAvailability({
      scheduledOrders: scheduledOrders.map((entry) => ({
        scheduledAt: entry.scheduledAt,
        totalBroas: this.resolveOrderProductionBroaCount(
          entry.items.map((item) => ({
            quantity: item.quantity,
            productName: item.product?.name ?? null,
            productUnit: item.product?.unit ?? null
          }))
        )
      })),
      requestedAt: options.requestedAt ?? null,
      requestedDate: options.requestedDate ?? null,
      requestedWindowKey,
      requestedTotalBroas: options.requestedTotalBroas ?? null,
      blockedWindows: Array.from(blockedWindowsByDay.entries()).flatMap(([dayKey, windowKeys]) =>
        Array.from(windowKeys).map((windowKey) => ({
          dayKey,
          windowKey
        }))
      ),
      reference: options.reference
    });

    return ExternalOrderScheduleAvailabilitySchema.parse({
      minimumAllowedAt: availability.minimumAllowedAt.toISOString(),
      nextAvailableAt: availability.nextAvailableAt.toISOString(),
      requestedAt: availability.requestedAt ? availability.requestedAt.toISOString() : null,
      requestedAvailable: availability.requestedAvailable,
      reason: availability.reason,
      dailyLimit: availability.dailyLimit,
      requestedTotalBroas: availability.requestedTotalBroas,
      requestedDurationMinutes: availability.requestedDurationMinutes,
      slotMinutes: availability.slotMinutes,
      dayOrderCount: availability.dayOrderCount,
      slotTaken: availability.slotTaken,
      requestedDate: availability.requestedDate,
      requestedWindowKey: availability.requestedWindowKey,
      requestedWindowLabel: availability.requestedWindowLabel,
      requestedWindowAvailable: availability.requestedWindowAvailable,
      requestedWindowReason: availability.requestedWindowReason,
      requestedWindowScheduledAt: availability.requestedWindowScheduledAt?.toISOString() ?? null,
      requestedWindowNextAvailableAt: availability.requestedWindowNextAvailableAt?.toISOString() ?? null,
      windows: availability.windows.map((window) => ({
        key: window.key,
        label: window.label,
        startLabel: window.startLabel,
        endLabel: window.endLabel,
        available: window.available,
        scheduledAt: window.scheduledAt?.toISOString() ?? null,
        reason: window.reason
      }))
    });
  }

  private buildPublicWindowAvailabilityError(availability: z.infer<typeof ExternalOrderScheduleAvailabilitySchema>) {
    const nextAvailableAt = availability.requestedWindowNextAvailableAt ?? availability.nextAvailableAt;
    const nextDate = new Date(nextAvailableAt);
    const nextWindowKey = resolveExternalOrderDeliveryWindowKeyForDate(nextDate);
    const nextWindowLabel = resolveExternalOrderDeliveryWindowLabel(nextWindowKey);
    const nextLabel = nextWindowLabel
      ? `${nextWindowLabel} (${new Intl.DateTimeFormat('pt-BR', {
          day: '2-digit',
          month: '2-digit'
        }).format(nextDate)})`
      : new Intl.DateTimeFormat('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        }).format(nextDate);

    const reason = availability.requestedWindowReason ?? availability.reason;
    const message =
      reason === 'DAY_FULL'
        ? `Esse dia já atingiu ${availability.dailyLimit} pedidos agendados. Próxima faixa: ${nextLabel}.`
        : reason === 'DAY_BLOCKED'
          ? `Essa faixa foi fechada para novos agendamentos. Próxima faixa: ${nextLabel}.`
          : `Essa faixa não comporta o tempo de forno necessário. Próxima faixa: ${nextLabel}.`;

    return new BadRequestException({
      message,
      nextAvailableAt,
      reason,
      dailyLimit: availability.dailyLimit,
      requestedDate: availability.requestedDate,
      requestedWindowKey: availability.requestedWindowKey
    });
  }

  private async resolvePublicExternalSubmissionSchedule(
    client: OrderScheduleQueryClient,
    fulfillment: ExternalOrderSubmissionPayload['fulfillment'],
    options: {
      requestedTotalBroas?: number | null;
      reference?: Date;
    } = {}
  ) {
    const requestedDate = String(fulfillment.date || '').trim() || null;
    const requestedWindowKey =
      ExternalOrderDeliveryWindowKeyEnum.safeParse(fulfillment.timeWindow ?? null).success
        ? (fulfillment.timeWindow as ExternalOrderDeliveryWindowKey)
        : null;

    if (requestedDate && requestedWindowKey) {
      const availability = await this.buildExternalOrderScheduleAvailability(client, {
        requestedDate,
        requestedWindowKey,
        requestedTotalBroas: options.requestedTotalBroas ?? null,
        reference: options.reference
      });

      if (!availability.requestedWindowAvailable || !availability.requestedWindowScheduledAt) {
        throw this.buildPublicWindowAvailabilityError(availability);
      }

      const scheduledAt = this.parseOptionalDateTime(availability.requestedWindowScheduledAt);
      if (!scheduledAt) {
        throw new BadRequestException('Faixa de horário inválida para o pedido.');
      }

      return {
        availability,
        scheduledAt,
        scheduledAtIso: availability.requestedWindowScheduledAt,
        requestedDate,
        requestedWindowKey
      };
    }

    const scheduledAt = this.parseOptionalDateTime(fulfillment.scheduledAt);
    await this.ensurePublicOrderScheduleAllowed(scheduledAt, {
      requestedTotalBroas: options.requestedTotalBroas ?? null,
      reference: options.reference
    });

    return {
      availability: null,
      scheduledAt,
      scheduledAtIso: scheduledAt?.toISOString() ?? fulfillment.scheduledAt ?? null,
      requestedDate: null,
      requestedWindowKey: null
    };
  }

  private async ensureOrderScheduleCapacityAllowed(
    client: OrderScheduleQueryClient,
    scheduledAt: Date | null,
    options: {
      requestedTotalBroas?: number | null;
      excludeOrderId?: number | null;
      reference?: Date;
    } = {}
  ) {
    if (!scheduledAt) {
      throw new BadRequestException('Data/hora do pedido inválida.');
    }
    const availability = await this.buildExternalOrderScheduleAvailability(client, {
      requestedAt: scheduledAt,
      requestedTotalBroas: options.requestedTotalBroas ?? null,
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
      requestedTotalBroas?: number | null;
      excludeOrderId?: number | null;
      reference?: Date;
    } = {}
  ) {
    if (!scheduledAt) {
      throw new BadRequestException('Data/hora do pedido inválida.');
    }
    if (!isExternalOrderScheduleAllowed(scheduledAt, options.reference)) {
      throw new BadRequestException(externalOrderScheduleErrorMessage(options.reference));
    }
    return this.ensureOrderScheduleCapacityAllowed(this.prisma, scheduledAt, {
      ...options,
      requestedTotalBroas: options.requestedTotalBroas ?? null
    });
  }

  private async ensureScheduleDayIsOpen(
    client: OrderScheduleQueryClient,
    scheduledAt: Date | null,
    options: {
      requestedTotalBroas?: number | null;
      currentScheduledAt?: Date | null;
      reference?: Date;
    } = {}
  ) {
    if (!scheduledAt) return;

    const requestedDayKey = formatScheduleDayKeyFromDate(scheduledAt);
    const requestedWindowKey = resolveExternalOrderDeliveryWindowKeyForDate(scheduledAt);
    const currentDayKey = options.currentScheduledAt ? formatScheduleDayKeyFromDate(options.currentScheduledAt) : null;
    const currentWindowKey = options.currentScheduledAt
      ? resolveExternalOrderDeliveryWindowKeyForDate(options.currentScheduledAt)
      : null;
    if (currentDayKey && currentDayKey === requestedDayKey && currentWindowKey === requestedWindowKey) {
      return;
    }

    const availability = await this.buildExternalOrderScheduleAvailability(client, {
      requestedAt: scheduledAt,
      requestedTotalBroas: options.requestedTotalBroas ?? null,
      reference: options.reference
    });

    if (availability.reason === 'DAY_BLOCKED') {
      throw this.buildPublicWindowAvailabilityError(availability);
    }
  }

  async getPublicScheduleAvailability(
    requestedDate?: string | null,
    requestedWindowKey?: string | null,
    requestedAt?: string | null,
    requestedTotalBroas?: number | null
  ) {
    const parsedRequestedAt = this.parseOptionalDateTime(requestedAt ?? null);
    return this.buildExternalOrderScheduleAvailability(this.prisma, {
      requestedDate: requestedDate ?? null,
      requestedWindowKey: requestedWindowKey ?? null,
      requestedAt: parsedRequestedAt,
      requestedTotalBroas: requestedTotalBroas ?? ORDER_BOX_UNITS
    });
  }

  async getScheduleDayAvailability(dayKey: string) {
    return this.resolveScheduleDayAvailability(this.prisma, dayKey);
  }

  async updateScheduleDayAvailability(dayKey: string, blockedWindows: ExternalOrderDeliveryWindowKey[]) {
    const normalizedDayKey = this.normalizeScheduleDayKey(dayKey);
    const normalizedBlockedWindows = Array.from(
      new Set(
        blockedWindows
          .map((windowKey) => ExternalOrderDeliveryWindowKeyEnum.safeParse(windowKey))
          .filter((result) => result.success)
          .map((result) => result.data)
      )
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.orderScheduleDayAvailability.deleteMany({
        where: { dayKey: normalizedDayKey },
      });

      if (!normalizedBlockedWindows.length) return;

      await tx.orderScheduleDayAvailability.createMany({
        data: normalizedBlockedWindows.map((windowKey) => ({
          dayKey: normalizedDayKey,
          windowKey,
          isOpen: false,
        }))
      });
    });

    return this.resolveScheduleDayAvailability(this.prisma, normalizedDayKey);
  }

  private withFinancial(order: OrderWithRelations) {
    const normalizedStatus = normalizeOrderStatus(order.status) || 'ABERTO';
    const total = this.toMoney(order.total ?? 0);
    const amountPaid = this.getPaidAmount(order.payments || []);
    const balanceDue = moneyFromMinorUnits(Math.max(moneyToMinorUnits(total) - moneyToMinorUnits(amountPaid), 0));
    const paymentStatus = this.deriveOrderPaymentStatus(total, amountPaid);
    return {
      ...order,
      status: normalizedStatus,
      deliveryProvider: this.normalizeDeliveryProvider(order.deliveryProvider),
      deliveryFeeSource: this.normalizeDeliveryFeeSource(order.deliveryFeeSource),
      deliveryQuoteStatus: this.normalizeDeliveryQuoteStatus(order.deliveryQuoteStatus),
      customerSnapshot: this.extractOrderCustomerSnapshot(order),
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

  private async syncPendingPixPaymentsForOrderTotal(tx: TransactionClient, orderId: number, total: number) {
    const pendingPayments = await tx.payment.findMany({
      where: {
        orderId,
        method: 'pix',
        paidAt: null,
        status: {
          not: 'PAGO'
        }
      },
      orderBy: [{ id: 'desc' }]
    });

    if (pendingPayments.length === 0) {
      return;
    }

    if (compareMoney(total, 0) <= 0) {
      await tx.payment.updateMany({
        where: {
          id: {
            in: pendingPayments.map((payment) => payment.id)
          }
        },
        data: {
          amount: 0,
          status: 'PAGO',
          paidAt: new Date()
        }
      });
      return;
    }

    await tx.payment.updateMany({
      where: {
        id: {
          in: pendingPayments.map((payment) => payment.id)
        }
      },
      data: {
        amount: total
      }
    });
  }

  private async getRaw(id: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: orderWithRelationsInclude
    });
    if (!order) throw new NotFoundException('Pedido não encontrado');
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

  private externalSubmissionIdemKey(
    payload: ExternalOrderSubmissionPayload,
    intakeChannel: 'CUSTOMER_LINK'
  ) {
    const rawKey = payload.source.idempotencyKey?.trim() || payload.source.externalId?.trim();
    if (!rawKey) return null;
    return `${intakeChannel}:${rawKey}`;
  }

  private externalSubmissionRequestHash(payload: ExternalOrderSubmissionPayload) {
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
      defaultChannel: 'GOOGLE_FORM' | 'PUBLIC_FORM';
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

  private assertPublicFormDeliveryAddress(customer: ExternalOrderSubmissionPayload['customer'], fulfillmentMode: 'DELIVERY' | 'PICKUP') {
    if (fulfillmentMode !== 'DELIVERY') return;

    if (!normalizeText(customer.address ?? undefined)) {
      throw new BadRequestException('Informe o endereço para entrega.');
    }

    if (!normalizeText(customer.placeId ?? undefined)) {
      throw new BadRequestException('Selecione um endereço reconhecido pelo Google Maps.');
    }

    const addressLine1 = normalizeTitle(customer.addressLine1 ?? undefined) ?? inferAddressLine1(customer.address ?? undefined) ?? '';
    if (!addressLine1) {
      throw new BadRequestException('Selecione um endereço com rua e número.');
    }

    if (!STREET_NUMBER_IN_ADDRESS_LINE_PATTERN.test(addressLine1)) {
      throw new BadRequestException('O endereço precisa incluir o número da rua.');
    }

    if (!normalizeNeighborhood(customer.neighborhood ?? undefined)) {
      throw new BadRequestException('O endereço precisa incluir o bairro.');
    }

    if (!normalizeTitle(customer.addressLine2 ?? undefined)) {
      throw new BadRequestException('Informe o complemento do endereço.');
    }
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
    return (['T', 'G', 'D', 'Q', 'R', 'RJ'] as const)
      .map((code) => {
        const quantity = Math.max(Math.floor(flavorCounts[code] || 0), 0);
        if (quantity <= 0) return null;
        const productId = productIdByCode.get(code);
        if (!productId) {
          throw new BadRequestException(`Produto ativo não encontrado para o sabor ${code}.`);
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

  private async resolveCouponDiscount(input: {
    couponCode?: string | null;
    subtotal: number;
    customerId?: number | null;
    customerPhone?: string | null;
    client?: PrismaService | TransactionClient;
    excludeOrderId?: number | null;
  }) {
    const client = input.client ?? this.prisma;
    const normalizedCode = normalizeCouponCode(input.couponCode);
    const subtotal = this.toMoney(input.subtotal);

    if (!normalizedCode) {
      return {
        code: null,
        discountPct: 0,
        discountAmount: 0,
        subtotalAfterDiscount: subtotal
      };
    }

    const coupon = await findCouponByNormalizedCode(client, normalizedCode);

    if (!coupon) {
      const activeCouponsCount = await client.coupon.count({
        where: {
          active: true
        }
      });
      throw new BadRequestException(
        activeCouponsCount > 0
          ? `Cupom ${normalizedCode} não encontrado entre os cupons ativos.`
          : 'Nenhum cupom ativo cadastrado no momento.'
      );
    }

    if (!coupon.active) {
      throw new BadRequestException(`Cupom ${coupon.code} esta inativo.`);
    }

    const usageLimitPerCustomer =
      typeof coupon.usageLimitPerCustomer === 'number' && coupon.usageLimitPerCustomer > 0
        ? Math.floor(coupon.usageLimitPerCustomer)
        : null;
    if (usageLimitPerCustomer) {
      if (!(input.customerId || String(input.customerPhone || '').trim())) {
        throw new BadRequestException(`Informe um telefone válido para usar o cupom ${coupon.code}.`);
      }

      const customerUsageCount = await countCouponUsageForCustomer(client, {
        couponCode: coupon.code,
        customerId: input.customerId ?? null,
        customerPhone: input.customerPhone ?? null,
        excludeOrderId: input.excludeOrderId ?? null
      });

      if (customerUsageCount >= usageLimitPerCustomer) {
        throw new BadRequestException(
          `Cupom ${coupon.code} já atingiu o limite de ${usageLimitPerCustomer} uso(s) para este cliente.`
        );
      }
    }

    const discountPct = this.toMoney(coupon.discountPct);
    const discountAmount = this.toMoney((subtotal * discountPct) / 100);
    return {
      code: coupon.code,
      discountPct,
      discountAmount,
      subtotalAfterDiscount: this.toMoney(Math.max(subtotal - discountAmount, 0))
    };
  }

  private async intakeExternalSubmission(
    data: ExternalOrderSubmissionPayload,
    params: {
      intakeChannel: 'CUSTOMER_LINK';
      publicAppOrigin?: string | null;
    }
  ) {
    const externalIdemKey = this.externalSubmissionIdemKey(data, params.intakeChannel);
    const externalRequestHash = this.externalSubmissionRequestHash(data);
    if (externalIdemKey) {
      const stored = await this.prisma.$transaction(async (tx) => {
        const existingRecord = await tx.idempotencyRecord.findUnique({
          where: {
            scope_idemKey: {
              scope: ORDER_EXTERNAL_INTAKE_SCOPE,
              idemKey: externalIdemKey
            }
          }
        });
        if (!existingRecord) return null;
        if (existingRecord.requestHash !== externalRequestHash) {
          throw new BadRequestException('Chave de idempotencia reutilizada com payload diferente.');
        }
        return this.findStoredIntakeResult(tx, externalIdemKey, ORDER_EXTERNAL_INTAKE_SCOPE);
      });
      if (stored) {
        return stored;
      }
    }

    const items = await this.resolveExternalSubmissionItems(data);
    const pricedOrder = await this.priceOrderItems(this.prisma, items);
    const resolvedSchedule = await this.resolvePublicExternalSubmissionSchedule(this.prisma, data.fulfillment, {
      requestedTotalBroas: pricedOrder.productionTotalBroas
    });
    const coupon = await this.resolveCouponDiscount({
      couponCode: data.couponCode ?? null,
      subtotal: pricedOrder.couponEligibleSubtotal,
      customerPhone: data.customer.phone ?? null
    });

    const result = await this.intake({
      version: 1,
      intent: 'CONFIRMED',
      customer: {
        name: data.customer.name,
        phone: data.customer.phone ?? null,
        address: data.customer.address ?? null,
        addressLine1: data.customer.addressLine1 ?? null,
        addressLine2: data.customer.addressLine2 ?? null,
        neighborhood: data.customer.neighborhood ?? null,
        city: data.customer.city ?? null,
        state: data.customer.state ?? null,
        postalCode: data.customer.postalCode ?? null,
        country: data.customer.country ?? null,
        placeId: data.customer.placeId ?? null,
        lat: data.customer.lat ?? null,
        lng: data.customer.lng ?? null,
        deliveryNotes: data.customer.deliveryNotes ?? null
      },
      fulfillment: {
        mode: data.fulfillment.mode,
        scheduledAt: resolvedSchedule.scheduledAtIso
      },
      delivery: data.delivery,
      order: {
        items,
        couponCode: coupon.code,
        discount: coupon.discountAmount,
        notes:
          mergeAppliedCouponIntoNotes(
            data.notes ?? null,
            coupon.code
              ? {
                  code: coupon.code,
                  discountPct: coupon.discountPct
                }
              : null
          ) ?? undefined
      },
      payment: {
        method: data.paymentMethod,
        status: 'PENDENTE',
        dueAt: resolvedSchedule.scheduledAtIso
      },
      source: {
        channel: params.intakeChannel,
        externalId: data.source.externalId ?? null,
        idempotencyKey: data.source.idempotencyKey ?? data.source.externalId ?? null,
        originLabel: data.source.originLabel ?? null,
        publicAppOrigin: params.publicAppOrigin ?? data.source.publicAppOrigin ?? null
      }
    });

    if (externalIdemKey) {
      await this.prisma.$transaction((tx) =>
        this.saveIntakeResult(tx, externalIdemKey, externalRequestHash, result, ORDER_EXTERNAL_INTAKE_SCOPE)
      );
    }

    return result;
  }

  private async previewExternalSubmission(
    data: ExternalOrderSubmissionPayload,
    params: {
      intakeChannel: 'CUSTOMER_LINK';
    }
  ): Promise<ExternalOrderSubmissionPreview> {
    const items = await this.resolveExternalSubmissionItems(data);
    const pricedOrder = await this.priceOrderItems(this.prisma, items);
    const resolvedSchedule = await this.resolvePublicExternalSubmissionSchedule(this.prisma, data.fulfillment, {
      requestedTotalBroas: pricedOrder.productionTotalBroas
    });
    const coupon = await this.resolveCouponDiscount({
      couponCode: data.couponCode ?? null,
      subtotal: pricedOrder.couponEligibleSubtotal,
      customerPhone: data.customer.phone ?? null
    });
    const scheduledAt = resolvedSchedule.scheduledAt;
    const deliveryQuote = await this.deliveriesService.resolveDeliverySelection(
      data.delivery,
      this.buildDeliveryQuoteDraft({
        fulfillmentMode: data.fulfillment.mode,
        scheduledAt: resolvedSchedule.scheduledAtIso,
        customerName: data.customer.name,
        customerPhone: data.customer.phone ?? null,
        customerAddress: data.customer.address ?? null,
        customerAddressLine1: data.customer.addressLine1 ?? null,
        customerAddressLine2: data.customer.addressLine2 ?? null,
        customerNeighborhood: data.customer.neighborhood ?? null,
        customerCity: data.customer.city ?? null,
        customerState: data.customer.state ?? null,
        customerPostalCode: data.customer.postalCode ?? null,
        customerCountry: data.customer.country ?? null,
        customerPlaceId: data.customer.placeId ?? null,
        customerLat: data.customer.lat ?? null,
        customerLng: data.customer.lng ?? null,
        customerDeliveryNotes: data.customer.deliveryNotes ?? null,
        items: pricedOrder.manifestItems,
        subtotal: this.toMoney(Math.max(pricedOrder.subtotal - coupon.discountAmount, 0))
      }),
      {
        enforceExternalSchedule: true,
        allowManualFallback: false
      }
    );

    const deliveryFee = this.toMoney(deliveryQuote.fee ?? 0);
    const discount = coupon.discountAmount;
    const netTotal = this.computeOrderTotal(pricedOrder.subtotal, discount, deliveryFee);
    const total = data.paymentMethod === 'card' ? computeSumUpCardPayableTotal(netTotal) : netTotal;

    return ExternalOrderSubmissionPreviewSchema.parse({
      version: 1,
      channel: params.intakeChannel,
      expectedStage: data.paymentMethod === 'card' ? 'PAYMENT_PENDING' : 'PIX_PENDING',
      fulfillmentMode: data.fulfillment.mode,
      scheduledAt: resolvedSchedule.scheduledAtIso,
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
        notes: mergeAppliedCouponIntoNotes(
          data.notes ?? null,
          coupon.code
            ? {
                code: coupon.code,
                discountPct: coupon.discountPct
              }
            : null
        )
      },
      delivery: deliveryQuote,
      payment: {
        method: data.paymentMethod,
        status: 'PENDENTE',
        payable: false,
        dueAt: resolvedSchedule.scheduledAtIso
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
    customerAddressLine1?: string | null;
    customerAddressLine2?: string | null;
    customerNeighborhood?: string | null;
    customerCity?: string | null;
    customerState?: string | null;
    customerPostalCode?: string | null;
    customerCountry?: string | null;
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
        addressLine1: input.customerAddressLine1 ?? null,
        addressLine2: input.customerAddressLine2 ?? null,
        neighborhood: input.customerNeighborhood ?? null,
        city: input.customerCity ?? null,
        state: input.customerState ?? null,
        postalCode: input.customerPostalCode ?? null,
        country: input.customerCountry ?? null,
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

  private buildOrderCustomerSnapshot(input: {
    name?: string | null;
    phone?: string | null;
    address?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    neighborhood?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
    placeId?: string | null;
    lat?: number | null;
    lng?: number | null;
    deliveryNotes?: string | null;
  }): OrderCustomerSnapshotPayload {
    const normalizedName = this.normalizeCustomerName(input.name);
    const normalizedPhone = normalizePhone(input.phone);
    const normalizedAddress = normalizeCustomerAddressPayload({
      address: input.address ?? null,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      neighborhood: input.neighborhood ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      postalCode: input.postalCode ?? null,
      country: input.country ?? null,
      placeId: input.placeId ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      deliveryNotes: input.deliveryNotes ?? null
    });

    return {
      name: normalizedName,
      phone: normalizedPhone,
      address: normalizedAddress.address,
      addressLine1: normalizedAddress.addressLine1,
      addressLine2: normalizedAddress.addressLine2,
      neighborhood: normalizedAddress.neighborhood,
      city: normalizedAddress.city,
      state: normalizedAddress.state,
      postalCode: normalizedAddress.postalCode,
      country: normalizedAddress.country,
      placeId: normalizedAddress.placeId,
      lat: normalizedAddress.lat,
      lng: normalizedAddress.lng,
      deliveryNotes: normalizedAddress.deliveryNotes
    };
  }

  private extractOrderCustomerSnapshot(order: {
    customer?: {
      name?: string | null;
      phone?: string | null;
      address?: string | null;
      addressLine1?: string | null;
      addressLine2?: string | null;
      neighborhood?: string | null;
      city?: string | null;
      state?: string | null;
      postalCode?: string | null;
      country?: string | null;
      placeId?: string | null;
      lat?: number | null;
      lng?: number | null;
      deliveryNotes?: string | null;
    } | null;
    customerName?: string | null;
    customerPhone?: string | null;
    customerAddress?: string | null;
    customerAddressLine1?: string | null;
    customerAddressLine2?: string | null;
    customerNeighborhood?: string | null;
    customerCity?: string | null;
    customerState?: string | null;
    customerPostalCode?: string | null;
    customerCountry?: string | null;
    customerPlaceId?: string | null;
    customerLat?: number | null;
    customerLng?: number | null;
    customerDeliveryNotes?: string | null;
  }) {
    const customer = order.customer;
    return this.buildOrderCustomerSnapshot({
      name: order.customerName ?? customer?.name ?? null,
      phone: order.customerPhone ?? customer?.phone ?? null,
      address: order.customerAddress ?? customer?.address ?? null,
      addressLine1: order.customerAddressLine1 ?? customer?.addressLine1 ?? null,
      addressLine2: order.customerAddressLine2 ?? customer?.addressLine2 ?? null,
      neighborhood: order.customerNeighborhood ?? customer?.neighborhood ?? null,
      city: order.customerCity ?? customer?.city ?? null,
      state: order.customerState ?? customer?.state ?? null,
      postalCode: order.customerPostalCode ?? customer?.postalCode ?? null,
      country: order.customerCountry ?? customer?.country ?? null,
      placeId: order.customerPlaceId ?? customer?.placeId ?? null,
      lat: order.customerLat ?? customer?.lat ?? null,
      lng: order.customerLng ?? customer?.lng ?? null,
      deliveryNotes: order.customerDeliveryNotes ?? customer?.deliveryNotes ?? null
    });
  }

  private flattenOrderCustomerSnapshot(snapshot: OrderCustomerSnapshotPayload) {
    return {
      customerName: snapshot.name ?? null,
      customerPhone: snapshot.phone ?? null,
      customerAddress: snapshot.address ?? null,
      customerAddressLine1: snapshot.addressLine1 ?? null,
      customerAddressLine2: snapshot.addressLine2 ?? null,
      customerNeighborhood: snapshot.neighborhood ?? null,
      customerCity: snapshot.city ?? null,
      customerState: snapshot.state ?? null,
      customerPostalCode: snapshot.postalCode ?? null,
      customerCountry: snapshot.country ?? null,
      customerPlaceId: snapshot.placeId ?? null,
      customerLat: snapshot.lat ?? null,
      customerLng: snapshot.lng ?? null,
      customerDeliveryNotes: snapshot.deliveryNotes ?? null
    };
  }

  private async saveCustomerAdditionalAddress(
    tx: TransactionClient,
    customerId: number,
    snapshot: OrderCustomerSnapshotPayload,
    options?: { primary?: boolean }
  ) {
    const normalized = normalizeCustomerAddressPayload({
      address: snapshot.address ?? null,
      addressLine1: snapshot.addressLine1 ?? null,
      addressLine2: snapshot.addressLine2 ?? null,
      neighborhood: snapshot.neighborhood ?? null,
      city: snapshot.city ?? null,
      state: snapshot.state ?? null,
      postalCode: snapshot.postalCode ?? null,
      country: snapshot.country ?? null,
      placeId: snapshot.placeId ?? null,
      lat: snapshot.lat ?? null,
      lng: snapshot.lng ?? null,
      deliveryNotes: snapshot.deliveryNotes ?? null
    });
    const addressKey = customerAddressIdentityKey(normalized);
    if (!addressKey) return null;

    const existing = await tx.customerAddress.findMany({
      where: { customerId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
    });
    const matched = existing.find((entry) => customerAddressIdentityKey(entry) === addressKey) || null;
    const shouldBePrimary = options?.primary === true;

    if (shouldBePrimary) {
      await tx.customerAddress.updateMany({
        where: { customerId, isPrimary: true, ...(matched ? { id: { not: matched.id } } : {}) },
        data: { isPrimary: false }
      });
    }

    if (matched) {
      return tx.customerAddress.update({
        where: { id: matched.id },
        data: {
          ...normalized,
          isPrimary: shouldBePrimary ? true : matched.isPrimary
        }
      });
    }

    return tx.customerAddress.create({
      data: {
        customerId,
        ...normalized,
        isPrimary: shouldBePrimary
      }
    });
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
      if (!existing) throw new NotFoundException('Cliente não encontrado');
      if (existing.deletedAt) {
        throw new BadRequestException('Cliente foi excluído e não pode receber novos pedidos.');
      }
      return this.ensureCustomerPublicNumber(tx, existing);
    }

    const normalizedName = this.normalizeCustomerName(customer.name);
    if (!normalizedName) {
      throw new BadRequestException('Nome do cliente e obrigatorio.');
    }
    const snapshot = this.buildOrderCustomerSnapshot({
      name: normalizedName,
      phone: customer.phone ?? null,
      address: customer.address ?? null,
      addressLine1: 'addressLine1' in customer ? customer.addressLine1 ?? null : null,
      addressLine2: 'addressLine2' in customer ? customer.addressLine2 ?? null : null,
      neighborhood: 'neighborhood' in customer ? customer.neighborhood ?? null : null,
      city: 'city' in customer ? customer.city ?? null : null,
      state: 'state' in customer ? customer.state ?? null : null,
      postalCode: 'postalCode' in customer ? customer.postalCode ?? null : null,
      country: 'country' in customer ? customer.country ?? null : null,
      placeId: 'placeId' in customer ? customer.placeId ?? null : null,
      lat: 'lat' in customer ? customer.lat ?? null : null,
      lng: 'lng' in customer ? customer.lng ?? null : null,
      deliveryNotes: customer.deliveryNotes ?? null
    });
    const normalizedPhone = snapshot.phone;
    const normalizedPlaceId = snapshot.placeId;
    const normalizedAddress = snapshot.address;

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
        (snapshot.phone && !existing.phone) ||
        (snapshot.address && !existing.address) ||
        (snapshot.addressLine1 && !existing.addressLine1) ||
        (snapshot.addressLine2 && !existing.addressLine2) ||
        (snapshot.neighborhood && !existing.neighborhood) ||
        (snapshot.city && !existing.city) ||
        (snapshot.state && !existing.state) ||
        (snapshot.postalCode && !existing.postalCode) ||
        (snapshot.country && !existing.country) ||
        (snapshot.placeId && !existing.placeId) ||
        (snapshot.lat !== null && existing.lat === null) ||
        (snapshot.lng !== null && existing.lng === null) ||
        (snapshot.deliveryNotes && !existing.deliveryNotes);
      const resolvedCustomer = shouldUpdate
        ? await tx.customer.update({
            where: { id: existing.id },
            data: {
              publicNumber: existing.publicNumber ?? (await allocateNextPublicNumber(tx, 'CUSTOMER')),
              activePhoneKey: existing.activePhoneKey || snapshot.phone,
              phone: existing.phone || snapshot.phone,
              address: existing.address || snapshot.address,
              addressLine1: existing.addressLine1 || snapshot.addressLine1 || inferAddressLine1(snapshot.address),
              addressLine2: existing.addressLine2 || snapshot.addressLine2,
              neighborhood: existing.neighborhood || normalizeNeighborhood(snapshot.neighborhood),
              city: existing.city || snapshot.city,
              state: existing.state || snapshot.state,
              postalCode: existing.postalCode || snapshot.postalCode,
              country: existing.country || snapshot.country,
              placeId: existing.placeId || snapshot.placeId,
              lat: existing.lat ?? snapshot.lat,
              lng: existing.lng ?? snapshot.lng,
              deliveryNotes: existing.deliveryNotes || snapshot.deliveryNotes
            }
          })
        : existing;
      await this.saveCustomerAdditionalAddress(tx, resolvedCustomer.id, snapshot, { primary: false });
      return resolvedCustomer;
    }

    const created = await tx.customer.create({
      data: {
        publicNumber: await allocateNextPublicNumber(tx, 'CUSTOMER'),
        name: normalizedName,
        firstName: normalizedName.split(' ')[0] || null,
        lastName: normalizedName.includes(' ') ? normalizedName.split(' ').slice(1).join(' ') : null,
        activePhoneKey: snapshot.phone,
        phone: snapshot.phone,
        address: snapshot.address,
        addressLine1: snapshot.addressLine1 || inferAddressLine1(snapshot.address),
        addressLine2: snapshot.addressLine2,
        neighborhood: snapshot.neighborhood,
        city: snapshot.city,
        state: snapshot.state,
        postalCode: snapshot.postalCode,
        country: snapshot.country,
        placeId: snapshot.placeId,
        lat: snapshot.lat,
        lng: snapshot.lng,
        deliveryNotes: snapshot.deliveryNotes
      }
    });
    await this.saveCustomerAdditionalAddress(tx, created.id, snapshot, { primary: true });
    return created;
  }

  private async resolveDeliveryQuoteCustomer(customer: OrderIntakePayload['customer']) {
    if ('customerId' in customer) {
      const existing = await this.prisma.customer.findUnique({ where: { id: customer.customerId } });
      if (!existing) throw new NotFoundException('Cliente não encontrado');
      return this.buildOrderCustomerSnapshot({
        name: existing.name,
        phone: existing.phone ?? null,
        address: ('address' in customer ? customer.address : null) ?? existing.address ?? null,
        addressLine1: ('addressLine1' in customer ? customer.addressLine1 : null) ?? existing.addressLine1 ?? null,
        addressLine2: ('addressLine2' in customer ? customer.addressLine2 : null) ?? existing.addressLine2 ?? null,
        neighborhood: ('neighborhood' in customer ? customer.neighborhood : null) ?? existing.neighborhood ?? null,
        city: ('city' in customer ? customer.city : null) ?? existing.city ?? null,
        state: ('state' in customer ? customer.state : null) ?? existing.state ?? null,
        postalCode: ('postalCode' in customer ? customer.postalCode : null) ?? existing.postalCode ?? null,
        country: ('country' in customer ? customer.country : null) ?? existing.country ?? null,
        placeId: ('placeId' in customer ? customer.placeId : null) ?? existing.placeId ?? null,
        lat: ('lat' in customer ? customer.lat : null) ?? existing.lat ?? null,
        lng: ('lng' in customer ? customer.lng : null) ?? existing.lng ?? null,
        deliveryNotes: ('deliveryNotes' in customer ? customer.deliveryNotes : null) ?? existing.deliveryNotes ?? null
      });
    }

    return this.buildOrderCustomerSnapshot({
      name: customer.name,
      phone: customer.phone ?? null,
      address: customer.address ?? null,
      addressLine1: 'addressLine1' in customer ? customer.addressLine1 ?? null : null,
      addressLine2: 'addressLine2' in customer ? customer.addressLine2 ?? null : null,
      neighborhood: 'neighborhood' in customer ? customer.neighborhood ?? null : null,
      city: 'city' in customer ? customer.city ?? null : null,
      state: 'state' in customer ? customer.state ?? null : null,
      postalCode: 'postalCode' in customer ? customer.postalCode ?? null : null,
      country: 'country' in customer ? customer.country ?? null : null,
      placeId: 'placeId' in customer ? customer.placeId ?? null : null,
      lat: 'lat' in customer ? customer.lat ?? null : null,
      lng: 'lng' in customer ? customer.lng ?? null : null,
      deliveryNotes: customer.deliveryNotes ?? null
    });
  }

  private async priceOrderItems(
    tx: TransactionClient | PrismaService,
    items: Array<{ productId: number; quantity: number }>,
    options?: {
      allowInactiveProductIds?: ReadonlySet<number>;
      excludeOrderId?: number | null;
    }
  ) {
    const parsedItems = items.map((item) =>
      OrderItemSchema.pick({ productId: true, quantity: true }).parse(item)
    );
    const productIds = Array.from(new Set(parsedItems.map((item) => item.productId)));
    const products = await tx.product.findMany({ where: { id: { in: productIds } } });
    const productMap = new Map(products.map((product) => [product.id, product]));
    const allowInactiveProductIds = options?.allowInactiveProductIds ?? new Set<number>();
    const salesLimitStates = await loadProductSalesLimitStates(tx, products, {
      excludeOrderId: options?.excludeOrderId ?? null
    });
    const requestedQuantityByProductId = new Map<number, number>();
    for (const item of parsedItems) {
      requestedQuantityByProductId.set(
        item.productId,
        (requestedQuantityByProductId.get(item.productId) || 0) + item.quantity
      );
    }

    for (const [productId, requestedQuantity] of requestedQuantityByProductId.entries()) {
      const product = productMap.get(productId);
      if (!product) throw new NotFoundException('Produto não encontrado');
      if (product.active === false && !allowInactiveProductIds.has(product.id)) {
        throw new BadRequestException('Produto indisponível.');
      }
      const salesLimitState = salesLimitStates.get(product.id);
      if (salesLimitState && requestedQuantity > salesLimitState.remainingUnits) {
        throw new BadRequestException(
          salesLimitState.remainingUnits > 0
            ? `Limite de ${product.name} excedido. Restam ${salesLimitState.remainingBoxes.toLocaleString('pt-BR', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2
              })} caixa(s).`
            : `${product.name} esgotou o limite configurado e ficou indisponível.`
        );
      }
    }

    const itemsData: Array<{ productId: number; quantity: number; unitPrice: number; total: number }> = [];
    const manifestItems: Array<{ productId: number; quantity: number; name: string }> = [];
    const productionItems: Array<{ quantity: number; productName: string; productUnit: string | null }> = [];
    for (const item of parsedItems) {
      const product = productMap.get(item.productId);
      if (!product) throw new NotFoundException('Produto não encontrado');
      const unitPrice = this.toUnitPrice(product.price);
      const total = this.toMoney(unitPrice * item.quantity);
      itemsData.push({ productId: item.productId, quantity: item.quantity, unitPrice, total });
      manifestItems.push({
        productId: item.productId,
        quantity: item.quantity,
        name: product.name
      });
      productionItems.push({
        quantity: item.quantity,
        productName: product.name,
        productUnit: product.unit ?? null
      });
    }

    const { subtotal, couponEligibleSubtotal } = await this.calculateOrderSubtotalsFromItems(tx, parsedItems);
    return {
      parsedItems,
      itemsData,
      subtotal,
      couponEligibleSubtotal,
      manifestItems,
      productionTotalBroas: this.resolveOrderProductionBroaCount(productionItems)
    };
  }

  private async syncLimitedProductsAfterOrderChange(
    tx: TransactionClient,
    productIds: number[]
  ) {
    const uniqueProductIds = Array.from(new Set(productIds)).filter((id) => Number.isFinite(id));
    if (uniqueProductIds.length === 0) return;

    const products = await tx.product.findMany({
      where: {
        id: { in: uniqueProductIds },
        salesLimitEnabled: true,
        salesLimitBoxes: { gt: 0 },
        salesLimitActivatedAt: { not: null },
        active: true
      },
      select: {
        id: true,
        salesLimitEnabled: true,
        salesLimitBoxes: true,
        salesLimitActivatedAt: true
      }
    });
    if (products.length === 0) return;

    const states = await loadProductSalesLimitStates(tx, products);
    const exhaustedIds = products
      .filter((product) => states.get(product.id)?.exhausted)
      .map((product) => product.id);
    if (exhaustedIds.length === 0) return;

    await tx.product.updateMany({
      where: {
        id: { in: exhaustedIds },
        active: true
      },
      data: {
        active: false
      }
    });
  }

  private async syncProductAvailabilityAfterInventoryChange(
    tx: TransactionClient,
    productIds: number[]
  ) {
    const uniqueProductIds = Array.from(new Set(productIds)).filter((id) => Number.isFinite(id));
    if (uniqueProductIds.length === 0) return;
    await syncCompanionProductActiveStateByProductIds(tx, uniqueProductIds);
    await this.syncLimitedProductsAfterOrderChange(tx, uniqueProductIds);
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
    if (payment && pixStatus === 'PENDENTE') {
      return payment.method === 'pix' ? ('PIX_PENDING' as const) : ('PAYMENT_PENDING' as const);
    }
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
    pixCharge: PixCharge | null,
    cardCheckout: CheckoutCard | null
  ) {
    const pixStatus = payment && (payment.status === 'PAGO' || payment.paidAt) ? 'PAGO' : 'PENDENTE';
    const paymentMethod: PaymentMethod = payment?.method === 'card' ? 'card' : 'pix';
    return OrderIntakeMetaSchema.parse({
      version: 1,
      channel: payload.source.channel,
      intent: payload.intent,
      stage: this.intakeStageFrom(payload, order, payment),
      fulfillmentMode: payload.fulfillment.mode,
      paymentMethod,
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
      cardCheckout,
      orderId: order.id!,
      customerId: order.customerId
    });
  }

  private async findStoredIntakeResult(
    tx: TransactionClient,
    idemKey: string,
    scope = ORDER_INTAKE_SCOPE
  ): Promise<{ order: ReturnType<OrdersService['withFinancial']>; intake: OrderIntakeMeta } | null> {
    const record = await tx.idempotencyRecord.findUnique({
      where: {
        scope_idemKey: {
          scope,
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
        include: orderWithRelationsInclude
      });
      if (!order) return null;
      const intakePayload =
        typeof parsed.intake === 'object' && parsed.intake ? (parsed.intake as Record<string, unknown>) : {};
      return {
        order: this.withFinancial(order),
        intake: OrderIntakeMetaSchema.parse({
          paymentMethod: 'pix',
          pixCharge: null,
          cardCheckout: null,
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
    result: { order: ReturnType<OrdersService['withFinancial']>; intake: OrderIntakeMeta },
    scope = ORDER_INTAKE_SCOPE
  ) {
    await tx.idempotencyRecord.upsert({
      where: {
        scope_idemKey: {
          scope,
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
        scope,
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
    const idemKey = this.intakeIdemKey(data);
    const requestHash = this.intakeRequestHash(data);
    if (idemKey) {
      const stored = await this.prisma.$transaction(async (tx) => {
        const existingRecord = await tx.idempotencyRecord.findUnique({
          where: {
            scope_idemKey: {
              scope: ORDER_INTAKE_SCOPE,
              idemKey
            }
          }
        });
        if (!existingRecord) return null;
        if (existingRecord.requestHash !== requestHash) {
          throw new BadRequestException('Chave de idempotencia reutilizada com payload diferente.');
        }
        return this.findStoredIntakeResult(tx, idemKey);
      });
      if (stored) {
        return stored;
      }
    }

    const isExternalIntakeChannel = data.source.channel === 'CUSTOMER_LINK';
    const quoteCustomer = await this.resolveDeliveryQuoteCustomer(data.customer);
    const pricedOrder = await this.priceOrderItems(this.prisma, data.order.items);
    const { discount, discountPct } = this.resolveOrderDiscountInput(pricedOrder.subtotal, data.order);
    const preflightResolvedCoupon = normalizeCouponCode(data.order.couponCode)
      ? await this.resolveCouponDiscount({
          couponCode: data.order.couponCode,
          subtotal: pricedOrder.couponEligibleSubtotal,
          customerId: 'customerId' in data.customer ? data.customer.customerId : null,
          customerPhone: quoteCustomer.phone ?? null
        })
      : null;
    const quoteDiscount = preflightResolvedCoupon ? preflightResolvedCoupon.discountAmount : discount;
    const quoteSubtotal = this.toMoney(Math.max(pricedOrder.subtotal - quoteDiscount, 0));
    const scheduledAt = this.parseOptionalDateTime(data.fulfillment.scheduledAt);
    await this.ensureScheduleDayIsOpen(this.prisma, scheduledAt, {
      requestedTotalBroas: pricedOrder.productionTotalBroas
    });
    const deliveryQuote = await this.deliveriesService.resolveDeliverySelection(
      data.delivery,
      this.buildDeliveryQuoteDraft({
        fulfillmentMode: data.fulfillment.mode,
        scheduledAt: scheduledAt?.toISOString() ?? data.fulfillment.scheduledAt ?? null,
        customerName: quoteCustomer.name,
        customerPhone: quoteCustomer.phone,
        customerAddress: quoteCustomer.address,
        customerAddressLine1: quoteCustomer.addressLine1,
        customerAddressLine2: quoteCustomer.addressLine2,
        customerNeighborhood: quoteCustomer.neighborhood,
        customerCity: quoteCustomer.city,
        customerState: quoteCustomer.state,
        customerPostalCode: quoteCustomer.postalCode,
        customerCountry: quoteCustomer.country,
        customerPlaceId: quoteCustomer.placeId,
        customerLat: quoteCustomer.lat,
        customerLng: quoteCustomer.lng,
        customerDeliveryNotes: quoteCustomer.deliveryNotes,
        subtotal: quoteSubtotal,
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
      const orderCustomerSnapshot =
        'customerId' in data.customer
          ? this.buildOrderCustomerSnapshot({
              name: customer.name,
              phone: customer.phone,
              address: ('address' in data.customer ? data.customer.address : null) ?? customer.address,
              addressLine1:
                ('addressLine1' in data.customer ? data.customer.addressLine1 : null) ?? customer.addressLine1,
              addressLine2:
                ('addressLine2' in data.customer ? data.customer.addressLine2 : null) ?? customer.addressLine2,
              neighborhood:
                ('neighborhood' in data.customer ? data.customer.neighborhood : null) ?? customer.neighborhood,
              city: ('city' in data.customer ? data.customer.city : null) ?? customer.city,
              state: ('state' in data.customer ? data.customer.state : null) ?? customer.state,
              postalCode:
                ('postalCode' in data.customer ? data.customer.postalCode : null) ?? customer.postalCode,
              country: ('country' in data.customer ? data.customer.country : null) ?? customer.country,
              placeId: ('placeId' in data.customer ? data.customer.placeId : null) ?? customer.placeId,
              lat: ('lat' in data.customer ? data.customer.lat : null) ?? customer.lat,
              lng: ('lng' in data.customer ? data.customer.lng : null) ?? customer.lng,
              deliveryNotes:
                ('deliveryNotes' in data.customer ? data.customer.deliveryNotes : null) ?? customer.deliveryNotes
            })
          : this.buildOrderCustomerSnapshot({
              name: data.customer.name ?? customer.name,
              phone: data.customer.phone ?? customer.phone,
              address: data.customer.address ?? customer.address,
              addressLine1:
                ('addressLine1' in data.customer ? data.customer.addressLine1 : null) ?? customer.addressLine1,
              addressLine2:
                ('addressLine2' in data.customer ? data.customer.addressLine2 : null) ?? customer.addressLine2,
              neighborhood:
                ('neighborhood' in data.customer ? data.customer.neighborhood : null) ?? customer.neighborhood,
              city: ('city' in data.customer ? data.customer.city : null) ?? customer.city,
              state: ('state' in data.customer ? data.customer.state : null) ?? customer.state,
              postalCode:
                ('postalCode' in data.customer ? data.customer.postalCode : null) ?? customer.postalCode,
              country: ('country' in data.customer ? data.customer.country : null) ?? customer.country,
              placeId: ('placeId' in data.customer ? data.customer.placeId : null) ?? customer.placeId,
              lat: ('lat' in data.customer ? data.customer.lat : null) ?? customer.lat,
              lng: ('lng' in data.customer ? data.customer.lng : null) ?? customer.lng,
              deliveryNotes: data.customer.deliveryNotes ?? customer.deliveryNotes
            });
      const { itemsData, subtotal } = pricedOrder;
      const quotedDeliveryFee = this.toMoney(deliveryQuote.fee ?? 0);
      const appliedCoupon = normalizeCouponCode(data.order.couponCode);
      const resolvedCoupon = appliedCoupon
        ? await this.resolveCouponDiscount({
            couponCode: appliedCoupon,
            subtotal: pricedOrder.couponEligibleSubtotal,
            customerId: customer.id,
            customerPhone: customer.phone ?? null,
            client: tx
          })
        : null;
      const effectiveDiscount = resolvedCoupon ? resolvedCoupon.discountAmount : discount;
      const effectiveDiscountPct = resolvedCoupon ? resolvedCoupon.discountPct : discountPct;
      const sponsoredDeliveryFee = this.resolveMarketingSponsoredDeliveryFee({
        quotedDeliveryFee,
        discountPct: effectiveDiscountPct,
        fulfillmentMode: data.fulfillment.mode,
        allowSponsoredDelivery: data.source.channel === 'INTERNAL_DASHBOARD'
      });
      const deliveryFee = compareMoney(sponsoredDeliveryFee, 0) > 0 ? 0 : quotedDeliveryFee;
      const total = this.computeOrderTotal(subtotal, effectiveDiscount, deliveryFee);
      let normalizedNotes = data.order.notes ?? null;

      if (resolvedCoupon?.code) {
        normalizedNotes = mergeAppliedCouponIntoNotes(normalizedNotes, {
          code: resolvedCoupon.code,
          discountPct: resolvedCoupon.discountPct
        });
      }

      if (data.source.channel === 'INTERNAL_DASHBOARD' && compareMoney(effectiveDiscountPct, 0) > 0) {
        normalizedNotes = mergeMarketingSamplesIntoNotes(normalizedNotes, {
          discountPct: effectiveDiscountPct,
          sponsoredDeliveryFee
        });
      }

      const createdOrder = await tx.order.create({
        data: {
          publicNumber: await allocateNextPublicNumber(tx, 'ORDER'),
          customerId: customer.id,
          ...this.flattenOrderCustomerSnapshot(orderCustomerSnapshot),
          status: 'ABERTO',
          fulfillmentMode: data.fulfillment.mode,
          notes: normalizedNotes,
          scheduledAt,
          subtotal,
          deliveryFee,
          deliveryProvider: deliveryQuote.provider,
          deliveryFeeSource: deliveryQuote.source,
          deliveryQuoteStatus: deliveryQuote.status,
          deliveryQuoteRef: deliveryQuote.quoteToken ?? null,
          deliveryQuoteExpiresAt: this.parseOptionalDateTime(deliveryQuote.expiresAt ?? null),
          discount: effectiveDiscount,
          couponCode: resolvedCoupon?.code ?? null,
          total,
          items: {
            create: itemsData
          }
        },
        include: orderWithRelationsInclude
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
      let cardCheckout: CheckoutCard | null = null;

      if (data.intent !== 'DRAFT' && data.payment) {
        const normalizedPaymentStatus = compareMoney(total, 0) <= 0 ? 'PAGO' : data.payment.status;
        paymentRecord = await tx.payment.create({
          data: {
            orderId: createdOrder.id,
            amount: total,
            method: data.payment.method,
            status: normalizedPaymentStatus,
            dueDate: data.payment.dueAt ? new Date(data.payment.dueAt) : scheduledAt,
            paidAt:
              normalizedPaymentStatus === 'PAGO'
                ? data.payment.paidAt
                  ? new Date(data.payment.paidAt)
                  : new Date()
                : null,
            providerRef: data.payment.providerRef ?? null
          }
        });

        if (paymentRecord.status !== 'PAGO' && !paymentRecord.paidAt) {
          if (paymentRecord.method === 'pix') {
            paymentRecord = await this.paymentsService.ensurePixChargeOnRecord(tx, paymentRecord);
          } else if (paymentRecord.method === 'card' && compareMoney(paymentRecord.amount, 0) > 0) {
            const ensuredCardCheckout = await this.paymentsService.ensureSumUpHostedCheckoutOnRecord(tx, paymentRecord, {
              orderPublicNumber: createdOrder.publicNumber ?? null,
              publicAppOrigin: data.source.publicAppOrigin ?? null
            });
            paymentRecord = ensuredCardCheckout.payment;
            cardCheckout = ensuredCardCheckout.cardCheckout;
          }
        }
      }

      const hydratedOrder = await tx.order.findUnique({
        where: { id: createdOrder.id },
        include: orderWithRelationsInclude
      });
      if (!hydratedOrder) throw new NotFoundException('Pedido não encontrado');

      await this.syncOrderInventoryArtifacts(tx, hydratedOrder);
      await this.syncProductAvailabilityAfterInventoryChange(
        tx,
        itemsData.map((item) => item.productId)
      );

      const freshOrder = await tx.order.findUnique({
        where: { id: createdOrder.id },
        include: orderWithRelationsInclude
      });
      if (!freshOrder) throw new NotFoundException('Pedido não encontrado');

      const order = this.withFinancial(freshOrder);
      const productNameById =
        freshOrder.items.length > 0
          ? new Map(
              (
                await tx.product.findMany({
                  where: {
                    id: {
                      in: Array.from(new Set(freshOrder.items.map((item) => item.productId)))
                    }
                  },
                  select: { id: true, name: true }
                })
              ).map((product) => [product.id, product.name] as const)
            )
          : new Map<number, string>();
      const orderAlertPayload = {
        ...order,
        items: order.items.map((item) => ({
          ...item,
          name: productNameById.get(item.productId) || null
        }))
      };
      const latestPayment =
        paymentRecord
          ? freshOrder.payments.find((entry) => entry.id === paymentRecord?.id) ?? paymentRecord
          : null;
      const pixCharge =
        latestPayment &&
        latestPayment.method === 'pix' &&
        latestPayment.status !== 'PAGO' &&
        !latestPayment.paidAt &&
        compareMoney(latestPayment.amount, 0) > 0
          ? this.paymentsService.buildPixCharge(latestPayment)
          : null;
      const result = {
        order,
        intake: this.buildOrderIntakeMeta(data, order, latestPayment, pixCharge, cardCheckout)
      };

      if (data.intent !== 'DRAFT') {
        createdFreshResult = {
          ...result,
          order: orderAlertPayload
        };
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

  async intakeCustomerForm(payload: unknown, options?: { publicAppOrigin?: string | null }) {
    const data = this.parseExternalOrderSubmission(payload, {
      defaultChannel: 'PUBLIC_FORM',
      defaultOriginLabel: 'customer-form'
    });
    this.assertPublicFormDeliveryAddress(data.customer, data.fulfillment.mode);
    return this.intakeExternalSubmission(data, {
      intakeChannel: 'CUSTOMER_LINK',
      publicAppOrigin: options?.publicAppOrigin ?? null
    });
  }

  async previewCustomerForm(payload: unknown) {
    const data = this.parseExternalOrderSubmission(payload, {
      defaultChannel: 'PUBLIC_FORM',
      defaultOriginLabel: 'customer-form'
    });
    this.assertPublicFormDeliveryAddress(data.customer, data.fulfillment.mode);
    return this.previewExternalSubmission(data, {
      intakeChannel: 'CUSTOMER_LINK'
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

  async list() {
    const orders = await this.prisma.order.findMany({
      include: orderWithRelationsInclude,
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

  async create(payload: unknown) {
    const data = OrderSchema.pick({
      customerId: true,
      notes: true,
      discount: true,
      discountPct: true,
      scheduledAt: true,
      items: true,
      fulfillmentMode: true
    }).parse(payload);
    const items = data.items ?? [];
    if (items.length === 0) {
      throw new BadRequestException('Itens são obrigatórios');
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
        discountPct: data.discountPct ?? undefined,
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
        include: orderWithRelationsInclude
      });
      if (!existing) throw new NotFoundException('Pedido não encontrado');
      const previousTargetDate = this.orderTargetDate(existing).date;

      const nextScheduledAt = Object.prototype.hasOwnProperty.call(data, 'scheduledAt')
        ? this.parseOptionalDateTime(data.scheduledAt)
        : undefined;
      const nextFulfillmentMode = data.fulfillmentMode ?? existing.fulfillmentMode ?? 'DELIVERY';
      const pricedOrder = await this.priceOrderItems(
        tx,
        existing.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity
        })),
        {
          allowInactiveProductIds: new Set(existing.items.map((item) => item.productId)),
          excludeOrderId: existing.id
        }
      );
      const subtotal = pricedOrder.subtotal;
      const shouldUpdateDiscount =
        Object.prototype.hasOwnProperty.call(data, 'discount') ||
        Object.prototype.hasOwnProperty.call(data, 'discountPct');
      const { discount, discountPct } =
        Object.prototype.hasOwnProperty.call(data, 'discount') || Object.prototype.hasOwnProperty.call(data, 'discountPct')
          ? this.resolveOrderDiscountInput(subtotal, {
              discount: data.discount,
              discountPct: data.discountPct
            })
          : this.resolveOrderDiscountInput(subtotal, {
              discount: existing.discount ?? 0
            });
      const currentSnapshot = this.extractOrderCustomerSnapshot(existing);
      const nextCustomerSnapshot = data.customerSnapshot
        ? this.buildOrderCustomerSnapshot({
            name:
              Object.prototype.hasOwnProperty.call(data.customerSnapshot, 'name')
                ? data.customerSnapshot.name ?? null
                : currentSnapshot.name,
            phone:
              Object.prototype.hasOwnProperty.call(data.customerSnapshot, 'phone')
                ? data.customerSnapshot.phone ?? null
                : currentSnapshot.phone,
            address:
              Object.prototype.hasOwnProperty.call(data.customerSnapshot, 'address')
                ? data.customerSnapshot.address ?? null
                : currentSnapshot.address,
            addressLine1:
              Object.prototype.hasOwnProperty.call(data.customerSnapshot, 'addressLine1')
                ? data.customerSnapshot.addressLine1 ?? null
                : currentSnapshot.addressLine1,
            addressLine2:
              Object.prototype.hasOwnProperty.call(data.customerSnapshot, 'addressLine2')
                ? data.customerSnapshot.addressLine2 ?? null
                : currentSnapshot.addressLine2,
            neighborhood:
              Object.prototype.hasOwnProperty.call(data.customerSnapshot, 'neighborhood')
                ? data.customerSnapshot.neighborhood ?? null
                : currentSnapshot.neighborhood,
            city:
              Object.prototype.hasOwnProperty.call(data.customerSnapshot, 'city')
                ? data.customerSnapshot.city ?? null
                : currentSnapshot.city,
            state:
              Object.prototype.hasOwnProperty.call(data.customerSnapshot, 'state')
                ? data.customerSnapshot.state ?? null
                : currentSnapshot.state,
            postalCode:
              Object.prototype.hasOwnProperty.call(data.customerSnapshot, 'postalCode')
                ? data.customerSnapshot.postalCode ?? null
                : currentSnapshot.postalCode,
            country:
              Object.prototype.hasOwnProperty.call(data.customerSnapshot, 'country')
                ? data.customerSnapshot.country ?? null
                : currentSnapshot.country,
            placeId:
              Object.prototype.hasOwnProperty.call(data.customerSnapshot, 'placeId')
                ? data.customerSnapshot.placeId ?? null
                : currentSnapshot.placeId,
            lat:
              Object.prototype.hasOwnProperty.call(data.customerSnapshot, 'lat')
                ? data.customerSnapshot.lat ?? null
                : currentSnapshot.lat,
            lng:
              Object.prototype.hasOwnProperty.call(data.customerSnapshot, 'lng')
                ? data.customerSnapshot.lng ?? null
                : currentSnapshot.lng,
            deliveryNotes:
              Object.prototype.hasOwnProperty.call(data.customerSnapshot, 'deliveryNotes')
                ? data.customerSnapshot.deliveryNotes ?? null
                : currentSnapshot.deliveryNotes
          })
        : currentSnapshot;
      if (!nextCustomerSnapshot.name) {
        throw new BadRequestException('Nome do cliente e obrigatorio.');
      }
      const quoteScheduledAt = nextScheduledAt ?? existing.scheduledAt;
      await this.ensureScheduleDayIsOpen(tx, quoteScheduledAt, {
        requestedTotalBroas: pricedOrder.productionTotalBroas,
        currentScheduledAt: existing.scheduledAt
      });
      const deliveryQuote = await this.deliveriesService.resolveDeliverySelection(
        undefined,
        this.buildDeliveryQuoteDraft({
          fulfillmentMode: nextFulfillmentMode === 'PICKUP' ? 'PICKUP' : 'DELIVERY',
          scheduledAt: quoteScheduledAt?.toISOString() ?? new Date().toISOString(),
          customerName: nextCustomerSnapshot.name,
          customerPhone: nextCustomerSnapshot.phone,
          customerAddress: nextCustomerSnapshot.address,
          customerAddressLine1: nextCustomerSnapshot.addressLine1,
          customerAddressLine2: nextCustomerSnapshot.addressLine2,
          customerNeighborhood: nextCustomerSnapshot.neighborhood,
          customerCity: nextCustomerSnapshot.city,
          customerState: nextCustomerSnapshot.state,
          customerPostalCode: nextCustomerSnapshot.postalCode,
          customerCountry: nextCustomerSnapshot.country,
          customerPlaceId: nextCustomerSnapshot.placeId,
          customerLat: nextCustomerSnapshot.lat,
          customerLng: nextCustomerSnapshot.lng,
          customerDeliveryNotes: nextCustomerSnapshot.deliveryNotes,
          items: pricedOrder.manifestItems,
          subtotal: this.toMoney(Math.max(subtotal - discount, 0))
        }),
        {
          enforceExternalSchedule: false,
          allowManualFallback: true,
          persistQuoteRecord: false
        }
      );
      const quotedDeliveryFee = this.toMoney(deliveryQuote.fee ?? 0);
      const sponsoredDeliveryFee = this.resolveMarketingSponsoredDeliveryFee({
        quotedDeliveryFee,
        discountPct,
        fulfillmentMode: nextFulfillmentMode,
        allowSponsoredDelivery: true
      });
      const deliveryFee = compareMoney(sponsoredDeliveryFee, 0) > 0 ? 0 : quotedDeliveryFee;
      const total = this.computeOrderTotal(subtotal, discount, deliveryFee);
      const amountPaid = this.getPaidAmount(existing.payments || []);
      this.ensureOrderTotalCoversPaid(total, amountPaid);
      const shouldUpdateNotes = Object.prototype.hasOwnProperty.call(data, 'notes') || shouldUpdateDiscount;
      let nextNotes = shouldUpdateNotes
        ? preserveOrderNoteMetadata(
            existing.notes ?? null,
            Object.prototype.hasOwnProperty.call(data, 'notes')
              ? data.notes ?? null
              : stripOrderNoteMetadata(existing.notes ?? null)
          )
        : undefined;
      if (nextNotes !== undefined) {
        nextNotes = mergeMarketingSamplesIntoNotes(
          nextNotes,
          compareMoney(discountPct, 0) > 0
            ? {
                discountPct,
                sponsoredDeliveryFee
              }
            : null
        );
      }
      const updated = await tx.order.update({
        where: { id },
        data: {
          ...(nextNotes !== undefined ? { notes: nextNotes } : {}),
          ...this.flattenOrderCustomerSnapshot(nextCustomerSnapshot),
          discount,
          subtotal,
          fulfillmentMode: nextFulfillmentMode,
          deliveryFee,
          deliveryProvider: deliveryQuote.provider,
          deliveryFeeSource: deliveryQuote.source,
          deliveryQuoteStatus: deliveryQuote.status,
          deliveryQuoteRef: deliveryQuote.quoteToken ?? null,
          deliveryQuoteExpiresAt: this.parseOptionalDateTime(deliveryQuote.expiresAt ?? null),
          total,
          ...(nextScheduledAt !== undefined ? { scheduledAt: nextScheduledAt } : {})
        },
        include: orderWithRelationsInclude
      });
      await this.syncPendingPixPaymentsForOrderTotal(tx, updated.id, total);
      const refreshedUpdated = await tx.order.findUnique({
        where: { id: updated.id },
        include: orderWithRelationsInclude
      });
      if (!refreshedUpdated) {
        throw new NotFoundException('Pedido não encontrado');
      }

      await this.syncOrderInventoryArtifacts(tx, refreshedUpdated);
      const nextTargetDate = this.orderTargetDate(refreshedUpdated).date;
      if (nextTargetDate !== previousTargetDate) {
        await this.syncPaperBagReservationsForCustomerDateGroup(tx, {
          customerId: refreshedUpdated.customerId,
          targetDate: previousTargetDate
        });
      }
      return this.withFinancial(refreshedUpdated);
    }, {
      maxWait: 15_000,
      timeout: 15_000
    });
  }

  async remove(id: number) {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id }, include: { items: true } });
      if (!order) throw new NotFoundException('Pedido não encontrado');
      const targetDate = this.orderTargetDate(order).date;
      await this.assertOrderRemovable(tx, id);

      await this.clearOrderFormulaArtifacts(tx, id);
      await this.syncProductAvailabilityAfterInventoryChange(
        tx,
        order.items.map((item) => item.productId)
      );
      await tx.order.delete({ where: { id } });
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
      if (!order) throw new NotFoundException('Pedido não encontrado');
      await this.assertOrderItemsMutable(tx, order);

      const product = await tx.product.findUnique({ where: { id: data.productId } });
      if (!product) throw new NotFoundException('Produto não encontrado');
      if (product.active === false) {
        throw new BadRequestException('Produto indisponível.');
      }

      await this.priceOrderItems(
        tx,
        [
          ...order.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity
          })),
          {
            productId: data.productId,
            quantity: data.quantity
          }
        ],
        {
          allowInactiveProductIds: new Set(order.items.map((item) => item.productId)),
          excludeOrderId: order.id
        }
      );

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
      const pricing = await this.resolveExistingOrderItemsPricing(tx, order, nextSubtotalItems);
      await tx.order.update({
        where: { id: orderId },
        data: {
          subtotal: pricing.subtotal,
          discount: pricing.discount,
          couponCode: pricing.couponCode,
          notes: pricing.notes,
          total: pricing.total
        }
      });

      const updatedOrder = await tx.order.findUnique({
        where: { id: orderId },
        include: orderWithRelationsInclude
      });
      if (!updatedOrder) throw new NotFoundException('Pedido não encontrado');
      await this.syncOrderInventoryArtifacts(tx, updatedOrder);
      await this.syncProductAvailabilityAfterInventoryChange(
        tx,
        updatedOrder.items.map((item) => item.productId)
      );
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
      if (!order) throw new NotFoundException('Pedido não encontrado');
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
        throw new BadRequestException('Itens são obrigatórios');
      }

      const productIds = normalizedItems.map((item) => item.productId);
      const products = await tx.product.findMany({ where: { id: { in: productIds } } });
      const productMap = new Map(products.map((product) => [product.id, product]));
      const allowInactiveProductIds = new Set(order.items.map((item) => item.productId));

      await this.priceOrderItems(tx, normalizedItems, {
        allowInactiveProductIds,
        excludeOrderId: order.id
      });

      const itemsData = [] as Array<{ productId: number; quantity: number; unitPrice: number; total: number }>;
      for (const item of normalizedItems) {
        const product = productMap.get(item.productId);
        if (!product) throw new NotFoundException('Produto não encontrado');
        if (product.active === false && !allowInactiveProductIds.has(product.id)) {
          throw new BadRequestException('Produto indisponível.');
        }
        const unitPrice = this.toUnitPrice(product.price);
        const total = this.toMoney(unitPrice * item.quantity);
        itemsData.push({ productId: item.productId, quantity: item.quantity, unitPrice, total });
      }

      const pricing = await this.resolveExistingOrderItemsPricing(tx, order, normalizedItems);
      const amountPaid = this.getPaidAmount(order.payments || []);
      this.ensureOrderTotalCoversPaid(pricing.total, amountPaid);

      await tx.orderItem.deleteMany({ where: { orderId } });
      await tx.orderItem.createMany({
        data: itemsData.map((item) => ({
          orderId,
          ...item
        }))
      });

      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          subtotal: pricing.subtotal,
          discount: pricing.discount,
          couponCode: pricing.couponCode,
          notes: pricing.notes,
          total: pricing.total
        },
        include: orderWithRelationsInclude
      });

      await this.syncOrderInventoryArtifacts(tx, updatedOrder);
      await this.syncProductAvailabilityAfterInventoryChange(
        tx,
        updatedOrder.items.map((item) => item.productId)
      );
      return this.withFinancial(updatedOrder);
    });
  }

  async removeItem(orderId: number, itemId: number) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, payments: true }
      });
      if (!order) throw new NotFoundException('Pedido não encontrado');
      await this.assertOrderItemsMutable(tx, order);

      const item = await tx.orderItem.findUnique({ where: { id: itemId } });
      if (!item || item.orderId !== orderId) throw new NotFoundException('Item não encontrado');

      await tx.orderItem.delete({ where: { id: itemId } });

      const remaining = order.items.filter((i) => i.id !== itemId);
      const pricing = await this.resolveExistingOrderItemsPricing(
        tx,
        order,
        remaining.map((entry) => ({
          productId: entry.productId,
          quantity: entry.quantity
        }))
      );
      const amountPaid = this.getPaidAmount(order.payments || []);
      this.ensureOrderTotalCoversPaid(pricing.total, amountPaid);

      await tx.order.update({
        where: { id: orderId },
        data: {
          subtotal: pricing.subtotal,
          discount: pricing.discount,
          couponCode: pricing.couponCode,
          notes: pricing.notes,
          total: pricing.total
        }
      });

      const updatedOrder = await tx.order.findUnique({
        where: { id: orderId },
        include: orderWithRelationsInclude
      });
      if (!updatedOrder) throw new NotFoundException('Pedido não encontrado');
      await this.syncOrderInventoryArtifacts(tx, updatedOrder);
      await this.syncProductAvailabilityAfterInventoryChange(
        tx,
        updatedOrder.items.map((entry) => entry.productId)
      );
      return this.withFinancial(updatedOrder);
    });
  }

  async updateStatus(orderId: number, nextStatus: unknown) {
    const status = OrderStatusEnum.parse(nextStatus);

    return this.prisma.$transaction(async (tx) => {
      const existingOrder = await tx.order.findUnique({
        where: { id: orderId },
        include: orderWithRelationsInclude
      });
      if (!existingOrder) {
        throw new NotFoundException('Pedido não encontrado');
      }

      const currentStatus = normalizeOrderStatus(existingOrder.status) || 'ABERTO';
      const path = resolveOrderStatusPath(currentStatus, status);
      if (path.length === 0) {
        if (existingOrder.status !== currentStatus) {
          const normalizedOrder = await tx.order.update({
            where: { id: orderId },
            data: { status: currentStatus },
            include: orderWithRelationsInclude
          });
          return this.withFinancial(normalizedOrder);
        }
        return this.withFinancial(existingOrder);
      }

      let updatedOrder = existingOrder;

      for (const stepStatus of path) {
        updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: { status: stepStatus },
          include: orderWithRelationsInclude
        });
        if (stepStatus === 'CANCELADO') {
          await this.clearOrderFormulaArtifacts(tx, orderId);
          await this.syncProductAvailabilityAfterInventoryChange(
            tx,
            updatedOrder.items.map((item) => item.productId)
          );
          await this.syncPaperBagReservationsForCustomerDateGroup(tx, {
            customerId: updatedOrder.customerId,
            targetDate: this.orderTargetDate(updatedOrder).date
          });
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
        include: orderWithRelationsInclude
      });
      if (!order) throw new NotFoundException('Pedido não encontrado');
      if (order.status === 'CANCELADO') {
        throw new BadRequestException('Não é possível registrar pagamento para pedido cancelado.');
      }

      if (!data.paid) {
        const paidPaymentIds = order.payments
          .filter((payment) => payment.status === 'PAGO' || Boolean(payment.paidAt))
          .map((payment) => payment.id);

        if (paidPaymentIds.length > 0) {
          await tx.payment.updateMany({
            where: {
              id: {
                in: paidPaymentIds
              }
            },
            data: {
              status: 'PENDENTE',
              paidAt: null
            }
          });
        }

        const updated = await tx.order.findUnique({
          where: { id: orderId },
          include: orderWithRelationsInclude
        });
        if (!updated) throw new NotFoundException('Pedido não encontrado');
        return this.withFinancial(updated);
      }

      const total = this.toMoney(order.total ?? 0);
      const amountPaid = this.getPaidAmount(order.payments || []);
      const balanceDue = moneyFromMinorUnits(Math.max(moneyToMinorUnits(total) - moneyToMinorUnits(amountPaid), 0));

      if (compareMoney(balanceDue, 0) <= 0) {
        return this.withFinancial(order);
      }

      const pendingPaymentIds = order.payments
        .filter((payment) => payment.status !== 'PAGO' || !payment.paidAt)
        .map((payment) => payment.id);

      if (pendingPaymentIds.length > 0) {
        await tx.payment.updateMany({
          where: {
            id: {
              in: pendingPaymentIds
            }
          },
          data: {
            status: 'PAGO',
            paidAt: data.paidAt ? new Date(data.paidAt) : new Date()
          }
        });
      }

      const paidAfterReuse = this.toMoney(
        order.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
      );
      const remainingBalance = moneyFromMinorUnits(
        Math.max(moneyToMinorUnits(total) - moneyToMinorUnits(paidAfterReuse), 0)
      );

      if (compareMoney(remainingBalance, 0) > 0) {
        await tx.payment.create({
          data: {
            orderId: order.id,
            amount: remainingBalance,
            method: 'pix',
            status: 'PAGO',
            paidAt: data.paidAt ? new Date(data.paidAt) : new Date()
          }
        });
      }

      const updated = await tx.order.findUnique({
        where: { id: orderId },
        include: orderWithRelationsInclude
      });
      if (!updated) throw new NotFoundException('Pedido não encontrado');
      return this.withFinancial(updated);
    });
  }
}
