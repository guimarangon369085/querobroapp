import { z } from 'zod';

export * from './lib/money.js';
export * from './lib/external-order-schedule.js';

export const OrderStatusEnum = z.enum([
  'ABERTO',
  'CONFIRMADO',
  'EM_PREPARACAO',
  'PRONTO',
  'ENTREGUE',
  'CANCELADO'
]);

export const PaymentStatusEnum = z.enum(['PENDENTE', 'PAGO', 'CANCELADO']);
export const OrderPaymentStatusEnum = z.enum(['PENDENTE', 'PARCIAL', 'PAGO']);
export const PixChargeProviderEnum = z.enum(['STATIC_PIX', 'LOCAL_DEV']);
export const OrderFulfillmentModeEnum = z.enum(['DELIVERY', 'PICKUP']);
export const DeliveryProviderEnum = z.enum(['NONE', 'LOCAL', 'LOGGI']);
export const DeliveryFeeSourceEnum = z.enum(['NONE', 'LOGGI_QUOTE', 'MANUAL_FALLBACK']);
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

export const StockMovementTypeEnum = z.enum(['IN', 'OUT', 'ADJUST']);
export const InventoryCategoryEnum = z.enum(['INGREDIENTE', 'EMBALAGEM_INTERNA', 'EMBALAGEM_EXTERNA']);

export const PixChargeSchema = z.object({
  provider: PixChargeProviderEnum,
  providerRef: z.string().min(1),
  txid: z.string().min(1),
  copyPasteCode: z.string().min(1),
  expiresAt: z.string().optional().nullable(),
  payable: z.boolean().default(false)
});

export const WhatsAppDispatchMessageSchema = z.object({
  kind: z.enum(['SUMMARY', 'PIX_CODE']),
  messageId: z.string().min(1)
});

export const WhatsAppPixDispatchSchema = z.object({
  provider: z.literal('WHATSAPP_CLOUD_API'),
  to: z.string().min(1),
  sentAt: z.string(),
  messages: z.array(WhatsAppDispatchMessageSchema).min(1)
});

export const CustomerSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
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
  createdAt: z.string().optional().nullable()
});

export const ProductSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1),
  category: z.string().optional().nullable(),
  unit: z.string().optional().nullable(),
  price: z.number().nonnegative(),
  active: z.boolean().default(true),
  createdAt: z.string().optional().nullable()
});

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
  customerId: z.number().int().positive(),
  status: OrderStatusEnum.default('ABERTO'),
  fulfillmentMode: OrderFulfillmentModeEnum.default('DELIVERY'),
  subtotal: z.number().nonnegative().optional(),
  deliveryFee: z.number().nonnegative().optional(),
  deliveryProvider: DeliveryProviderEnum.optional(),
  deliveryFeeSource: DeliveryFeeSourceEnum.optional(),
  deliveryQuoteStatus: DeliveryQuoteStatusEnum.optional(),
  deliveryQuoteExpiresAt: z.string().optional().nullable(),
  discount: z.number().nonnegative().optional(),
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

export const OrderIntakeChannelEnum = z.enum([
  'INTERNAL_DASHBOARD',
  'ADMIN_REPEAT',
  'CUSTOMER_LINK',
  'WHATSAPP_FLOW'
]);

export const OrderIntakeIntentEnum = z.enum(['DRAFT', 'CONFIRMED', 'PAID']);
export const OrderIntakeStageEnum = z.enum(['DRAFT', 'CONFIRMED', 'PIX_PENDING', 'PAID', 'SCHEDULED']);
export const PixChargeStatusEnum = z.enum(['PENDENTE', 'PAGO']);

