import { z } from 'zod';

export * from './lib/money.js';
export * from './lib/external-order-schedule.js';
export * from './lib/business-profile.js';

type DisplayNumberSubject = {
  id?: number | null;
  publicNumber?: number | null;
};

export function resolveDisplayNumber(subject: DisplayNumberSubject | null | undefined) {
  const publicNumber = subject?.publicNumber;
  if (typeof publicNumber === 'number' && Number.isInteger(publicNumber) && publicNumber > 0) {
    return publicNumber;
  }

  const id = subject?.id;
  if (typeof id === 'number' && Number.isInteger(id) && id > 0) {
    return id;
  }

  return null;
}

const CANONICAL_ORDER_STATUS_VALUES = ['ABERTO', 'PRONTO', 'ENTREGUE', 'CANCELADO'] as const;
const LEGACY_ORDER_STATUS_MAP = {
  CONFIRMADO: 'ABERTO',
  EM_PREPARACAO: 'ABERTO'
} as const;

export const OrderStatusEnum = z.enum(CANONICAL_ORDER_STATUS_VALUES);

export function normalizeOrderStatus(value?: string | null) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized in LEGACY_ORDER_STATUS_MAP) {
    return LEGACY_ORDER_STATUS_MAP[normalized as keyof typeof LEGACY_ORDER_STATUS_MAP];
  }
  return CANONICAL_ORDER_STATUS_VALUES.includes(normalized as (typeof CANONICAL_ORDER_STATUS_VALUES)[number])
    ? (normalized as (typeof CANONICAL_ORDER_STATUS_VALUES)[number])
    : null;
}

const OrderStatusInputSchema = z.preprocess((input) => {
  if (typeof input !== 'string') return input;
  return normalizeOrderStatus(input) ?? input;
}, OrderStatusEnum);

export const PaymentStatusEnum = z.enum(['PENDENTE', 'PAGO', 'CANCELADO']);
export const OrderPaymentStatusEnum = z.enum(['PENDENTE', 'PARCIAL', 'PAGO']);
export const PixChargeProviderEnum = z.enum(['STATIC_PIX', 'LOCAL_DEV']);
export const OrderFulfillmentModeEnum = z.enum(['DELIVERY', 'PICKUP']);
export const DeliveryProviderEnum = z.enum(['NONE', 'LOCAL']);
export const DeliveryFeeSourceEnum = z.enum(['NONE', 'MANUAL_FALLBACK']);
export const DeliveryQuoteStatusEnum = z.enum(['NOT_REQUIRED', 'PENDING', 'QUOTED', 'FALLBACK', 'EXPIRED', 'FAILED']);
export const DeliveryJobStatusEnum = z.enum([
  'NOT_REQUESTED',
  'PENDING_REQUIREMENTS',
  'REQUESTED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'FAILED',
  'CANCELED'
]);
export const DeliveryPricingTierSchema = z.object({
  maxKm: z.number().positive().max(999),
  fee: z.number().nonnegative().max(9999)
});
export type DeliveryPricingTier = z.infer<typeof DeliveryPricingTierSchema>;
export const DeliveryPricingConfigSchema = z.object({
  tiers: z.array(DeliveryPricingTierSchema).min(1),
  fallbackWithoutCoordinatesFee: z.number().nonnegative().max(9999).default(12),
  outOfAreaMessage: z.string().trim().min(1).max(160).default('FORA DA ÁREA DE ENTREGA'),
  updatedAt: z.string().datetime().optional().nullable()
});
export type DeliveryPricingConfig = z.infer<typeof DeliveryPricingConfigSchema>;

export const StockMovementTypeEnum = z.enum(['IN', 'OUT', 'ADJUST']);
export const InventoryCategoryEnum = z.enum(['INGREDIENTE', 'EMBALAGEM_INTERNA', 'EMBALAGEM_EXTERNA']);
export const InventoryCriticalityEnum = z.enum(['BAIXA', 'MEDIA', 'ALTA', 'CRITICA']);
export const InventoryRiskLevelEnum = z.enum(['OK', 'ATENCAO', 'CRITICO']);

export const PixChargeSchema = z.object({
  provider: PixChargeProviderEnum,
  providerRef: z.string().min(1),
  txid: z.string().min(1),
  copyPasteCode: z.string().min(1),
  expiresAt: z.string().optional().nullable(),
  payable: z.boolean().default(false)
});

export const CustomerAddressSchema = z.object({
  id: z.number().int().positive().optional(),
  customerId: z.number().int().positive().optional(),
  address: z.string().optional().nullable(),
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  neighborhood: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  placeId: z.string().optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  deliveryNotes: z.string().optional().nullable(),
  isPrimary: z.boolean().default(false),
  createdAt: z.string().optional().nullable(),
  updatedAt: z.string().optional().nullable()
});

export const CustomerSchema = z.object({
  id: z.number().int().positive().optional(),
  publicNumber: z.number().int().positive().optional().nullable(),
  name: z.string().min(1),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  neighborhood: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  placeId: z.string().optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  deliveryNotes: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
  addresses: z.array(CustomerAddressSchema).optional()
});

export const OrderCustomerSnapshotSchema = z.object({
  name: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  neighborhood: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  placeId: z.string().optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  deliveryNotes: z.string().optional().nullable()
});

export const CompanionProductInventorySchema = z.object({
  balance: z.number().optional().nullable(),
  unit: z.string().min(1).optional().nullable(),
  purchasePackSize: z.number().positive().optional().nullable(),
  purchasePackCost: z.number().nonnegative().optional().nullable(),
  sourceName: z.string().max(120).optional().nullable(),
  sourceUrl: z.string().max(512).optional().nullable(),
  leadTimeDays: z.number().int().nonnegative().optional().nullable(),
  safetyStockQty: z.number().nonnegative().optional().nullable(),
  reorderPointQty: z.number().nonnegative().optional().nullable(),
  targetStockQty: z.number().nonnegative().optional().nullable(),
  perishabilityDays: z.number().int().nonnegative().optional().nullable(),
  criticality: z.string().max(24).optional().nullable(),
  preferredSupplier: z.string().max(160).optional().nullable()
});

export const ProductSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1),
  category: z.string().optional().nullable(),
  unit: z.string().optional().nullable(),
  measureLabel: z.string().optional().nullable(),
  drawerNote: z.string().max(1200).optional().nullable(),
  inventoryItemId: z.number().int().positive().optional().nullable(),
  inventoryQtyPerSaleUnit: z.number().positive().optional().nullable(),
  companionInventory: CompanionProductInventorySchema.optional().nullable(),
  price: z.number().nonnegative(),
  imageUrl: z.string().min(1).max(2048).optional().nullable(),
  active: z.boolean().default(true),
  salesLimitEnabled: z.boolean().optional(),
  salesLimitBoxes: z.number().int().positive().optional().nullable(),
  salesLimitActivatedAt: z.string().datetime().optional().nullable(),
  salesLimitConsumedBoxes: z.number().nonnegative().optional().nullable(),
  salesLimitRemainingBoxes: z.number().nonnegative().optional().nullable(),
  salesLimitExhausted: z.boolean().optional(),
  createdAt: z.string().optional().nullable()
});

export const CouponSchema = z.object({
  id: z.number().int().positive().optional(),
  code: z.string().trim().min(1).max(80),
  discountPct: z.number().nonnegative().max(100),
  usageLimitPerCustomer: z.number().int().positive().optional().nullable(),
  active: z.boolean().default(true),
  createdAt: z.string().optional().nullable(),
  updatedAt: z.string().optional().nullable()
});

