'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from 'react';
import type {
  Bom,
  BomItem as CatalogBomItem,
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

const EMPTY_PRODUCT_FORM: Pick<Product, 'name' | 'category' | 'unit' | 'active'> = {
  name: '',
  category: 'Sabores',
  unit: 'unidade',
  active: true
};

const OFFICIAL_BROA_ORDER_BY_NAME = new Map(
  OFFICIAL_BROAS.map((broa, index) => [normalizeLookupText(broa.name), index])
);

function isTechnicalCatalogProduct(product: Product) {
  return normalizeLookupText(product.category || '') !== 'HISTORICO';
}

function movementTypeLabel(value: string) {
  return movementTypeOptions.find((entry) => entry.value === value)?.label || value;
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
  const inventoryItemsDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const stockCardPendingActionIdsRef = useRef<Set<number>>(new Set());

  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<InventoryOverviewItem[]>([]);
  const [massSummary, setMassSummary] = useState<InventoryMassSummary>(EMPTY_MASS_SUMMARY);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [boms, setBoms] = useState<BomCatalogRecord[]>([]);
  const [editingItemId, setEditingItemId] = useState<number | ''>('');
  const [packSize, setPackSize] = useState<string>('0');
  const [packCost, setPackCost] = useState<string>('0');
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [showProductEditor, setShowProductEditor] = useState(false);
  const [productForm, setProductForm] = useState<Pick<Product, 'name' | 'category' | 'unit' | 'active'>>(
    EMPTY_PRODUCT_FORM
  );
  const [productPriceInput, setProductPriceInput] = useState<string>('0,00');

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
      const [overviewData, movementsData] = await Promise.all([
        fetchWithRetry<InventoryOverviewResponse>('/inventory-overview'),
        fetchWithRetry<InventoryMovement[]>('/inventory-movements')
      ]);

      setItems(overviewData.items || []);
      setMassSummary(overviewData.mass || EMPTY_MASS_SUMMARY);
      setMovements(movementsData);

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

  const startEditItem = (item: InventoryOverviewItem) => {
    setEditingItemId(item.id!);
    setPackSize(String(item.purchasePackSize ?? 0));
    setPackCost(String(item.purchasePackCost ?? 0));
  };

  const updateItem = async () => {
    if (!editingItemId) return;
    const parsedPackSize = parseRequiredNumber(packSize, 'Tamanho da embalagem');
    if (parsedPackSize === null) return;
    if (parsedPackSize <= 0) {
      notifyError('Tamanho da embalagem deve ser maior que zero.');
      return;
    }

    const parsedPackCost = parseRequiredNumber(packCost, 'Custo da embalagem');
    if (parsedPackCost === null) return;

    try {
      await apiFetch(`/inventory-items/${editingItemId}`, {
        method: 'PUT',
        body: JSON.stringify({
          purchasePackSize: parsedPackSize,
          purchasePackCost: parsedPackCost
        })
      });
      setEditingItemId('');
      setPackSize('0');
      setPackCost('0');
      await load();
      notifySuccess('Custo de compra atualizado.');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel atualizar o custo.');
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
      active: product.active
    });
    setProductPriceInput(formatMoneyInputBR(product.price ?? 0) || '0,00');
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

  const saveProduct = async (event?: FormEvent) => {
    event?.preventDefault();

    if (!productForm.name || productForm.name.trim().length < 2) {
      notifyError('Informe um nome valido para o produto.');
      return;
    }

    const parsedPrice = parseRequiredNumber(productPriceInput, 'Preco de venda');
    if (parsedPrice === null) return;

    const payload = {
      name: productForm.name.trim(),
      category: productForm.category?.trim() || '',
      unit: productForm.unit?.trim() || 'unidade',
      active: productForm.active,
      price: Math.round(parsedPrice * 100) / 100
    };

    try {
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
      notifySuccess(editingProductId ? 'Produto atualizado dentro do Estoque.' : 'Produto criado dentro do Estoque.');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel salvar o produto.');
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
    if (section === 'items' && inventoryItemsDetailsRef.current) {
      inventoryItemsDetailsRef.current.open = true;
    }

    const slotId = section === 'items' ? 'packaging' : 'bom';
    scrollToLayoutSlot(slotId, {
      focus: true,
      focusSelector: 'summary, button, input, select, textarea'
    });
    if (section !== 'items') {
      bomSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

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
                            {movement.reason || 'Sem observacao'}
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
                        <button type="submit" className="app-button app-button-primary">
                          {editingProductId ? 'Atualizar produto' : 'Criar produto'}
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

                {!isOperationMode ? (
                  <details
                    ref={inventoryItemsDetailsRef}
                    className="app-details"
                    open={!isOperationMode}
                  >
                  <summary>Insumos e custos de compra</summary>
                  <div className="mt-2 grid gap-3">
                    <BuilderLayoutItemSlot id="packaging">
                      <div className="grid gap-3 rounded-2xl border border-white/70 bg-white/75 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="grid gap-1">
                            <h4 className="text-base font-semibold text-neutral-900">Preco de compra</h4>
                            <p className="text-sm text-neutral-600">Use o botao para atualizar pelos links da planilha.</p>
                          </div>
                          <button
                            type="button"
                            className="app-button app-button-ghost"
                            onClick={refreshPurchaseCosts}
                            disabled={isRefreshingPurchaseCosts}
                          >
                            {isRefreshingPurchaseCosts ? 'Atualizando...' : 'Atualizar precos online'}
                          </button>
                        </div>
                        {purchaseCostRefreshResponse ? (
                          <div className="rounded-2xl border border-white/70 bg-white/70 px-3 py-3 text-sm text-neutral-700">
                            <p>
                              {purchaseCostRefreshResponse.totals.updatedSourceCount} online •{' '}
                              {purchaseCostRefreshResponse.totals.fallbackSourceCount} manual •{' '}
                              {purchaseCostRefreshResponse.totals.updatedItemCount} item(ns) atualizado(s)
                            </p>
                            {purchaseCostRefreshResponse.results.some((entry) => entry.status !== 'UPDATED') ? (
                              <div className="mt-2 grid gap-1 text-xs text-neutral-600">
                                {purchaseCostRefreshResponse.results
                                  .filter((entry) => entry.status !== 'UPDATED')
                                  .map((entry) => (
                                    <p key={`${entry.canonicalName}-${entry.status}`}>
                                      {entry.canonicalName}: {entry.status === 'FALLBACK' ? 'valor manual' : 'sem item'}.
                                    </p>
                                  ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="grid gap-3 md:grid-cols-3">
                          <select
                            className="app-select"
                            value={editingItemId}
                            onChange={(e) => {
                              const selectedId = e.target.value ? Number(e.target.value) : '';
                              if (selectedId === '') {
                                setEditingItemId('');
                                return;
                              }
                              const item = items.find((entry) => entry.id === selectedId);
                              if (item) startEditItem(item);
                            }}
                          >
                            <option value="">Item</option>
                            {items.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                          <input
                            className="app-input"
                            placeholder="Tamanho embalagem"
                            value={packSize}
                            onChange={(e) => setPackSize(e.target.value)}
                            onBlur={() => setPackSize(formatDecimalInputBR(packSize, { maxFractionDigits: 4 }) || '0')}
                          />
                          <input
                            className="app-input"
                            placeholder="Custo embalagem (R$)"
                            value={packCost}
                            onChange={(e) => setPackCost(e.target.value)}
                            onBlur={() => setPackCost(formatMoneyInputBR(packCost || '0') || '0,00')}
                          />
                        </div>
                        <div className="app-form-actions app-form-actions--mobile-sticky">
                          <button className="app-button app-button-primary" onClick={updateItem}>
                            Salvar preco manual
                          </button>
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