export const OrderIntakeCustomerRefSchema = z.union([
  z.object({
    customerId: z.number().int().positive()
  }),
  z.object({
    name: z.string().min(1),
    phone: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
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
    discount: z.number().nonnegative().default(0),
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

export const ExternalOrderSubmissionChannelEnum = z.enum(['GOOGLE_FORM', 'PUBLIC_FORM', 'WHATSAPP_FLOW']);

export const ExternalOrderFlavorCountsSchema = z
  .object({
    T: z.coerce.number().int().nonnegative().default(0),
    G: z.coerce.number().int().nonnegative().default(0),
    D: z.coerce.number().int().nonnegative().default(0),
    Q: z.coerce.number().int().nonnegative().default(0),
    R: z.coerce.number().int().nonnegative().default(0)
  })
  .default({});

export const ExternalOrderSubmissionSchema = z
  .object({
    version: z.literal(1).default(1),
    customer: z.object({
      name: z.string().min(1),
      phone: z.string().optional().nullable(),
      address: z.string().optional().nullable(),
      placeId: z.string().optional().nullable(),
      lat: z.number().optional().nullable(),
      lng: z.number().optional().nullable(),
      deliveryNotes: z.string().optional().nullable()
    }),
    fulfillment: z.object({
      mode: OrderFulfillmentModeEnum.default('DELIVERY'),
      scheduledAt: z.string().datetime()
    }),
    delivery: DeliveryQuoteSelectionSchema.optional(),
    flavors: ExternalOrderFlavorCountsSchema,
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
    const total =
      (value.flavors.T || 0) +
      (value.flavors.G || 0) +
      (value.flavors.D || 0) +
      (value.flavors.Q || 0) +
      (value.flavors.R || 0);
    if (total <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe ao menos 1 broa.',
        path: ['flavors']
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
  createdAt: z.string().optional().nullable()
});

export const InventoryMovementSchema = z.object({
  id: z.number().int().positive().optional(),
  itemId: z.number().int().positive(),
  orderId: z.number().int().positive().optional().nullable(),
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
  productId: z.number().int().positive(),
  productName: z.string(),
  message: z.string()
});

export const ProductionRequirementsResponseSchema = z.object({
  date: z.string(),
  basis: z.enum(['deliveryDate', 'createdAtPlus1']),
  rows: z.array(ProductionRequirementRowSchema),
  warnings: z.array(ProductionRequirementWarningSchema)
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
      'Redesenho completo com base em tons de goiabada, crosta assada, creme e verde menta: contraste premium, leitura rapida para operacao e identidade visual coerente com o universo artesanal da marca.'
    ),
  gallery: z
    .array(BuilderHomeImageSchema)
    .max(12)
    .default([
      { id: 'hero-01', src: '/querobroa/hero-01.jpg', alt: 'Bandeja com broas e utensilios' },
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
    { id: 'new_order', label: 'Criacao de pedido', kind: 'slot', visible: true, order: 4 },
    { id: 'detail', label: 'Detalhe do pedido', kind: 'slot', visible: true, order: 5 }
  ]),
  estoque: BuilderPageLayoutSchema.default([
    { id: 'header', label: 'Cabecalho da pagina', kind: 'slot', visible: true, order: 0 },
    { id: 'kpis', label: 'Resumo do dia', kind: 'slot', visible: true, order: 1 },
    { id: 'movement', label: 'Ajuste rapido de saldos', kind: 'slot', visible: true, order: 2 },
    { id: 'd1', label: 'Alertas e compras', kind: 'slot', visible: true, order: 3 },
    { id: 'capacity', label: 'Capacidade de producao', kind: 'slot', visible: true, order: 4 },
    { id: 'movements', label: 'Auditoria', kind: 'slot', visible: true, order: 5 },
    { id: 'bom', label: 'Catalogo tecnico', kind: 'slot', visible: true, order: 6 },
    { id: 'packaging', label: 'Itens e insumos', kind: 'slot', visible: true, order: 7 },
    { id: 'balance', label: 'Saldos detalhados', kind: 'slot', visible: true, order: 8 },
    { id: 'ops', label: 'Atalhos operacionais', kind: 'slot', visible: false, order: 9 }
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
export type WhatsAppDispatchMessage = z.infer<typeof WhatsAppDispatchMessageSchema>;
export type WhatsAppPixDispatch = z.infer<typeof WhatsAppPixDispatchSchema>;
export type ExternalOrderSubmissionChannel = z.infer<typeof ExternalOrderSubmissionChannelEnum>;
export type ExternalOrderFlavorCounts = z.infer<typeof ExternalOrderFlavorCountsSchema>;
export type ExternalOrderSubmission = z.infer<typeof ExternalOrderSubmissionSchema>;

export type Customer = z.infer<typeof CustomerSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type OrderIntakeCustomerRef = z.infer<typeof OrderIntakeCustomerRefSchema>;
export type OrderIntakeItem = z.infer<typeof OrderIntakeItemSchema>;
export type OrderIntakePayment = z.infer<typeof OrderIntakePaymentSchema>;
export type OrderIntakeSource = z.infer<typeof OrderIntakeSourceSchema>;
export type OrderIntake = z.infer<typeof OrderIntakeSchema>;
export type OrderIntakeMeta = z.infer<typeof OrderIntakeMetaSchema>;
export type InventoryCategory = z.infer<typeof InventoryCategoryEnum>;
export type InventoryItem = z.infer<typeof InventoryItemSchema>;
export type InventoryMovement = z.infer<typeof InventoryMovementSchema>;
export type InventoryOverviewItem = z.infer<typeof InventoryOverviewItemSchema>;
export type InventoryMassSummary = z.infer<typeof InventoryMassSummarySchema>;
export type InventoryOverviewResponse = z.infer<typeof InventoryOverviewResponseSchema>;
export type Bom = z.infer<typeof BomSchema>;
export type BomItem = z.infer<typeof BomItemSchema>;
export type ProductionRequirementBreakdown = z.infer<typeof ProductionRequirementBreakdownSchema>;
export type ProductionRequirementRow = z.infer<typeof ProductionRequirementRowSchema>;
export type ProductionRequirementWarning = z.infer<typeof ProductionRequirementWarningSchema>;
export type ProductionRequirementsResponse = z.infer<typeof ProductionRequirementsResponseSchema>;
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