export const CouponUpsertSchema = CouponSchema.pick({
  code: true,
  discountPct: true,
  usageLimitPerCustomer: true,
  active: true
});

export const CouponResolveRequestSchema = z.object({
  code: z.string().trim().min(1).max(80),
  subtotal: z.number().nonnegative().default(0),
  customerId: z.number().int().positive().optional().nullable(),
  customerPhone: z.string().trim().min(1).max(40).optional().nullable(),
  customerName: z.string().trim().min(1).max(160).optional().nullable()
});

export const CouponResolveResponseSchema = z.object({
  code: z.string().trim().min(1).max(80),
  discountPct: z.number().nonnegative().max(100),
  subtotal: z.number().nonnegative(),
  discountAmount: z.number().nonnegative(),
  subtotalAfterDiscount: z.number().nonnegative()
});

export const CouponAnalyticsCustomerSchema = z.object({
  customerId: z.number().int().positive().optional().nullable(),
  customerDisplayNumber: z.number().int().positive().optional().nullable(),
  customerName: z.string().trim().min(1).max(160).optional().nullable(),
  customerPhone: z.string().trim().min(1).max(40).optional().nullable(),
  uses: z.number().int().nonnegative(),
  discountInvestmentTotal: z.number().nonnegative(),
  subtotalTotal: z.number().nonnegative(),
  netRevenueTotal: z.number().nonnegative(),
  lastUsedAt: z.string().datetime().optional().nullable()
});

export const CouponAnalyticsOrderSchema = z.object({
  orderId: z.number().int().positive(),
  orderDisplayNumber: z.number().int().positive().optional().nullable(),
  customerId: z.number().int().positive().optional().nullable(),
  customerDisplayNumber: z.number().int().positive().optional().nullable(),
  customerName: z.string().trim().min(1).max(160).optional().nullable(),
  customerPhone: z.string().trim().min(1).max(40).optional().nullable(),
  createdAt: z.string().datetime(),
  scheduledAt: z.string().datetime().optional().nullable(),
  subtotal: z.number().nonnegative(),
  discountAmount: z.number().nonnegative(),
  total: z.number().nonnegative()
});

export const CouponAnalyticsSummarySchema = z.object({
  uses: z.number().int().nonnegative(),
  distinctCustomers: z.number().int().nonnegative(),
  discountInvestmentTotal: z.number().nonnegative(),
  subtotalTotal: z.number().nonnegative(),
  netRevenueTotal: z.number().nonnegative(),
  averageDiscountAmount: z.number().nonnegative(),
  lastUsedAt: z.string().datetime().optional().nullable()
});

export const CouponAnalyticsSchema = CouponSchema.extend({
  historicalOnly: z.boolean().default(false),
  metrics: CouponAnalyticsSummarySchema,
  customers: z.array(CouponAnalyticsCustomerSchema),
  recentOrders: z.array(CouponAnalyticsOrderSchema)
});

export const APPLIED_COUPON_NOTE_PREFIX = 'Cupom aplicado:';
export const MARKETING_SAMPLES_NOTE_PREFIX = 'Investimento de marketing:';
export const ORDER_ITEMS_SUMMARY_NOTE_PREFIX = 'pedido=';
export const COMPANION_PRODUCT_PROFILE_NOTE_PREFIX = 'amigas=';

const ORDER_NOTE_METADATA_PREFIXES = [
  APPLIED_COUPON_NOTE_PREFIX,
  MARKETING_SAMPLES_NOTE_PREFIX,
  ORDER_ITEMS_SUMMARY_NOTE_PREFIX
];

export type OrderItemsSummaryNoteEntry = {
  label: string;
  detail: string | null;
};

export type CompanionProductProfile = {
  title: string;
  flavor: string | null;
  maker: string | null;
  origin: string | null;
};

function splitOrderNoteLines(value?: string | null) {
  const visibleLines: string[] = [];
  const metadataLines: string[] = [];

  for (const line of String(value || '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    if (ORDER_NOTE_METADATA_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      metadataLines.push(line);
      continue;
    }
    visibleLines.push(line);
  }

  return {
    visibleLines,
    metadataLines
  };
}

function splitCompanionDrawerNoteLines(value?: string | null) {
  const visibleLines: string[] = [];
  const metadataLines: string[] = [];

  for (const line of String(value || '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    if (line.startsWith(COMPANION_PRODUCT_PROFILE_NOTE_PREFIX)) {
      metadataLines.push(line);
      continue;
    }
    visibleLines.push(line);
  }

  return {
    visibleLines,
    metadataLines
  };
}

export function normalizeCompanionProductProfile(
  value?: Partial<CompanionProductProfile> | null,
): CompanionProductProfile | null {
  const title = String(value?.title || '').trim();
  if (!title) return null;

  const flavor = String(value?.flavor || '').trim();
  const maker = String(value?.maker || '').trim();
  const origin = String(value?.origin || '').trim();

  return {
    title,
    flavor: flavor || null,
    maker: maker || null,
    origin: origin || null
  };
}

export function buildCompanionProductMakerLine(value?: Partial<CompanionProductProfile> | null) {
  const normalized = normalizeCompanionProductProfile(value);
  if (!normalized) return null;
  if (normalized.maker && normalized.origin) {
    return `${normalized.maker} - ${normalized.origin}`;
  }
  return normalized.maker || normalized.origin || null;
}

export function buildCompanionProductName(value?: Partial<CompanionProductProfile> | null) {
  const normalized = normalizeCompanionProductProfile(value);
  if (!normalized) return '';

  return [normalized.title, normalized.flavor, buildCompanionProductMakerLine(normalized)]
    .filter(Boolean)
    .join(' • ');
}

export function parseCompanionProductProfileFromName(name?: string | null): CompanionProductProfile | null {
  const parts = String(name || '')
    .split('•')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (parts.length === 0) return null;

  const makerOrigin = parts.slice(2).join(' • ').trim();
  const makerOriginParts = makerOrigin
    ? makerOrigin.split(' - ').map((entry) => entry.trim()).filter(Boolean)
    : [];

  return normalizeCompanionProductProfile({
    title: parts[0],
    flavor: parts[1] || null,
    maker: makerOriginParts[0] || null,
    origin: makerOriginParts.slice(1).join(' - ') || null
  });
}

export function parseCompanionProductProfileFromDrawerNote(
  drawerNote?: string | null,
): CompanionProductProfile | null {
  const { metadataLines } = splitCompanionDrawerNoteLines(drawerNote);
  const encoded = metadataLines
    .find((line) => line.startsWith(COMPANION_PRODUCT_PROFILE_NOTE_PREFIX))
    ?.slice(COMPANION_PRODUCT_PROFILE_NOTE_PREFIX.length)
    .trim();
  if (!encoded) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(encoded));
    if (!parsed || typeof parsed !== 'object') return null;
    return normalizeCompanionProductProfile(parsed as Partial<CompanionProductProfile>);
  } catch {
    return null;
  }
}

export function resolveCompanionProductProfile(value?: {
  name?: string | null;
  drawerNote?: string | null;
} | null) {
  return (
    parseCompanionProductProfileFromDrawerNote(value?.drawerNote) ||
    parseCompanionProductProfileFromName(value?.name) ||
    normalizeCompanionProductProfile({
      title: value?.name || ''
    })
  );
}

export function stripCompanionProductProfileFromDrawerNote(drawerNote?: string | null) {
  const { visibleLines } = splitCompanionDrawerNoteLines(drawerNote);
  return visibleLines.join('\n') || null;
}

