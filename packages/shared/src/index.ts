import { z } from 'zod';

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

export const StockMovementTypeEnum = z.enum(['IN', 'OUT', 'ADJUST']);
export const InventoryCategoryEnum = z.enum(['INGREDIENTE', 'EMBALAGEM_INTERNA', 'EMBALAGEM_EXTERNA']);
export const OutboxChannelEnum = z.enum(['whatsapp']);
export const OutboxStatusEnum = z.enum(['PENDING', 'SENT', 'FAILED']);

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
  subtotal: z.number().nonnegative().optional(),
  discount: z.number().nonnegative().optional(),
  total: z.number().nonnegative().optional(),
  amountPaid: z.number().nonnegative().optional(),
  balanceDue: z.number().nonnegative().optional(),
  paymentStatus: OrderPaymentStatusEnum.optional(),
  notes: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
  items: z.array(OrderItemSchema).optional()
});

export const PaymentSchema = z.object({
  id: z.number().int().positive().optional(),
  orderId: z.number().int().positive(),
  amount: z.number().nonnegative(),
  method: z.string().min(1),
  status: PaymentStatusEnum.default('PENDENTE'),
  paidAt: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  providerRef: z.string().optional().nullable()
});

export const StockMovementSchema = z.object({
  id: z.number().int().positive().optional(),
  productId: z.number().int().positive(),
  type: StockMovementTypeEnum,
  quantity: z.number().int(),
  reason: z.string().optional().nullable(),
  orderId: z.number().int().positive().optional().nullable(),
  createdAt: z.string().optional().nullable()
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
  createdAt: z.string().optional().nullable()
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

export const OutboxMessageSchema = z.object({
  id: z.number().int().positive().optional(),
  messageId: z.string().min(1),
  channel: OutboxChannelEnum.default('whatsapp'),
  to: z.string().min(1),
  template: z.string().min(1),
  payload: z.unknown(),
  status: OutboxStatusEnum.default('PENDING'),
  createdAt: z.string().optional().nullable(),
  sentAt: z.string().optional().nullable()
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

export const ReceiptOfficialItemEnum = z.enum([
  'FARINHA DE TRIGO',
  'FUBÁ DE CANJICA',
  'AÇÚCAR',
  'MANTEIGA',
  'LEITE',
  'OVOS',
  'GOIABADA',
  'DOCE DE LEITE',
  'QUEIJO DO SERRO',
  'REQUEIJÃO DE CORTE',
  'SACOLA',
  'CAIXA DE PLÁSTICO',
  'PAPEL MANTEIGA'
]);

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

export const BuilderReceiptStockRuleSchema = z.object({
  officialItem: ReceiptOfficialItemEnum,
  inventoryItemName: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  quantityMultiplier: z.number().positive().max(100).default(1)
});

export const BuilderIntegrationsSchema = z.object({
  shortcutsEnabled: z.boolean().default(true),
  shortcutsWebhookUrl: z.string().max(300).default(''),
  shortcutsNotes: z.string().max(500).default(''),
  receiptsPrompt: z.string().max(3000).default(''),
  receiptsSeparator: z.string().min(1).max(4).default(';'),
  receiptsAutoIngestEnabled: z.boolean().default(true),
  receiptStockRules: z.array(BuilderReceiptStockRuleSchema).max(30).default([
    {
      officialItem: 'FARINHA DE TRIGO',
      inventoryItemName: 'FARINHA DE TRIGO',
      enabled: true,
      quantityMultiplier: 1
    },
    {
      officialItem: 'FUBÁ DE CANJICA',
      inventoryItemName: 'FUBÁ DE CANJICA',
      enabled: true,
      quantityMultiplier: 1
    },
    { officialItem: 'AÇÚCAR', inventoryItemName: 'AÇÚCAR', enabled: true, quantityMultiplier: 1 },
    { officialItem: 'MANTEIGA', inventoryItemName: 'MANTEIGA', enabled: true, quantityMultiplier: 1 },
    { officialItem: 'LEITE', inventoryItemName: 'LEITE', enabled: true, quantityMultiplier: 1 },
    { officialItem: 'OVOS', inventoryItemName: 'OVOS', enabled: true, quantityMultiplier: 1 },
    { officialItem: 'GOIABADA', inventoryItemName: 'GOIABADA', enabled: true, quantityMultiplier: 1 },
    {
      officialItem: 'DOCE DE LEITE',
      inventoryItemName: 'DOCE DE LEITE',
      enabled: true,
      quantityMultiplier: 1
    },
    {
      officialItem: 'QUEIJO DO SERRO',
      inventoryItemName: 'QUEIJO DO SERRO',
      enabled: true,
      quantityMultiplier: 1
    },
    {
      officialItem: 'REQUEIJÃO DE CORTE',
      inventoryItemName: 'REQUEIJÃO DE CORTE',
      enabled: true,
      quantityMultiplier: 1
    },
    { officialItem: 'SACOLA', inventoryItemName: 'SACOLA', enabled: false, quantityMultiplier: 1 },
    {
      officialItem: 'CAIXA DE PLÁSTICO',
      inventoryItemName: 'CAIXA DE PLÁSTICO',
      enabled: false,
      quantityMultiplier: 1
    },
    {
      officialItem: 'PAPEL MANTEIGA',
      inventoryItemName: 'PAPEL MANTEIGA',
      enabled: false,
      quantityMultiplier: 1
    }
  ])
});

export const BuilderLayoutPageKeyEnum = z.enum([
  'dashboard',
  'produtos',
  'clientes',
  'pedidos',
  'estoque'
]);

export const BuilderLayoutItemSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  visible: z.boolean().default(true),
  order: z.number().int().min(0).max(99).default(0)
});

export const BuilderPageLayoutSchema = z.array(BuilderLayoutItemSchema).max(20);

export const BuilderLayoutsSchema = z.object({
  dashboard: BuilderPageLayoutSchema.default([
    { id: 'header', label: 'Cabecalho da pagina', visible: true, order: 0 },
    { id: 'error', label: 'Avisos e erros', visible: true, order: 1 },
    { id: 'kpis', label: 'Cards de KPI', visible: true, order: 2 }
  ]),
  produtos: BuilderPageLayoutSchema.default([
    { id: 'header', label: 'Cabecalho da pagina', visible: true, order: 0 },
    { id: 'note', label: 'Painel de convencao', visible: true, order: 1 },
    { id: 'load_error', label: 'Aviso de carga', visible: true, order: 2 },
    { id: 'kpis_filters', label: 'KPI e filtros', visible: true, order: 3 },
    { id: 'form', label: 'Formulario do produto', visible: true, order: 4 },
    { id: 'list', label: 'Lista de produtos', visible: true, order: 5 }
  ]),
  clientes: BuilderPageLayoutSchema.default([
    { id: 'header', label: 'Cabecalho da pagina', visible: true, order: 0 },
    { id: 'kpis_search', label: 'KPI e busca', visible: true, order: 1 },
    { id: 'form', label: 'Formulario de cliente', visible: true, order: 2 },
    { id: 'list', label: 'Lista de clientes', visible: true, order: 3 }
  ]),
  pedidos: BuilderPageLayoutSchema.default([
    { id: 'header', label: 'Cabecalho da pagina', visible: true, order: 0 },
    { id: 'load_error', label: 'Aviso de carga', visible: true, order: 1 },
    { id: 'kpis', label: 'KPIs de pedidos', visible: true, order: 2 },
    { id: 'new_order', label: 'Criacao de pedido', visible: true, order: 3 },
    { id: 'list', label: 'Lista de pedidos', visible: true, order: 4 },
    { id: 'detail', label: 'Detalhe do pedido', visible: true, order: 5 }
  ]),
  estoque: BuilderPageLayoutSchema.default([
    { id: 'header', label: 'Cabecalho da pagina', visible: true, order: 0 },
    { id: 'kpis', label: 'KPIs de estoque', visible: true, order: 1 },
    { id: 'capacity', label: 'Capacidade por produto', visible: true, order: 2 },
    { id: 'd1', label: 'Quadro D+1', visible: true, order: 3 },
    { id: 'movement', label: 'Nova movimentacao', visible: true, order: 4 },
    { id: 'bom', label: 'Fichas tecnicas (BOM)', visible: true, order: 5 },
    { id: 'packaging', label: 'Custo de embalagem', visible: true, order: 6 },
    { id: 'balance', label: 'Saldo por item', visible: true, order: 7 },
    { id: 'movements', label: 'Historico de movimentacoes', visible: true, order: 8 }
  ])
});

export const BuilderLayoutsPatchSchema = z
  .object({
    dashboard: BuilderPageLayoutSchema.optional(),
    produtos: BuilderPageLayoutSchema.optional(),
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
  integrations: BuilderIntegrationsSchema.default({}),
  layouts: BuilderLayoutsSchema.default({})
});

export const BuilderConfigPatchSchema = z
  .object({
    theme: BuilderThemeSchema.partial().optional(),
    forms: BuilderFormsSchema.partial().optional(),
    home: BuilderHomeSchema.partial().optional(),
    integrations: BuilderIntegrationsSchema.partial().optional(),
    layouts: BuilderLayoutsPatchSchema.optional()
  })
  .strict();

export const BuilderBlockKeyEnum = z.enum(['theme', 'forms', 'home', 'integrations', 'layout']);

export type OrderStatus = z.infer<typeof OrderStatusEnum>;
export type PaymentStatus = z.infer<typeof PaymentStatusEnum>;
export type OrderPaymentStatus = z.infer<typeof OrderPaymentStatusEnum>;
export type StockMovementType = z.infer<typeof StockMovementTypeEnum>;
export type OutboxChannel = z.infer<typeof OutboxChannelEnum>;
export type OutboxStatus = z.infer<typeof OutboxStatusEnum>;

export type Customer = z.infer<typeof CustomerSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type StockMovement = z.infer<typeof StockMovementSchema>;
export type InventoryCategory = z.infer<typeof InventoryCategoryEnum>;
export type InventoryItem = z.infer<typeof InventoryItemSchema>;
export type InventoryMovement = z.infer<typeof InventoryMovementSchema>;
export type Bom = z.infer<typeof BomSchema>;
export type BomItem = z.infer<typeof BomItemSchema>;
export type OutboxMessage = z.infer<typeof OutboxMessageSchema>;
export type ProductionRequirementBreakdown = z.infer<typeof ProductionRequirementBreakdownSchema>;
export type ProductionRequirementRow = z.infer<typeof ProductionRequirementRowSchema>;
export type ProductionRequirementWarning = z.infer<typeof ProductionRequirementWarningSchema>;
export type ProductionRequirementsResponse = z.infer<typeof ProductionRequirementsResponseSchema>;
export type ReceiptOfficialItem = z.infer<typeof ReceiptOfficialItemEnum>;
export type BuilderTheme = z.infer<typeof BuilderThemeSchema>;
export type BuilderForms = z.infer<typeof BuilderFormsSchema>;
export type BuilderHomeImage = z.infer<typeof BuilderHomeImageSchema>;
export type BuilderHome = z.infer<typeof BuilderHomeSchema>;
export type BuilderReceiptStockRule = z.infer<typeof BuilderReceiptStockRuleSchema>;
export type BuilderIntegrations = z.infer<typeof BuilderIntegrationsSchema>;
export type BuilderLayoutPageKey = z.infer<typeof BuilderLayoutPageKeyEnum>;
export type BuilderLayoutItem = z.infer<typeof BuilderLayoutItemSchema>;
export type BuilderLayouts = z.infer<typeof BuilderLayoutsSchema>;
export type BuilderLayoutsPatch = z.infer<typeof BuilderLayoutsPatchSchema>;
export type BuilderConfig = z.infer<typeof BuilderConfigSchema>;
export type BuilderConfigPatch = z.infer<typeof BuilderConfigPatchSchema>;
export type BuilderBlockKey = z.infer<typeof BuilderBlockKeyEnum>;
