'use client';

import {
  Suspense,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode
} from 'react';
import type {
  Bom,
  BomItem as CatalogBomItem,
  CompanionProductProfile,
  InventoryCategory,
  InventoryCriticality,
  InventoryItem,
  InventoryMovement,
  InventoryMassSummary,
  InventoryOverviewItem,
  InventoryOverviewResponse,
  Product,
  StockPlanningResponse
} from '@querobroapp/shared';
import {
  buildCompanionProductName,
  mergeCompanionProductProfileIntoDrawerNote,
  resolveCompanionProductProfile,
  stripCompanionProductProfileFromDrawerNote
} from '@querobroapp/shared';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { resolveBuilderImageSrc } from '@/lib/builder';
import { clearQueryParams, consumeFocusQueryParam, scrollToLayoutSlot } from '@/lib/layout-scroll';
import { useDialogA11y } from '@/lib/use-dialog-a11y';
import { formatDecimalInputBR, formatMoneyInputBR, parseLocaleNumber } from '@/lib/format';
import { useSurfaceMode } from '@/hooks/use-surface-mode';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { useFeedback } from '@/components/feedback-provider';
import { BuilderLayoutItemSlot, BuilderLayoutProvider } from '@/components/builder-layout';

const movementTypeOptions: Array<{ value: 'IN' | 'OUT' | 'ADJUST'; label: string }> = [
  { value: 'IN', label: 'Entrada' },
  { value: 'OUT', label: 'Saida' },
  { value: 'ADJUST', label: 'Ajuste de saldo' }
];

const inventoryCriticalityOptions: Array<{ value: InventoryCriticality; label: string }> = [
  { value: 'BAIXA', label: 'Baixa' },
  { value: 'MEDIA', label: 'Media' },
  { value: 'ALTA', label: 'Alta' },
  { value: 'CRITICA', label: 'Critica' }
];

const inventoryCategoryOptions: Array<{ value: InventoryCategory; label: string }> = [
  { value: 'INGREDIENTE', label: 'Ingrediente' },
  { value: 'EMBALAGEM_INTERNA', label: 'Embalagem interna' },
  { value: 'EMBALAGEM_EXTERNA', label: 'Embalagem externa' }
];

const OFFICIAL_BROAS = [
  { code: 'T', name: 'Broa Tradicional (T)', boxPrice: 40 },
  { code: 'G', name: 'Broa Goiabada (G)', boxPrice: 50 },
  { code: 'D', name: 'Broa Doce de Leite (D)', boxPrice: 52 },
  { code: 'Q', name: 'Broa Queijo do Serro (Q)', boxPrice: 52 },
  { code: 'R', name: 'Broa Requeijão de corte (R)', boxPrice: 52 },
  { code: 'RJ', name: 'Broa Romeu E Julieta (RJ)', boxPrice: 52 }
] as const;

type ProductFormState = Pick<
  Product,
  'name' | 'category' | 'unit' | 'active' | 'imageUrl' | 'salesLimitEnabled' | 'salesLimitBoxes' | 'drawerNote'
>;

const EMPTY_PRODUCT_FORM: ProductFormState = {
  name: '',
  category: 'Sabores',
  unit: 'unidade',
  imageUrl: null,
  active: true,
  salesLimitEnabled: false,
  salesLimitBoxes: null,
  drawerNote: null
};

type InventoryItemFormState = {
  name: string;
  category: InventoryCategory;
  unit: string;
  balance: string;
  purchasePackSize: string;
  purchasePackCost: string;
  sourceName: string;
  sourceUrl: string;
  leadTimeDays: string;
  safetyStockQty: string;
  reorderPointQty: string;
  targetStockQty: string;
  perishabilityDays: string;
  criticality: InventoryCriticality | '';
  preferredSupplier: string;
};

type InventoryItemFormSeed = {
  name?: string | null;
  category?: InventoryCategory | null;
  unit?: string | null;
  balance?: number | null;
  purchasePackSize?: number | null;
  purchasePackCost?: number | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  leadTimeDays?: number | null;
  safetyStockQty?: number | null;
  reorderPointQty?: number | null;
  targetStockQty?: number | null;
  perishabilityDays?: number | null;
  criticality?: InventoryCriticality | null;
  preferredSupplier?: string | null;
};

type CompanionInventoryFormState = Omit<InventoryItemFormState, 'name' | 'category'>;

type CompanionProductIdentityFormState = {
  title: string;
  flavor: string;
  maker: string;
  origin: string;
};

function buildInventoryItemFormState(item?: InventoryItemFormSeed): InventoryItemFormState {
  return {
    name: item?.name ?? '',
    category: item?.category ?? 'INGREDIENTE',
    unit: item?.unit ?? 'g',
    balance:
      item?.balance != null
        ? formatDecimalInputBR(item.balance, {
            maxFractionDigits: 4
          }) || '0'
        : '0',
    purchasePackSize:
      formatDecimalInputBR(item?.purchasePackSize ?? 1000, {
        maxFractionDigits: 4
      }) || '0',
    purchasePackCost: formatMoneyInputBR(item?.purchasePackCost ?? 0) || '0,00',
    sourceName: item?.sourceName ?? '',
    sourceUrl: item?.sourceUrl ?? '',
    leadTimeDays:
      item?.leadTimeDays != null
        ? formatDecimalInputBR(item.leadTimeDays, { maxFractionDigits: 0 }) || '0'
        : '',
    safetyStockQty:
      item?.safetyStockQty != null
        ? formatDecimalInputBR(item.safetyStockQty, { maxFractionDigits: 4 }) || '0'
        : '',
    reorderPointQty:
      item?.reorderPointQty != null
        ? formatDecimalInputBR(item.reorderPointQty, { maxFractionDigits: 4 }) || '0'
        : '',
    targetStockQty:
      item?.targetStockQty != null
        ? formatDecimalInputBR(item.targetStockQty, { maxFractionDigits: 4 }) || '0'
        : '',
    perishabilityDays:
      item?.perishabilityDays != null
        ? formatDecimalInputBR(item.perishabilityDays, { maxFractionDigits: 0 }) || '0'
        : '',
    criticality: item?.criticality ?? '',
    preferredSupplier: item?.preferredSupplier ?? ''
  };
}

const EMPTY_INVENTORY_ITEM_FORM: InventoryItemFormState = buildInventoryItemFormState();

function buildCompanionInventoryFormState(item?: InventoryItemFormSeed): CompanionInventoryFormState {
  const { name: _name, category: _category, ...rest } = buildInventoryItemFormState({
    category: 'INGREDIENTE',
    ...item
  });
  return rest;
}

const EMPTY_COMPANION_INVENTORY_FORM: CompanionInventoryFormState =
  buildCompanionInventoryFormState();

const EMPTY_COMPANION_PRODUCT_IDENTITY_FORM: CompanionProductIdentityFormState = {
  title: '',
  flavor: '',
  maker: '',
  origin: ''
};

function buildCompanionProductIdentityFormState(
  value?: Partial<CompanionProductProfile> | { name?: string | null; drawerNote?: string | null } | null,
): CompanionProductIdentityFormState {
  if (value && ('name' in value || 'drawerNote' in value)) {
    const resolvedProfile = resolveCompanionProductProfile({
      name: value.name ?? null,
      drawerNote: value.drawerNote ?? null
    });

    return {
      title: resolvedProfile?.title ?? '',
      flavor: resolvedProfile?.flavor ?? '',
      maker: resolvedProfile?.maker ?? '',
      origin: resolvedProfile?.origin ?? ''
    };
  }

  const profileSeed = value as Partial<CompanionProductProfile> | null | undefined;
  const resolvedProfile = {
    title: String(profileSeed?.title || '').trim(),
    flavor: String(profileSeed?.flavor || '').trim() || null,
    maker: String(profileSeed?.maker || '').trim() || null,
    origin: String(profileSeed?.origin || '').trim() || null
  };

  return {
    title: resolvedProfile?.title ?? '',
    flavor: resolvedProfile?.flavor ?? '',
    maker: resolvedProfile?.maker ?? '',
    origin: resolvedProfile?.origin ?? ''
  };
}

function buildCompanionProductProfileFromForm(
  value: CompanionProductIdentityFormState,
): CompanionProductProfile | null {
  const title = String(value.title || '').trim();
  if (!title) return null;
  return {
    title,
    flavor: String(value.flavor || '').trim() || null,
    maker: String(value.maker || '').trim() || null,
    origin: String(value.origin || '').trim() || null
  };
}

const OFFICIAL_BROA_ORDER_BY_NAME = new Map(
  OFFICIAL_BROAS.map((broa, index) => [normalizeLookupText(broa.name), index])
);

const COMPANION_PRODUCT_CATEGORY_VALUE = 'Amigas da Broa';
const COMPANION_PRODUCT_CATEGORY_ALIASES = new Set([
  normalizeLookupText('Amigas da Broa'),
  normalizeLookupText('Amigos da Broa')
]);

function isCompanionProductCategoryValue(value?: string | null) {
  return COMPANION_PRODUCT_CATEGORY_ALIASES.has(normalizeLookupText(value));
}

function isTechnicalCatalogProduct(product: Product) {
  return normalizeLookupText(product.category || '') !== 'HISTORICO';
}

function movementTypeLabel(value: string) {
  return movementTypeOptions.find((entry) => entry.value === value)?.label || value;
}

function movementOrderLabel(movement: Pick<InventoryMovement, 'orderDisplayNumber' | 'orderId'>) {
  const orderNumber =
    (typeof movement.orderDisplayNumber === 'number' && movement.orderDisplayNumber > 0
      ? movement.orderDisplayNumber
      : null) ??
    (typeof movement.orderId === 'number' && movement.orderId > 0 ? movement.orderId : null);
  return orderNumber ? `Pedido #${orderNumber}` : null;
}

function formatMovementReason(movement: Pick<InventoryMovement, 'reason' | 'orderDisplayNumber' | 'orderId'>) {
  const baseReason = String(movement.reason || '').trim();
  const orderLabel = movementOrderLabel(movement);
  if (!orderLabel) return baseReason || 'Sem observação';
  if (!baseReason) return orderLabel;
  return baseReason.includes(orderLabel) ? baseReason : `${baseReason} • ${orderLabel}`;
}

type BomItemInput = {
  itemId: number | '';
  qtyPerRecipe?: string;
  qtyPerSaleUnit?: string;
  qtyPerUnit?: string;
};

type BomQuantityCarrier = {
  qtyPerRecipe?: string | number | null;
  qtyPerSaleUnit?: string | number | null;
  qtyPerUnit?: string | number | null;
};

type BomCatalogItem = CatalogBomItem & {
  item?: InventoryOverviewItem | null;
};

type BomCatalogRecord = Omit<Bom, 'id'> & {
  id: number;
  product?: Product | null;
  items?: BomCatalogItem[];
};

type PurchaseCostRefreshItemResult = {
  id: number;
  name: string;
  purchasePackSize: number;
  previousCost: number;
  nextCost: number;
};

type PurchaseCostRefreshResult = {
  canonicalName: string;
  sourceName: string;
  sourceUrl: string;
  sourcePackSize: number;
  sourcePrice: number;
  status: 'UPDATED' | 'FALLBACK' | 'SKIPPED';
  message: string;
  updatedItems: PurchaseCostRefreshItemResult[];
};

type PurchaseCostRefreshResponse = {
  updatedAt: string;
  totals: {
    sources: number;
    updatedSourceCount: number;
    fallbackSourceCount: number;
    skippedSourceCount: number;
    updatedItemCount: number;
  };
  results: PurchaseCostRefreshResult[];
};

type PriceBaselineResearchResponse = {
  appliedAt: string;
  firstOrderAt: string;
  results: Array<{
    canonicalName: string;
    sourceName: string;
    sourceUrl: string;
    livePrice: number;
    historicalAveragePrice: number;
    sourcePackSize: number;
    status: 'UPDATED' | 'SKIPPED';
    message: string;
    updatedItemIds: number[];
  }>;
};

type StockBoardCard = {
  item: InventoryOverviewItem;
  balance: number;
};

const TUTORIAL_QUERY_VALUE = 'primeira_vez';