export function mergeCompanionProductProfileIntoDrawerNote(
  currentDrawerNote: string | null | undefined,
  profile: Partial<CompanionProductProfile> | null | undefined,
) {
  const { visibleLines, metadataLines } = splitCompanionDrawerNoteLines(currentDrawerNote);
  const preservedMetadata = metadataLines.filter(
    (line) => !line.startsWith(COMPANION_PRODUCT_PROFILE_NOTE_PREFIX),
  );
  const normalizedProfile = normalizeCompanionProductProfile(profile);
  if (normalizedProfile) {
    preservedMetadata.push(
      `${COMPANION_PRODUCT_PROFILE_NOTE_PREFIX}${encodeURIComponent(JSON.stringify(normalizedProfile))}`,
    );
  }
  return [...visibleLines, ...preservedMetadata].join('\n') || null;
}

export function stripOrderNoteMetadata(value?: string | null) {
  const { visibleLines } = splitOrderNoteLines(value);
  return visibleLines.join('\n') || null;
}

export function preserveOrderNoteMetadata(previousNotes?: string | null, nextVisibleNotes?: string | null) {
  const { metadataLines } = splitOrderNoteLines(previousNotes);
  const visibleLines = splitOrderNoteLines(nextVisibleNotes).visibleLines;
  return [...visibleLines, ...metadataLines].join('\n') || null;
}

export function mergeAppliedCouponIntoNotes(
  currentNotes: string | null | undefined,
  appliedCoupon: { code: string; discountPct: number } | null
) {
  const { visibleLines, metadataLines } = splitOrderNoteLines(currentNotes);
  const preservedMetadata = metadataLines.filter((line) => !line.startsWith(APPLIED_COUPON_NOTE_PREFIX));

  if (appliedCoupon) {
    preservedMetadata.push(
      `${APPLIED_COUPON_NOTE_PREFIX} ${appliedCoupon.code} (${Number(appliedCoupon.discountPct).toLocaleString('pt-BR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      })}%)`
    );
  }

  return [...visibleLines, ...preservedMetadata].join('\n') || null;
}

export function parseAppliedCouponFromNotes(notes?: string | null) {
  const { metadataLines } = splitOrderNoteLines(notes);
  const line = metadataLines.find((entry) => entry.startsWith(APPLIED_COUPON_NOTE_PREFIX));
  if (!line) return null;

  const rawValue = line.slice(APPLIED_COUPON_NOTE_PREFIX.length).trim();
  if (!rawValue) return null;

  const match = rawValue.match(/^(.+?)(?:\s+\(([\d.,]+)%\))?$/);
  const code = String(match?.[1] || rawValue).trim();
  if (!code) return null;

  const normalizedDiscountPct = String(match?.[2] || '')
    .trim()
    .replace(/\./g, '')
    .replace(',', '.');
  const parsedDiscountPct = normalizedDiscountPct ? Number.parseFloat(normalizedDiscountPct) : Number.NaN;

  return {
    code,
    discountPct: Number.isFinite(parsedDiscountPct) ? parsedDiscountPct : null
  };
}

export function mergeMarketingSamplesIntoNotes(
  currentNotes: string | null | undefined,
  marketingSample: { discountPct: number; sponsoredDeliveryFee?: number | null } | null
) {
  const { visibleLines, metadataLines } = splitOrderNoteLines(currentNotes);
  const preservedMetadata = metadataLines.filter((line) => !line.startsWith(MARKETING_SAMPLES_NOTE_PREFIX));

  if (marketingSample) {
    const sponsoredDeliveryFee = Math.max(Number(marketingSample.sponsoredDeliveryFee || 0), 0);
    const sponsoredDeliveryLabel =
      sponsoredDeliveryFee > 0
        ? `, frete ${sponsoredDeliveryFee.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL'
          })}`
        : '';
    preservedMetadata.push(
      `${MARKETING_SAMPLES_NOTE_PREFIX} AMOSTRAS (${Number(marketingSample.discountPct).toLocaleString('pt-BR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      })}%${sponsoredDeliveryLabel})`
    );
  }

  return [...visibleLines, ...preservedMetadata].join('\n') || null;
}

export function parseOrderItemsSummaryFromNotes(notes?: string | null): OrderItemsSummaryNoteEntry[] {
  const { metadataLines } = splitOrderNoteLines(notes);
  const encoded = metadataLines
    .find((line) => line.startsWith(ORDER_ITEMS_SUMMARY_NOTE_PREFIX))
    ?.slice(ORDER_ITEMS_SUMMARY_NOTE_PREFIX.length)
    .trim();
  if (!encoded) return [];

  try {
    const parsed = JSON.parse(decodeURIComponent(encoded));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const label = String((entry as { label?: unknown }).label || '').trim();
        const detail = String((entry as { detail?: unknown }).detail || '').trim();
        if (!label) return null;
        return {
          label,
          detail: detail || null
        } satisfies OrderItemsSummaryNoteEntry;
      })
      .filter((entry): entry is OrderItemsSummaryNoteEntry => Boolean(entry));
  } catch {
    return [];
  }
}

export function mergeOrderItemsSummaryIntoNotes(
  currentNotes: string | null | undefined,
  entries: OrderItemsSummaryNoteEntry[] | null | undefined
) {
  const { visibleLines, metadataLines } = splitOrderNoteLines(currentNotes);
  const preservedMetadata = metadataLines.filter((line) => !line.startsWith(ORDER_ITEMS_SUMMARY_NOTE_PREFIX));
  const normalizedEntries = Array.isArray(entries)
    ? entries
        .map((entry) => {
          const label = String(entry?.label || '').trim();
          const detail = String(entry?.detail || '').trim();
          if (!label) return null;
          return {
            label,
            detail: detail || null
          };
        })
        .filter((entry): entry is OrderItemsSummaryNoteEntry => Boolean(entry))
    : [];

  if (normalizedEntries.length > 0) {
    preservedMetadata.push(`${ORDER_ITEMS_SUMMARY_NOTE_PREFIX}${encodeURIComponent(JSON.stringify(normalizedEntries))}`);
  }

  return [...visibleLines, ...preservedMetadata].join('\n') || null;
}

