'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent
} from 'react';
import type {
  Bom,
  BomItem as CatalogBomItem,
  InventoryItem,
  InventoryPriceBoardResponse,
  InventoryMovement,
  InventoryMassSummary,
  InventoryOverviewItem,
  InventoryOverviewResponse,
  Product,
  ProductionRequirementRow,
  ProductionRequirementWarning,
  ProductionRequirementsResponse,
} from '@querobroapp/shared';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { resolveBuilderImageSrc } from '@/lib/builder';
import { clearQueryParams, consumeFocusQueryParam, scrollToLayoutSlot } from '@/lib/layout-scroll';
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

const OFFICIAL_BROAS = [
  { code: 'T', name: 'Broa Tradicional (T)', boxPrice: 40 },
  { code: 'G', name: 'Broa Goiabada (G)', boxPrice: 50 },
  { code: 'D', name: 'Broa Doce de Leite (D)', boxPrice: 52 },
  { code: 'Q', name: 'Broa Queijo do Serro (Q)', boxPrice: 52 },
  { code: 'R', name: 'Broa Requeijão de corte (R)', boxPrice: 52 }
] as const;

const EMPTY_PRODUCT_FORM: Pick<Product, 'name' | 'category' | 'unit' | 'active' | 'imageUrl'> = {
  name: '',
  category: 'Sabores',
  unit: 'unidade',
  imageUrl: null,
  active: true
};

type InventoryItemFormState = {
  name: string;
  unit: string;
  purchasePackSize: string;
  purchasePackCost: string;
};

function buildInventoryItemFormState(
  item?: Partial<Pick<InventoryItem, 'name' | 'unit' | 'purchasePackSize' | 'purchasePackCost'>>
): InventoryItemFormState {
  return {
    name: item?.name ?? '',
    unit: item?.unit ?? 'g',
    purchasePackSize:
      formatDecimalInputBR(item?.purchasePackSize ?? 1000, {
        maxFractionDigits: 4
      }) || '0',
    purchasePackCost: formatMoneyInputBR(item?.purchasePackCost ?? 0) || '0,00'
  };
}

const EMPTY_INVENTORY_ITEM_FORM: InventoryItemFormState = buildInventoryItemFormState();

const OFFICIAL_BROA_ORDER_BY_NAME = new Map(
  OFFICIAL_BROAS.map((broa, index) => [normalizeLookupText(broa.name), index])
);

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
  if (!orderLabel) return baseReason || 'Sem observacao';
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