function formatQty(value: number) {
  if (!Number.isFinite(value)) return '0';
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

function roundInventoryQty(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatCurrencyBR(value: number) {
  if (!Number.isFinite(value)) return 'R$ 0,00';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatShortDateBR(value?: string | null) {
  if (!value) return 'Sem data';
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-03:00` : value;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('pt-BR');
}

function planningRiskBadgeClass(level: 'OK' | 'ATENCAO' | 'CRITICO') {
  if (level === 'CRITICO') return 'border-rose-200 bg-rose-50 text-rose-900';
  if (level === 'ATENCAO') return 'border-amber-200 bg-amber-50 text-amber-900';
  return 'border-emerald-200 bg-emerald-50 text-emerald-900';
}

function planningRiskLabel(level: 'OK' | 'ATENCAO' | 'CRITICO') {
  if (level === 'CRITICO') return 'Critico';
  if (level === 'ATENCAO') return 'Atencao';
  return 'Ok';
}

function planningRiskTone(level?: 'OK' | 'ATENCAO' | 'CRITICO' | null) {
  if (level === 'CRITICO') return 'critical';
  if (level === 'ATENCAO') return 'attention';
  if (level === 'OK') return 'ok';
  return 'neutral';
}

function inventoryCategoryLabel(category: string) {
  if (category === 'INGREDIENTE') return 'Ingrediente';
  if (category === 'EMBALAGEM_INTERNA') return 'Embalagem interna';
  if (category === 'EMBALAGEM_EXTERNA') return 'Embalagem externa';
  return category;
}

function normalizeLookupText(value?: string | null) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function isCanonicalCatalogCategoryValue(value?: string | null) {
  return normalizeLookupText(value) === normalizeLookupText('Sabores');
}

const ROMEU_E_JULIETA_CARDAPIO_IMAGE = '/querobroa-brand/cardapio/romeu-e-julieta.jpg?v=20260422-rj3';
const MISTA_ROMEU_E_JULIETA_CARDAPIO_IMAGE = '/querobroa-brand/cardapio/mista-romeu-e-julieta.jpg';
const SABORES_CARDAPIO_IMAGE = '/querobroa-brand/cardapio/sabores-caixa.jpg?v=20260422-rj3';

function resolveCanonicalCatalogProductImage(name?: string | null, category?: string | null) {
  if (!isCanonicalCatalogCategoryValue(category)) return null;

  const normalized = normalizeLookupText(name);
  if (!normalized) return null;

  if (normalized.includes('MISTA') && (normalized.includes('ROMEU') || normalized.includes('JULIETA'))) {
    return MISTA_ROMEU_E_JULIETA_CARDAPIO_IMAGE;
  }
  if (normalized.includes('ROMEU') || normalized.includes('JULIETA')) {
    return ROMEU_E_JULIETA_CARDAPIO_IMAGE;
  }
  if (normalized.includes('MISTA') && normalized.includes('GOIABADA')) {
    return '/querobroa-brand/cardapio/mista-goiabada.jpg';
  }
  if (normalized.includes('MISTA') && normalized.includes('DOCE DE LEITE')) {
    return '/querobroa-brand/cardapio/mista-doce-de-leite.jpg';
  }
  if (normalized.includes('MISTA') && normalized.includes('QUEIJO')) {
    return '/querobroa-brand/cardapio/mista-queijo-do-serro.jpg';
  }
  if (normalized.includes('MISTA') && normalized.includes('REQUEIJAO')) {
    return '/querobroa-brand/cardapio/mista-requeijao-de-corte.jpg';
  }
  if (normalized.includes('TRADICIONAL')) {
    return '/querobroa-brand/cardapio/tradicional.jpg';
  }
  if (normalized.includes('GOIABADA')) {
    return '/querobroa-brand/cardapio/goiabada.jpg';
  }
  if (normalized.includes('DOCE DE LEITE')) {
    return '/querobroa-brand/cardapio/doce-de-leite.jpg';
  }
  if (normalized.includes('REQUEIJAO')) {
    return '/querobroa-brand/cardapio/requeijao-de-corte.jpg';
  }
  if (normalized.includes('QUEIJO')) {
    return '/querobroa-brand/cardapio/queijo-do-serro-camadas.jpg';
  }
  if (normalized.includes('SABORES')) {
    return SABORES_CARDAPIO_IMAGE;
  }

  return null;
}

const EMPTY_MASS_SUMMARY: InventoryMassSummary = {
  itemId: null,
  name: 'MASSA PRONTA',
  recipesAvailable: 0,
  broasAvailable: 0,
  recipesPossibleFromIngredients: 0,
  broasPossibleFromIngredients: 0,
  totalPotentialRecipes: 0,
  totalPotentialBroas: 0,
  limitingIngredientName: null
};

const EMPTY_STOCK_PLANNING: StockPlanningResponse = {
  summary: {
    generatedAt: '',
    openOrdersCount: 0,
    riskyOrdersCount: 0,
    criticalOrdersCount: 0,
    shortageItemsCount: 0,
    purchaseSuggestionsCount: 0,
    bomWarningsCount: 0
  },
  productionAction: {
    targetDate: null,
    requiredBroas: 0,
    availableBroas: 0,
    plannedPrepBroas: 0,
    remainingBroasAfterPlan: 0
  },
  shortageItems: [],
  purchaseSuggestions: [],
  orderRisks: [],
  bomWarnings: []
};

function compareStockProducts(left: Product, right: Product) {
  const leftOrder = OFFICIAL_BROA_ORDER_BY_NAME.get(normalizeLookupText(left.name)) ?? 99;
  const rightOrder = OFFICIAL_BROA_ORDER_BY_NAME.get(normalizeLookupText(right.name)) ?? 99;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  if (left.active !== right.active) return left.active ? -1 : 1;
  return left.name.localeCompare(right.name, 'pt-BR');
}

function compareStockBoms(
  left: Bom & { product?: Product | null },
  right: Bom & { product?: Product | null }
) {
  const leftName = left.product?.name || left.name || '';
  const rightName = right.product?.name || right.name || '';
  const leftOrder = OFFICIAL_BROA_ORDER_BY_NAME.get(normalizeLookupText(leftName)) ?? 99;
  const rightOrder = OFFICIAL_BROA_ORDER_BY_NAME.get(normalizeLookupText(rightName)) ?? 99;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return leftName.localeCompare(rightName, 'pt-BR');
}

function hasBomQuantityValue(value: string | number | null | undefined) {
  if (value == null) return false;
  return String(value).trim() !== '';
}

function getPrimaryBomQuantityField(item: BomQuantityCarrier) {
  if (hasBomQuantityValue(item.qtyPerSaleUnit)) return 'qtyPerSaleUnit' as const;
  if (hasBomQuantityValue(item.qtyPerUnit)) return 'qtyPerUnit' as const;
  if (hasBomQuantityValue(item.qtyPerRecipe)) return 'qtyPerRecipe' as const;
  return 'qtyPerSaleUnit' as const;
}

function getPrimaryBomQuantityValue(item: BomQuantityCarrier) {
  const field = getPrimaryBomQuantityField(item);
  return item[field] ?? '';
}

function StockPageContent() {
  const searchParams = useSearchParams();
  const { isSpotlightSlot } = useTutorialSpotlight(searchParams, TUTORIAL_QUERY_VALUE);
  const bomSectionRef = useRef<HTMLDivElement | null>(null);
  const technicalCatalogDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const productCatalogDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const bomCatalogDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const ingredientDrawerDialogRef = useRef<HTMLDivElement | null>(null);
  const ingredientDrawerCloseRef = useRef<HTMLButtonElement | null>(null);
  const operationalLoadRef = useRef<Promise<boolean> | null>(null);
  const technicalCatalogLoadRef = useRef<Promise<void> | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<InventoryOverviewItem[]>([]);
  const [massSummary, setMassSummary] = useState<InventoryMassSummary>(EMPTY_MASS_SUMMARY);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [boms, setBoms] = useState<BomCatalogRecord[]>([]);
  const [editingItemId, setEditingItemId] = useState<number | ''>('');
  const [showIngredientEditor, setShowIngredientEditor] = useState(false);
  const [isIngredientDrawerEditing, setIsIngredientDrawerEditing] = useState(false);
  const [inventoryItemForm, setInventoryItemForm] = useState<InventoryItemFormState>(
    EMPTY_INVENTORY_ITEM_FORM
  );
  const [isSavingInventoryItem, setIsSavingInventoryItem] = useState(false);
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [showProductEditor, setShowProductEditor] = useState(false);
  const [productForm, setProductForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM);
  const [productPriceInput, setProductPriceInput] = useState<string>('0,00');
  const [productSalesLimitBoxesInput, setProductSalesLimitBoxesInput] = useState<string>('');
  const [companionProductIdentityForm, setCompanionProductIdentityForm] =
    useState<CompanionProductIdentityFormState>(EMPTY_COMPANION_PRODUCT_IDENTITY_FORM);
  const [companionQtyPerSaleUnitInput, setCompanionQtyPerSaleUnitInput] = useState<string>('');
  const [companionInventoryForm, setCompanionInventoryForm] = useState<CompanionInventoryFormState>(
    EMPTY_COMPANION_INVENTORY_FORM
  );
  const [productImageFile, setProductImageFile] = useState<File | null>(null);
  const [productImagePreviewUrl, setProductImagePreviewUrl] = useState<string>('');
  const [isSavingProduct, setIsSavingProduct] = useState(false);

  const [editingBomId, setEditingBomId] = useState<number | null>(null);
  const [showBomEditor, setShowBomEditor] = useState(false);
  const [bomProductId, setBomProductId] = useState<number | ''>('');
  const [bomName, setBomName] = useState<string>('');
  const [bomSaleUnitLabel, setBomSaleUnitLabel] = useState<string>('Caixa com 7 broas');
  const [bomYieldUnits, setBomYieldUnits] = useState<string>('21');
  const [bomItems, setBomItems] = useState<BomItemInput[]>([]);
  const [stockPlanning, setStockPlanning] = useState<StockPlanningResponse>(EMPTY_STOCK_PLANNING);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasLoadedTechnicalCatalog, setHasLoadedTechnicalCatalog] = useState(false);
  const [showInactiveTechnicalEntries, setShowInactiveTechnicalEntries] = useState(false);
  const [isRefreshingPurchaseCosts, setIsRefreshingPurchaseCosts] = useState(false);
  const [purchaseCostRefreshResponse, setPurchaseCostRefreshResponse] =
    useState<PurchaseCostRefreshResponse | null>(null);
  const { isOperationMode } = useSurfaceMode('estoque', { defaultMode: 'operation' });
  const [movementsLoadedMode, setMovementsLoadedMode] = useState<'preview' | 'full'>(
    isOperationMode ? 'preview' : 'full'
  );
  const [isApplyingPriceBaseline, setIsApplyingPriceBaseline] = useState(false);
  const [priceBaselineResponse, setPriceBaselineResponse] =
    useState<PriceBaselineResearchResponse | null>(null);
  const [isMovementHistoryOpen, setIsMovementHistoryOpen] = useState(!isOperationMode);
  const [isTechnicalCatalogOpen, setIsTechnicalCatalogOpen] = useState(!isOperationMode);
  const { confirm, notifyError, notifyInfo, notifySuccess, notifyUndo } = useFeedback();
  const deferredItems = useDeferredValue(items);
  const deferredMovements = useDeferredValue(movements);
  const deferredProducts = useDeferredValue(products);
  const deferredBoms = useDeferredValue(boms);
  const deferredStockPlanning = useDeferredValue(stockPlanning);
  const technicalCatalogQueryTarget = searchParams.get('bomProductId') || searchParams.get('productId') || '';
  const shouldRenderTechnicalCatalog =
    !isOperationMode || isTechnicalCatalogOpen || showProductEditor || showBomEditor;
  const shouldLoadTechnicalCatalog = shouldRenderTechnicalCatalog || Boolean(technicalCatalogQueryTarget);
  const shouldPauseStockAutoRefresh =
    showIngredientEditor || showProductEditor || showBomEditor || isSavingInventoryItem || isSavingProduct;
  const companionProductProfileDraft = buildCompanionProductProfileFromForm(companionProductIdentityForm);
  const companionProductNamePreview = buildCompanionProductName(companionProductProfileDraft);

  useEffect(() => {
    if (!isOperationMode) {
      setIsMovementHistoryOpen(true);
      setIsTechnicalCatalogOpen(true);
    }
  }, [isOperationMode]);

  const fetchWithRetry = useCallback(async <T,>(path: string, attempts = 2): Promise<T> => {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await apiFetch<T>(path);
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await wait(250);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Falha ao carregar ${path}.`);
  }, []);

  const loadOperationalData = useCallback(
    async (options?: { forceFullMovements?: boolean; includePriceBoard?: boolean }) => {
      if (operationalLoadRef.current) return operationalLoadRef.current;

      const shouldFetchFullMovements = options?.forceFullMovements || !isOperationMode || isMovementHistoryOpen;
      const movementPath = shouldFetchFullMovements ? '/inventory-movements' : '/inventory-movements?limit=6';

      const request = (async () => {
        try {
          const requests: Array<Promise<unknown>> = [
            fetchWithRetry<InventoryOverviewResponse>('/inventory-overview'),
            fetchWithRetry<InventoryMovement[]>(movementPath),
            fetchWithRetry<StockPlanningResponse>('/production/stock-planning')
          ];

          const [overviewData, movementsData, planningData] = await Promise.all(requests);

          startTransition(() => {
            setItems((overviewData as InventoryOverviewResponse).items || []);
            setMassSummary((overviewData as InventoryOverviewResponse).mass || EMPTY_MASS_SUMMARY);
            setMovements((movementsData as InventoryMovement[]) || []);
            setStockPlanning((planningData as StockPlanningResponse) || EMPTY_STOCK_PLANNING);
            setMovementsLoadedMode(shouldFetchFullMovements ? 'full' : 'preview');
            setLoadError(null);
          });
          return true;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Não foi possível atualizar a tela de estoque.';
          setLoadError(message);
          return false;
        } finally {
          operationalLoadRef.current = null;
        }
      })();

      operationalLoadRef.current = request;
      return request;
    },
    [fetchWithRetry, isMovementHistoryOpen, isOperationMode]
  );

  const loadTechnicalCatalog = useCallback(async () => {
    if (technicalCatalogLoadRef.current) return technicalCatalogLoadRef.current;

    const request = (async () => {
      try {
        const [productsData, bomsData] = await Promise.all([
          fetchWithRetry<Product[]>('/inventory-products'),
          fetchWithRetry<BomCatalogRecord[]>('/boms')
        ]);

        startTransition(() => {
          setProducts([...productsData].sort(compareStockProducts));
          setBoms([...bomsData].sort(compareStockBoms));
          setHasLoadedTechnicalCatalog(true);
          setLoadError(null);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha ao recarregar produtos/BOM.';
        setLoadError(`Estoque atualizado, mas o catálogo técnico não recarregou agora. ${message}`);
      } finally {
        technicalCatalogLoadRef.current = null;
      }
    })();

    technicalCatalogLoadRef.current = request;
    return request;
  }, [fetchWithRetry]);

  const load = useCallback(async () => {
    const operationalLoaded = await loadOperationalData();
    if (!operationalLoaded) return false;
    if (shouldLoadTechnicalCatalog) {
      await loadTechnicalCatalog();
    }
    return true;
  }, [loadOperationalData, loadTechnicalCatalog, shouldLoadTechnicalCatalog]);

  const refreshOperationalOnly = useCallback(
    async (options?: { forceFullMovements?: boolean; includePriceBoard?: boolean }) =>
      loadOperationalData(options),
    [loadOperationalData]
  );

  const refreshTechnicalOnly = useCallback(async () => {
    if (!shouldLoadTechnicalCatalog && !hasLoadedTechnicalCatalog) return true;
    await loadTechnicalCatalog();
    return true;
  }, [hasLoadedTechnicalCatalog, loadTechnicalCatalog, shouldLoadTechnicalCatalog]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!shouldLoadTechnicalCatalog || hasLoadedTechnicalCatalog) return;
    void loadTechnicalCatalog();
  }, [hasLoadedTechnicalCatalog, loadTechnicalCatalog, shouldLoadTechnicalCatalog]);

  useEffect(() => {
    if (!isMovementHistoryOpen || movementsLoadedMode === 'full') return;
    void loadOperationalData({ forceFullMovements: true });
  }, [isMovementHistoryOpen, loadOperationalData, movementsLoadedMode]);

  useEffect(() => {
    const focus = consumeFocusQueryParam(searchParams);
    if (!focus) return;

    const allowed = new Set([
      'kpis',
      'ops',
      'movement',
      'bom',
      'packaging',
      'balance',
      'movements'
    ]);
    if (!allowed.has(focus)) return;

    if (focus === 'bom') {
      setIsTechnicalCatalogOpen(true);
      if (technicalCatalogDetailsRef.current) technicalCatalogDetailsRef.current.open = true;
      if (bomCatalogDetailsRef.current) bomCatalogDetailsRef.current.open = true;
      scrollToLayoutSlot('bom', {
        focus: true,
        focusSelector: 'summary, button, input, select, textarea'
      });
      return;
    }

    if (focus === 'packaging' || focus === 'balance') {
      scrollToLayoutSlot('movement', {
        focus: true,
        focusSelector: 'button, summary'
      });
      return;
    }

    scrollToLayoutSlot(focus, {
      focus: focus === 'movement' || focus === 'bom' || focus === 'packaging' || focus === 'ops',
      focusSelector: 'input, select, textarea, button'
    });
  }, [searchParams]);

  useEffect(() => {
    if (shouldPauseStockAutoRefresh) return;

    const refreshMs = 30_000;
    const refreshVisibleData = () => {
      if (document.visibilityState !== 'visible') return;
      if (shouldPauseStockAutoRefresh) return;
      void loadOperationalData();
    };
    const intervalId = window.setInterval(refreshVisibleData, refreshMs);
    document.addEventListener('visibilitychange', refreshVisibleData);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshVisibleData);
    };
  }, [loadOperationalData, shouldPauseStockAutoRefresh]);

  useEffect(
    () => () => {
      if (productImagePreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(productImagePreviewUrl);
      }
    },
    [productImagePreviewUrl]
  );

  const parseRequiredNumber = (raw: string | number | null | undefined, fieldLabel: string) => {
    const parsed = parseLocaleNumber(raw);
    if (parsed === null || parsed < 0) {
      notifyError(`${fieldLabel} inválido. Use número (ex.: 10,99 ou 10.99).`);
      return null;
    }
    return parsed;
  };

  const parseOptionalNumber = (
    raw: string | number | null | undefined,
    fieldLabel: string,
    line?: number
  ) => {
    if (raw == null) return null;
    const value = typeof raw === 'string' ? raw.trim() : String(raw);
    if (!value) return null;

    const parsed = parseLocaleNumber(value);
    if (parsed === null || parsed < 0) {
      const prefix = line ? `Linha ${line}: ` : '';
      notifyError(`${prefix}${fieldLabel} inválido. Use número (ex.: 10,99 ou 10.99).`);
      return undefined;
    }
    return parsed;
  };

  const parseOptionalInteger = (raw: string | number | null | undefined, fieldLabel: string) => {
    const parsed = parseOptionalNumber(raw, fieldLabel);
    if (parsed === undefined || parsed === null) return parsed;
    if (!Number.isInteger(parsed)) {
      notifyError(`${fieldLabel} inválido. Use número inteiro.`);
      return undefined;
    }
    return parsed;
  };

  const removeMovement = async (id: number) => {
    const movementToRestore = movements.find((entry) => entry.id === id);
    const accepted = await confirm({
      title: 'Remover movimentação?',
      description: 'Essa ação exclui o registro selecionado.',
      confirmLabel: 'Remover',
      cancelLabel: 'Cancelar',
      danger: true
    });
    if (!accepted) return;
    try {
      await apiFetch(`/inventory-movements/${id}`, { method: 'DELETE' });
      await refreshOperationalOnly({ forceFullMovements: isMovementHistoryOpen, includePriceBoard: false });
      if (movementToRestore) {
        const itemName =
          itemMap.get(movementToRestore.itemId)?.name || `Item ${movementToRestore.itemId}`;
        notifyUndo(`Movimentação removida: ${itemName}.`, async () => {
          await apiFetch('/inventory-movements', {
            method: 'POST',
            body: JSON.stringify({
              itemId: movementToRestore.itemId,
              quantity: movementToRestore.quantity,
              type: movementToRestore.type,
              reason: movementToRestore.reason || undefined,
              orderId: movementToRestore.orderId || undefined
            })
          });
          await refreshOperationalOnly({ forceFullMovements: true, includePriceBoard: false });
          notifySuccess('Movimentação restaurada com sucesso.');
          scrollToLayoutSlot('movements');
        });
      } else {
        notifySuccess('Movimentação removida com sucesso.');
      }
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Não foi possível remover a movimentação.');
    }
  };

  const clearAllMovements = async () => {
    const accepted = await confirm({
      title: 'Limpar todas as movimentações do estoque?',
      description:
        'Essa ação apaga todo o histórico de movimentações de insumos e produtos. Os itens e fichas técnicas permanecem, mas os saldos derivados serão recalculados a partir de zero.',
      confirmLabel: 'Limpar tudo',
      cancelLabel: 'Cancelar',
      danger: true
    });
    if (!accepted) return;

    try {
      const result = await apiFetch<{
        inventoryMovementsDeleted: number;
        stockMovementsDeleted: number;
        totalDeleted: number;
      }>('/inventory-movements', { method: 'DELETE' });
      await refreshOperationalOnly({ forceFullMovements: isMovementHistoryOpen, includePriceBoard: false });
      notifySuccess(
        `Histórico limpo: ${result.totalDeleted} movimentação(ões) removida(s).`
      );
      scrollToLayoutSlot('movements');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Não foi possível limpar as movimentações.');
    }
  };

  const startCreateIngredientEditor = useCallback(() => {
    setShowIngredientEditor(true);
    setIsIngredientDrawerEditing(true);
    setEditingItemId('');
    setInventoryItemForm(EMPTY_INVENTORY_ITEM_FORM);
  }, []);

  const startEditItem = useCallback((item: InventoryOverviewItem, options?: { editing?: boolean }) => {
    setShowIngredientEditor(true);
    setIsIngredientDrawerEditing(options?.editing ?? false);
    setEditingItemId(item.id!);
    setInventoryItemForm(buildInventoryItemFormState(item));
  }, []);

  const resetIngredientEditor = useCallback(() => {
    setShowIngredientEditor(false);
    setIsIngredientDrawerEditing(false);
    setEditingItemId('');
    setInventoryItemForm(EMPTY_INVENTORY_ITEM_FORM);
  }, []);

  useDialogA11y({
    isOpen: showIngredientEditor,
    dialogRef: ingredientDrawerDialogRef,
    onClose: resetIngredientEditor,
    initialFocusRef: ingredientDrawerCloseRef
  });

  const saveInventoryItem = async (event?: FormEvent) => {
    event?.preventDefault();
    if (isSavingInventoryItem) return;
    const isEditing = editingItemId !== '';

    if (!inventoryItemForm.name || inventoryItemForm.name.trim().length < 2) {
      notifyError('Informe um nome válido para o item.');
      return;
    }

    if (!inventoryItemForm.unit || inventoryItemForm.unit.trim().length < 1) {
      notifyError('Informe a unidade do item.');
      return;
    }
    const parsedBalance = parseRequiredNumber(inventoryItemForm.balance, 'Saldo atual');
    if (parsedBalance === null) return;

    const parsedPackSize = parseRequiredNumber(inventoryItemForm.purchasePackSize, 'Tamanho do pacote');
    if (parsedPackSize === null) return;
    if (parsedPackSize <= 0) {
      notifyError('Tamanho do pacote deve ser maior que zero.');
      return;
    }

    const parsedPackCost = parseRequiredNumber(inventoryItemForm.purchasePackCost, 'Custo de compra');
    if (parsedPackCost === null) return;

    const parsedLeadTimeDays = parseOptionalInteger(inventoryItemForm.leadTimeDays, 'Lead time');
    if (parsedLeadTimeDays === undefined) return;
    const parsedSafetyStockQty = parseOptionalNumber(inventoryItemForm.safetyStockQty, 'Estoque de seguranca');
    if (parsedSafetyStockQty === undefined) return;
    const parsedReorderPointQty = parseOptionalNumber(inventoryItemForm.reorderPointQty, 'Ponto de reposição');
    if (parsedReorderPointQty === undefined) return;
    const parsedTargetStockQty = parseOptionalNumber(inventoryItemForm.targetStockQty, 'Estoque ideal');
    if (parsedTargetStockQty === undefined) return;
    const parsedPerishabilityDays = parseOptionalInteger(
      inventoryItemForm.perishabilityDays,
      'Validade operacional'
    );
    if (parsedPerishabilityDays === undefined) return;
    if (
      parsedTargetStockQty != null &&
      parsedReorderPointQty != null &&
      parsedTargetStockQty + 0.0001 < parsedReorderPointQty
    ) {
      notifyError('Estoque ideal não pode ser menor que o ponto de reposição.');
      return;
    }

    setIsSavingInventoryItem(true);
    try {
      const savedItem = await apiFetch<InventoryItem>(
        isEditing ? `/inventory-items/${editingItemId}` : '/inventory-items',
        {
          method: isEditing ? 'PUT' : 'POST',
          body: JSON.stringify({
            name: inventoryItemForm.name.trim(),
            category: inventoryItemForm.category,
            unit: inventoryItemForm.unit.trim(),
            purchasePackSize: parsedPackSize,
            purchasePackCost: parsedPackCost,
            sourceName: inventoryItemForm.sourceName.trim() || null,
            sourceUrl: inventoryItemForm.sourceUrl.trim() || null,
            leadTimeDays: parsedLeadTimeDays,
            safetyStockQty: parsedSafetyStockQty,
            reorderPointQty: parsedReorderPointQty,
            targetStockQty: parsedTargetStockQty,
            perishabilityDays: parsedPerishabilityDays,
            criticality: inventoryItemForm.criticality ? inventoryItemForm.criticality : null,
            preferredSupplier: inventoryItemForm.preferredSupplier.trim() || null
          })
        }
      );

      const nextBalance = roundInventoryQty(parsedBalance);
      const previousBalance = roundInventoryQty(editingInventoryItem?.balance || 0);
      if (!isEditing || Math.abs(previousBalance - nextBalance) >= 0.0001) {
        await apiFetch(`/inventory-items/${savedItem.id}/effective-balance`, {
          method: 'POST',
          body: JSON.stringify({
            quantity: nextBalance,
            reason: isEditing
              ? 'Ajuste via gaveta do item no Estoque.'
              : 'Saldo inicial definido na criação do item.'
          })
        });
      }

      setShowIngredientEditor(true);
      setIsIngredientDrawerEditing(false);
      setEditingItemId(savedItem.id ?? '');
      setInventoryItemForm(
        buildInventoryItemFormState({
          name: savedItem.name ?? inventoryItemForm.name.trim(),
          category: savedItem.category ?? inventoryItemForm.category,
          unit: savedItem.unit ?? inventoryItemForm.unit.trim(),
          balance: nextBalance,
          purchasePackSize: savedItem.purchasePackSize ?? parsedPackSize,
          purchasePackCost: savedItem.purchasePackCost ?? parsedPackCost,
          sourceName: inventoryItemForm.sourceName.trim() || null,
          sourceUrl: inventoryItemForm.sourceUrl.trim() || null,
          leadTimeDays: savedItem.leadTimeDays ?? parsedLeadTimeDays ?? null,
          safetyStockQty: savedItem.safetyStockQty ?? parsedSafetyStockQty ?? null,
          reorderPointQty: savedItem.reorderPointQty ?? parsedReorderPointQty ?? null,
          targetStockQty: savedItem.targetStockQty ?? parsedTargetStockQty ?? null,
          perishabilityDays: savedItem.perishabilityDays ?? parsedPerishabilityDays ?? null,
          criticality: savedItem.criticality ?? (inventoryItemForm.criticality || null),
          preferredSupplier: savedItem.preferredSupplier ?? (inventoryItemForm.preferredSupplier.trim() || null)
        })
      );
      await refreshOperationalOnly({ forceFullMovements: isMovementHistoryOpen });
      notifySuccess(
        isEditing
          ? 'Item atualizado.'
          : 'Item criado.'
      );
    } catch (err) {
      notifyError(
        err instanceof Error
          ? err.message
          : isEditing
            ? 'Não foi possível atualizar o item.'
            : 'Não foi possível criar o ingrediente.'
      );
    } finally {
      setIsSavingInventoryItem(false);
    }
  };

  const refreshPurchaseCosts = async () => {
    if (isRefreshingPurchaseCosts) return;
    setIsRefreshingPurchaseCosts(true);
    try {
      const result = await apiFetch<PurchaseCostRefreshResponse>('/inventory-items/refresh-purchase-costs', {
        method: 'POST'
      });
      setPurchaseCostRefreshResponse(result);
      await refreshOperationalOnly({ forceFullMovements: isMovementHistoryOpen, includePriceBoard: true });

      notifySuccess(
        `Precos atualizados: ${result.totals.updatedSourceCount} online, ${result.totals.fallbackSourceCount} manual.`
      );
      if (result.totals.skippedSourceCount > 0) {
        notifyInfo(`${result.totals.skippedSourceCount} fonte(s) ficaram sem item correspondente no estoque.`);
      }
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Não foi possível atualizar os preços online.');
    } finally {
      setIsRefreshingPurchaseCosts(false);
    }
  };

  const applyPriceResearchBaseline = async () => {
    if (isApplyingPriceBaseline) return;
    setIsApplyingPriceBaseline(true);
    try {
      const result = await apiFetch<PriceBaselineResearchResponse>('/inventory-items/research-price-baseline', {
        method: 'POST'
      });
      setPriceBaselineResponse(result);
      await refreshOperationalOnly({ forceFullMovements: isMovementHistoryOpen, includePriceBoard: true });
      notifySuccess(`Baseline historica aplicada desde ${new Date(result.firstOrderAt).toLocaleDateString('pt-BR')}.`);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Não foi possível aplicar a baseline de preços.');
    } finally {
      setIsApplyingPriceBaseline(false);
    }
  };

  const removeItem = async (id: number) => {
    const accepted = await confirm({
      title: 'Remover item do estoque?',
      description: 'Essa ação exclui o item e seus vínculos podem impedir a remoção.',
      confirmLabel: 'Remover',
      cancelLabel: 'Cancelar',
      danger: true
    });
    if (!accepted) return;
    try {
      await apiFetch(`/inventory-items/${id}`, { method: 'DELETE' });
      if (editingItemId === id) {
        resetIngredientEditor();
      }
      await refreshOperationalOnly({ forceFullMovements: isMovementHistoryOpen });
      notifySuccess('Item removido do estoque.');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Não foi possível remover o item.');
    }
  };

  const resetProductForm = useCallback(() => {
    setEditingProductId(null);
    setShowProductEditor(false);
    setProductForm(EMPTY_PRODUCT_FORM);
    setProductPriceInput('0,00');
    setProductSalesLimitBoxesInput('');
    setCompanionProductIdentityForm(EMPTY_COMPANION_PRODUCT_IDENTITY_FORM);
    setCompanionQtyPerSaleUnitInput('');
    setCompanionInventoryForm(EMPTY_COMPANION_INVENTORY_FORM);
    setProductImageFile(null);
    setProductImagePreviewUrl('');
  }, []);

  const startEditProduct = useCallback((product: Product) => {
    setIsTechnicalCatalogOpen(true);
    if (technicalCatalogDetailsRef.current) technicalCatalogDetailsRef.current.open = true;
    if (productCatalogDetailsRef.current) productCatalogDetailsRef.current.open = true;
    setShowProductEditor(true);
    setEditingProductId(product.id ?? null);
    setProductForm({
      name: product.name,
      category: product.category ?? 'Sabores',
      unit: product.unit ?? 'unidade',
      imageUrl: product.imageUrl ?? null,
      active: product.active,
      salesLimitEnabled: product.salesLimitEnabled === true,
      salesLimitBoxes: product.salesLimitBoxes ?? null,
      drawerNote: stripCompanionProductProfileFromDrawerNote(product.drawerNote) ?? null
    });
    setCompanionProductIdentityForm(
      buildCompanionProductIdentityFormState({
        name: product.name,
        drawerNote: product.drawerNote
      })
    );
    setProductPriceInput(formatMoneyInputBR(product.price ?? 0) || '0,00');
    setProductSalesLimitBoxesInput(
      typeof product.salesLimitBoxes === 'number' && product.salesLimitBoxes > 0
        ? String(product.salesLimitBoxes)
        : ''
    );
    setCompanionQtyPerSaleUnitInput(
      product.inventoryQtyPerSaleUnit != null
        ? formatDecimalInputBR(product.inventoryQtyPerSaleUnit, {
            maxFractionDigits: 4
          }) || ''
        : ''
    );
    setCompanionInventoryForm(
      buildCompanionInventoryFormState(
        product.companionInventory
          ? {
              ...product.companionInventory,
              criticality:
                product.companionInventory.criticality === 'BAIXA' ||
                product.companionInventory.criticality === 'MEDIA' ||
                product.companionInventory.criticality === 'ALTA' ||
                product.companionInventory.criticality === 'CRITICA'
                  ? product.companionInventory.criticality
                  : null
            }
          : undefined
      )
    );
    setProductImageFile(null);
    setProductImagePreviewUrl(product.imageUrl || '');
    scrollToLayoutSlot('bom', { focus: true, focusSelector: 'input, select, textarea, button' });
    bomSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const resetBomEditor = useCallback(() => {
    setEditingBomId(null);
    setShowBomEditor(false);
    setBomProductId('');
    setBomName('');
    setBomSaleUnitLabel('Caixa com 7 broas');
    setBomYieldUnits('');
    setBomItems([]);
  }, []);

  const handleProductImageSelection = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;

    setProductImageFile(file);
    setProductImagePreviewUrl(URL.createObjectURL(file));
  }, []);

  const saveProduct = async (event?: FormEvent) => {
    event?.preventDefault();
    if (isSavingProduct) return;

    const isCompanionProduct = isCompanionProductCategoryValue(productForm.category);
    const companionProductProfile = isCompanionProduct
      ? buildCompanionProductProfileFromForm(companionProductIdentityForm)
      : null;
    const normalizedProductName = isCompanionProduct
      ? buildCompanionProductName(companionProductProfile)
      : productForm.name.trim();

    if (!normalizedProductName || normalizedProductName.trim().length < 2) {
      notifyError('Informe um nome válido para o produto.');
      return;
    }

    const parsedPrice = parseRequiredNumber(productPriceInput, 'Preco de venda');
    if (parsedPrice === null) return;
    const parsedSalesLimitBoxes = productForm.salesLimitEnabled
      ? Math.max(Math.floor(Number(productSalesLimitBoxesInput) || 0), 0)
      : null;
    if (productForm.salesLimitEnabled && (!parsedSalesLimitBoxes || parsedSalesLimitBoxes <= 0)) {
      notifyError('Informe um limite válido em caixas para ativar a limitação.');
      return;
    }
    if (!editingProductId && !productImageFile && !productForm.imageUrl && !canonicalProductImageUrl) {
      notifyError('Envie uma imagem para criar o produto.');
      return;
    }

    const parsedCompanionQtyPerSaleUnit = isCompanionProduct
      ? parseRequiredNumber(companionQtyPerSaleUnitInput, 'Consumo por unidade vendida')
      : null;
    if (isCompanionProduct && parsedCompanionQtyPerSaleUnit === null) return;
    const parsedCompanionBalance = isCompanionProduct
      ? parseRequiredNumber(companionInventoryForm.balance, 'Saldo atual')
      : null;
    if (isCompanionProduct && parsedCompanionBalance === null) return;
    const parsedCompanionPackSize = isCompanionProduct
      ? parseRequiredNumber(companionInventoryForm.purchasePackSize, 'Tamanho do pack')
      : null;
    if (isCompanionProduct && parsedCompanionPackSize === null) return;
    const parsedCompanionPackCost = isCompanionProduct
      ? parseRequiredNumber(companionInventoryForm.purchasePackCost, 'Preco do pack')
      : null;
    if (isCompanionProduct && parsedCompanionPackCost === null) return;
    const parsedCompanionLeadTimeDays = isCompanionProduct
      ? parseOptionalInteger(companionInventoryForm.leadTimeDays, 'Lead time')
      : null;
    if (isCompanionProduct && parsedCompanionLeadTimeDays === undefined) return;
    const parsedCompanionSafetyStockQty = isCompanionProduct
      ? parseOptionalNumber(companionInventoryForm.safetyStockQty, 'Estoque de seguranca')
      : null;
    if (isCompanionProduct && parsedCompanionSafetyStockQty === undefined) return;
    const parsedCompanionReorderPointQty = isCompanionProduct
      ? parseOptionalNumber(companionInventoryForm.reorderPointQty, 'Ponto de reposição')
      : null;
    if (isCompanionProduct && parsedCompanionReorderPointQty === undefined) return;
    const parsedCompanionTargetStockQty = isCompanionProduct
      ? parseOptionalNumber(companionInventoryForm.targetStockQty, 'Estoque ideal')
      : null;
    if (isCompanionProduct && parsedCompanionTargetStockQty === undefined) return;
    const parsedCompanionPerishabilityDays = isCompanionProduct
      ? parseOptionalInteger(companionInventoryForm.perishabilityDays, 'Perecibilidade')
      : null;
    if (isCompanionProduct && parsedCompanionPerishabilityDays === undefined) return;
    const normalizedCompanionStockUnit = isCompanionProduct
      ? companionInventoryForm.unit.trim().toLowerCase()
      : '';
    if (isCompanionProduct && !normalizedCompanionStockUnit) {
      notifyError('Informe a unidade do estoque do produto.');
      return;
    }
    const safeCompanionQtyPerSaleUnit = parsedCompanionQtyPerSaleUnit ?? 0;
    const safeCompanionBalance = parsedCompanionBalance ?? 0;
    const safeCompanionPackSize = parsedCompanionPackSize ?? 0;
    const safeCompanionPackCost = parsedCompanionPackCost ?? 0;

    setIsSavingProduct(true);
    try {
      let nextImageUrl = canonicalProductImageUrl || productForm.imageUrl || null;
      if (!canonicalProductImageUrl && productImageFile) {
        const formData = new FormData();
        formData.append('file', productImageFile);
        const uploadResult = await apiFetch<{ imageUrl: string }>('/inventory-products/image-upload', {
          method: 'POST',
          body: formData
        });
        nextImageUrl = uploadResult.imageUrl || null;
      }

      const payload = {
        name: normalizedProductName,
        category: productForm.category?.trim() || '',
        unit: productForm.unit?.trim() || 'unidade',
        imageUrl: nextImageUrl,
        active: productForm.active,
        drawerNote: isCompanionProduct
          ? mergeCompanionProductProfileIntoDrawerNote(
              String(productForm.drawerNote || '').trim() || null,
              companionProductProfile,
            )
          : null,
        inventoryQtyPerSaleUnit: isCompanionProduct
          ? Math.round((safeCompanionQtyPerSaleUnit + Number.EPSILON) * 10000) / 10000
          : null,
        companionInventory: isCompanionProduct
          ? {
              balance: Math.round((safeCompanionBalance + Number.EPSILON) * 10000) / 10000,
              unit: normalizedCompanionStockUnit,
              purchasePackSize:
                Math.round((safeCompanionPackSize + Number.EPSILON) * 10000) / 10000,
              purchasePackCost:
                Math.round((safeCompanionPackCost + Number.EPSILON) * 100) / 100,
              sourceName: companionInventoryForm.sourceName.trim() || null,
              sourceUrl: companionInventoryForm.sourceUrl.trim() || null,
              leadTimeDays: parsedCompanionLeadTimeDays,
              safetyStockQty: parsedCompanionSafetyStockQty,
              reorderPointQty: parsedCompanionReorderPointQty,
              targetStockQty: parsedCompanionTargetStockQty,
              perishabilityDays: parsedCompanionPerishabilityDays,
              criticality: companionInventoryForm.criticality || null,
              preferredSupplier: companionInventoryForm.preferredSupplier.trim() || null
            }
          : null,
        salesLimitEnabled: productForm.salesLimitEnabled === true,
        salesLimitBoxes: productForm.salesLimitEnabled ? parsedSalesLimitBoxes : null,
        price: Math.round(parsedPrice * 100) / 100
      };

      if (editingProductId) {
        await apiFetch(`/inventory-products/${editingProductId}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        await apiFetch('/inventory-products', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }

      resetProductForm();
      await refreshTechnicalOnly();
      notifySuccess(
        editingProductId
          ? 'Produto atualizado dentro do Estoque.'
          : isCompanionProduct
            ? 'Produto criado com estoque direto.'
            : 'Produto criado com a ficha base da Broa Tradicional.'
      );
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Não foi possível salvar o produto.');
    } finally {
      setIsSavingProduct(false);
    }
  };

  const removeProduct = async (id: number) => {
    const productToRestore = products.find((entry) => entry.id === id);
    const accepted = await confirm({
      title: 'Remover produto do catálogo?',
      description:
        'Se houver pedidos, movimentos ou ficha vinculada, o produto será apenas desativado para não interferir na operação.',
      confirmLabel: 'Remover',
      cancelLabel: 'Cancelar',
      danger: true
    });
    if (!accepted) return;

    try {
      const result = await apiFetch<{ archived?: boolean; deleted?: boolean }>(
        `/inventory-products/${id}`,
        {
          method: 'DELETE'
        }
      );

      if (result?.archived) {
        if (editingProductId === id) resetProductForm();
        notifyInfo('Produto desativado porque já participa de pedidos, movimentos ou ficha técnica.');
      } else if (result?.deleted) {
        if (editingProductId === id) resetProductForm();
        if (productToRestore) {
          notifyUndo(`Produto ${productToRestore.name} removido do catálogo.`, async () => {
            await apiFetch('/inventory-products', {
              method: 'POST',
              body: JSON.stringify({
                name: productToRestore.name,
                category: productToRestore.category ?? '',
                unit: productToRestore.unit ?? 'unidade',
                imageUrl: productToRestore.imageUrl ?? null,
                price: productToRestore.price ?? 0,
                active: productToRestore.active ?? true
              })
            });
            await refreshTechnicalOnly();
            notifySuccess('Produto restaurado com sucesso.');
          });
        } else {
          notifySuccess('Produto removido do catálogo.');
        }
      }

      await refreshTechnicalOnly();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Não foi possível remover o produto.');
    }
  };

  const startEditBom = useCallback((bom: BomCatalogRecord, shouldScroll = true) => {
    setIsTechnicalCatalogOpen(true);
    if (technicalCatalogDetailsRef.current) technicalCatalogDetailsRef.current.open = true;
    if (bomCatalogDetailsRef.current) bomCatalogDetailsRef.current.open = true;
    setShowBomEditor(true);
    setEditingBomId(bom.id);
    setBomProductId(bom.productId);
    setBomName(bom.name || '');
    setBomSaleUnitLabel(bom.saleUnitLabel || '');
    setBomYieldUnits(String(bom.yieldUnits ?? ''));
    const items = (bom.items || []).map((item) => ({
      itemId: item.itemId,
      qtyPerRecipe: item.qtyPerRecipe == null ? '' : String(item.qtyPerRecipe),
      qtyPerSaleUnit: item.qtyPerSaleUnit == null ? '' : String(item.qtyPerSaleUnit),
      qtyPerUnit: item.qtyPerUnit == null ? '' : String(item.qtyPerUnit)
    }));
    setBomItems(items);
    if (shouldScroll) {
      scrollToLayoutSlot('bom', { focus: true, focusSelector: 'input, select, textarea, button' });
      bomSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const startBomForProduct = useCallback((productId: number, shouldScroll = true) => {
    const product = products.find((entry) => entry.id === productId);
    if (!product) {
      throw new Error('Produto não encontrado.');
    }
    if (isCompanionProductCategoryValue(product.category)) {
      throw new Error('Amigas da Broa usa estoque direto no proprio produto.');
    }

    const existingBom = boms.find((entry) => entry.productId === productId);
    if (existingBom) {
      startEditBom(existingBom, shouldScroll);
      return;
    }

    setIsTechnicalCatalogOpen(true);
    if (technicalCatalogDetailsRef.current) technicalCatalogDetailsRef.current.open = true;
    if (bomCatalogDetailsRef.current) bomCatalogDetailsRef.current.open = true;
    setShowBomEditor(true);
    setEditingBomId(null);
    setBomProductId(product.id ?? '');
    setBomName(product.name || '');
    setBomSaleUnitLabel('Caixa com 7 broas');
    setBomYieldUnits('');
    setBomItems([]);
    if (shouldScroll) {
      scrollToLayoutSlot('bom', { focus: true, focusSelector: 'input, select, textarea, button' });
      bomSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [boms, products, startEditBom]);

  const openTechnicalCatalog = useCallback((section: 'product' | 'bom' | 'items' = 'product') => {
    setIsTechnicalCatalogOpen(true);
    if (technicalCatalogDetailsRef.current) {
      technicalCatalogDetailsRef.current.open = true;
    }

    if (section === 'product') {
      setShowProductEditor(true);
      if (productCatalogDetailsRef.current) {
        productCatalogDetailsRef.current.open = true;
      }
    }
    if (section === 'bom') {
      setShowBomEditor(true);
      if (bomCatalogDetailsRef.current) {
        bomCatalogDetailsRef.current.open = true;
      }
    }
    if (section === 'items') {
      startCreateIngredientEditor();
    }

    const slotId = section === 'items' ? 'packaging' : 'bom';
    scrollToLayoutSlot(slotId, {
      focus: true,
      focusSelector: 'summary, button, input, select, textarea'
    });
    if (section !== 'items') {
      bomSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [startCreateIngredientEditor]);

  useEffect(() => {
    const raw = technicalCatalogQueryTarget;
    if (!raw) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      clearQueryParams(['bomProductId', 'productId']);
      return;
    }
    if (!hasLoadedTechnicalCatalog) return;

    try {
      startBomForProduct(parsed, true);
      clearQueryParams(['bomProductId', 'productId']);
    } catch (error) {
      clearQueryParams(['bomProductId', 'productId']);
      notifyError(error instanceof Error ? error.message : 'Não foi possível abrir a ficha técnica.');
    }
  }, [hasLoadedTechnicalCatalog, notifyError, startBomForProduct, technicalCatalogQueryTarget]);

  const addBomItem = () => {
    setBomItems((prev) => [...prev, { itemId: '', qtyPerRecipe: '', qtyPerSaleUnit: '', qtyPerUnit: '' }]);
  };

  const updateBomItem = (index: number, patch: Partial<BomItemInput>) => {
    setBomItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const removeBomItem = (index: number) => {
    const removed = bomItems[index];
    if (!removed) return;
    setBomItems((prev) => prev.filter((_, i) => i !== index));
    const itemName = removed.itemId ? itemMap.get(Number(removed.itemId))?.name || `Item ${removed.itemId}` : 'Insumo';
    notifyUndo(`${itemName} removido da ficha técnica em edição.`, () => {
      setBomItems((prev) => {
        const safeIndex = Math.min(index, prev.length);
        const next = [...prev];
        next.splice(safeIndex, 0, removed);
        return next;
      });
    });
  };

  const saveBom = async () => {
    if (!bomProductId || Number(bomProductId) <= 0) {
      notifyError('Selecione um produto para a ficha técnica.');
      scrollToLayoutSlot('bom', { focus: true, focusSelector: 'select, input, button' });
      return;
    }

    const inferredBomName =
      bomName.trim() ||
      products.find((entry) => entry.id === Number(bomProductId))?.name?.trim() ||
      '';

    if (!inferredBomName) {
      notifyError('Informe o nome da ficha técnica.');
      scrollToLayoutSlot('bom', { focus: true, focusSelector: 'input, select, button' });
      return;
    }

    const parsedYieldUnits = parseOptionalNumber(bomYieldUnits, 'Rendimento em unidades');
    if (parsedYieldUnits === undefined) return;

    const parsedItems = [];
    for (const [index, item] of bomItems.entries()) {
      if (!item.itemId) continue;

      const qtyPerRecipe = parseOptionalNumber(item.qtyPerRecipe, 'Qtd por receita', index + 1);
      if (qtyPerRecipe === undefined) return;

      const qtyPerSaleUnit = parseOptionalNumber(item.qtyPerSaleUnit, 'Qtd. por caixa', index + 1);
      if (qtyPerSaleUnit === undefined) return;

      const qtyPerUnit = parseOptionalNumber(item.qtyPerUnit, 'Qtd por unidade', index + 1);
      if (qtyPerUnit === undefined) return;

      parsedItems.push({
        itemId: Number(item.itemId),
        qtyPerRecipe,
        qtyPerSaleUnit,
        qtyPerUnit
      });
    }

    const payload = {
      productId: Number(bomProductId),
      name: inferredBomName,
      saleUnitLabel: bomSaleUnitLabel || null,
      yieldUnits: parsedYieldUnits,
      items: parsedItems
    };

    try {
      if (editingBomId) {
        await apiFetch(`/boms/${editingBomId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/boms', { method: 'POST', body: JSON.stringify(payload) });
      }
      resetBomEditor();
      await refreshTechnicalOnly();
      notifySuccess(editingBomId ? 'Ficha técnica atualizada com sucesso.' : 'Ficha técnica criada com sucesso.');
      scrollToLayoutSlot('bom');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Não foi possível salvar a ficha técnica.');
    }
  };

  const removeBom = async (id: number) => {
    const accepted = await confirm({
      title: 'Remover ficha técnica?',
      description: 'Essa ação exclui a BOM selecionada.',
      confirmLabel: 'Remover',
      cancelLabel: 'Cancelar',
      danger: true
    });
    if (!accepted) return;
    try {
      await apiFetch(`/boms/${id}`, { method: 'DELETE' });
      if (editingBomId === id) {
        resetBomEditor();
      }
      await refreshOperationalOnly({ forceFullMovements: isMovementHistoryOpen, includePriceBoard: false });
      notifySuccess('Ficha técnica removida com sucesso.');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Não foi possível remover a ficha técnica.');
    }
  };

  const canSaveBom = Boolean(
    bomProductId &&
      (
        bomName.trim().length > 0 ||
        products.find((entry) => entry.id === Number(bomProductId))?.name?.trim()
      )
  );

  const itemMap = useMemo(() => {
    const map = new Map<number, InventoryOverviewItem>();
    for (const item of deferredItems) {
      map.set(item.id!, item);
      for (const rawItemId of item.rawItemIds || []) {
        map.set(rawItemId, item);
      }
    }
    return map;
  }, [deferredItems]);

  const editingInventoryItem = useMemo(
    () => (editingItemId ? items.find((item) => item.id === editingItemId) ?? null : null),
    [editingItemId, items]
  );

  const editingProduct = useMemo(
    () =>
      showProductEditor || !isOperationMode
        ? editingProductId
          ? products.find((product) => product.id === editingProductId) ?? null
          : null
        : null,
    [editingProductId, isOperationMode, products, showProductEditor]
  );

  const canonicalProductImageUrl = useMemo(
    () => resolveCanonicalCatalogProductImage(productForm.name, productForm.category),
    [productForm.category, productForm.name]
  );
  const displayedProductImagePreviewUrl = canonicalProductImageUrl || productImagePreviewUrl;

  const technicalCatalogStats = useMemo(() => {
    const activeProductIds = new Set<number>();
    let activeProductCount = 0;
    let inactiveProductCount = 0;
    for (const product of deferredProducts) {
      if (!isTechnicalCatalogProduct(product)) continue;
      if (product.active) {
        activeProductCount += 1;
        if (product.id) activeProductIds.add(product.id);
      } else {
        inactiveProductCount += 1;
      }
    }

    let activeBomCount = 0;
    for (const bom of deferredBoms) {
      if (Boolean(bom.product?.active) || activeProductIds.has(bom.productId)) {
        activeBomCount += 1;
      }
    }

    return {
      activeProductCount,
      inactiveProductCount,
      activeBomCount,
      inactiveBomCount: Math.max(0, deferredBoms.length - activeBomCount),
      activeProductIds
    };
  }, [deferredBoms, deferredProducts]);

  const visibleProducts = useMemo(() => {
    if (!shouldRenderTechnicalCatalog) return [];
    return deferredProducts.filter(
      (product) =>
        isTechnicalCatalogProduct(product) && (showInactiveTechnicalEntries || Boolean(product.active))
    );
  }, [deferredProducts, shouldRenderTechnicalCatalog, showInactiveTechnicalEntries]);
  const bomEligibleProducts = useMemo(
    () => visibleProducts.filter((product) => !isCompanionProductCategoryValue(product.category)),
    [visibleProducts]
  );
  const visibleBoms = useMemo(() => {
    if (!shouldRenderTechnicalCatalog) return [];
    return showInactiveTechnicalEntries
      ? deferredBoms
      : deferredBoms.filter(
          (bom) =>
            Boolean(bom.product?.active) || technicalCatalogStats.activeProductIds.has(bom.productId)
        );
  }, [deferredBoms, shouldRenderTechnicalCatalog, showInactiveTechnicalEntries, technicalCatalogStats.activeProductIds]);
  const bomByProductId = useMemo(() => {
    const map = new Map<number, BomCatalogRecord>();
    for (const bom of visibleBoms) {
      if (!map.has(bom.productId)) {
        map.set(bom.productId, bom);
      }
    }
    return map;
  }, [visibleBoms]);
  const visibleTechnicalCatalogEntries = useMemo(
    () =>
      visibleProducts.map((product) => ({
        product,
        bom: product.id ? bomByProductId.get(product.id) || null : null
      })),
    [bomByProductId, visibleProducts]
  );

  const purchaseSuggestions = useMemo(
    () => deferredStockPlanning.purchaseSuggestions || [],
    [deferredStockPlanning.purchaseSuggestions]
  );
  const riskyOrders = useMemo(
    () => (deferredStockPlanning.orderRisks || []).filter((order) => order.level !== 'OK'),
    [deferredStockPlanning.orderRisks]
  );
  const planningShortageByItemId = useMemo(
    () => new Map((deferredStockPlanning.shortageItems || []).map((item) => [item.itemId, item])),
    [deferredStockPlanning.shortageItems]
  );
  const purchaseHeadline = purchaseSuggestions[0] || null;
  const drawerPlanningItem = editingInventoryItem
    ? planningShortageByItemId.get(editingInventoryItem.id!) || null
    : null;
  const planningWarningsPreview = useMemo(
    () => (deferredStockPlanning.bomWarnings || []).slice(0, 4),
    [deferredStockPlanning.bomWarnings]
  );
  const cancelIngredientDrawerEditing = useCallback(() => {
    if (editingInventoryItem) {
      setInventoryItemForm(buildInventoryItemFormState(editingInventoryItem));
      setIsIngredientDrawerEditing(false);
      return;
    }
    resetIngredientEditor();
  }, [editingInventoryItem, resetIngredientEditor]);

  const stockBoardCards = useMemo(() => {
    return deferredItems
      .map((item) => {
        return {
          item,
          balance: roundInventoryQty(item.balance || 0),
        } satisfies StockBoardCard;
      })
      .sort((left, right) => left.item.name.localeCompare(right.item.name, 'pt-BR'));
  }, [deferredItems]);
  const recentMovements = useMemo(() => deferredMovements.slice(0, 6), [deferredMovements]);
  const shouldRenderMovementHistory = !isOperationMode || isMovementHistoryOpen;
  const renderIngredientDrawerField = useCallback(
    (
      label: string,
      readValue: string,
      input: ReactNode,
      options?: { wide?: boolean; url?: string | null }
    ) => (
      <label
        className={`inventory-item-drawer__field${options?.wide ? ' inventory-item-drawer__field--wide' : ''}`}
      >
        <span className="inventory-item-drawer__label">{label}</span>
        {isIngredientDrawerEditing ? (
          input
        ) : options?.url ? (
          <a
            href={options.url}
            target="_blank"
            rel="noreferrer"
            className="inventory-item-drawer__value inventory-item-drawer__value--link"
          >
            {readValue || '—'}
          </a>
        ) : (
          <span className="inventory-item-drawer__value">{readValue || '—'}</span>
        )}
      </label>
    ),
    [isIngredientDrawerEditing]
  );

  return (
    <>
      <BuilderLayoutProvider page="estoque">
        <section className="stock-page grid gap-6">
          <BuilderLayoutItemSlot
            id="ops"
            className={isSpotlightSlot('ops') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'}
          >
            <div className="app-panel grid gap-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="grid gap-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
                    1. Resumo do dia
                  </p>
                  <h2 className="text-xl font-semibold text-neutral-900">
                    Radar do estoque
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="app-button app-button-primary"
                    onClick={startCreateIngredientEditor}
                  >
                    Novo item
                  </button>
                  <button
                    type="button"
                    className="app-button app-button-ghost"
                    onClick={() => openTechnicalCatalog('product')}
                  >
                    Abrir catálogo técnico
                  </button>
                </div>
              </div>

              {loadError ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {loadError}
                </div>
              ) : null}

              <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-white/70 bg-white/75 p-3 md:p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
                    Comprar hoje
                  </p>
                  <p className="mt-2 text-lg font-semibold text-neutral-900">
                    {deferredStockPlanning.summary.purchaseSuggestionsCount} item(ns)
                  </p>
                  <p className="text-sm text-neutral-600">
                    {purchaseHeadline
                      ? `${purchaseHeadline.name} • comprar ${formatQty(purchaseHeadline.recommendedPurchaseQty)} ${purchaseHeadline.unit}`
                      : 'Nenhuma compra urgente sugerida agora'}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/70 bg-white/75 p-3 md:p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
                    Produzir hoje
                  </p>
                  <p className="mt-2 text-lg font-semibold text-neutral-900">
                    +{formatQty(deferredStockPlanning.productionAction.plannedPrepBroas)} broa(s)
                  </p>
                  <p className="text-sm text-neutral-600">
                    {deferredStockPlanning.productionAction.targetDate
                      ? `${formatShortDateBR(deferredStockPlanning.productionAction.targetDate)} pede ${formatQty(
                          deferredStockPlanning.productionAction.requiredBroas
                        )} broa(s)`
                      : 'Sem janela futura carregada'}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/70 bg-white/75 p-3 md:p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
                    Pedidos em risco
                  </p>
                  <p className="mt-2 text-lg font-semibold text-neutral-900">
                    {deferredStockPlanning.summary.riskyOrdersCount} pedido(s)
                  </p>
                  <p className="text-sm text-neutral-600">
                    {deferredStockPlanning.summary.criticalOrdersCount} critico(s) no horizonte aberto
                  </p>
                </div>
                <div className="rounded-2xl border border-white/70 bg-white/75 p-3 md:p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
                    BOM quebrada
                  </p>
                  <p className="mt-2 text-lg font-semibold text-neutral-900">
                    {deferredStockPlanning.summary.bomWarningsCount} alerta(s)
                  </p>
                  <p className="text-sm text-neutral-600">
                    {planningWarningsPreview[0]
                      ? planningWarningsPreview[0].productName
                      : 'Sem alerta agora'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-white/80 bg-white/70 px-2 py-1 text-neutral-700">
                  Massa pronta: {formatQty(massSummary.recipesAvailable)} receita(s)
                </span>
                <span className="rounded-full border border-white/80 bg-white/70 px-2 py-1 text-neutral-700">
                  Potencial total: {formatQty(massSummary.totalPotentialRecipes)} receita(s)
                </span>
                <span className="rounded-full border border-white/80 bg-white/70 px-2 py-1 text-neutral-700">
                  Possivel pelos ingredientes: {formatQty(massSummary.recipesPossibleFromIngredients)} receita(s)
                </span>
                {massSummary.limitingIngredientName ? (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
                    Gargalo atual: {massSummary.limitingIngredientName}
                  </span>
                ) : null}
                {recentMovements[0] ? (
                  <span className="rounded-full border border-white/80 bg-white/70 px-2 py-1 text-neutral-700">
                    Ultimo movimento: {itemMap.get(recentMovements[0].itemId)?.name || `Item ${recentMovements[0].itemId}`}
                  </span>
                ) : null}
              </div>

              <div className="grid gap-3 xl:grid-cols-3">
                <article className="rounded-2xl border border-white/70 bg-white/70 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-neutral-900">Compra sugerida</h3>
                    </div>
                    <span className="rounded-full border border-white/80 bg-white/80 px-2 py-1 text-[11px] text-neutral-700">
                      {purchaseSuggestions.length} item(ns)
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm">
                    {purchaseSuggestions.slice(0, 4).map((item) => (
                      <div key={`purchase-${item.itemId}`} className="rounded-2xl border border-white/70 bg-white/80 px-3 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-neutral-900">{item.name}</p>
                            <p className="text-xs text-neutral-600">
                              Projetado: {formatQty(item.projectedBalance)} {item.unit}
                              {item.preferredSupplier ? ` • ${item.preferredSupplier}` : ''}
                            </p>
                          </div>
                          <span className={`rounded-full border px-2 py-1 text-[11px] font-medium ${planningRiskBadgeClass(item.level)}`}>
                            {planningRiskLabel(item.level)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-neutral-700">
                          Comprar {formatQty(item.recommendedPurchaseQty)} {item.unit}
                          {item.targetStockQty != null ? ` para voltar ao ideal ${formatQty(item.targetStockQty)}` : ''}
                        </p>
                      </div>
                    ))}
                    {purchaseSuggestions.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/70 bg-white/65 px-3 py-4 text-xs text-neutral-500">
                        Nenhum item abaixo do ponto de reposição agora.
                      </div>
                    ) : null}
                  </div>
                </article>

                <article className="rounded-2xl border border-white/70 bg-white/70 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-neutral-900">Pedidos em risco</h3>
                    </div>
                    <span className="rounded-full border border-white/80 bg-white/80 px-2 py-1 text-[11px] text-neutral-700">
                      {riskyOrders.length} pedido(s)
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm">
                    {riskyOrders.slice(0, 4).map((order) => (
                      <div key={`risk-${order.orderId}`} className="rounded-2xl border border-white/70 bg-white/80 px-3 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-neutral-900">
                              #{order.orderPublicNumber || order.orderId} • {order.customerName}
                            </p>
                            <p className="text-xs text-neutral-600">
                              {formatShortDateBR(order.targetDate)}
                              {order.highlightedItems.length ? ` • ${order.highlightedItems.join(' • ')}` : ''}
                            </p>
                          </div>
                          <span className={`rounded-full border px-2 py-1 text-[11px] font-medium ${planningRiskBadgeClass(order.level)}`}>
                            {planningRiskLabel(order.level)}
                          </span>
                        </div>
                      </div>
                    ))}
                    {riskyOrders.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/70 bg-white/65 px-3 py-4 text-xs text-neutral-500">
                        Nenhum pedido aberto com risco de abastecimento agora.
                      </div>
                    ) : null}
                  </div>
                </article>

                <article className="rounded-2xl border border-white/70 bg-white/70 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-neutral-900">BOM e preparo</h3>
                    </div>
                    <span className="rounded-full border border-white/80 bg-white/80 px-2 py-1 text-[11px] text-neutral-700">
                      {deferredStockPlanning.summary.bomWarningsCount} BOM
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm">
                    <div className="rounded-2xl border border-white/70 bg-white/80 px-3 py-2">
                      <p className="font-medium text-neutral-900">
                        Preparar +{formatQty(deferredStockPlanning.productionAction.plannedPrepBroas)} broa(s)
                      </p>
                      <p className="text-xs text-neutral-600">
                        Cobertura atual: {formatQty(deferredStockPlanning.productionAction.availableBroas)} /{' '}
                        {formatQty(deferredStockPlanning.productionAction.requiredBroas)} broa(s)
                      </p>
                    </div>
                    {planningWarningsPreview.map((warning, index) => (
                      <div key={`planning-warning-${warning.orderId}-${warning.productId}-${index}`} className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2">
                        <p className="font-medium text-amber-900">
                          Pedido #{warning.orderPublicNumber || warning.orderId} • {warning.productName}
                        </p>
                        <p className="text-xs text-amber-800">{warning.message}</p>
                      </div>
                    ))}
                    {planningWarningsPreview.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/70 bg-white/65 px-3 py-4 text-xs text-neutral-500">
                        Nenhuma ficha quebrada nos pedidos abertos agora.
                      </div>
                    ) : null}
                  </div>
                </article>
              </div>
            </div>
          </BuilderLayoutItemSlot>

          <BuilderLayoutItemSlot id="movement">
            <div className="app-panel">
              <div className="mass-prep-stock-grid">
                {stockBoardCards.map((card) => {
                  const stockItemId = card.item.id!;
                  const planningItem = planningShortageByItemId.get(stockItemId) || null;
                  const tone = planningRiskTone(planningItem?.level);

                  return (
                    <button
                      type="button"
                      key={`stock-card-${stockItemId}`}
                      className={`mass-prep-stock-card mass-prep-stock-card--${tone}`}
                      onClick={() => startEditItem(card.item)}
                    >
                      <p className="mass-prep-stock-card__category">
                        {inventoryCategoryLabel(card.item.category)}
                      </p>
                      <h4 className="mass-prep-stock-card__name">{card.item.name}</h4>
                      <p className="mass-prep-stock-card__metric">
                        Saldo atual: {formatQty(card.balance)} {card.item.unit}
                      </p>
                      <p className="mass-prep-stock-card__metric">
                        Projetado: {formatQty(planningItem?.projectedBalance ?? card.balance)} {card.item.unit}
                      </p>
                      {(planningItem?.reorderPointQty ?? card.item.reorderPointQty) != null ? (
                        <p className="mass-prep-stock-card__meta">
                          Reposicao: {formatQty(planningItem?.reorderPointQty ?? card.item.reorderPointQty ?? 0)}{' '}
                          {card.item.unit}
                        </p>
                      ) : null}
                      {planningItem ? (
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                          <span className={`rounded-full border px-2 py-1 ${planningRiskBadgeClass(planningItem.level)}`}>
                            {planningRiskLabel(planningItem.level)}
                          </span>
                          <span className="rounded-full border border-white/80 bg-white/75 px-2 py-1 text-neutral-700">
                            {planningItem.impactedOrdersCount} pedido(s)
                          </span>
                        </div>
                      ) : null}
                      <p className="mass-prep-stock-card__hint">Toque para ver e editar</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </BuilderLayoutItemSlot>

          <BuilderLayoutItemSlot id="movements">
            <div className="app-panel grid gap-3">
              <details
                className="app-details"
                open={isMovementHistoryOpen}
                onToggle={(event) => setIsMovementHistoryOpen(event.currentTarget.open)}
              >
                <summary>Historico de movimentacoes</summary>
                {shouldRenderMovementHistory ? (
                <div className="mt-3 grid gap-3">
                  <div className="app-inline-actions">
                    <button
                      type="button"
                      className="app-button app-button-danger"
                      onClick={clearAllMovements}
                    >
                      Zerar movimentacoes
                    </button>
                  </div>

                  {movements.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/70 bg-white/65 px-4 py-6 text-sm text-neutral-500">
                      Nenhuma movimentação registrada.
                    </div>
                  ) : (
                    movements.map((movement) => (
                      <div key={movement.id} className="app-panel text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            {itemMap.get(movement.itemId)?.name || `Item ${movement.itemId}`} •{' '}
                            {movementTypeLabel(movement.type)} • {formatQty(movement.quantity)}{' '}
                            {itemMap.get(movement.itemId)?.unit || 'un'} •{' '}
                            {formatMovementReason(movement)}
                          </div>
                          <button
                            className="app-button app-button-danger"
                            onClick={() => removeMovement(movement.id!)}
                          >
                            Remover
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                ) : null}
              </details>
            </div>
          </BuilderLayoutItemSlot>

          <BuilderLayoutItemSlot
            id="bom"
            className={isSpotlightSlot('bom') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'}
          >
            <details
              ref={technicalCatalogDetailsRef}
              className="app-details"
              open={isTechnicalCatalogOpen}
              onToggle={(event) => setIsTechnicalCatalogOpen(event.currentTarget.open)}
            >
              <summary>Catálogo Técnico</summary>
              {shouldRenderTechnicalCatalog ? (
              <div className="app-panel mt-2 grid gap-3">
                <div
                  ref={bomSectionRef}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-white/70 bg-white/75 px-4 py-3"
                >
                  <div className="grid gap-1">
                    <h3 className="text-lg font-semibold text-neutral-900">Produtos e ficha basica</h3>
                    <p className="text-sm text-neutral-600">
                      Expanda um produto para ver somente os insumos e a quantidade da ficha técnica.
                    </p>
                    <p className="text-sm text-neutral-500">
                      {visibleProducts.length} produto(s) visivel(is)
                      {!showInactiveTechnicalEntries && technicalCatalogStats.inactiveProductCount > 0
                        ? ` • ${technicalCatalogStats.inactiveProductCount} inativo(s) oculto(s)`
                        : ''}
                      {!showInactiveTechnicalEntries && technicalCatalogStats.inactiveBomCount > 0
                        ? ` • ${technicalCatalogStats.inactiveBomCount} ficha(s) oculta(s)`
                        : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="app-button app-button-primary"
                      onClick={() => {
                        resetProductForm();
                        setShowProductEditor(true);
                        if (technicalCatalogDetailsRef.current) technicalCatalogDetailsRef.current.open = true;
                        scrollToLayoutSlot('bom', {
                          focus: true,
                          focusSelector: 'summary, button, input, select, textarea'
                        });
                        bomSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                    >
                      Novo produto
                    </button>
                    <button
                      type="button"
                      className="app-button app-button-ghost"
                      onClick={() => openTechnicalCatalog('items')}
                    >
                      Novo ingrediente
                    </button>
                    {technicalCatalogStats.inactiveProductCount > 0 ? (
                      <button
                        type="button"
                        className="app-button app-button-ghost"
                        onClick={() => setShowInactiveTechnicalEntries((current) => !current)}
                      >
                        {showInactiveTechnicalEntries
                          ? 'Ocultar inativos'
                          : `Mostrar inativos (${technicalCatalogStats.inactiveProductCount})`}
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-2">
                  {visibleTechnicalCatalogEntries.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/70 bg-white/65 px-4 py-6 text-sm text-neutral-500">
                      {products.length === 0
                        ? 'Nenhum produto cadastrado no catálogo.'
                        : technicalCatalogStats.inactiveProductCount > 0 && !showInactiveTechnicalEntries
                          ? `Nenhum produto ativo visivel agora. ${technicalCatalogStats.inactiveProductCount} inativo(s) oculto(s).`
                          : 'Nenhum produto ativo visível no catálogo.'}
                    </div>
                  ) : (
                    visibleTechnicalCatalogEntries.map(({ product, bom }) => (
                      <details key={product.id} className="app-details">
                        <summary>{product.name}</summary>
                        <div className="mt-2 grid gap-2">
                          {(() => {
                            const isCompanionProduct = isCompanionProductCategoryValue(product.category);
                            return (
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap gap-2 text-xs">
                              <span
                                className={`rounded-full px-2 py-1 font-semibold uppercase tracking-[0.14em] ${
                                  product.active
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-neutral-200 text-neutral-700'
                                }`}
                              >
                                {product.active ? 'Ativo' : 'Inativo'}
                              </span>
                              <span className="rounded-full border border-white/80 bg-white/70 px-2 py-1 text-neutral-700">
                                {isCompanionProduct ? 'Estoque direto' : `${bom?.items?.length || 0} item(ns)`}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="app-button app-button-ghost"
                                onClick={() => startEditProduct(product)}
                              >
                                Editar produto
                              </button>
                              {!isCompanionProduct ? (
                                <button
                                  type="button"
                                  className="app-button app-button-ghost"
                                  onClick={() => {
                                    if (!product.id) return;
                                    void startBomForProduct(product.id);
                                  }}
                                >
                                  {bom ? 'Editar ficha' : 'Criar ficha'}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="app-button app-button-danger"
                                onClick={() => {
                                  if (!product.id) return;
                                  void removeProduct(product.id);
                                }}
                              >
                                Remover
                              </button>
                            </div>
                          </div>
                            );
                          })()}

                          {isCompanionProductCategoryValue(product.category) ? (
                            <div className="rounded-2xl border border-white/70 bg-white/65 px-4 py-5 text-sm text-neutral-600">
                              Estoque e consumo direto configurados no próprio produto.
                            </div>
                          ) : !bom || (bom.items || []).length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-white/70 bg-white/65 px-4 py-5 text-sm text-neutral-500">
                              Nenhuma ficha técnica cadastrada para este produto.
                            </div>
                          ) : (
                            <div className="grid gap-2">
                              {(bom.items || []).map((item) => (
                                <div
                                  key={item.id}
                                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/70 bg-white/70 px-3 py-2"
                                >
                                  <p className="font-medium text-neutral-800">
                                    {item.item?.name || `Item ${item.itemId}`}
                                  </p>
                                  <p className="text-sm font-semibold text-neutral-700">
                                    {getPrimaryBomQuantityValue(item) || '-'} {item.item?.unit || ''}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </details>
                    ))
                  )}
                </div>

                {showProductEditor || !isOperationMode ? (
                  <details ref={productCatalogDetailsRef} className="app-details" open>
                    <summary>{editingProductId ? 'Editar produto' : 'Novo produto'}</summary>
                    <form className="mt-2 grid gap-3 rounded-2xl border border-white/70 bg-white/75 p-3" onSubmit={saveProduct}>
                      <div className="grid gap-3 rounded-2xl border border-white/70 bg-white/70 p-3 md:grid-cols-[120px_minmax(0,1fr)]">
                        <div className="relative aspect-square overflow-hidden rounded-2xl border border-white/80 bg-white/80">
                          {displayedProductImagePreviewUrl ? (
                            <>
                              {/* Blob previews from local uploads do not work reliably with next/image. */}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              alt={
                                (isCompanionProductCategoryValue(productForm.category)
                                  ? companionProductNamePreview
                                  : productForm.name) || 'Preview do produto'
                              }
                              className="h-full w-full object-cover"
                              src={resolveBuilderImageSrc(displayedProductImagePreviewUrl)}
                            />
                            </>
                          ) : (
                            <div className="flex h-full items-center justify-center px-3 text-center text-xs text-neutral-500">
                              Sem imagem
                            </div>
                          )}
                        </div>
                        <div className="grid gap-2">
                          <label className="text-sm font-medium text-neutral-800">
                            {editingProductId ? 'Trocar imagem do produto' : 'Imagem do produto'}
                          </label>
                          <input
                            className="app-input"
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            disabled={Boolean(canonicalProductImageUrl)}
                            onChange={handleProductImageSelection}
                          />
                          {canonicalProductImageUrl ? (
                            <p className="text-xs text-neutral-500">Arte oficial do catálogo.</p>
                          ) : null}
                        </div>
                      </div>
                      <select
                        className="app-select"
                        value={
                          isCompanionProductCategoryValue(productForm.category)
                            ? COMPANION_PRODUCT_CATEGORY_VALUE
                            : 'Sabores'
                        }
                        onChange={(event) =>
                          setProductForm((current) => ({
                            ...current,
                            category: event.target.value,
                            drawerNote: isCompanionProductCategoryValue(event.target.value) ? current.drawerNote : null
                          }))
                        }
                      >
                        <option value="Sabores">Sabores</option>
                        <option value={COMPANION_PRODUCT_CATEGORY_VALUE}>Amigas da Broa</option>
                      </select>
                      {isCompanionProductCategoryValue(productForm.category) ? (
                        <div className="grid gap-3 rounded-2xl border border-white/70 bg-white/70 p-3 md:grid-cols-2">
                          <div className="grid gap-2 md:col-span-2">
                            <label className="text-sm font-medium text-neutral-800">Nome</label>
                            <input
                              className="app-input"
                              placeholder="Ex.: Cafe (torrado e moido)"
                              value={companionProductIdentityForm.title}
                              onChange={(event) =>
                                setCompanionProductIdentityForm((current) => ({
                                  ...current,
                                  title: event.target.value
                                }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <label className="text-sm font-medium text-neutral-800">Sabor</label>
                            <input
                              className="app-input"
                              placeholder="Ex.: Catucai Amarelo 24/137"
                              value={companionProductIdentityForm.flavor}
                              onChange={(event) =>
                                setCompanionProductIdentityForm((current) => ({
                                  ...current,
                                  flavor: event.target.value
                                }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <label className="text-sm font-medium text-neutral-800">Fabricante</label>
                            <input
                              className="app-input"
                              placeholder="Ex.: Fazenda Dona Luiza"
                              value={companionProductIdentityForm.maker}
                              onChange={(event) =>
                                setCompanionProductIdentityForm((current) => ({
                                  ...current,
                                  maker: event.target.value
                                }))
                              }
                            />
                          </div>
                          <div className="grid gap-2 md:col-span-2">
                            <label className="text-sm font-medium text-neutral-800">Origem / local</label>
                            <input
                              className="app-input"
                              placeholder="Ex.: Cambuquira/MG"
                              value={companionProductIdentityForm.origin}
                              onChange={(event) =>
                                setCompanionProductIdentityForm((current) => ({
                                  ...current,
                                  origin: event.target.value
                                }))
                              }
                            />
                          </div>
                        </div>
                      ) : (
                        <input
                          className="app-input"
                          placeholder="Nome do produto"
                          value={productForm.name}
                          onChange={(event) =>
                            setProductForm((current) => ({ ...current, name: event.target.value }))
                          }
                        />
                      )}
                      {isCompanionProductCategoryValue(productForm.category) ? (
                        <div className="grid gap-2 rounded-2xl border border-white/70 bg-white/70 p-3">
                          <label className="text-sm font-medium text-neutral-800">
                            Descrição na gaveta do /pedido
                          </label>
                          <textarea
                            className="app-textarea min-h-[110px]"
                            value={productForm.drawerNote ?? ''}
                            onChange={(event) =>
                              setProductForm((current) => ({ ...current, drawerNote: event.target.value }))
                            }
                            placeholder="Descrição exibida ao abrir o item"
                          />
                        </div>
                      ) : null}
                      {isCompanionProductCategoryValue(productForm.category) ? (
                        <div className="grid gap-3 rounded-2xl border border-white/70 bg-white/70 p-3 md:grid-cols-2">
                          <div className="grid gap-2">
                            <label className="text-sm font-medium text-neutral-800">
                              Consumo por unidade vendida
                            </label>
                            <input
                              className="app-input"
                              inputMode="decimal"
                              placeholder="Ex.: 90"
                              value={companionQtyPerSaleUnitInput}
                              onChange={(event) => setCompanionQtyPerSaleUnitInput(event.target.value)}
                              onBlur={() =>
                                setCompanionQtyPerSaleUnitInput(
                                  formatDecimalInputBR(companionQtyPerSaleUnitInput, {
                                    maxFractionDigits: 4
                                  }) || ''
                                )
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <label className="text-sm font-medium text-neutral-800">Unidade do estoque</label>
                            <input
                              className="app-input"
                              placeholder="Ex.: g, ml, un"
                              value={companionInventoryForm.unit}
                              onChange={(event) =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  unit: event.target.value
                                }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <label className="text-sm font-medium text-neutral-800">Saldo atual</label>
                            <input
                              className="app-input"
                              inputMode="decimal"
                              placeholder="Ex.: 1200"
                              value={companionInventoryForm.balance}
                              onChange={(event) =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  balance: event.target.value
                                }))
                              }
                              onBlur={() =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  balance:
                                    formatDecimalInputBR(current.balance, {
                                      maxFractionDigits: 4
                                    }) || '0'
                                }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <label className="text-sm font-medium text-neutral-800">Tamanho do pack</label>
                            <input
                              className="app-input"
                              inputMode="decimal"
                              placeholder="Ex.: 1000"
                              value={companionInventoryForm.purchasePackSize}
                              onChange={(event) =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  purchasePackSize: event.target.value
                                }))
                              }
                              onBlur={() =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  purchasePackSize:
                                    formatDecimalInputBR(current.purchasePackSize, {
                                      maxFractionDigits: 4
                                    }) || '0'
                                }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <label className="text-sm font-medium text-neutral-800">Preco do pack</label>
                            <input
                              className="app-input"
                              inputMode="decimal"
                              placeholder="Ex.: 24,90"
                              value={companionInventoryForm.purchasePackCost}
                              onChange={(event) =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  purchasePackCost: event.target.value
                                }))
                              }
                              onBlur={() =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  purchasePackCost:
                                    formatMoneyInputBR(current.purchasePackCost || '0') || '0,00'
                                }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <label className="text-sm font-medium text-neutral-800">Loja de preço</label>
                            <input
                              className="app-input"
                              placeholder="Ex.: Pao de Acucar"
                              value={companionInventoryForm.sourceName}
                              onChange={(event) =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  sourceName: event.target.value
                                }))
                              }
                            />
                          </div>
                          <div className="grid gap-2 md:col-span-2">
                            <label className="text-sm font-medium text-neutral-800">URL da loja</label>
                            <input
                              className="app-input"
                              placeholder="Cole o link da loja"
                              value={companionInventoryForm.sourceUrl}
                              onChange={(event) =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  sourceUrl: event.target.value
                                }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <label className="text-sm font-medium text-neutral-800">Lead time</label>
                            <input
                              className="app-input"
                              inputMode="numeric"
                              placeholder="Dias para comprar"
                              value={companionInventoryForm.leadTimeDays}
                              onChange={(event) =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  leadTimeDays: event.target.value
                                }))
                              }
                              onBlur={() =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  leadTimeDays:
                                    formatDecimalInputBR(current.leadTimeDays, {
                                      maxFractionDigits: 0
                                    }) || ''
                                }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <label className="text-sm font-medium text-neutral-800">Estoque de seguranca</label>
                            <input
                              className="app-input"
                              inputMode="decimal"
                              placeholder="Reserva minima"
                              value={companionInventoryForm.safetyStockQty}
                              onChange={(event) =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  safetyStockQty: event.target.value
                                }))
                              }
                              onBlur={() =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  safetyStockQty:
                                    formatDecimalInputBR(current.safetyStockQty, {
                                      maxFractionDigits: 4
                                    }) || ''
                                }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <label className="text-sm font-medium text-neutral-800">Ponto de reposição</label>
                            <input
                              className="app-input"
                              inputMode="decimal"
                              placeholder="Comprar a partir"
                              value={companionInventoryForm.reorderPointQty}
                              onChange={(event) =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  reorderPointQty: event.target.value
                                }))
                              }
                              onBlur={() =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  reorderPointQty:
                                    formatDecimalInputBR(current.reorderPointQty, {
                                      maxFractionDigits: 4
                                    }) || ''
                                }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <label className="text-sm font-medium text-neutral-800">Estoque ideal</label>
                            <input
                              className="app-input"
                              inputMode="decimal"
                              placeholder="Meta apos compra"
                              value={companionInventoryForm.targetStockQty}
                              onChange={(event) =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  targetStockQty: event.target.value
                                }))
                              }
                              onBlur={() =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  targetStockQty:
                                    formatDecimalInputBR(current.targetStockQty, {
                                      maxFractionDigits: 4
                                    }) || ''
                                }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <label className="text-sm font-medium text-neutral-800">Perecibilidade</label>
                            <input
                              className="app-input"
                              inputMode="numeric"
                              placeholder="Dias de validade"
                              value={companionInventoryForm.perishabilityDays}
                              onChange={(event) =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  perishabilityDays: event.target.value
                                }))
                              }
                              onBlur={() =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  perishabilityDays:
                                    formatDecimalInputBR(current.perishabilityDays, {
                                      maxFractionDigits: 0
                                    }) || ''
                                }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <label className="text-sm font-medium text-neutral-800">Criticidade</label>
                            <select
                              className="app-select"
                              value={companionInventoryForm.criticality}
                              onChange={(event) =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  criticality: event.target.value as InventoryCriticality | ''
                                }))
                              }
                            >
                              <option value="">Sem classificação</option>
                              {inventoryCriticalityOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="grid gap-2 md:col-span-2">
                            <label className="text-sm font-medium text-neutral-800">
                              Fornecedor preferencial
                            </label>
                            <input
                              className="app-input"
                              placeholder="Ex.: Mercearia parceira"
                              value={companionInventoryForm.preferredSupplier}
                              onChange={(event) =>
                                setCompanionInventoryForm((current) => ({
                                  ...current,
                                  preferredSupplier: event.target.value
                                }))
                              }
                            />
                          </div>
                        </div>
                      ) : null}
                      <input
                        className="app-input"
                        inputMode="decimal"
                        placeholder="Preco por unidade"
                        value={productPriceInput}
                        onChange={(event) => setProductPriceInput(event.target.value)}
                        onBlur={() => setProductPriceInput(formatMoneyInputBR(productPriceInput) || '0,00')}
                      />
                      <label className="flex items-center gap-2 text-sm text-neutral-700">
                        <input
                          type="checkbox"
                          checked={Boolean(productForm.active)}
                          onChange={(event) =>
                            setProductForm((current) => ({ ...current, active: event.target.checked }))
                          }
                        />
                        Produto ativo
                      </label>
                      <div className="grid gap-2 rounded-2xl border border-white/70 bg-white/70 p-3">
                        <label className="flex items-center gap-2 text-sm text-neutral-700">
                          <input
                            type="checkbox"
                            checked={Boolean(productForm.salesLimitEnabled)}
                            onChange={(event) =>
                              setProductForm((current) => ({
                                ...current,
                                salesLimitEnabled: event.target.checked,
                                salesLimitBoxes: event.target.checked ? current.salesLimitBoxes : null
                              }))
                            }
                          />
                          LIMITAR
                        </label>
                        <input
                          className="app-input"
                          inputMode="numeric"
                          placeholder="Quantidade em caixas"
                          value={productSalesLimitBoxesInput}
                          disabled={!productForm.salesLimitEnabled}
                          onChange={(event) => setProductSalesLimitBoxesInput(event.target.value.replace(/[^\d]/g, ''))}
                        />
                        <p className="text-xs text-neutral-500">
                          Quando a quantidade configurada for consumida, o produto será marcado como inativo automaticamente.
                        </p>
                        {editingProduct?.salesLimitEnabled ? (
                          <div className="flex flex-wrap gap-2 text-xs text-neutral-600">
                            <span className="rounded-full border border-white/80 bg-white/80 px-2 py-1">
                              Consumido: {(editingProduct.salesLimitConsumedBoxes ?? 0).toLocaleString('pt-BR', {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 2
                              })} cx
                            </span>
                            <span className="rounded-full border border-white/80 bg-white/80 px-2 py-1">
                              Restante: {(editingProduct.salesLimitRemainingBoxes ?? 0).toLocaleString('pt-BR', {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 2
                              })} cx
                            </span>
                            {editingProduct.salesLimitExhausted ? (
                              <span className="rounded-full bg-rose-100 px-2 py-1 font-semibold text-rose-700">
                                Esgotado
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="app-form-actions">
                        <button type="button" className="app-button app-button-ghost" onClick={resetProductForm}>
                          Cancelar
                        </button>
                        <button type="submit" className="app-button app-button-primary" disabled={isSavingProduct}>
                          {isSavingProduct
                            ? 'Salvando...'
                            : editingProductId
                              ? 'Atualizar produto'
                              : 'Criar produto'}
                        </button>
                      </div>
                    </form>
                  </details>
                ) : null}

                {showBomEditor || !isOperationMode ? (
                  <details ref={bomCatalogDetailsRef} className="app-details" open>
                    <summary>{editingBomId ? 'Editar ficha técnica' : 'Nova ficha técnica'}</summary>
                    <div className="mt-2 grid gap-3 rounded-2xl border border-white/70 bg-white/75 p-3">
                      <select
                        className="app-select"
                        value={bomProductId}
                        onChange={(event) => {
                          const nextProductId = event.target.value ? Number(event.target.value) : '';
                          setBomProductId(nextProductId);
                          if (!nextProductId) {
                            setBomName('');
                            setBomYieldUnits('');
                            return;
                          }
                          const selectedProduct = products.find((entry) => entry.id === nextProductId);
                          setBomName(selectedProduct?.name || '');
                          if (!editingBomId) {
                            setBomYieldUnits('');
                          }
                        }}
                      >
                        <option value="">Produto</option>
                        {bomEligibleProducts.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </select>

                      <div className="grid gap-3">
                        {bomItems.map((item, index) => {
                          const quantityField = getPrimaryBomQuantityField(item);
                          const quantityValue = getPrimaryBomQuantityValue(item);
                          return (
                            <div
                              key={`${item.itemId}-${index}`}
                              className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]"
                            >
                              <select
                                className="app-select"
                                value={item.itemId}
                                onChange={(event) =>
                                  updateBomItem(index, {
                                    itemId: event.target.value ? Number(event.target.value) : ''
                                  })
                                }
                              >
                                <option value="">Item</option>
                                {items.map((inventoryItem) => (
                                  <option key={inventoryItem.id} value={inventoryItem.id}>
                                    {inventoryItem.name}
                                  </option>
                                ))}
                              </select>
                              <input
                                className="app-input"
                                placeholder="Quantidade"
                                value={quantityValue}
                                onChange={(event) =>
                                  updateBomItem(index, {
                                    [quantityField]: event.target.value
                                  } as Partial<BomItemInput>)
                                }
                                onBlur={() =>
                                  updateBomItem(index, {
                                    [quantityField]: formatDecimalInputBR(String(quantityValue || ''), {
                                      maxFractionDigits: 4
                                    })
                                  } as Partial<BomItemInput>)
                                }
                              />
                              <button
                                type="button"
                                className="app-button app-button-danger"
                                onClick={() => removeBomItem(index)}
                              >
                                Remover
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      <div className="app-form-actions app-form-actions--mobile-sticky">
                        <button type="button" className="app-button app-button-ghost" onClick={addBomItem}>
                          Adicionar item
                        </button>
                        <button type="button" className="app-button app-button-ghost" onClick={resetBomEditor}>
                          Cancelar
                        </button>
                        {editingBomId ? (
                          <button
                            type="button"
                            className="app-button app-button-danger"
                            onClick={() => void removeBom(editingBomId)}
                          >
                            Remover ficha
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="app-button app-button-primary disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={saveBom}
                          disabled={!canSaveBom}
                        >
                          {editingBomId ? 'Atualizar ficha técnica' : 'Criar ficha técnica'}
                        </button>
                      </div>
                    </div>
                  </details>
                ) : null}

                <BuilderLayoutItemSlot id="packaging">
                  <div className="app-panel grid gap-3 rounded-[26px] p-4 sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="grid gap-1">
                        <h4 className="text-base font-semibold text-neutral-900">Gestão dos itens</h4>
                        <p className="text-sm text-neutral-600">{items.length} item(ns) ativos no estoque visivel.</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="app-button app-button-primary" onClick={startCreateIngredientEditor}>
                          Novo item
                        </button>
                        <button
                          type="button"
                          className="app-button app-button-ghost"
                          onClick={applyPriceResearchBaseline}
                          disabled={isApplyingPriceBaseline}
                        >
                          {isApplyingPriceBaseline ? 'Aplicando...' : 'Baseline'}
                        </button>
                        <button
                          type="button"
                          className="app-button app-button-ghost"
                          onClick={refreshPurchaseCosts}
                          disabled={isRefreshingPurchaseCosts}
                        >
                          {isRefreshingPurchaseCosts ? 'Atualizando...' : 'Precos online'}
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs">
                      {priceBaselineResponse ? (
                        <span className="rounded-full border border-white/80 bg-white/80 px-2 py-1 text-neutral-700">
                          Baseline: {priceBaselineResponse.results.filter((entry) => entry.status === 'UPDATED').length} familia(s)
                        </span>
                      ) : null}
                      {purchaseCostRefreshResponse ? (
                        <span className="rounded-full border border-white/80 bg-white/80 px-2 py-1 text-neutral-700">
                          Precos: {purchaseCostRefreshResponse.totals.updatedItemCount} item(ns)
                        </span>
                      ) : null}
                    </div>
                  </div>
                </BuilderLayoutItemSlot>
              </div>
              ) : null}
            </details>
          </BuilderLayoutItemSlot>
        </section>
      </BuilderLayoutProvider>
      {showIngredientEditor ? (
        <div className="order-detail-modal" role="presentation" onClick={resetIngredientEditor}>
          <div
            className="order-detail-modal__dialog order-detail-modal__dialog--inventory-item"
            ref={ingredientDrawerDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="inventory-item-drawer-title"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              ref={ingredientDrawerCloseRef}
              type="button"
              className="order-detail-modal__close"
              onClick={resetIngredientEditor}
            >
              Fechar
            </button>
            <div className="app-panel order-detail-modal__panel inventory-item-drawer">
              <div className="inventory-item-drawer__header">
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inventory-item-drawer__eyebrow">
                      {inventoryCategoryLabel(editingInventoryItem?.category || inventoryItemForm.category)}
                    </span>
                    {drawerPlanningItem ? (
                      <span
                        className={`rounded-full border px-2 py-1 text-[11px] font-medium ${planningRiskBadgeClass(drawerPlanningItem.level)}`}
                      >
                        {planningRiskLabel(drawerPlanningItem.level)}
                      </span>
                    ) : null}
                  </div>
                  <h3 id="inventory-item-drawer-title" className="text-[1.35rem] font-semibold tracking-[-0.05em] text-[color:var(--ink-strong)]">
                    {editingInventoryItem?.name || inventoryItemForm.name || 'Novo item'}
                  </h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  {editingInventoryItem ? (
                    <button
                      type="button"
                      className="app-button app-button-ghost"
                      onClick={startCreateIngredientEditor}
                    >
                      Novo item
                    </button>
                  ) : null}
                  {editingInventoryItem && !isIngredientDrawerEditing ? (
                    <button
                      type="button"
                      className="app-button app-button-primary"
                      onClick={() => setIsIngredientDrawerEditing(true)}
                    >
                      Editar
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="inventory-item-drawer__metrics">
                <div className="inventory-item-drawer__metric-card">
                  <span className="inventory-item-drawer__metric-label">Saldo atual</span>
                  <strong className="inventory-item-drawer__metric-value">
                    {formatQty(parseLocaleNumber(inventoryItemForm.balance) ?? 0)} {inventoryItemForm.unit || editingInventoryItem?.unit || 'un'}
                  </strong>
                </div>
                <div className="inventory-item-drawer__metric-card">
                  <span className="inventory-item-drawer__metric-label">Projetado</span>
                  <strong className="inventory-item-drawer__metric-value">
                    {formatQty(drawerPlanningItem?.projectedBalance ?? editingInventoryItem?.balance ?? parseLocaleNumber(inventoryItemForm.balance) ?? 0)}{' '}
                    {editingInventoryItem?.unit || inventoryItemForm.unit || 'un'}
                  </strong>
                </div>
                <div className="inventory-item-drawer__metric-card">
                  <span className="inventory-item-drawer__metric-label">Reposicao</span>
                  <strong className="inventory-item-drawer__metric-value">
                    {(drawerPlanningItem?.reorderPointQty ?? editingInventoryItem?.reorderPointQty) != null
                      ? `${formatQty(drawerPlanningItem?.reorderPointQty ?? editingInventoryItem?.reorderPointQty ?? 0)} ${
                          editingInventoryItem?.unit || inventoryItemForm.unit || 'un'
                        }`
                      : '—'}
                  </strong>
                </div>
              </div>

              <form className="inventory-item-drawer__grid" onSubmit={saveInventoryItem}>
                {renderIngredientDrawerField(
                  'Nome',
                  inventoryItemForm.name,
                  <input
                    className="app-input"
                    placeholder="Ex.: Goiabada cremosa"
                    value={inventoryItemForm.name}
                    onChange={(event) =>
                      setInventoryItemForm((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                )}
                {renderIngredientDrawerField(
                  'Categoria',
                  inventoryCategoryLabel(inventoryItemForm.category),
                  <select
                    className="app-select"
                    value={inventoryItemForm.category}
                    onChange={(event) =>
                      setInventoryItemForm((current) => ({
                        ...current,
                        category: event.target.value as InventoryCategory
                      }))
                    }
                  >
                    {inventoryCategoryOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
                {renderIngredientDrawerField(
                  'Unidade',
                  inventoryItemForm.unit,
                  <input
                    className="app-input"
                    placeholder="g, ml, un"
                    value={inventoryItemForm.unit}
                    onChange={(event) =>
                      setInventoryItemForm((current) => ({ ...current, unit: event.target.value }))
                    }
                  />
                )}
                {renderIngredientDrawerField(
                  'Saldo atual',
                  `${formatQty(parseLocaleNumber(inventoryItemForm.balance) ?? 0)} ${inventoryItemForm.unit || editingInventoryItem?.unit || 'un'}`,
                  <input
                    className="app-input"
                    inputMode="decimal"
                    placeholder="Ex.: 1200"
                    value={inventoryItemForm.balance}
                    onChange={(event) =>
                      setInventoryItemForm((current) => ({ ...current, balance: event.target.value }))
                    }
                    onBlur={() =>
                      setInventoryItemForm((current) => ({
                        ...current,
                        balance:
                          formatDecimalInputBR(current.balance, {
                            maxFractionDigits: 4
                          }) || '0'
                      }))
                    }
                  />
                )}
                {renderIngredientDrawerField(
                  'Pack',
                  `${formatQty(parseLocaleNumber(inventoryItemForm.purchasePackSize) ?? 0)} ${inventoryItemForm.unit || editingInventoryItem?.unit || 'un'}`,
                  <input
                    className="app-input"
                    inputMode="decimal"
                    placeholder="Ex.: 1000"
                    value={inventoryItemForm.purchasePackSize}
                    onChange={(event) =>
                      setInventoryItemForm((current) => ({
                        ...current,
                        purchasePackSize: event.target.value
                      }))
                    }
                    onBlur={() =>
                      setInventoryItemForm((current) => ({
                        ...current,
                        purchasePackSize:
                          formatDecimalInputBR(current.purchasePackSize, {
                            maxFractionDigits: 4
                          }) || '0'
                      }))
                    }
                  />
                )}
                {renderIngredientDrawerField(
                  'Preco do pack',
                  formatCurrencyBR(parseLocaleNumber(inventoryItemForm.purchasePackCost) ?? 0),
                  <input
                    className="app-input"
                    inputMode="decimal"
                    placeholder="Ex.: 24,90"
                    value={inventoryItemForm.purchasePackCost}
                    onChange={(event) =>
                      setInventoryItemForm((current) => ({
                        ...current,
                        purchasePackCost: event.target.value
                      }))
                    }
                    onBlur={() =>
                      setInventoryItemForm((current) => ({
                        ...current,
                        purchasePackCost:
                          formatMoneyInputBR(current.purchasePackCost || '0') || '0,00'
                      }))
                    }
                  />
                )}
                {renderIngredientDrawerField(
                  'Loja de preço',
                  inventoryItemForm.sourceName,
                  <input
                    className="app-input"
                    placeholder="Ex.: Pao de Acucar"
                    value={inventoryItemForm.sourceName}
                    onChange={(event) =>
                      setInventoryItemForm((current) => ({ ...current, sourceName: event.target.value }))
                    }
                  />
                )}
                {renderIngredientDrawerField(
                  'URL da loja',
                  inventoryItemForm.sourceUrl,
                  <input
                    className="app-input"
                    placeholder="Cole o link da loja"
                    value={inventoryItemForm.sourceUrl}
                    onChange={(event) =>
                      setInventoryItemForm((current) => ({ ...current, sourceUrl: event.target.value }))
                    }
                  />,
                  { wide: true, url: inventoryItemForm.sourceUrl.trim() || null }
                )}
                {renderIngredientDrawerField(
                  'Lead time',
                  inventoryItemForm.leadTimeDays ? `${inventoryItemForm.leadTimeDays} dia(s)` : '—',
                  <input
                    className="app-input"
                    inputMode="numeric"
                    placeholder="Dias para comprar"
                    value={inventoryItemForm.leadTimeDays}
                    onChange={(event) =>
                      setInventoryItemForm((current) => ({ ...current, leadTimeDays: event.target.value }))
                    }
                    onBlur={() =>
                      setInventoryItemForm((current) => ({
                        ...current,
                        leadTimeDays:
                          formatDecimalInputBR(current.leadTimeDays, {
                            maxFractionDigits: 0
                          }) || ''
                      }))
                    }
                  />
                )}
                {renderIngredientDrawerField(
                  'Estoque de seguranca',
                  inventoryItemForm.safetyStockQty
                    ? `${formatQty(parseLocaleNumber(inventoryItemForm.safetyStockQty) ?? 0)} ${inventoryItemForm.unit || editingInventoryItem?.unit || 'un'}`
                    : '—',
                  <input
                    className="app-input"
                    inputMode="decimal"
                    placeholder="Reserva minima"
                    value={inventoryItemForm.safetyStockQty}
                    onChange={(event) =>
                      setInventoryItemForm((current) => ({
                        ...current,
                        safetyStockQty: event.target.value
                      }))
                    }
                    onBlur={() =>
                      setInventoryItemForm((current) => ({
                        ...current,
                        safetyStockQty:
                          formatDecimalInputBR(current.safetyStockQty, {
                            maxFractionDigits: 4
                          }) || ''
                      }))
                    }
                  />
                )}
                {renderIngredientDrawerField(
                  'Ponto de reposição',
                  inventoryItemForm.reorderPointQty
                    ? `${formatQty(parseLocaleNumber(inventoryItemForm.reorderPointQty) ?? 0)} ${inventoryItemForm.unit || editingInventoryItem?.unit || 'un'}`
                    : '—',
                  <input
                    className="app-input"
                    inputMode="decimal"
                    placeholder="Comprar a partir"
                    value={inventoryItemForm.reorderPointQty}
                    onChange={(event) =>
                      setInventoryItemForm((current) => ({
                        ...current,
                        reorderPointQty: event.target.value
                      }))
                    }
                    onBlur={() =>
                      setInventoryItemForm((current) => ({
                        ...current,
                        reorderPointQty:
                          formatDecimalInputBR(current.reorderPointQty, {
                            maxFractionDigits: 4
                          }) || ''
                      }))
                    }
                  />
                )}
                {renderIngredientDrawerField(
                  'Estoque ideal',
                  inventoryItemForm.targetStockQty
                    ? `${formatQty(parseLocaleNumber(inventoryItemForm.targetStockQty) ?? 0)} ${inventoryItemForm.unit || editingInventoryItem?.unit || 'un'}`
                    : '—',
                  <input
                    className="app-input"
                    inputMode="decimal"
                    placeholder="Meta apos compra"
                    value={inventoryItemForm.targetStockQty}
                    onChange={(event) =>
                      setInventoryItemForm((current) => ({
                        ...current,
                        targetStockQty: event.target.value
                      }))
                    }
                    onBlur={() =>
                      setInventoryItemForm((current) => ({
                        ...current,
                        targetStockQty:
                          formatDecimalInputBR(current.targetStockQty, {
                            maxFractionDigits: 4
                          }) || ''
                      }))
                    }
                  />
                )}
                {renderIngredientDrawerField(
                  'Validade',
                  inventoryItemForm.perishabilityDays ? `${inventoryItemForm.perishabilityDays} dia(s)` : '—',
                  <input
                    className="app-input"
                    inputMode="numeric"
                    placeholder="Validade em dias"
                    value={inventoryItemForm.perishabilityDays}
                    onChange={(event) =>
                      setInventoryItemForm((current) => ({
                        ...current,
                        perishabilityDays: event.target.value
                      }))
                    }
                    onBlur={() =>
                      setInventoryItemForm((current) => ({
                        ...current,
                        perishabilityDays:
                          formatDecimalInputBR(current.perishabilityDays, {
                            maxFractionDigits: 0
                          }) || ''
                      }))
                    }
                  />
                )}
                {renderIngredientDrawerField(
                  'Criticidade',
                  inventoryItemForm.criticality
                    ? inventoryCriticalityOptions.find((option) => option.value === inventoryItemForm.criticality)?.label || inventoryItemForm.criticality
                    : '—',
                  <select
                    className="app-select"
                    value={inventoryItemForm.criticality}
                    onChange={(event) =>
                      setInventoryItemForm((current) => ({
                        ...current,
                        criticality: event.target.value as InventoryCriticality | ''
                      }))
                    }
                  >
                    <option value="">Selecione</option>
                    {inventoryCriticalityOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
                {renderIngredientDrawerField(
                  'Fornecedor preferencial',
                  inventoryItemForm.preferredSupplier,
                  <input
                    className="app-input"
                    placeholder="Fornecedor padrao"
                    value={inventoryItemForm.preferredSupplier}
                    onChange={(event) =>
                      setInventoryItemForm((current) => ({
                        ...current,
                        preferredSupplier: event.target.value
                      }))
                    }
                  />,
                  { wide: true }
                )}

                <div className="inventory-item-drawer__actions">
                  {editingInventoryItem && isIngredientDrawerEditing ? (
                    <button
                      type="button"
                      className="app-button app-button-danger"
                      onClick={() => {
                        void removeItem(editingInventoryItem.id!);
                      }}
                    >
                      Remover
                    </button>
                  ) : null}
                  {isIngredientDrawerEditing ? (
                    <>
                      <button type="button" className="app-button app-button-ghost" onClick={cancelIngredientDrawerEditing}>
                        Cancelar
                      </button>
                      <button type="submit" className="app-button app-button-primary" disabled={isSavingInventoryItem}>
                        {isSavingInventoryItem
                          ? editingInventoryItem
                            ? 'Salvando...'
                            : 'Criando...'
                          : editingInventoryItem
                            ? 'Salvar item'
                            : 'Criar item'}
                      </button>
                    </>
                  ) : null}
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function StockPage() {
  return (
    <Suspense fallback={null}>
      <StockPageContent />
    </Suspense>
  );
}