export function parseMarketingSamplesDiscountPct(notes?: string | null) {
  const { metadataLines } = splitOrderNoteLines(notes);
  const line = metadataLines.find((entry) => entry.startsWith(MARKETING_SAMPLES_NOTE_PREFIX));
  if (!line) return null;

  const match = line.match(/\(([\d.,]+)%(?:\)|,)/);
  if (!match) return 0;
  const normalized = match[1].replace(/\./g, '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseMarketingSamplesSponsoredDeliveryFee(notes?: string | null) {
  const { metadataLines } = splitOrderNoteLines(notes);
  const line = metadataLines.find((entry) => entry.startsWith(MARKETING_SAMPLES_NOTE_PREFIX));
  if (!line) return 0;

  const match = line.match(/frete\s+R\$\s*([\d.,]+)/i);
  if (!match) return 0;
  const normalized = match[1].replace(/\./g, '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const OrderItemSchema = z.object({
  id: z.number().int().positive().optional(),
  orderId: z.number().int().positive().optional(),
  productId: z.number().int().positive(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative().optional(),
  total: z.number().nonnegative().optional()
});

export const OrderSchema = z.object({
  id: z.number().int().positive().optional(),
  publicNumber: z.number().int().positive().optional().nullable(),
  customerId: z.number().int().positive(),
  customerSnapshot: OrderCustomerSnapshotSchema.optional().nullable(),
  status: OrderStatusInputSchema.default('ABERTO'),
  fulfillmentMode: OrderFulfillmentModeEnum.default('DELIVERY'),
  subtotal: z.number().nonnegative().optional(),
  deliveryFee: z.number().nonnegative().optional(),
  deliveryProvider: DeliveryProviderEnum.optional(),
  deliveryFeeSource: DeliveryFeeSourceEnum.optional(),
  deliveryQuoteStatus: DeliveryQuoteStatusEnum.optional(),
  deliveryQuoteExpiresAt: z.string().optional().nullable(),
  discount: z.number().nonnegative().optional(),
  discountPct: z.number().nonnegative().max(100).optional(),
  couponCode: z.string().trim().min(1).max(80).optional().nullable(),
  total: z.number().nonnegative().optional(),
  amountPaid: z.number().nonnegative().optional(),
  balanceDue: z.number().nonnegative().optional(),
  paymentStatus: OrderPaymentStatusEnum.optional(),
  notes: z.string().optional().nullable(),
  scheduledAt: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
  items: z.array(OrderItemSchema).optional()
});

export const PaymentSchema = z.object({
  id: z.number().int().positive().optional(),
  orderId: z.number().int().positive(),
  amount: z.number().nonnegative(),
  method: z.literal('pix').default('pix'),
  status: PaymentStatusEnum.default('PENDENTE'),
  paidAt: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  providerRef: z.string().optional().nullable(),
  pixCharge: PixChargeSchema.optional().nullable()
});

export const PixSettlementWebhookSchema = z
  .object({
    version: z.literal(1).default(1),
    paymentId: z.number().int().positive().optional().nullable(),
    orderId: z.number().int().positive().optional().nullable(),
    txid: z.string().trim().min(1).max(80).optional().nullable(),
    providerRef: z.string().trim().min(1).max(160).optional().nullable(),
    amount: z.number().positive().optional().nullable(),
    paidAt: z.string().datetime({ offset: true }).optional().nullable(),
    source: z.string().trim().min(1).max(80).default('webhook'),
    metadata: z.record(z.unknown()).optional()
  })
  .refine((value) => Boolean(value.paymentId || value.providerRef || value.txid), {
    message: 'Informe paymentId, providerRef ou txid.'
  });

export const PixReconciliationWebhookSchema = z.object({
  version: z.literal(1).default(1),
  payerName: z.string().trim().min(1).max(160),
  amount: z.number().positive(),
  paidAt: z.string().datetime({ offset: true }).optional().nullable(),
  source: z.string().trim().min(1).max(80).default('bank-statement-import'),
  sourceTransactionId: z.string().trim().min(1).max(160).optional().nullable(),
  metadata: z.record(z.unknown()).optional()
});

export const OrderIntakeChannelEnum = z.enum([
  'INTERNAL_DASHBOARD',
  'ADMIN_REPEAT',
  'CUSTOMER_LINK'
]);

export const OrderIntakeIntentEnum = z.enum(['DRAFT', 'CONFIRMED', 'PAID']);
export const OrderIntakeStageEnum = z.enum(['DRAFT', 'CONFIRMED', 'PIX_PENDING', 'PAID', 'SCHEDULED']);
export const PixChargeStatusEnum = z.enum(['PENDENTE', 'PAGO']);

export const OrderIntakeCustomerRefSchema = z.union([
  z.object({
    customerId: z.number().int().positive(),
    address: z.string().optional().nullable(),
    addressLine1: z.string().optional().nullable(),
    addressLine2: z.string().optional().nullable(),
    neighborhood: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    postalCode: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
    placeId: z.string().optional().nullable(),
    lat: z.number().optional().nullable(),
    lng: z.number().optional().nullable(),
    deliveryNotes: z.string().optional().nullable()
  }),
  z.object({
    name: z.string().min(1),
    phone: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    addressLine1: z.string().optional().nullable(),
    addressLine2: z.string().optional().nullable(),
    neighborhood: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    postalCode: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
    placeId: z.string().optional().nullable(),
    lat: z.number().optional().nullable(),
    lng: z.number().optional().nullable(),
    deliveryNotes: z.string().optional().nullable()
  })
]);

export const OrderIntakeItemSchema = OrderItemSchema.pick({
  productId: true,
  quantity: true
});

export const OrderIntakePaymentSchema = z.object({
  method: z.literal('pix').default('pix'),
  status: PixChargeStatusEnum.default('PENDENTE'),
  dueAt: z.string().datetime().optional().nullable(),
  paidAt: z.string().datetime().optional().nullable(),
  providerRef: z.string().trim().min(1).max(160).optional().nullable()
});

export const OrderIntakeSourceSchema = z.object({
  channel: OrderIntakeChannelEnum.default('INTERNAL_DASHBOARD'),
  externalId: z.string().trim().min(1).max(160).optional().nullable(),
  idempotencyKey: z.string().trim().min(1).max(160).optional().nullable(),
  originLabel: z.string().trim().min(1).max(160).optional().nullable()
});

export const DeliveryQuoteSelectionSchema = z.object({
  quoteToken: z.string().trim().min(1).max(512).optional().nullable(),
  fee: z.number().nonnegative().optional().nullable(),
  provider: DeliveryProviderEnum.optional().nullable(),
  source: DeliveryFeeSourceEnum.optional().nullable(),
  status: DeliveryQuoteStatusEnum.optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable()
});

export const OrderIntakeSchema = z.object({
  version: z.literal(1).default(1),
  intent: OrderIntakeIntentEnum.default('CONFIRMED'),
  customer: OrderIntakeCustomerRefSchema,
  fulfillment: z
    .object({
      mode: OrderFulfillmentModeEnum.default('DELIVERY'),
      scheduledAt: z.string().datetime().optional().nullable()
    })
    .default({}),
  delivery: DeliveryQuoteSelectionSchema.optional(),
  order: z.object({
    items: z.array(OrderIntakeItemSchema).min(1),
    discount: z.number().nonnegative().optional(),
    discountPct: z.number().nonnegative().max(100).optional(),
    couponCode: z.string().trim().min(1).max(80).optional().nullable(),
    notes: z.string().optional().nullable()
  }),
  payment: OrderIntakePaymentSchema.optional(),
  source: OrderIntakeSourceSchema.default({})
});

export const OrderIntakeMetaSchema = z.object({
  version: z.literal(1),
  channel: OrderIntakeChannelEnum,
  intent: OrderIntakeIntentEnum,
  stage: OrderIntakeStageEnum,
  fulfillmentMode: OrderFulfillmentModeEnum,
  paymentMethod: z.literal('pix'),
  pixStatus: PixChargeStatusEnum,
  paymentId: z.number().int().positive().nullable(),
  dueAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  providerRef: z.string().nullable(),
  deliveryFee: z.number().nonnegative(),
  deliveryProvider: DeliveryProviderEnum,
  deliveryFeeSource: DeliveryFeeSourceEnum,
  deliveryQuoteStatus: DeliveryQuoteStatusEnum,
  deliveryQuoteExpiresAt: z.string().nullable(),
  pixCharge: PixChargeSchema.nullable(),
  orderId: z.number().int().positive(),
  customerId: z.number().int().positive()
});

export const ExternalOrderScheduleAvailabilityReasonEnum = z.enum([
  'AVAILABLE',
  'BEFORE_MINIMUM',
  'SLOT_TAKEN',
  'DAY_FULL',
  'DAY_BLOCKED'
]);

export const ExternalOrderDeliveryWindowKeyEnum = z.enum(['MORNING', 'AFTERNOON', 'EVENING']);

export const ExternalOrderDeliveryWindowAvailabilitySchema = z.object({
  key: ExternalOrderDeliveryWindowKeyEnum,
  label: z.string().min(1),
  startLabel: z.string().min(1),
  endLabel: z.string().min(1),
  available: z.boolean(),
  scheduledAt: z.string().datetime().nullable(),
  reason: ExternalOrderScheduleAvailabilityReasonEnum
});

export const ExternalOrderScheduleAvailabilitySchema = z.object({
  minimumAllowedAt: z.string().datetime(),
  nextAvailableAt: z.string().datetime(),
  requestedAt: z.string().datetime().nullable(),
  requestedAvailable: z.boolean(),
  reason: ExternalOrderScheduleAvailabilityReasonEnum,
  dailyLimit: z.number().int().positive(),
  requestedTotalBroas: z.number().int().nonnegative(),
  requestedDurationMinutes: z.number().int().nonnegative(),
  slotMinutes: z.number().int().positive(),
  dayOrderCount: z.number().int().nonnegative(),
  slotTaken: z.boolean(),
  requestedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestedWindowKey: ExternalOrderDeliveryWindowKeyEnum.nullable(),
  requestedWindowLabel: z.string().nullable(),
  requestedWindowAvailable: z.boolean(),
  requestedWindowReason: ExternalOrderScheduleAvailabilityReasonEnum.nullable(),
  requestedWindowScheduledAt: z.string().datetime().nullable(),
  requestedWindowNextAvailableAt: z.string().datetime().nullable(),
  windows: z.array(ExternalOrderDeliveryWindowAvailabilitySchema)
});

export const ExternalOrderSubmissionChannelEnum = z.enum(['GOOGLE_FORM', 'PUBLIC_FORM']);

export const ExternalOrderFlavorCountsSchema = z
  .object({
    T: z.coerce.number().int().nonnegative().default(0),
    G: z.coerce.number().int().nonnegative().default(0),
    D: z.coerce.number().int().nonnegative().default(0),
    Q: z.coerce.number().int().nonnegative().default(0),
    R: z.coerce.number().int().nonnegative().default(0),
    RJ: z.coerce.number().int().nonnegative().default(0)
  })
  .default({});

export const ExternalOrderSubmissionItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.coerce.number().int().nonnegative().default(0)
});