function defaultTomorrowDate() {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.toISOString().slice(0, 10);
}

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
  const inventoryPricesDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const inventoryItemsDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const stockCardPendingActionIdsRef = useRef<Set<number>>(new Set());

  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<InventoryOverviewItem[]>([]);
  const [massSummary, setMassSummary] = useState<InventoryMassSummary>(EMPTY_MASS_SUMMARY);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [boms, setBoms] = useState<BomCatalogRecord[]>([]);
  const [editingItemId, setEditingItemId] = useState<number | ''>('');
  const [showIngredientEditor, setShowIngredientEditor] = useState(false);
  const [inventoryItemForm, setInventoryItemForm] = useState<InventoryItemFormState>(
    EMPTY_INVENTORY_ITEM_FORM
  );
  const [isSavingInventoryItem, setIsSavingInventoryItem] = useState(false);
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [showProductEditor, setShowProductEditor] = useState(false);
  const [productForm, setProductForm] = useState<
    Pick<Product, 'name' | 'category' | 'unit' | 'active' | 'imageUrl'>
  >(
    EMPTY_PRODUCT_FORM
  );
  const [productPriceInput, setProductPriceInput] = useState<string>('0,00');
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
  const [d1Date] = useState<string>(defaultTomorrowDate());
  const [d1Rows, setD1Rows] = useState<ProductionRequirementRow[]>([]);
  const [d1Warnings, setD1Warnings] = useState<ProductionRequirementWarning[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasLoadedTechnicalCatalog, setHasLoadedTechnicalCatalog] = useState(false);
  const [showInactiveTechnicalEntries, setShowInactiveTechnicalEntries] = useState(false);
  const [stockCardBalanceByItemId, setStockCardBalanceByItemId] = useState<Record<number, string>>({});
  const [stockCardErrorByItemId, setStockCardErrorByItemId] = useState<Record<number, string>>({});
  const [stockCardSavingItemId, setStockCardSavingItemId] = useState<number | null>(null);
  const [isRefreshingPurchaseCosts, setIsRefreshingPurchaseCosts] = useState(false);
  const [purchaseCostRefreshResponse, setPurchaseCostRefreshResponse] =
    useState<PurchaseCostRefreshResponse | null>(null);
  const [priceBoard, setPriceBoard] = useState<InventoryPriceBoardResponse | null>(null);
  const [priceInputsByItemId, setPriceInputsByItemId] = useState<Record<number, string>>({});
  const [savingPriceItemId, setSavingPriceItemId] = useState<number | null>(null);
  const [isApplyingPriceBaseline, setIsApplyingPriceBaseline] = useState(false);
  const [priceBaselineResponse, setPriceBaselineResponse] =
    useState<PriceBaselineResearchResponse | null>(null);
  const { isOperationMode } = useSurfaceMode('estoque', { defaultMode: 'operation' });
  const { confirm, notifyError, notifyInfo, notifySuccess, notifyUndo } = useFeedback();

  const load = useCallback(async () => {
    const fetchWithRetry = async <T,>(path: string, attempts = 2): Promise<T> => {
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
    };

    try {
      const [overviewData, movementsData, priceBoardData] = await Promise.all([
        fetchWithRetry<InventoryOverviewResponse>('/inventory-overview'),
        fetchWithRetry<InventoryMovement[]>('/inventory-movements'),
        fetchWithRetry<InventoryPriceBoardResponse>('/inventory-price-board')
      ]);

      setItems(overviewData.items || []);
      setMassSummary(overviewData.mass || EMPTY_MASS_SUMMARY);
      setMovements(movementsData);
      setPriceBoard(priceBoardData);
      setPriceInputsByItemId(
        Object.fromEntries(
          (priceBoardData.items || []).map((entry) => [
            entry.itemId,
            formatMoneyInputBR(entry.purchasePackCost) || '0,00'
          ])
        )
      );

      try {
        const [productsData, bomsData] = await Promise.all([
          fetchWithRetry<Product[]>('/inventory-products'),
          fetchWithRetry<BomCatalogRecord[]>('/boms')
        ]);

        setProducts([...productsData].sort(compareStockProducts));
        setBoms([...bomsData].sort(compareStockBoms));
        setHasLoadedTechnicalCatalog(true);
        setLoadError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha ao recarregar produtos/BOM.';
        setLoadError(`Estoque atualizado, mas o catalogo tecnico nao recarregou agora. ${message}`);
      }

      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Nao foi possivel atualizar a tela de estoque.';
      setLoadError(message);
      return false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      if (technicalCatalogDetailsRef.current) technicalCatalogDetailsRef.current.open = true;
      if (bomCatalogDetailsRef.current) bomCatalogDetailsRef.current.open = true;
      scrollToLayoutSlot('bom', {
        focus: true,
        focusSelector: 'summary, button, input, select, textarea'
      });
      return;
    }

    if (focus === 'packaging' || focus === 'balance') {
      if (technicalCatalogDetailsRef.current) technicalCatalogDetailsRef.current.open = true;
      if (focus === 'packaging' && inventoryPricesDetailsRef.current) {
        inventoryPricesDetailsRef.current.open = true;
      }
      if (inventoryItemsDetailsRef.current) inventoryItemsDetailsRef.current.open = true;
      scrollToLayoutSlot(focus, {
        focus: true,
        focusSelector: 'summary, button, input, select, textarea'
      });
      return;
    }

    scrollToLayoutSlot(focus, {
      focus: focus === 'movement' || focus === 'bom' || focus === 'packaging' || focus === 'ops',
      focusSelector: 'input, select, textarea, button'
    });
  }, [searchParams]);

  const loadD1 = useCallback(async (targetDate: string) => {
    try {
      const data = await apiFetch<ProductionRequirementsResponse>(
        `/production/requirements?date=${encodeURIComponent(targetDate)}`
      );
      setD1Rows(data.rows || []);
      setD1Warnings(data.warnings || []);
    } catch {
      setD1Rows([]);
      setD1Warnings([]);
    }
  }, []);

  useEffect(() => {
    void loadD1(d1Date);
  }, [d1Date, loadD1]);

  useEffect(() => {
    const refreshMs = 30_000;
    const intervalId = window.setInterval(() => {
      void load();
      void loadD1(d1Date);
    }, refreshMs);

    return () => window.clearInterval(intervalId);
  }, [d1Date, load, loadD1]);

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
      notifyError(`${fieldLabel} invalido. Use numero (ex.: 10,99 ou 10.99).`);
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
      notifyError(`${prefix}${fieldLabel} invalido. Use numero (ex.: 10,99 ou 10.99).`);
      return undefined;
    }
    return parsed;
  };

  const removeMovement = async (id: number) => {
    const movementToRestore = movements.find((entry) => entry.id === id);
    const accepted = await confirm({
      title: 'Remover movimentacao?',
      description: 'Essa acao exclui o registro selecionado.',
      confirmLabel: 'Remover',
      cancelLabel: 'Cancelar',
      danger: true
    });
    if (!accepted) return;
    try {
      await apiFetch(`/inventory-movements/${id}`, { method: 'DELETE' });
      await load();
      if (movementToRestore) {
        const itemName =
          itemMap.get(movementToRestore.itemId)?.name || `Item ${movementToRestore.itemId}`;
        notifyUndo(`Movimentacao removida: ${itemName}.`, async () => {
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
          await load();
          notifySuccess('Movimentacao restaurada com sucesso.');
          scrollToLayoutSlot('movements');
        });
      } else {
        notifySuccess('Movimentacao removida com sucesso.');
      }
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel remover a movimentacao.');
    }
  };

  const clearAllMovements = async () => {
    const accepted = await confirm({
      title: 'Limpar todas as movimentacoes do estoque?',
      description:
        'Essa acao apaga todo o historico de movimentacoes de insumos e produtos. Os itens e fichas tecnicas permanecem, mas os saldos derivados serao recalculados a partir de zero.',
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
      await load();
      notifySuccess(
        `Historico limpo: ${result.totalDeleted} movimentacao(oes) removida(s).`
      );
      scrollToLayoutSlot('movements');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel limpar as movimentacoes.');
    }
  };

  const startCreateIngredientEditor = useCallback(() => {
    if (technicalCatalogDetailsRef.current) technicalCatalogDetailsRef.current.open = true;
    if (inventoryItemsDetailsRef.current) inventoryItemsDetailsRef.current.open = true;
    setShowIngredientEditor(true);
    setEditingItemId('');
    setInventoryItemForm(EMPTY_INVENTORY_ITEM_FORM);
  }, []);

  const startEditItem = useCallback((item: InventoryOverviewItem) => {
    if (technicalCatalogDetailsRef.current) technicalCatalogDetailsRef.current.open = true;
    if (inventoryItemsDetailsRef.current) inventoryItemsDetailsRef.current.open = true;
    setShowIngredientEditor(true);
    setEditingItemId(item.id!);
    setInventoryItemForm(buildInventoryItemFormState(item));
  }, []);

  const resetIngredientEditor = useCallback(() => {
    setShowIngredientEditor(false);
    setEditingItemId('');
    setInventoryItemForm(EMPTY_INVENTORY_ITEM_FORM);
  }, []);

  const saveInventoryItem = async (event?: FormEvent) => {
    event?.preventDefault();
    if (isSavingInventoryItem) return;
    const isEditing = editingItemId !== '';

    if (!inventoryItemForm.name || inventoryItemForm.name.trim().length < 2) {
      notifyError('Informe um nome valido para o item.');
      return;
    }

    if (!inventoryItemForm.unit || inventoryItemForm.unit.trim().length < 1) {
      notifyError('Informe a unidade do item.');
      return;
    }

    const parsedPackSize = parseRequiredNumber(inventoryItemForm.purchasePackSize, 'Tamanho do pacote');
    if (parsedPackSize === null) return;
    if (parsedPackSize <= 0) {
      notifyError('Tamanho do pacote deve ser maior que zero.');
      return;
    }

    const parsedPackCost = parseRequiredNumber(inventoryItemForm.purchasePackCost, 'Custo de compra');
    if (parsedPackCost === null) return;

    setIsSavingInventoryItem(true);
    try {
      const savedItem = await apiFetch<InventoryItem>(
        isEditing ? `/inventory-items/${editingItemId}` : '/inventory-items',
        {
          method: isEditing ? 'PUT' : 'POST',
          body: JSON.stringify({
            name: inventoryItemForm.name.trim(),
            ...(isEditing ? {} : { category: 'INGREDIENTE' }),
            unit: inventoryItemForm.unit.trim(),
            purchasePackSize: parsedPackSize,
            purchasePackCost: parsedPackCost
          })
        }
      );

      if (technicalCatalogDetailsRef.current) technicalCatalogDetailsRef.current.open = true;
      if (inventoryItemsDetailsRef.current) inventoryItemsDetailsRef.current.open = true;
      setShowIngredientEditor(true);
      setEditingItemId(savedItem.id ?? '');
      setInventoryItemForm(
        buildInventoryItemFormState({
          name: savedItem.name ?? inventoryItemForm.name.trim(),
          unit: savedItem.unit ?? inventoryItemForm.unit.trim(),
          purchasePackSize: savedItem.purchasePackSize ?? parsedPackSize,
          purchasePackCost: savedItem.purchasePackCost ?? parsedPackCost
        })
      );
      await load();
      notifySuccess(
        isEditing
          ? 'Item atualizado e mantido disponivel nas fichas tecnicas.'
          : 'Ingrediente criado e ja disponivel nas fichas tecnicas.'
      );
      scrollToLayoutSlot('packaging', {
        focus: true,
        focusSelector: 'input, select, textarea, button'
      });
    } catch (err) {
      notifyError(
        err instanceof Error
          ? err.message
          : isEditing
            ? 'Nao foi possivel atualizar o item.'
            : 'Nao foi possivel criar o ingrediente.'
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
      await load();

      notifySuccess(
        `Precos atualizados: ${result.totals.updatedSourceCount} online, ${result.totals.fallbackSourceCount} manual.`
      );
      if (result.totals.skippedSourceCount > 0) {
        notifyInfo(`${result.totals.skippedSourceCount} fonte(s) ficaram sem item correspondente no estoque.`);
      }
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel atualizar os precos online.');
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
      await load();
      notifySuccess(`Baseline historica aplicada desde ${new Date(result.firstOrderAt).toLocaleDateString('pt-BR')}.`);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel aplicar a baseline de precos.');
    } finally {
      setIsApplyingPriceBaseline(false);
    }
  };

  const savePurchasePrice = async (itemId: number) => {
    if (savingPriceItemId) return;
    const raw = priceInputsByItemId[itemId] ?? '';
    const parsed = parseRequiredNumber(raw, 'Preco do pacote');
    if (parsed === null) return;

    setSavingPriceItemId(itemId);
    try {
      await apiFetch(`/inventory-items/${itemId}/purchase-price`, {
        method: 'PUT',
        body: JSON.stringify({
          purchasePackCost: parsed
        })
      });
      await load();
      notifySuccess('Preco de compra atualizado e refletido no COGS.');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel salvar o preco.');
    } finally {
      setSavingPriceItemId(null);
    }
  };

  const removeItem = async (id: number) => {
    const accepted = await confirm({
      title: 'Remover item do estoque?',
      description: 'Essa acao exclui o item e seus vinculos podem impedir a remocao.',
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
      await load();
      notifySuccess('Item removido do estoque.');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel remover o item.');
    }
  };

  const resetProductForm = useCallback(() => {
    setEditingProductId(null);
    setShowProductEditor(false);
    setProductForm(EMPTY_PRODUCT_FORM);
    setProductPriceInput('0,00');
    setProductImageFile(null);
    setProductImagePreviewUrl('');
  }, []);

  const startEditProduct = useCallback((product: Product) => {
    if (technicalCatalogDetailsRef.current) technicalCatalogDetailsRef.current.open = true;
    if (productCatalogDetailsRef.current) productCatalogDetailsRef.current.open = true;
    setShowProductEditor(true);
    setEditingProductId(product.id ?? null);
    setProductForm({
      name: product.name,
      category: product.category ?? 'Sabores',
      unit: product.unit ?? 'unidade',
      imageUrl: product.imageUrl ?? null,
      active: product.active
    });
    setProductPriceInput(formatMoneyInputBR(product.price ?? 0) || '0,00');
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

    if (!productForm.name || productForm.name.trim().length < 2) {
      notifyError('Informe um nome valido para o produto.');
      return;
    }

    const parsedPrice = parseRequiredNumber(productPriceInput, 'Preco de venda');
    if (parsedPrice === null) return;
    if (!editingProductId && !productImageFile && !productForm.imageUrl) {
      notifyError('Envie uma imagem para criar o produto.');
      return;
    }

    setIsSavingProduct(true);
    try {
      let nextImageUrl = productForm.imageUrl ?? null;
      if (productImageFile) {
        const formData = new FormData();
        formData.append('file', productImageFile);
        const uploadResult = await apiFetch<{ imageUrl: string }>('/inventory-products/image-upload', {
          method: 'POST',
          body: formData
        });
        nextImageUrl = uploadResult.imageUrl || null;
      }

      const payload = {
        name: productForm.name.trim(),
        category: productForm.category?.trim() || '',
        unit: productForm.unit?.trim() || 'unidade',
        imageUrl: nextImageUrl,
        active: productForm.active,
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
      await load();
      notifySuccess(
        editingProductId
          ? 'Produto atualizado dentro do Estoque.'
          : 'Produto criado com a ficha base da Broa Tradicional.'
      );
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel salvar o produto.');
    } finally {
      setIsSavingProduct(false);
    }
  };

  const removeProduct = async (id: number) => {
    const productToRestore = products.find((entry) => entry.id === id);
    const accepted = await confirm({
      title: 'Remover produto do catalogo?',
      description:
        'Se houver pedidos, movimentos ou ficha vinculada, o produto sera apenas desativado para nao interferir na operacao.',
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
        notifyInfo('Produto desativado porque ja participa de pedidos, movimentos ou ficha tecnica.');
      } else if (result?.deleted) {
        if (editingProductId === id) resetProductForm();
        if (productToRestore) {
          notifyUndo(`Produto ${productToRestore.name} removido do catalogo.`, async () => {
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
            await load();
            notifySuccess('Produto restaurado com sucesso.');
          });
        } else {
          notifySuccess('Produto removido do catalogo.');
        }
      }

      await load();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel remover o produto.');
    }
  };

  const startEditBom = useCallback((bom: BomCatalogRecord, shouldScroll = true) => {
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
      throw new Error('Produto nao encontrado.');
    }

    const existingBom = boms.find((entry) => entry.productId === productId);
    if (existingBom) {
      startEditBom(existingBom, shouldScroll);
      return;
    }

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
    const raw = searchParams.get('bomProductId') || searchParams.get('productId');
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
      notifyError(error instanceof Error ? error.message : 'Nao foi possivel abrir a ficha tecnica.');
    }
  }, [hasLoadedTechnicalCatalog, notifyError, searchParams, startBomForProduct]);

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
    notifyUndo(`${itemName} removido da ficha tecnica em edicao.`, () => {
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
      notifyError('Selecione um produto para a ficha tecnica.');
      scrollToLayoutSlot('bom', { focus: true, focusSelector: 'select, input, button' });
      return;
    }

    const inferredBomName =
      bomName.trim() ||
      products.find((entry) => entry.id === Number(bomProductId))?.name?.trim() ||
      '';

    if (!inferredBomName) {
      notifyError('Informe o nome da ficha tecnica.');
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

      const qtyPerSaleUnit = parseOptionalNumber(item.qtyPerSaleUnit, 'Qtd por caixa', index + 1);
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
      await load();
      notifySuccess(editingBomId ? 'Ficha tecnica atualizada com sucesso.' : 'Ficha tecnica criada com sucesso.');
      scrollToLayoutSlot('bom');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel salvar a ficha tecnica.');
    }
  };

  const removeBom = async (id: number) => {
    const accepted = await confirm({
      title: 'Remover ficha tecnica?',
      description: 'Essa acao exclui a BOM selecionada.',
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
      await load();
      notifySuccess('Ficha tecnica removida com sucesso.');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel remover a ficha tecnica.');
    }
  };

  const canSaveBom = Boolean(
    bomProductId &&
      (
        bomName.trim().length > 0 ||
        products.find((entry) => entry.id === Number(bomProductId))?.name?.trim()
      )
  );

  const saveStockCardBalance = useCallback(
    async (item: InventoryOverviewItem) => {
      if (!item.id) return;
      if (stockCardPendingActionIdsRef.current.has(item.id)) return;

      const rawValue = stockCardBalanceByItemId[item.id];
      const parsedValue = parseLocaleNumber(rawValue);
      if (parsedValue == null || !Number.isFinite(parsedValue)) {
        setStockCardErrorByItemId((current) => ({
          ...current,
          [item.id!]: 'Informe um saldo valido.'
        }));
        return;
      }

      const currentBalance = roundInventoryQty(item.balance || 0);
      const normalizedNext = roundInventoryQty(parsedValue);
      if (Math.abs(currentBalance - normalizedNext) < 0.0001) {
        setStockCardBalanceByItemId((current) => ({
          ...current,
          [item.id!]: formatQty(currentBalance)
        }));
        setStockCardErrorByItemId((current) => ({
          ...current,
          [item.id!]: ''
        }));
        return;
      }

      const unitLabel = item.unit || 'un';
      const delta = roundInventoryQty(normalizedNext - currentBalance);
      const deltaAbs = roundInventoryQty(Math.abs(delta));
      const movementLabel = delta > 0 ? 'entrada' : 'saida';

      stockCardPendingActionIdsRef.current.add(item.id);
      try {
        const accepted = await confirm({
          title: delta > 0 ? 'Confirmar entrada automatica?' : 'Confirmar saida automatica?',
          description: `Saldo atual: ${formatQty(currentBalance)} ${unitLabel}. Novo saldo: ${formatQty(
            normalizedNext
          )} ${unitLabel}. Isso vai registrar ${movementLabel} de ${formatQty(deltaAbs)} ${unitLabel} em ${
            item.name
          }.`,
          confirmLabel: delta > 0 ? 'Confirmar entrada' : 'Confirmar saida',
          cancelLabel: 'Cancelar'
        });
        if (!accepted) {
          setStockCardBalanceByItemId((current) => ({
            ...current,
            [item.id!]: formatQty(currentBalance)
          }));
          setStockCardErrorByItemId((current) => ({
            ...current,
            [item.id!]: ''
          }));
          return;
        }

        setStockCardSavingItemId(item.id);
        setStockCardErrorByItemId((current) => ({
          ...current,
          [item.id!]: ''
        }));

        await apiFetch(`/inventory-items/${item.id}/effective-balance`, {
          method: 'POST',
          body: JSON.stringify({
            quantity: normalizedNext,
            reason: `Ajuste manual via card Estoque (${formatQty(currentBalance)} -> ${formatQty(
              normalizedNext
            )} ${unitLabel})`
          })
        });
        await load();
        notifySuccess(
          `${delta > 0 ? 'Entrada' : 'Saida'} registrada automaticamente: ${formatQty(deltaAbs)} ${unitLabel} em ${item.name}.`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Nao foi possivel salvar o saldo deste item.';
        setStockCardErrorByItemId((current) => ({
          ...current,
          [item.id!]: message
        }));
        notifyError(message);
      } finally {
        stockCardPendingActionIdsRef.current.delete(item.id);
        setStockCardSavingItemId(null);
      }
    },
    [confirm, load, notifyError, notifySuccess, stockCardBalanceByItemId]
  );

  const unitCostMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const item of items) {
      const packSize = item.purchasePackSize || 0;
      const packCost = item.purchasePackCost || 0;
      const unitCost = packSize > 0 ? packCost / packSize : 0;
      map.set(item.id!, unitCost);
    }
    return map;
  }, [items]);

  const itemMap = useMemo(() => {
    const map = new Map<number, InventoryOverviewItem>();
    for (const item of items) {
      map.set(item.id!, item);
      for (const rawItemId of item.rawItemIds || []) {
        map.set(rawItemId, item);
      }
    }
    return map;
  }, [items]);

  const editingInventoryItem = useMemo(
    () => (editingItemId ? items.find((item) => item.id === editingItemId) ?? null : null),
    [editingItemId, items]
  );

  const activeProducts = useMemo(
    () => products.filter((product) => product.active && isTechnicalCatalogProduct(product)),
    [products]
  );

  const inactiveProducts = useMemo(
    () => products.filter((product) => !product.active && isTechnicalCatalogProduct(product)),
    [products]
  );

  const activeProductIds = useMemo(
    () => new Set(activeProducts.map((product) => product.id).filter(Boolean) as number[]),
    [activeProducts]
  );

  const activeBoms = useMemo(
    () =>
      boms.filter((bom) => Boolean(bom.product?.active) || activeProductIds.has(bom.productId)),
    [activeProductIds, boms]
  );

  const inactiveBomsCount = Math.max(0, boms.length - activeBoms.length);
  const visibleProducts = showInactiveTechnicalEntries
    ? products.filter((product) => isTechnicalCatalogProduct(product))
    : activeProducts;
  const visibleBoms = showInactiveTechnicalEntries ? boms : activeBoms;
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

  const d1Shortages = useMemo(() => d1Rows.filter((row) => row.shortageQty > 0), [d1Rows]);

  const stockBoardCards = useMemo(() => {
    return items
      .map((item) => {
        return {
          item,
          balance: roundInventoryQty(item.balance || 0),
        } satisfies StockBoardCard;
      })
      .sort((left, right) => left.item.name.localeCompare(right.item.name, 'pt-BR'));
  }, [items]);

  const recentMovements = useMemo(() => movements.slice(0, 6), [movements]);

  const impactedOrdersCount = useMemo(
    () => new Set(d1Warnings.map((warning) => warning.orderId)).size,
    [d1Warnings]
  );

  useEffect(() => {
    setStockCardBalanceByItemId(
      Object.fromEntries(stockBoardCards.map((card) => [card.item.id!, formatQty(card.balance)]))
    );
    setStockCardErrorByItemId({});
  }, [stockBoardCards]);

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
                    Operacao do estoque sem ruido tecnico
                  </h2>
                  <p className="text-sm text-neutral-700">
                    Entradas e faltas ficam na frente. Catalogo, fichas e custos avancados
                    ficam no final.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="app-button app-button-primary"
                    onClick={() =>
                      scrollToLayoutSlot('movement', {
                        focus: true,
                        focusSelector: 'input, button'
                      })
                    }
                  >
                    Ajustar saldos
                  </button>
                  <button
                    type="button"
                    className="app-button app-button-ghost"
                    onClick={() => openTechnicalCatalog('product')}
                  >
                    Abrir catalogo tecnico
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
                    Massa pronta
                  </p>
                  <p className="mt-2 text-lg font-semibold text-neutral-900">
                    {formatQty(massSummary.recipesAvailable)} receita(s)
                  </p>
                  <p className="text-sm text-neutral-600">
                    {formatQty(massSummary.broasAvailable)} broa(s) disponiveis agora
                  </p>
                </div>
                <div className="rounded-2xl border border-white/70 bg-white/75 p-3 md:p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
                    Potencial total
                  </p>
                  <p className="mt-2 text-lg font-semibold text-neutral-900">
                    {formatQty(massSummary.totalPotentialRecipes)} receita(s)
                  </p>
                  <p className="text-sm text-neutral-600">
                    {formatQty(massSummary.totalPotentialBroas)} broa(s) somando massa pronta e ingredientes
                  </p>
                </div>
                <div className="rounded-2xl border border-white/70 bg-white/75 p-3 md:p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
                    Alertas D+1
                  </p>
                  <p className="mt-2 text-lg font-semibold text-neutral-900">
                    {d1Shortages.length} item(ns) em falta
                  </p>
                  <p className="text-sm text-neutral-600">
                    {impactedOrdersCount} pedido(s) com alerta de ficha tecnica
                  </p>
                </div>
                <div className="rounded-2xl border border-white/70 bg-white/75 p-3 md:p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
                    Catalogo ativo
                  </p>
                  <p className="mt-2 text-lg font-semibold text-neutral-900">
                    {activeProducts.length} produto(s)
                  </p>
                  <p className="text-sm text-neutral-600">
                    {activeBoms.length} ficha(s) ativa(s) no Estoque
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
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
            </div>
          </BuilderLayoutItemSlot>

          <BuilderLayoutItemSlot id="movement">
            <div className="app-panel">
              <div className="mass-prep-stock-grid">
                {stockBoardCards.map((card) => {
                  const stockItemId = card.item.id!;
                  const editValue = stockCardBalanceByItemId[stockItemId] ?? formatQty(card.balance);
                  const itemError = stockCardErrorByItemId[stockItemId];
                  const isSavingItem = stockCardSavingItemId === stockItemId;

                  return (
                    <article key={`stock-card-${stockItemId}`} className="mass-prep-stock-card">
                      <p className="mass-prep-stock-card__category">
                        {inventoryCategoryLabel(card.item.category)}
                      </p>
                      <h4 className="mass-prep-stock-card__name">{card.item.name}</h4>
                      <p className="mass-prep-stock-card__balance">
                        Saldo atual: {formatQty(card.balance)} {card.item.unit}
                      </p>
                      <label className="mass-prep-stock-card__edit-label">
                        Ajustar saldo ({card.item.unit})
                        <input
                          type="text"
                          inputMode="decimal"
                          className="app-input mass-prep-stock-card__input"
                          value={editValue}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setStockCardBalanceByItemId((current) => ({
                              ...current,
                              [stockItemId]: nextValue
                            }));
                            setStockCardErrorByItemId((current) => ({
                              ...current,
                              [stockItemId]: ''
                            }));
                          }}
                          onBlur={() => {
                            void saveStockCardBalance(card.item);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter') return;
                            event.preventDefault();
                            void saveStockCardBalance(card.item);
                          }}
                          placeholder="0"
                          disabled={isSavingItem}
                        />
                      </label>
                      {itemError ? <p className="mass-prep-stock-card__error">{itemError}</p> : null}
                    </article>
                  );
                })}
              </div>
            </div>
          </BuilderLayoutItemSlot>

          <BuilderLayoutItemSlot id="movements">
            <div className="app-panel grid gap-3">
              <details className="app-details" open={!isOperationMode}>
                <summary>Historico de movimentacoes</summary>
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
                      Nenhuma movimentacao registrada.
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
              </details>
            </div>
          </BuilderLayoutItemSlot>

          <BuilderLayoutItemSlot
            id="bom"
            className={isSpotlightSlot('bom') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'}
          >
            <details ref={technicalCatalogDetailsRef} className="app-details" open={!isOperationMode}>
              <summary>Catálogo Técnico</summary>
              <div className="app-panel mt-2 grid gap-3">
                <div
                  ref={bomSectionRef}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-white/70 bg-white/75 px-4 py-3"
                >
                  <div className="grid gap-1">
                    <h3 className="text-lg font-semibold text-neutral-900">Produtos e ficha basica</h3>
                    <p className="text-sm text-neutral-600">
                      Expanda um produto para ver somente os insumos e a quantidade da ficha tecnica.
                    </p>
                    <p className="text-sm text-neutral-500">
                      {visibleProducts.length} produto(s) visivel(is)
                      {!showInactiveTechnicalEntries && inactiveProducts.length > 0
                        ? ` • ${inactiveProducts.length} inativo(s) oculto(s)`
                        : ''}
                      {!showInactiveTechnicalEntries && inactiveBomsCount > 0
                        ? ` • ${inactiveBomsCount} ficha(s) oculta(s)`
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
                    <button
                      type="button"
                      className="app-button app-button-ghost"
                      onClick={() => {
                        if (technicalCatalogDetailsRef.current) technicalCatalogDetailsRef.current.open = true;
                        if (inventoryPricesDetailsRef.current) inventoryPricesDetailsRef.current.open = true;
                        scrollToLayoutSlot('prices', {
                          focus: true,
                          focusSelector: 'summary, button, input, select, textarea'
                        });
                      }}
                    >
                      Preços
                    </button>
                    {inactiveProducts.length > 0 ? (
                      <button
                        type="button"
                        className="app-button app-button-ghost"
                        onClick={() => setShowInactiveTechnicalEntries((current) => !current)}
                      >
                        {showInactiveTechnicalEntries
                          ? 'Ocultar inativos'
                          : `Mostrar inativos (${inactiveProducts.length})`}
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-2">
                  {visibleTechnicalCatalogEntries.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/70 bg-white/65 px-4 py-6 text-sm text-neutral-500">
                      {products.length === 0
                        ? 'Nenhum produto cadastrado no catalogo.'
                        : inactiveProducts.length > 0 && !showInactiveTechnicalEntries
                          ? `Nenhum produto ativo visivel agora. ${inactiveProducts.length} inativo(s) oculto(s).`
                          : 'Nenhum produto ativo visivel no catalogo.'}
                    </div>
                  ) : (
                    visibleTechnicalCatalogEntries.map(({ product, bom }) => (
                      <details key={product.id} className="app-details">
                        <summary>{product.name}</summary>
                        <div className="mt-2 grid gap-2">
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
                                {bom?.items?.length || 0} item(ns)
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

                          {!bom || (bom.items || []).length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-white/70 bg-white/65 px-4 py-5 text-sm text-neutral-500">
                              Nenhuma ficha tecnica cadastrada para este produto.
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
                      <p className="text-sm text-neutral-600">
                        Todo produto novo ja nasce com a ficha tecnica da Broa Tradicional para voce ajustar so o que mudar.
                      </p>
                      <div className="grid gap-3 rounded-2xl border border-white/70 bg-white/70 p-3 md:grid-cols-[120px_minmax(0,1fr)]">
                        <div className="relative aspect-square overflow-hidden rounded-2xl border border-white/80 bg-white/80">
                          {productImagePreviewUrl ? (
                            <>
                              {/* Blob previews from local uploads do not work reliably with next/image. */}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              alt={productForm.name || 'Preview do produto'}
                              className="h-full w-full object-cover"
                              src={resolveBuilderImageSrc(productImagePreviewUrl)}
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
                            onChange={handleProductImageSelection}
                          />
                          <p className="text-xs text-neutral-500">
                            Essa mesma imagem sera usada no catalogo e dentro da Caixa Sabores.
                          </p>
                        </div>
                      </div>
                      <input
                        className="app-input"
                        placeholder="Nome do produto"
                        value={productForm.name}
                        onChange={(event) =>
                          setProductForm((current) => ({ ...current, name: event.target.value }))
                        }
                      />
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
                    <summary>{editingBomId ? 'Editar ficha tecnica' : 'Nova ficha tecnica'}</summary>
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
                        {visibleProducts.map((product) => (
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
                          {editingBomId ? 'Atualizar ficha tecnica' : 'Criar ficha tecnica'}
                        </button>
                      </div>
                    </div>
                  </details>
                ) : null}

                <details ref={inventoryPricesDetailsRef} className="app-details" open>
                  <summary>Preços</summary>
                  <div className="mt-2 grid gap-3">
                    <div className="grid gap-3 rounded-2xl border border-white/70 bg-white/75 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="grid gap-1">
                          <h4 className="text-base font-semibold text-neutral-900">Pesquisa e atualização de preços</h4>
                          <p className="text-sm text-neutral-600">
                            Esta visão sempre trabalha na unidade real de compra de cada item. O baseline histórico parte do
                            primeiro pedido; quando não há histórico amplo, o backend usa a média das amostras encontradas.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="app-button app-button-ghost"
                            onClick={applyPriceResearchBaseline}
                            disabled={isApplyingPriceBaseline}
                          >
                            {isApplyingPriceBaseline ? 'Aplicando...' : 'Aplicar baseline histórica'}
                          </button>
                          <button
                            type="button"
                            className="app-button app-button-ghost"
                            onClick={refreshPurchaseCosts}
                            disabled={isRefreshingPurchaseCosts}
                          >
                            {isRefreshingPurchaseCosts ? 'Atualizando...' : 'Atualizar preços online'}
                          </button>
                        </div>
                      </div>

                      {priceBaselineResponse ? (
                        <div className="rounded-2xl border border-white/70 bg-white/70 px-3 py-3 text-sm text-neutral-700">
                          <p>
                            Baseline aplicada desde{' '}
                            {new Date(priceBaselineResponse.firstOrderAt).toLocaleDateString('pt-BR')} para{' '}
                            {priceBaselineResponse.results.filter((entry) => entry.status === 'UPDATED').length} familia(s).
                          </p>
                        </div>
                      ) : null}

                      {purchaseCostRefreshResponse ? (
                        <div className="rounded-2xl border border-white/70 bg-white/70 px-3 py-3 text-sm text-neutral-700">
                          <p>
                            {purchaseCostRefreshResponse.totals.updatedSourceCount} online •{' '}
                            {purchaseCostRefreshResponse.totals.fallbackSourceCount} fallback •{' '}
                            {purchaseCostRefreshResponse.totals.updatedItemCount} item(ns) atualizado(s)
                          </p>
                        </div>
                      ) : null}
                    </div>

                    <BuilderLayoutItemSlot id="prices">
                      <div className="grid gap-3">
                        {(priceBoard?.items || []).map((entry) => (
                          <details key={entry.itemId} className="app-details">
                            <summary>{entry.name}</summary>
                            <div className="mt-2 grid gap-3 rounded-2xl border border-white/70 bg-white/75 p-3">
                              <div className="grid gap-1">
                                <p className="text-sm font-medium text-neutral-800">
                                  Unidade de compra: {formatQty(entry.purchasePackSize)} {entry.unit}
                                </p>
                                <p className="text-sm text-neutral-600">
                                  Custo unitário atual: {formatCurrencyBR(entry.unitCost)} por {entry.unit}
                                </p>
                                {entry.sourceUrl ? (
                                  <a
                                    href={entry.sourceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-sm text-neutral-600 underline decoration-dotted underline-offset-2 hover:text-neutral-900"
                                  >
                                    Fonte: {entry.sourceName || 'link cadastrado'}
                                  </a>
                                ) : null}
                              </div>

                              <div className="grid gap-3 md:grid-cols-[minmax(0,220px)_auto] md:items-end">
                                <label className="grid gap-1 text-sm text-neutral-700">
                                  <span>Preço do pacote</span>
                                  <input
                                    className="app-input"
                                    inputMode="decimal"
                                    value={priceInputsByItemId[entry.itemId] ?? ''}
                                    onChange={(event) =>
                                      setPriceInputsByItemId((current) => ({
                                        ...current,
                                        [entry.itemId]: event.target.value
                                      }))
                                    }
                                    onBlur={() =>
                                      setPriceInputsByItemId((current) => ({
                                        ...current,
                                        [entry.itemId]:
                                          formatMoneyInputBR(current[entry.itemId] || '0') || '0,00'
                                      }))
                                    }
                                  />
                                </label>
                                <button
                                  type="button"
                                  className="app-button app-button-primary"
                                  onClick={() => void savePurchasePrice(entry.itemId)}
                                  disabled={savingPriceItemId === entry.itemId}
                                >
                                  {savingPriceItemId === entry.itemId ? 'Salvando...' : 'Salvar preço'}
                                </button>
                              </div>

                              <div className="grid gap-2 rounded-2xl border border-white/70 bg-white/70 px-3 py-3 text-sm text-neutral-600">
                                <p>
                                  Baseline desde o primeiro pedido:{' '}
                                  {entry.baselinePackCost != null ? formatCurrencyBR(entry.baselinePackCost) : 'nao aplicada'}
                                  {entry.baselineEffectiveAt
                                    ? ` • ${new Date(entry.baselineEffectiveAt).toLocaleDateString('pt-BR')}`
                                    : ''}
                                </p>
                                {entry.priceEntries.length ? (
                                  <div className="grid gap-1 text-xs text-neutral-600">
                                    {entry.priceEntries
                                      .slice()
                                      .reverse()
                                      .slice(0, 4)
                                      .map((priceEntry) => (
                                        <p key={priceEntry.id}>
                                          {new Date(priceEntry.effectiveAt).toLocaleDateString('pt-BR')} •{' '}
                                          {formatCurrencyBR(priceEntry.purchasePackCost)} / {formatQty(priceEntry.purchasePackSize)}{' '}
                                          {entry.unit}
                                          {priceEntry.sourceName ? ` • ${priceEntry.sourceName}` : ''}
                                        </p>
                                      ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-neutral-500">Sem histórico gravado ainda.</p>
                                )}
                              </div>
                            </div>
                          </details>
                        ))}
                      </div>
                    </BuilderLayoutItemSlot>
                  </div>
                </details>

                {showIngredientEditor || !isOperationMode ? (
                  <details
                    ref={inventoryItemsDetailsRef}
                    className="app-details"
                    open={showIngredientEditor || !isOperationMode}
                  >
                    <summary>Cadastro de insumos</summary>
                    <div className="mt-2 grid gap-3">
                      <BuilderLayoutItemSlot id="packaging">
                        <div className="grid gap-3">
                          <form
                            className="grid gap-3 rounded-2xl border border-white/70 bg-white/75 p-3"
                            onSubmit={saveInventoryItem}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="grid gap-1">
                                <h4 className="text-base font-semibold text-neutral-900">
                                  {editingInventoryItem
                                    ? `Editar ${inventoryCategoryLabel(editingInventoryItem.category).toLowerCase()}`
                                    : 'Novo ingrediente'}
                                </h4>
                                <p className="text-sm text-neutral-600">
                                  {editingInventoryItem
                                    ? 'Qualquer ajuste salvo aqui atualiza imediatamente o item usado nas fichas tecnicas.'
                                    : 'Tudo que voce cadastrar aqui entra imediatamente na lista usada pelas fichas tecnicas.'}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {editingInventoryItem ? (
                                  <button
                                    type="button"
                                    className="app-button app-button-ghost"
                                    onClick={startCreateIngredientEditor}
                                  >
                                    Novo ingrediente
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="app-button app-button-ghost"
                                  onClick={resetIngredientEditor}
                                >
                                  Fechar
                                </button>
                              </div>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                              {items.length > 0 ? (
                                <select
                                  className="app-select md:col-span-2"
                                  value={editingItemId}
                                  onChange={(event) => {
                                    const selectedId = event.target.value ? Number(event.target.value) : '';
                                    if (selectedId === '') {
                                      startCreateIngredientEditor();
                                      return;
                                    }
                                    const item = items.find((entry) => entry.id === selectedId);
                                    if (item) startEditItem(item);
                                  }}
                                >
                                  <option value="">
                                    {editingInventoryItem
                                      ? 'Criar novo ingrediente'
                                      : 'Selecione um item existente para editar'}
                                  </option>
                                  {items.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.name}
                                    </option>
                                  ))}
                                </select>
                              ) : null}
                              <input
                                className="app-input"
                                placeholder="Nome do item"
                                value={inventoryItemForm.name}
                                onChange={(event) =>
                                  setInventoryItemForm((current) => ({ ...current, name: event.target.value }))
                                }
                              />
                              <input
                                className="app-input"
                                placeholder="Unidade (g, ml, uni)"
                                value={inventoryItemForm.unit}
                                onChange={(event) =>
                                  setInventoryItemForm((current) => ({ ...current, unit: event.target.value }))
                                }
                              />
                              <input
                                className="app-input"
                                inputMode="decimal"
                                placeholder="Tamanho do pacote"
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
                              <input
                                className="app-input"
                                inputMode="decimal"
                                placeholder="Custo de compra (R$)"
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
                            </div>
                            <div className="app-form-actions app-form-actions--mobile-sticky">
                              <button type="button" className="app-button app-button-ghost" onClick={resetIngredientEditor}>
                                Cancelar
                              </button>
                              <button
                                type="submit"
                                className="app-button app-button-primary"
                                disabled={isSavingInventoryItem}
                              >
                                {isSavingInventoryItem
                                  ? editingInventoryItem
                                    ? 'Salvando...'
                                    : 'Criando...'
                                  : editingInventoryItem
                                    ? 'Salvar item'
                                    : 'Criar ingrediente'}
                              </button>
                            </div>
                          </form>

                          <div className="rounded-2xl border border-white/70 bg-white/75 px-3 py-3 text-sm text-neutral-600">
                            Selecione um item no formulario acima ou toque em um card abaixo para editar nome,
                            unidade e unidade de compra. Os preços agora ficam no bloco dedicado de Preços.
                          </div>
                        </div>
                      </BuilderLayoutItemSlot>

                      <BuilderLayoutItemSlot id="balance">
                        <div className="grid gap-2">
                          <div className="rounded-2xl border border-white/70 bg-white/60 px-3 py-2 text-sm text-neutral-600">
                            Base completa de insumos e embalagens. Use so para manutencao.
                          </div>
                          {items.map((item) => {
                            const isExpanded = editingItemId === item.id;
                            return (
                              <div
                                key={item.id}
                                className={`app-panel app-panel--expandable ${
                                  isExpanded ? 'app-panel--expanded' : ''
                                }`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <button
                                    type="button"
                                    className="min-w-0 flex-1 text-left"
                                    onClick={() => startEditItem(item)}
                                  >
                                    <div className="flex items-center gap-3">
                                      <p className="truncate font-semibold">{item.name}</p>
                                      <span className="app-panel__chevron" aria-hidden="true" />
                                    </div>
                                    <p className="mt-1 text-sm text-neutral-500">
                                      {inventoryCategoryLabel(item.category)} • {formatQty(item.balance || 0)} {item.unit}
                                    </p>
                                  </button>
                                  <button
                                    type="button"
                                    className="app-button app-button-danger"
                                    onClick={() => {
                                      void removeItem(item.id!);
                                    }}
                                  >
                                    Remover
                                  </button>
                                </div>
                                <div className="app-panel__expand" aria-hidden={!isExpanded}>
                                  <div className="app-panel__expand-inner">
                                    <div className="app-panel__expand-surface grid gap-2 text-sm text-neutral-600">
                                      <p>Custo unitario: R$ {(unitCostMap.get(item.id!) ?? 0).toFixed(4)}</p>
                                      <p>
                                        Pack:{' '}
                                        {item.purchasePackSize && item.purchasePackSize > 0
                                          ? `${formatQty(item.purchasePackSize)} ${item.unit}`
                                          : 'nao definido'}
                                      </p>
                                      <p>
                                        Custo pack:{' '}
                                        {item.purchasePackCost && item.purchasePackCost > 0
                                          ? formatCurrencyBR(item.purchasePackCost)
                                          : 'nao definido'}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </BuilderLayoutItemSlot>
                    </div>
                  </details>
                ) : null}
              </div>
            </details>
          </BuilderLayoutItemSlot>
        </section>
      </BuilderLayoutProvider>
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