export const ExternalOrderSubmissionSchema = z
  .object({
    version: z.literal(1).default(1),
    customer: z.object({
      name: z.string().min(1),
      phone: z.string().optional().nullable(),
      address: z.string().optional().nullable(),
      addressLine1: z.string().optional().nullable(),
      addressLine2: z.string().optional().nullable(),
      neighborhood: z.string().optional().nullable(),
      city: z.string().optional().nullable(),
      state: z.string().optional().nullable(),
      postalCode: z.string().optional().nullable(),
      country: z.string().optional().nullable(),
      placeId: z.string().optional().nullable(),
      lat: z.number().optional().nullable(),
      lng: z.number().optional().nullable(),
      deliveryNotes: z.string().optional().nullable()
    }),
    fulfillment: z.object({
      mode: OrderFulfillmentModeEnum.default('DELIVERY'),
      scheduledAt: z.string().datetime().optional().nullable(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      timeWindow: ExternalOrderDeliveryWindowKeyEnum.optional().nullable()
    }),
    delivery: DeliveryQuoteSelectionSchema.optional(),
    flavors: ExternalOrderFlavorCountsSchema,
    items: z.array(ExternalOrderSubmissionItemSchema).default([]),
    couponCode: z.string().trim().min(1).max(80).optional().nullable(),
    notes: z.string().optional().nullable(),
    source: z
      .object({
        channel: ExternalOrderSubmissionChannelEnum.default('GOOGLE_FORM'),
        externalId: z.string().trim().min(1).max(160).optional().nullable(),
        idempotencyKey: z.string().trim().min(1).max(160).optional().nullable(),
        originLabel: z.string().trim().min(1).max(160).optional().nullable()
      })
      .default({})
  })
  .superRefine((value, ctx) => {
    const hasScheduledAt = Boolean(value.fulfillment.scheduledAt);
    const hasDate = Boolean(value.fulfillment.date);
    const hasTimeWindow = Boolean(value.fulfillment.timeWindow);
    if (!hasScheduledAt && !(hasDate && hasTimeWindow)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe a data e a faixa de horario do pedido.',
        path: ['fulfillment', 'timeWindow']
      });
    }
    const flavorTotal =
      (value.flavors.T || 0) +
      (value.flavors.G || 0) +
      (value.flavors.D || 0) +
      (value.flavors.Q || 0) +
      (value.flavors.R || 0) +
      (value.flavors.RJ || 0);
    const itemTotal = (value.items || []).reduce(
      (sum, item) => sum + Math.max(Math.floor(item.quantity || 0), 0),
      0
    );
    if (flavorTotal <= 0 && itemTotal <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe ao menos 1 item.',
        path: ['items']
      });
    }
  });

export const DeliveryQuoteDraftSchema = z.object({
  mode: OrderFulfillmentModeEnum.default('DELIVERY'),
  scheduledAt: z.string().datetime(),
  customer: z.object({
    name: z.string().min(1).optional().nullable(),
    phone: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    addressLine1: z.string().optional().nullable(),
    addressLine2: z.string().optional().nullable(),
    neighborhood: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    postalCode: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
    placeId: z.string().optional().nullable(),
    lat: z.number().optional().nullable(),
    lng: z.number().optional().nullable(),
    deliveryNotes: z.string().optional().nullable()
  }),
  manifest: z.object({
    items: z
      .array(
        z.object({
          name: z.string().min(1),
          quantity: z.number().nonnegative()
        })
      )
      .default([]),
    subtotal: z.number().nonnegative().default(0),
    totalUnits: z.number().int().nonnegative().default(0)
  })
});

export const DeliveryQuoteResponseSchema = z.object({
  provider: DeliveryProviderEnum,
  fee: z.number().nonnegative(),
  currencyCode: z.string().trim().min(3).max(8).default('BRL'),
  source: DeliveryFeeSourceEnum,
  status: DeliveryQuoteStatusEnum,
  quoteToken: z.string().trim().min(1).max(512).optional().nullable(),
  providerQuoteId: z.string().trim().min(1).max(160).optional().nullable(),
  expiresAt: z.string().nullable(),
  fallbackReason: z.string().nullable(),
  breakdownLabel: z.string().trim().min(1).max(160).optional().nullable()
});

export const ExternalOrderSubmissionPreviewItemSchema = z.object({
  productId: z.number().int().positive(),
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  total: z.number().nonnegative()
});

export const ExternalOrderSubmissionPreviewSchema = z.object({
  version: z.literal(1),
  channel: OrderIntakeChannelEnum,
  expectedStage: OrderIntakeStageEnum,
  fulfillmentMode: OrderFulfillmentModeEnum,
  scheduledAt: z.string().datetime(),
  customer: z.object({
    name: z.string().min(1),
    phone: z.string().nullable(),
    address: z.string().nullable(),
    placeId: z.string().nullable(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    deliveryNotes: z.string().nullable()
  }),
  order: z.object({
    items: z.array(ExternalOrderSubmissionPreviewItemSchema).min(1),
    totalUnits: z.number().int().nonnegative(),
    subtotal: z.number().nonnegative(),
    discount: z.number().nonnegative(),
    deliveryFee: z.number().nonnegative(),
    total: z.number().nonnegative(),
    notes: z.string().nullable()
  }),
  delivery: DeliveryQuoteResponseSchema,
  payment: z.object({
    method: z.literal('pix'),
    status: PixChargeStatusEnum,
    payable: z.boolean(),
    dueAt: z.string().datetime().nullable()
  }),
  source: z.object({
    channel: ExternalOrderSubmissionChannelEnum,
    externalId: z.string().nullable(),
    idempotencyKey: z.string().nullable(),
    originLabel: z.string().nullable()
  })
});

export const DeliveryQuoteViewSchema = DeliveryQuoteResponseSchema.extend({
  id: z.number().int().positive().optional(),
  orderId: z.number().int().positive().optional().nullable(),
  providerQuoteId: z.string().trim().min(1).max(160).optional().nullable(),
  requestHash: z.string().trim().min(1).max(160).optional().nullable(),
  createdAt: z.string().optional().nullable()
});

export const DeliveryJobSchema = z.object({
  id: z.number().int().positive().optional(),
  orderId: z.number().int().positive(),
  provider: DeliveryProviderEnum,
  status: DeliveryJobStatusEnum,
  providerDeliveryId: z.string().trim().min(1).max(160).optional().nullable(),
  providerTrackingUrl: z.string().trim().max(512).optional().nullable(),
  pickupEta: z.string().optional().nullable(),
  dropoffEta: z.string().optional().nullable(),
  lastError: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
  updatedAt: z.string().optional().nullable()
});

export const InventoryItemSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1),
  category: InventoryCategoryEnum,
  unit: z.string().min(1),
  purchasePackSize: z.number().nonnegative(),
  purchasePackCost: z.number().nonnegative().optional(),
  leadTimeDays: z.number().int().nonnegative().optional().nullable(),
  safetyStockQty: z.number().nonnegative().optional().nullable(),
  reorderPointQty: z.number().nonnegative().optional().nullable(),
  targetStockQty: z.number().nonnegative().optional().nullable(),
  perishabilityDays: z.number().int().nonnegative().optional().nullable(),
  criticality: InventoryCriticalityEnum.optional().nullable(),
  preferredSupplier: z.string().max(160).optional().nullable(),
  createdAt: z.string().optional().nullable()
});

export const InventoryPriceEntrySchema = z.object({
  id: z.number().int().positive().optional(),
  itemId: z.number().int().positive(),
  purchasePackSize: z.number().positive(),
  purchasePackCost: z.number().nonnegative(),
  sourceName: z.string().optional().nullable(),
  sourceUrl: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  effectiveAt: z.string(),
  createdAt: z.string().optional().nullable()
});

export const InventoryMovementSchema = z.object({
  id: z.number().int().positive().optional(),
  itemId: z.number().int().positive(),
  orderId: z.number().int().positive().optional().nullable(),
  orderDisplayNumber: z.number().int().positive().optional().nullable(),
  type: StockMovementTypeEnum,
  quantity: z.number().nonnegative(),
  reason: z.string().optional().nullable(),
  source: z.string().min(1).max(40).optional().nullable(),
  sourceLabel: z.string().min(1).max(140).optional().nullable(),
  unitCost: z.number().nonnegative().optional().nullable(),
  createdAt: z.string().optional().nullable()
});

export const InventoryOverviewItemSchema = InventoryItemSchema.extend({
  balance: z.number(),
  sourceName: z.string().optional().nullable(),
  sourceUrl: z.string().optional().nullable(),
  rawItemIds: z.array(z.number().int().positive()).default([])
});

export const InventoryMassSummarySchema = z.object({
  itemId: z.number().int().positive().nullable(),
  name: z.string(),
  recipesAvailable: z.number(),
  broasAvailable: z.number(),
  recipesPossibleFromIngredients: z.number().nonnegative(),
  broasPossibleFromIngredients: z.number().nonnegative(),
  totalPotentialRecipes: z.number(),
  totalPotentialBroas: z.number(),
  limitingIngredientName: z.string().nullable()
});

export const InventoryOverviewResponseSchema = z.object({
  items: z.array(InventoryOverviewItemSchema),
  mass: InventoryMassSummarySchema,
  generatedAt: z.string()
});

export const InventoryPriceBoardItemSchema = z.object({
  itemId: z.number().int().positive(),
  name: z.string().min(1),
  category: InventoryCategoryEnum,
  unit: z.string().min(1),
  purchasePackSize: z.number().positive(),
  purchasePackCost: z.number().nonnegative(),
  rawItemIds: z.array(z.number().int().positive()).default([]),
  unitCost: z.number().nonnegative(),
  sourceName: z.string().optional().nullable(),
  sourceUrl: z.string().optional().nullable(),
  sourcePackSize: z.number().positive().optional().nullable(),
  livePrice: z.number().nonnegative().optional().nullable(),
  liveStatus: z.enum(['LIVE', 'FALLBACK', 'MANUAL']).optional().nullable(),
  liveMessage: z.string().optional().nullable(),
  firstOrderAt: z.string().optional().nullable(),
  baselinePackCost: z.number().nonnegative().optional().nullable(),
  baselineEffectiveAt: z.string().optional().nullable(),
  priceEntries: z.array(InventoryPriceEntrySchema).default([])
});

export const InventoryPriceBoardResponseSchema = z.object({
  generatedAt: z.string(),
  firstOrderAt: z.string().nullable(),
  items: z.array(InventoryPriceBoardItemSchema)
});

export const BomSchema = z.object({
  id: z.number().int().positive().optional(),
  productId: z.number().int().positive(),
  name: z.string().min(1),
  saleUnitLabel: z.string().optional().nullable(),
  yieldUnits: z.number().nonnegative().optional().nullable()
});

export const BomItemSchema = z.object({
  id: z.number().int().positive().optional(),
  bomId: z.number().int().positive(),
  itemId: z.number().int().positive(),
  qtyPerRecipe: z.number().nonnegative().optional().nullable(),
  qtyPerSaleUnit: z.number().nonnegative().optional().nullable(),
  qtyPerUnit: z.number().nonnegative().optional().nullable()
});

export const ProductionRequirementBreakdownSchema = z.object({
  productId: z.number().int().positive(),
  productName: z.string(),
  orderId: z.number().int().positive().optional(),
  orderItemId: z.number().int().positive().optional(),
  quantity: z.number().nonnegative()
});

export const ProductionRequirementRowSchema = z.object({
  ingredientId: z.number().int().positive(),
  name: z.string(),
  unit: z.string(),
  requiredQty: z.number().nonnegative(),
  availableQty: z.number(),
  shortageQty: z.number().nonnegative(),
  breakdown: z.array(ProductionRequirementBreakdownSchema).optional()
});

export const ProductionRequirementWarningSchema = z.object({
  type: z.enum(['BOM_MISSING', 'BOM_ITEM_MISSING_QTY']),
  orderId: z.number().int().positive(),
  orderPublicNumber: z.number().int().positive().optional().nullable(),
  productId: z.number().int().positive(),
  productName: z.string(),
  message: z.string()
});

export const ProductionMassReadySummarySchema = z.object({
  requiredRecipes: z.number().nonnegative(),
  requiredBroas: z.number().nonnegative(),
  availableRecipes: z.number().nonnegative(),
  availableBroas: z.number().nonnegative(),
  missingRecipes: z.number().nonnegative(),
  missingBroas: z.number().nonnegative(),
  plannedPrepRecipes: z.number().nonnegative(),
  plannedPrepBroas: z.number().nonnegative()
});

export const ProductionRequirementsResponseSchema = z.object({
  date: z.string(),
  basis: z.enum(['deliveryDate', 'createdAtPlus1']),
  rows: z.array(ProductionRequirementRowSchema),
  warnings: z.array(ProductionRequirementWarningSchema),
  massReady: ProductionMassReadySummarySchema
});

export const StockPlanningSummarySchema = z.object({
  generatedAt: z.string(),
  openOrdersCount: z.number().int().nonnegative(),
  riskyOrdersCount: z.number().int().nonnegative(),
  criticalOrdersCount: z.number().int().nonnegative(),
  shortageItemsCount: z.number().int().nonnegative(),
  purchaseSuggestionsCount: z.number().int().nonnegative(),
  bomWarningsCount: z.number().int().nonnegative()
});

export const StockPlanningProductionActionSchema = z.object({
  targetDate: z.string().nullable(),
  requiredBroas: z.number().nonnegative(),
  availableBroas: z.number().nonnegative(),
  plannedPrepBroas: z.number().nonnegative(),
  remainingBroasAfterPlan: z.number().nonnegative()
});

export const StockPlanningShortageItemSchema = z.object({
  itemId: z.number().int().positive(),
  name: z.string().min(1),
  unit: z.string().min(1),
  category: InventoryCategoryEnum,
  level: InventoryRiskLevelEnum,
  criticality: InventoryCriticalityEnum.optional().nullable(),
  currentBalance: z.number(),
  projectedBalance: z.number(),
  totalRequiredQty: z.number().nonnegative(),
  shortageQty: z.number().nonnegative(),
  impactedOrdersCount: z.number().int().nonnegative(),
  firstRiskDate: z.string().nullable(),
  firstRiskOrderId: z.number().int().positive().nullable(),
  firstRiskOrderPublicNumber: z.number().int().positive().nullable(),
  reorderPointQty: z.number().nonnegative().nullable(),
  targetStockQty: z.number().nonnegative().nullable(),
  recommendedPurchaseQty: z.number().nonnegative(),
  preferredSupplier: z.string().nullable()
});

export const StockPlanningPurchaseSuggestionSchema = StockPlanningShortageItemSchema.extend({
  reason: z.enum(['SHORTAGE', 'REORDER_POINT'])
});

export const StockPlanningOrderRiskSchema = z.object({
  orderId: z.number().int().positive(),
  orderPublicNumber: z.number().int().positive().nullable(),
  customerName: z.string().min(1),
  status: OrderStatusEnum,
  targetDate: z.string(),
  scheduledAt: z.string().datetime().nullable(),
  level: InventoryRiskLevelEnum,
  shortageItemCount: z.number().int().nonnegative(),
  belowReorderPointItemCount: z.number().int().nonnegative(),
  bomWarningCount: z.number().int().nonnegative(),
  highlightedItems: z.array(z.string()).default([])
});

export const StockPlanningResponseSchema = z.object({
  summary: StockPlanningSummarySchema,
  productionAction: StockPlanningProductionActionSchema,
  shortageItems: z.array(StockPlanningShortageItemSchema),
  purchaseSuggestions: z.array(StockPlanningPurchaseSuggestionSchema),
  orderRisks: z.array(StockPlanningOrderRiskSchema),
  bomWarnings: z.array(ProductionRequirementWarningSchema)
});

export * from './lib/phone.js';

const HexColorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);

export const BuilderThemeSchema = z.object({
  primaryColor: HexColorSchema.default('#c9242f'),
  secondaryColor: HexColorSchema.default('#c9712f'),
  backgroundColor: HexColorSchema.default('#f6efe4'),
  surfaceColor: HexColorSchema.default('#fff8f1'),
  textColor: HexColorSchema.default('#2a1d14'),
  mutedTextColor: HexColorSchema.default('#715848'),
  fontBody: z
    .string()
    .min(1)
    .max(140)
    .default('var(--font-body, ui-sans-serif, system-ui, -apple-system, sans-serif)'),
  fontDisplay: z
    .string()
    .min(1)
    .max(180)
    .default(
      'var(--font-display, var(--font-body, ui-sans-serif, system-ui, -apple-system, sans-serif))'
    )
});

export const BuilderFormsSchema = z.object({
  inputRadius: z.number().min(0).max(40).default(14),
  inputPaddingY: z.number().min(6).max(30).default(10),
  inputPaddingX: z.number().min(8).max(40).default(14),
  inputBorderWidth: z.number().min(1).max(4).default(1),
  checkboxAccentColor: HexColorSchema.default('#c9242f')
});

export const BuilderHomeImageSchema = z.object({
  id: z.string().min(1).max(64),
  src: z.string().min(1).max(300),
  alt: z.string().min(1).max(160)
});

export const BuilderHomeSchema = z.object({
  kicker: z.string().min(1).max(60).default('Brand system aplicado'),
  title: z.string().min(1).max(140).default('QUEROBROApp · UX soft-edge e sensorial'),
  description: z
    .string()
    .min(1)
    .max(500)
    .default(
      'Redesenho completo com base em tons de goiabada, crosta assada, creme e verde-menta: contraste premium, leitura rápida para operação e identidade visual coerente com o universo artesanal da marca.'
    ),
  gallery: z
    .array(BuilderHomeImageSchema)
    .max(12)
    .default([
      { id: 'hero-01', src: '/querobroa/hero-01.jpg', alt: 'Bandeja com broas e utensílios' },
      { id: 'hero-02', src: '/querobroa/hero-02.jpg', alt: 'Selecao de broas e sabores' },
      {
        id: 'hero-03',
        src: '/querobroa/hero-03.jpg',
        alt: 'Composicao com broas e loucas artesanais'
      },
      { id: 'hero-04', src: '/querobroa/hero-04.jpg', alt: 'Doce de leite artesanal' }
    ])
});

export const BuilderLayoutPageKeyEnum = z.enum([
  'dashboard',
  'clientes',
  'pedidos',
  'estoque'
]);

export const BuilderLayoutItemSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  kind: z.enum(['slot', 'custom']).default('slot'),
  description: z.string().trim().max(240).default(''),
  actionLabel: z.string().trim().max(50).default(''),
  actionHref: z.string().trim().max(260).default(''),
  actionFocusSlot: z.string().trim().max(80).default(''),
  visible: z.boolean().default(true),
  order: z.number().int().min(0).max(99).default(0)
});

export const BuilderPageLayoutSchema = z.array(BuilderLayoutItemSchema).max(40);

export const BuilderLayoutsSchema = z.object({
  dashboard: BuilderPageLayoutSchema.default([
    { id: 'header', label: 'Cabecalho da pagina', kind: 'slot', visible: true, order: 0 },
    { id: 'error', label: 'Avisos e erros', kind: 'slot', visible: true, order: 1 },
    { id: 'kpis', label: 'Cards de KPI', kind: 'slot', visible: true, order: 2 }
  ]),
  clientes: BuilderPageLayoutSchema.default([
    { id: 'header', label: 'Cabecalho da pagina', kind: 'slot', visible: true, order: 0 },
    { id: 'form', label: 'Formulario de cliente', kind: 'slot', visible: true, order: 1 },
    { id: 'kpis_search', label: 'KPI e busca', kind: 'slot', visible: true, order: 2 },
    { id: 'list', label: 'Lista de clientes', kind: 'slot', visible: true, order: 3 }
  ]),
  pedidos: BuilderPageLayoutSchema.default([
    { id: 'header', label: 'Cabecalho da pagina', kind: 'slot', visible: true, order: 0 },
    { id: 'load_error', label: 'Aviso de carga', kind: 'slot', visible: true, order: 1 },
    { id: 'kpis', label: 'KPIs de pedidos', kind: 'slot', visible: true, order: 2 },
    { id: 'list', label: 'Lista de pedidos', kind: 'slot', visible: true, order: 3 },
    { id: 'new_order', label: 'Criação de pedido', kind: 'slot', visible: true, order: 4 },
    { id: 'detail', label: 'Detalhe do pedido', kind: 'slot', visible: true, order: 5 }
  ]),
  estoque: BuilderPageLayoutSchema.default([
    { id: 'header', label: 'Cabecalho da pagina', kind: 'slot', visible: true, order: 0 },
    { id: 'kpis', label: 'Resumo do dia', kind: 'slot', visible: true, order: 1 },
    { id: 'movement', label: 'Ajuste rapido de saldos', kind: 'slot', visible: true, order: 2 },
    { id: 'movements', label: 'Auditoria', kind: 'slot', visible: true, order: 3 },
    { id: 'bom', label: 'Catalogo tecnico', kind: 'slot', visible: true, order: 4 },
    { id: 'packaging', label: 'Itens e insumos', kind: 'slot', visible: true, order: 5 },
    { id: 'balance', label: 'Saldos detalhados', kind: 'slot', visible: true, order: 6 },
    { id: 'ops', label: 'Atalhos operacionais', kind: 'slot', visible: false, order: 7 }
  ])
});

export const BuilderLayoutsPatchSchema = z
  .object({
    dashboard: BuilderPageLayoutSchema.optional(),
    clientes: BuilderPageLayoutSchema.optional(),
    pedidos: BuilderPageLayoutSchema.optional(),
    estoque: BuilderPageLayoutSchema.optional()
  })
  .strict();

export const BuilderConfigSchema = z.object({
  version: z.literal(1).default(1),
  updatedAt: z.string().optional(),
  theme: BuilderThemeSchema.default({}),
  forms: BuilderFormsSchema.default({}),
  home: BuilderHomeSchema.default({}),
  layouts: BuilderLayoutsSchema.default({})
});

export const BuilderConfigPatchSchema = z
  .object({
    theme: BuilderThemeSchema.partial().optional(),
    forms: BuilderFormsSchema.partial().optional(),
    home: BuilderHomeSchema.partial().optional(),
    layouts: BuilderLayoutsPatchSchema.optional()
  })
  .strict();

export const BuilderBlockKeyEnum = z.enum(['theme', 'forms', 'home', 'layout']);

export type OrderStatus = z.infer<typeof OrderStatusEnum>;
export type PaymentStatus = z.infer<typeof PaymentStatusEnum>;
export type OrderPaymentStatus = z.infer<typeof OrderPaymentStatusEnum>;
export type PixChargeProvider = z.infer<typeof PixChargeProviderEnum>;
export type PixCharge = z.infer<typeof PixChargeSchema>;
export type StockMovementType = z.infer<typeof StockMovementTypeEnum>;
export type OrderIntakeChannel = z.infer<typeof OrderIntakeChannelEnum>;
export type OrderIntakeIntent = z.infer<typeof OrderIntakeIntentEnum>;
export type OrderIntakeStage = z.infer<typeof OrderIntakeStageEnum>;
export type OrderFulfillmentMode = z.infer<typeof OrderFulfillmentModeEnum>;
export type PixChargeStatus = z.infer<typeof PixChargeStatusEnum>;
export type ExternalOrderSubmissionChannel = z.infer<typeof ExternalOrderSubmissionChannelEnum>;
export type ExternalOrderFlavorCounts = z.infer<typeof ExternalOrderFlavorCountsSchema>;
export type ExternalOrderSubmission = z.infer<typeof ExternalOrderSubmissionSchema>;
export type Coupon = z.infer<typeof CouponSchema>;
export type CouponUpsert = z.infer<typeof CouponUpsertSchema>;
export type CouponResolveRequest = z.infer<typeof CouponResolveRequestSchema>;
export type CouponResolveResponse = z.infer<typeof CouponResolveResponseSchema>;
export type CouponAnalyticsCustomer = z.infer<typeof CouponAnalyticsCustomerSchema>;
export type CouponAnalyticsOrder = z.infer<typeof CouponAnalyticsOrderSchema>;
export type CouponAnalyticsSummary = z.infer<typeof CouponAnalyticsSummarySchema>;
export type CouponAnalytics = z.infer<typeof CouponAnalyticsSchema>;

export type Customer = z.infer<typeof CustomerSchema>;
export type CustomerAddress = z.infer<typeof CustomerAddressSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type OrderCustomerSnapshot = z.infer<typeof OrderCustomerSnapshotSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type PixSettlementWebhook = z.infer<typeof PixSettlementWebhookSchema>;
export type PixReconciliationWebhook = z.infer<typeof PixReconciliationWebhookSchema>;
export type OrderIntakeCustomerRef = z.infer<typeof OrderIntakeCustomerRefSchema>;
export type OrderIntakeItem = z.infer<typeof OrderIntakeItemSchema>;
export type OrderIntakePayment = z.infer<typeof OrderIntakePaymentSchema>;
export type OrderIntakeSource = z.infer<typeof OrderIntakeSourceSchema>;
export type OrderIntake = z.infer<typeof OrderIntakeSchema>;
export type OrderIntakeMeta = z.infer<typeof OrderIntakeMetaSchema>;
export type InventoryCategory = z.infer<typeof InventoryCategoryEnum>;
export type InventoryCriticality = z.infer<typeof InventoryCriticalityEnum>;
export type InventoryRiskLevel = z.infer<typeof InventoryRiskLevelEnum>;
export type InventoryItem = z.infer<typeof InventoryItemSchema>;
export type InventoryPriceEntry = z.infer<typeof InventoryPriceEntrySchema>;
export type InventoryMovement = z.infer<typeof InventoryMovementSchema>;
export type InventoryOverviewItem = z.infer<typeof InventoryOverviewItemSchema>;
export type InventoryMassSummary = z.infer<typeof InventoryMassSummarySchema>;
export type InventoryOverviewResponse = z.infer<typeof InventoryOverviewResponseSchema>;
export type InventoryPriceBoardItem = z.infer<typeof InventoryPriceBoardItemSchema>;
export type InventoryPriceBoardResponse = z.infer<typeof InventoryPriceBoardResponseSchema>;
export type Bom = z.infer<typeof BomSchema>;
export type BomItem = z.infer<typeof BomItemSchema>;
export type ProductionRequirementBreakdown = z.infer<typeof ProductionRequirementBreakdownSchema>;
export type ProductionRequirementRow = z.infer<typeof ProductionRequirementRowSchema>;
export type ProductionRequirementWarning = z.infer<typeof ProductionRequirementWarningSchema>;
export type ProductionRequirementsResponse = z.infer<typeof ProductionRequirementsResponseSchema>;
export type StockPlanningSummary = z.infer<typeof StockPlanningSummarySchema>;
export type StockPlanningProductionAction = z.infer<typeof StockPlanningProductionActionSchema>;
export type StockPlanningShortageItem = z.infer<typeof StockPlanningShortageItemSchema>;
export type StockPlanningPurchaseSuggestion = z.infer<typeof StockPlanningPurchaseSuggestionSchema>;
export type StockPlanningOrderRisk = z.infer<typeof StockPlanningOrderRiskSchema>;
export type StockPlanningResponse = z.infer<typeof StockPlanningResponseSchema>;
export type BuilderTheme = z.infer<typeof BuilderThemeSchema>;
export type BuilderForms = z.infer<typeof BuilderFormsSchema>;
export type BuilderHomeImage = z.infer<typeof BuilderHomeImageSchema>;
export type BuilderHome = z.infer<typeof BuilderHomeSchema>;
export type BuilderLayoutPageKey = z.infer<typeof BuilderLayoutPageKeyEnum>;
export type BuilderLayoutItem = z.infer<typeof BuilderLayoutItemSchema>;
export type BuilderLayouts = z.infer<typeof BuilderLayoutsSchema>;
export type BuilderLayoutsPatch = z.infer<typeof BuilderLayoutsPatchSchema>;
export type BuilderConfig = z.infer<typeof BuilderConfigSchema>;
export type BuilderConfigPatch = z.infer<typeof BuilderConfigPatchSchema>;
export type BuilderBlockKey = z.infer<typeof BuilderBlockKeyEnum>;
