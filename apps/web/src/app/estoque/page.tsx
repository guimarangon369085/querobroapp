'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent
} from 'react';
import type {
  Bom,
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
import { consumeFocusQueryParam, scrollToLayoutSlot } from '@/lib/layout-scroll';
import { formatDecimalInputBR, formatMoneyInputBR, parseLocaleNumber } from '@/lib/format';
import { useSurfaceMode } from '@/hooks/use-surface-mode';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { useFeedback } from '@/components/feedback-provider';
import { BuilderLayoutItemSlot, BuilderLayoutProvider } from '@/components/builder-layout';
import { StockCapacitySection, type StockCapacityEntry } from './stock-capacity-section';

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

function movementTypeLabel(value: string) {
  return movementTypeOptions.find((entry) => entry.value === value)?.label || value;
}

type BomItemInput = {
  itemId: number | '';
  qtyPerRecipe?: string;
  qtyPerSaleUnit?: string;
  qtyPerUnit?: string;
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

function parseSaleUnitCount(label?: string | null) {
  if (!label) return 1;
  const match = label.match(/(\d+)/);
  return match ? Number(match[1]) : 1;
}

function resolveBomItemQtyPerSale(
  bom: { saleUnitLabel?: string | null; yieldUnits?: number | null },
  item: {
    qtyPerSaleUnit?: number | null;
    qtyPerUnit?: number | null;
    qtyPerRecipe?: number | null;
  }
) {
  if (item.qtyPerSaleUnit != null && item.qtyPerSaleUnit > 0) return item.qtyPerSaleUnit;

  const unitsPerSale = parseSaleUnitCount(bom.saleUnitLabel);
  if (item.qtyPerUnit != null && item.qtyPerUnit > 0) {
    return item.qtyPerUnit * unitsPerSale;
  }
  if (item.qtyPerRecipe != null && item.qtyPerRecipe > 0 && bom.yieldUnits && bom.yieldUnits > 0) {
    return item.qtyPerRecipe / bom.yieldUnits;
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

function StockPageContent() {
  const searchParams = useSearchParams();
  const { isSpotlightSlot } = useTutorialSpotlight(searchParams, TUTORIAL_QUERY_VALUE);
  const bomSectionRef = useRef<HTMLDivElement | null>(null);
  const openedBomProductIdRef = useRef<number | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<InventoryOverviewItem[]>([]);
  const [massSummary, setMassSummary] = useState<InventoryMassSummary>(EMPTY_MASS_SUMMARY);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
  const [itemId, setItemId] = useState<number | ''>('');
  const [quantity, setQuantity] = useState<string>('1');
  const [type, setType] = useState<string>('IN');
  const [reason, setReason] = useState<string>('');
  const [editingItemId, setEditingItemId] = useState<number | ''>('');
  const [packSize, setPackSize] = useState<string>('0');
  const [packCost, setPackCost] = useState<string>('0');

  const [editingBomId, setEditingBomId] = useState<number | null>(null);
  const [bomProductId, setBomProductId] = useState<number | ''>('');
  const [bomName, setBomName] = useState<string>('');
  const [bomSaleUnitLabel, setBomSaleUnitLabel] = useState<string>('Caixa com 7 broas');
  const [bomYieldUnits, setBomYieldUnits] = useState<string>('21');
  const [bomItems, setBomItems] = useState<BomItemInput[]>([]);
  const [d1Date, setD1Date] = useState<string>(defaultTomorrowDate());
  const [d1Rows, setD1Rows] = useState<ProductionRequirementRow[]>([]);
  const [d1Warnings, setD1Warnings] = useState<ProductionRequirementWarning[]>([]);
  const [d1Basis, setD1Basis] = useState<'deliveryDate' | 'createdAtPlus1'>('createdAtPlus1');
  const [d1Loading, setD1Loading] = useState(false);
  const [d1Error, setD1Error] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flavorCombos, setFlavorCombos] = useState<Array<{ code: string; composition: string }>>([]);
  const [flavorComboTotal, setFlavorComboTotal] = useState<number>(0);
  const [flavorComboLoading, setFlavorComboLoading] = useState(false);
  const [stockCardBalanceByItemId, setStockCardBalanceByItemId] = useState<Record<number, string>>({});
  const [stockCardErrorByItemId, setStockCardErrorByItemId] = useState<Record<number, string>>({});
  const [stockCardSavingItemId, setStockCardSavingItemId] = useState<number | null>(null);
  const { isOperationMode } = useSurfaceMode('estoque', { defaultMode: 'operation' });
  const { confirm, notifyError, notifySuccess, notifyUndo } = useFeedback();

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
          fetchWithRetry<Product[]>('/products'),
          fetchWithRetry<any[]>('/boms')
        ]);
        const officialOrderByName = new Map(
          OFFICIAL_BROAS.map((broa, index) => [normalizeLookupText(broa.name), index])
        );
        const officialProducts = productsData
          .filter((product) => officialOrderByName.has(normalizeLookupText(product.name)))
          .sort((left, right) => {
            const leftOrder = officialOrderByName.get(normalizeLookupText(left.name)) ?? 99;
            const rightOrder = officialOrderByName.get(normalizeLookupText(right.name)) ?? 99;
            return leftOrder - rightOrder;
          });
        const officialProductIds = new Set(
          officialProducts.map((product) => product.id).filter(Boolean) as number[]
        );
        const officialBoms = (bomsData as Bom[]).filter((bom) =>
          officialProductIds.has(bom.productId)
        );

        setProducts(officialProducts);
        setBoms(officialBoms);
        setLoadError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha ao recarregar produtos/BOM.';
        setLoadError(
          `Estoque atualizado, mas o catalogo auxiliar nao recarregou agora. ${message}`
        );
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
      'capacity',
      'd1',
      'movement',
      'bom',
      'packaging',
      'balance',
      'movements'
    ]);
    if (!allowed.has(focus)) return;

    scrollToLayoutSlot(focus, {
      focus: focus === 'movement' || focus === 'bom' || focus === 'packaging' || focus === 'ops',
      focusSelector: 'input, select, textarea, button'
    });
  }, [searchParams]);

  const loadD1 = useCallback(async (targetDate: string) => {
    setD1Loading(true);
    setD1Error(null);
    try {
      const data = await apiFetch<ProductionRequirementsResponse>(
        `/production/requirements?date=${encodeURIComponent(targetDate)}`
      );
      setD1Rows(data.rows || []);
      setD1Warnings(data.warnings || []);
      setD1Basis(data.basis || 'createdAtPlus1');
    } catch (err) {
      setD1Error(err instanceof Error ? err.message : 'Nao foi possivel calcular o quadro D+1.');
      setD1Rows([]);
      setD1Warnings([]);
    } finally {
      setD1Loading(false);
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

  const applyBroaPreset = async () => {
    try {
      await apiFetch('/boms/bootstrap/broa', { method: 'POST' });
      await load();
      notifySuccess('Padrao Broa aplicado: insumos, custos e fichas tecnicas atualizados.');
      scrollToLayoutSlot('bom');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel aplicar o padrao Broa.');
    }
  };

  const loadFlavorCombinations = useCallback(async () => {
    setFlavorComboLoading(true);
    try {
      const data = await apiFetch<{
        totalCombinations: number;
        combinations: Array<{ code: string; composition: string }>;
      }>('/boms/flavor-combinations?units=7');
      setFlavorComboTotal(data.totalCombinations || 0);
      setFlavorCombos((data.combinations || []).slice(0, 80));
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel carregar combinacoes.');
    } finally {
      setFlavorComboLoading(false);
    }
  }, [notifyError]);

  useEffect(() => {
    void loadFlavorCombinations();
  }, [loadFlavorCombinations]);

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

  const createMovement = async () => {
    if (!itemId) return;
    const parsedQty = parseRequiredNumber(quantity, 'Quantidade');
    if (parsedQty === null) return;
    if (parsedQty <= 0) {
      notifyError('Quantidade deve ser maior que zero.');
      return;
    }

    try {
      await apiFetch('/inventory-movements', {
        method: 'POST',
        body: JSON.stringify({
          itemId: Number(itemId),
          quantity: parsedQty,
          type,
          reason
        })
      });
      setItemId('');
      setQuantity('1');
      setType('IN');
      setReason('');
      await load();
      notifySuccess('Movimentacao registrada com sucesso.');
      scrollToLayoutSlot('movements');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel registrar a movimentacao.');
    }
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

  const startEditBom = useCallback((bom: any, shouldScroll = true) => {
    setEditingBomId(bom.id);
    setBomProductId(bom.productId);
    setBomName(bom.name || '');
    setBomSaleUnitLabel(bom.saleUnitLabel || '');
    setBomYieldUnits(String(bom.yieldUnits ?? ''));
    const items = (bom.items || []).map((item: any) => ({
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

  const openBomForProduct = useCallback(async (productId: number) => {
    const bom = await apiFetch<any>(`/products/${productId}/bom`);
    startEditBom(bom, true);
  }, [startEditBom]);

  useEffect(() => {
    const raw = searchParams.get('bomProductId') || searchParams.get('productId');
    if (!raw) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    if (openedBomProductIdRef.current === parsed) return;
    openedBomProductIdRef.current = parsed;

    void openBomForProduct(parsed)
      .then(() => load())
      .catch((error) => {
        openedBomProductIdRef.current = null;
        notifyError(
          error instanceof Error ? error.message : 'Nao foi possivel abrir a ficha tecnica.'
        );
      });
  }, [searchParams, openBomForProduct, load, notifyError]);

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

    if (!bomName.trim()) {
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
      name: bomName,
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
      setEditingBomId(null);
      setBomProductId('');
      setBomName('');
      setBomItems([]);
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
      await load();
      notifySuccess('Ficha tecnica removida com sucesso.');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel remover a ficha tecnica.');
    }
  };

  const handleInteractiveStockCardKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    action: () => void
  ) => {
    if (event.currentTarget !== event.target) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    action();
  };

  const stopStockCardAction = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const canSaveBom = Boolean(bomProductId) && bomName.trim().length > 0;

  const effectiveBalanceByItemId = useMemo(() => {
    const map = new Map<number, number>();
    for (const item of items) {
      map.set(item.id!, roundInventoryQty(item.balance || 0));
      for (const rawItemId of item.rawItemIds || []) {
        map.set(rawItemId, roundInventoryQty(item.balance || 0));
      }
    }
    return map;
  }, [items]);

  const saveStockCardBalance = useCallback(
    async (item: InventoryOverviewItem, options?: { silent?: boolean }) => {
      if (!item.id) return;
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

      setStockCardSavingItemId(item.id);
      setStockCardErrorByItemId((current) => ({
        ...current,
        [item.id!]: ''
      }));

      try {
        await apiFetch(`/inventory-items/${item.id}/effective-balance`, {
          method: 'POST',
          body: JSON.stringify({
            quantity: normalizedNext,
            reason: 'Ajuste efetivo via Estoque'
          })
        });
        await load();
        if (!options?.silent) {
          notifySuccess('Saldo ajustado no estoque.');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Nao foi possivel salvar o saldo deste item.';
        setStockCardErrorByItemId((current) => ({
          ...current,
          [item.id!]: message
        }));
        notifyError(message);
      } finally {
        setStockCardSavingItemId(null);
      }
    },
    [load, notifyError, notifySuccess, stockCardBalanceByItemId]
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

  const bomCosts = useMemo(() => {
    return (boms as any[]).map((bom) => {
      let cost = 0;
      for (const item of bom.items || []) {
        const perSale = resolveBomItemQtyPerSale(bom, item);
        if (perSale === null) continue;
        cost += perSale * (unitCostMap.get(item.itemId) || 0);
      }
      return { bomId: bom.id, cost };
    });
  }, [boms, unitCostMap]);

  const bomCostByBomId = useMemo(
    () => new Map(bomCosts.map((entry) => [entry.bomId, entry.cost])),
    [bomCosts]
  );

  const capacity = useMemo<StockCapacityEntry[]>(() => {
    return boms.map((bom: any) => {
      const perSaleItems = (bom.items || [])
        .map((item: any) => {
          const perSaleQty = resolveBomItemQtyPerSale(bom, item);
          return perSaleQty && perSaleQty > 0 ? { ...item, perSaleQty } : null;
        })
        .filter(Boolean) as Array<any>;

      let maxUnits = Infinity;
      let limitingItemName = '';
      let hasNegativeInput = false;

      for (const item of perSaleItems) {
        const balance = effectiveBalanceByItemId.get(item.itemId) || 0;
        if (balance < 0) hasNegativeInput = true;
        const currentCapacity = balance / item.perSaleQty;
        if (currentCapacity < maxUnits) {
          maxUnits = currentCapacity;
          limitingItemName = item.item?.name || `Item ${item.itemId}`;
        }
      }
      if (!Number.isFinite(maxUnits)) maxUnits = 0;

      return {
        bom,
        maxUnits: Math.max(0, Math.floor(maxUnits)),
        hasNegativeInput,
        missingQtyDefinitions: perSaleItems.length === 0,
        limitingItemName
      };
    });
  }, [boms, effectiveBalanceByItemId]);

  const d1Shortages = useMemo(() => d1Rows.filter((row) => row.shortageQty > 0), [d1Rows]);

  const d1ShortagesByCategory = useMemo(() => {
    const categoryOrder = new Map<string, number>([
      ['INGREDIENTE', 0],
      ['EMBALAGEM_INTERNA', 1],
      ['EMBALAGEM_EXTERNA', 2]
    ]);

    return d1Shortages
      .map((row) => ({
        ...row,
        category: itemMap.get(row.ingredientId)?.category || 'INGREDIENTE'
      }))
      .sort((a, b) => {
        const categoryA = categoryOrder.get(a.category) ?? 99;
        const categoryB = categoryOrder.get(b.category) ?? 99;
        if (categoryA !== categoryB) return categoryA - categoryB;
        if (b.shortageQty !== a.shortageQty) return b.shortageQty - a.shortageQty;
        return a.name.localeCompare(b.name, 'pt-BR');
      });
  }, [d1Shortages, itemMap]);

  const d1ShortageSummary = useMemo(() => {
    const ingredients = d1ShortagesByCategory.filter((row) => row.category === 'INGREDIENTE').length;
    const internalPackaging = d1ShortagesByCategory.filter(
      (row) => row.category === 'EMBALAGEM_INTERNA'
    ).length;
    const externalPackaging = d1ShortagesByCategory.filter(
      (row) => row.category === 'EMBALAGEM_EXTERNA'
    ).length;
    return { ingredients, internalPackaging, externalPackaging };
  }, [d1ShortagesByCategory]);

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

  useEffect(() => {
    setStockCardBalanceByItemId(
      Object.fromEntries(stockBoardCards.map((card) => [card.item.id!, formatQty(card.balance)]))
    );
    setStockCardErrorByItemId({});
  }, [stockBoardCards]);

  const d1BreakdownSummary = (row: ProductionRequirementRow) => {
    const grouped = new Map<string, number>();
    for (const entry of row.breakdown || []) {
      const current = grouped.get(entry.productName) || 0;
      grouped.set(entry.productName, current + entry.quantity);
    }
    return Array.from(grouped.entries())
      .map(([product, qty]) => `${product}: ${formatQty(qty)}`)
      .join(' | ');
  };

  return (
    <>
    <BuilderLayoutProvider page="estoque">
      <section className="grid gap-8">
      <BuilderLayoutItemSlot
        id="ops"
        className={isSpotlightSlot('ops') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'}
      >
      <div className="app-panel mb-4 grid gap-3">
        <div className="grid gap-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
            Base de massa
          </p>
          <p className="text-sm text-neutral-700">
            Estoque efetivo consolidado com os aliases canônicos do backend.
          </p>
        </div>
        {loadError ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {loadError}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-white/80 bg-white/70 px-2 py-1 text-neutral-700">
            Disponivel agora: {formatQty(massSummary.recipesAvailable)} receita(s) •{' '}
            {formatQty(massSummary.broasAvailable)} broa(s)
          </span>
          <span className="rounded-full border border-white/80 bg-white/70 px-2 py-1 text-neutral-700">
            Possivel pelos ingredientes: {formatQty(massSummary.recipesPossibleFromIngredients)} receita(s) •{' '}
            {formatQty(massSummary.broasPossibleFromIngredients)} broa(s)
          </span>
          <span className="rounded-full border border-white/80 bg-white/70 px-2 py-1 text-neutral-700">
            Potencial total: {formatQty(massSummary.totalPotentialRecipes)} receita(s) •{' '}
            {formatQty(massSummary.totalPotentialBroas)} broa(s)
          </span>
          {massSummary.limitingIngredientName ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
              Gargalo da massa: {massSummary.limitingIngredientName}
            </span>
          ) : null}
        </div>
      </div>
      <div className="mass-prep-stock-grid">
        {stockBoardCards.map((card) => {
          const itemId = card.item.id!;
          const editValue = stockCardBalanceByItemId[itemId] ?? formatQty(card.balance);
          const itemError = stockCardErrorByItemId[itemId];
          const isSavingItem = stockCardSavingItemId === itemId;

          return (
            <article key={`stock-card-${itemId}`} className="mass-prep-stock-card">
              <p className="mass-prep-stock-card__category">{inventoryCategoryLabel(card.item.category)}</p>
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
                      [itemId]: nextValue
                    }));
                    setStockCardErrorByItemId((current) => ({
                      ...current,
                      [itemId]: ''
                    }));
                  }}
                  onBlur={() => {
                    void saveStockCardBalance(card.item, { silent: true });
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    void saveStockCardBalance(card.item, { silent: true });
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
      </BuilderLayoutItemSlot>

      {!isOperationMode ? (
      <BuilderLayoutItemSlot id="d1">
      <div className="app-panel grid gap-4">
        <div className="grid gap-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">1. Planejar</p>
          <p className="text-sm text-neutral-600">
            Veja a demanda e as faltas previstas antes de comprar ou produzir.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-semibold text-neutral-700">
            D+1 ({d1Basis === 'deliveryDate' ? 'data de entrega' : 'pedido + 1 dia'})
          </span>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm text-neutral-600">
              Data
              <input
                className="app-input mt-1"
                type="date"
                value={d1Date}
                onChange={(e) => setD1Date(e.target.value)}
              />
            </label>
            <button className="app-button app-button-ghost" onClick={() => loadD1(d1Date)}>
              Atualizar
            </button>
          </div>
        </div>

        {d1Error ? <p className="text-sm text-red-700">{d1Error}</p> : null}
        {d1Loading ? <p className="text-sm text-neutral-500">Calculando D+1...</p> : null}

        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-white/80 bg-white/70 px-2 py-1 text-neutral-700">
            Itens em falta: {d1Shortages.length}
          </span>
          <span className="rounded-full border border-white/80 bg-white/70 px-2 py-1 text-neutral-700">
            Ingredientes: {d1ShortageSummary.ingredients}
          </span>
          <span className="rounded-full border border-white/80 bg-white/70 px-2 py-1 text-neutral-700">
            Embalagens: {d1ShortageSummary.internalPackaging + d1ShortageSummary.externalPackaging}
          </span>
        </div>

        <div className="overflow-x-auto rounded-lg border border-white/60 bg-white/70">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-white/70 text-left text-xs uppercase tracking-[0.18em] text-neutral-500">
                <th className="px-3 py-2">Insumo</th>
                <th className="px-3 py-2">Unidade</th>
                <th className="px-3 py-2">Necessario</th>
                <th className="px-3 py-2">Disponivel</th>
                <th className="px-3 py-2">Falta</th>
                <th className="px-3 py-2">Por produto</th>
              </tr>
            </thead>
            <tbody>
              {d1Rows.map((row) => (
                <tr key={row.ingredientId} className="border-b border-white/50 align-top">
                  <td className="px-3 py-2 font-medium text-neutral-800">{row.name}</td>
                  <td className="px-3 py-2 text-neutral-600">{row.unit}</td>
                  <td className="px-3 py-2 text-neutral-700">{formatQty(row.requiredQty)}</td>
                  <td className="px-3 py-2 text-neutral-700">{formatQty(row.availableQty)}</td>
                  <td className={`px-3 py-2 font-semibold ${row.shortageQty > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {formatQty(row.shortageQty)}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-600">
                    {row.breakdown?.length ? d1BreakdownSummary(row) : '-'}
                  </td>
                </tr>
              ))}
              {!d1Loading && d1Rows.length === 0 && (
                <tr>
                  <td className="px-3 py-3 text-sm text-neutral-500" colSpan={6}>
                    Sem necessidades calculadas para a data selecionada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {d1Warnings.length > 0 ? (
          <details className="app-details">
            <summary>Alertas de BOM ({d1Warnings.length})</summary>
            <div className="mt-3 grid gap-2">
              {d1Warnings.map((warning, index) => (
                <div key={`${warning.orderId}-${warning.productId}-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Pedido #{warning.orderId} • {warning.productName}: {warning.message}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
      </BuilderLayoutItemSlot>
      ) : null}

      {!isOperationMode ? (
      <BuilderLayoutItemSlot id="movement">
      <div className="app-panel grid gap-4">
        <div className="grid gap-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">2. Comprar</p>
          <p className="text-sm text-neutral-600">
            Registre a entrada quando a compra chegar ou ajuste o saldo manualmente.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <select
            className="app-select"
            value={itemId}
            onChange={(e) => setItemId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Selecione o item</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            className="app-select"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {movementTypeOptions.map((movement) => (
              <option key={movement.value} value={movement.value}>
                {movement.label}
              </option>
            ))}
          </select>
          <input
            className="app-input"
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onBlur={() => setQuantity(formatDecimalInputBR(quantity, { maxFractionDigits: 4 }) || '')}
            inputMode="decimal"
            placeholder="Quantidade"
          />
          <input
            className="app-input"
            placeholder="Observacao (opcional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="app-form-actions app-form-actions--mobile-sticky">
          <button className="app-button app-button-primary" onClick={createMovement}>
            Salvar movimentacao
          </button>
        </div>
      </div>
      </BuilderLayoutItemSlot>
      ) : null}

      {!isOperationMode ? (
      <BuilderLayoutItemSlot id="capacity">
      <StockCapacitySection
        capacity={capacity}
        bomCostByBomId={bomCostByBomId}
        selectedBomId={editingBomId}
        onSelectBom={startEditBom}
        onCardKeyDown={handleInteractiveStockCardKeyDown}
      />
      </BuilderLayoutItemSlot>
      ) : null}

      {!isOperationMode ? (
      <BuilderLayoutItemSlot
        id="bom"
        className={isSpotlightSlot('bom') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'}
      >
      <details className="app-details">
      <summary>3. Produzir: fichas tecnicas</summary>
      <div className="app-panel mt-3 grid gap-4">
        <div ref={bomSectionRef} className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Fichas tecnicas</h3>
          <div className="flex flex-wrap gap-2">
            <button className="app-button app-button-ghost" onClick={loadFlavorCombinations}>
              {flavorComboLoading ? 'Atualizando...' : 'Atualizar combinacoes'}
            </button>
            <button className="app-button app-button-primary" onClick={applyBroaPreset}>
              Aplicar padrao Broa
            </button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <select
            className="app-select"
            value={bomProductId}
            onChange={(e) => setBomProductId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Produto</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
          <input
            className="app-input"
            placeholder="Nome da ficha tecnica"
            value={bomName}
            onChange={(e) => setBomName(e.target.value)}
          />
        </div>
        <details className="app-details">
          <summary>Mais detalhes da ficha</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <input
              className="app-input"
              placeholder="Unidade de venda (ex: Caixa com 7)"
              value={bomSaleUnitLabel}
              onChange={(e) => setBomSaleUnitLabel(e.target.value)}
            />
            <input
              className="app-input"
              placeholder="Rendimento (broas por receita)"
              value={bomYieldUnits}
              onChange={(e) => setBomYieldUnits(e.target.value)}
            />
          </div>
        </details>
        <div className="grid gap-3">
          {bomItems.map((item, index) => (
            <div key={`${item.itemId}-${index}`} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <select
                className="app-select"
                value={item.itemId}
                onChange={(e) =>
                  updateBomItem(index, { itemId: e.target.value ? Number(e.target.value) : '' })
                }
              >
                <option value="">Item</option>
                {items.map((invItem) => (
                  <option key={invItem.id} value={invItem.id}>
                    {invItem.name}
                  </option>
                ))}
              </select>
              <input
                className="app-input"
                placeholder="Peso por venda"
                value={item.qtyPerSaleUnit ?? ''}
                onChange={(e) =>
                  updateBomItem(index, {
                    qtyPerRecipe: '',
                    qtyPerSaleUnit: e.target.value,
                    qtyPerUnit: ''
                  })
                }
                onBlur={() =>
                  updateBomItem(index, {
                    qtyPerRecipe: '',
                    qtyPerSaleUnit: formatDecimalInputBR(item.qtyPerSaleUnit || '', { maxFractionDigits: 4 }),
                    qtyPerUnit: ''
                  })
                }
              />
              <button
                className="app-button app-button-danger"
                onClick={() => removeBomItem(index)}
              >
                Remover
              </button>
            </div>
          ))}
        </div>
        <div className="app-form-actions app-form-actions--mobile-sticky">
          <button className="app-button app-button-ghost" onClick={addBomItem}>
            Adicionar item
          </button>
          <button
            className="app-button app-button-primary disabled:cursor-not-allowed disabled:opacity-60"
            onClick={saveBom}
            disabled={!canSaveBom}
          >
            {editingBomId ? 'Atualizar ficha tecnica' : 'Criar ficha tecnica'}
          </button>
        </div>

        <div className="grid gap-3">
          {boms.map((bom: any) => {
            const isExpanded = editingBomId === bom.id;
            return (
              <div
                key={bom.id}
                className={`app-panel app-panel--interactive app-panel--expandable ${
                  isExpanded ? 'app-panel--expanded' : ''
                }`}
                role="button"
                tabIndex={0}
                onClick={() => startEditBom(bom)}
                onKeyDown={(event) =>
                  handleInteractiveStockCardKeyDown(event, () => startEditBom(bom))
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <p className="truncate font-semibold">{bom.name}</p>
                      <span className="app-panel__chevron" aria-hidden="true" />
                    </div>
                    <p className="mt-1 text-sm text-neutral-500">
                      Produto: {bom.product?.name || 'Produto'} • {bom.saleUnitLabel || 'Unidade'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="app-button app-button-ghost"
                      onClick={(event) => {
                        stopStockCardAction(event);
                        startEditBom(bom);
                      }}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="app-button app-button-danger"
                      onClick={(event) => {
                        stopStockCardAction(event);
                        void removeBom(bom.id);
                      }}
                    >
                      Remover
                    </button>
                  </div>
                </div>
                <div className="app-panel__expand" aria-hidden={!isExpanded}>
                  <div className="app-panel__expand-inner">
                    <div className="app-panel__expand-surface grid gap-2 text-sm text-neutral-500">
                      {(bom.items || []).length === 0 ? (
                        <p>Nenhum item nessa ficha.</p>
                      ) : (
                        (bom.items || []).map((item: any) => (
                          <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/60 bg-white/70 px-3 py-2">
                            <div>
                              <p className="font-medium text-neutral-800">
                                {item.item?.name || `Item ${item.itemId}`}
                              </p>
                              <p className="text-xs text-neutral-500">
                                Peso: {item.qtyPerSaleUnit ?? item.qtyPerUnit ?? item.qtyPerRecipe ?? '-'} {item.item?.unit || ''}
                                {' • '}
                                Valor: {formatCurrencyBR(item.item?.purchasePackCost ?? 0)}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="app-panel">
          <p className="font-semibold text-neutral-900">
            Combinacoes de sabores (7 broas): {flavorComboTotal}
          </p>
          <div className="mt-3 grid gap-2 text-sm text-neutral-700">
            {flavorCombos.length === 0 ? (
              <p>Nenhuma combinacao carregada.</p>
            ) : (
              flavorCombos.map((combo, index) => (
                <p key={`${combo.code}-${index}`}>
                  <strong>{combo.code}</strong> • {combo.composition}
                </p>
              ))
            )}
          </div>
        </div>
      </div>
      </details>
      </BuilderLayoutItemSlot>
      ) : null}

      {!isOperationMode ? (
      <BuilderLayoutItemSlot id="packaging">
      <details className="app-details">
      <summary>2. Comprar: custos de embalagem</summary>
      <div className="app-panel mt-3 grid gap-4">
        <h3 className="text-lg font-semibold">Custo de compra por embalagem</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <select
            className="app-select"
            value={editingItemId}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : '';
              if (id === '') {
                setEditingItemId('');
                return;
              }
              const item = items.find((entry) => entry.id === id);
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
            Atualizar custo
          </button>
        </div>
      </div>
      </details>
      </BuilderLayoutItemSlot>
      ) : null}

      {!isOperationMode ? (
      <BuilderLayoutItemSlot id="balance">
      <details className="app-details">
        <summary>4. Conferir: saldo por item</summary>
      <div className="mt-3 grid gap-3">
        {items.map((item) => {
          const isExpanded = editingItemId === item.id;
          return (
            <div
              key={item.id}
              className={`app-panel app-panel--interactive app-panel--expandable ${
                isExpanded ? 'app-panel--expanded' : ''
              }`}
              role="button"
              tabIndex={0}
              onClick={() => startEditItem(item)}
              onKeyDown={(event) =>
                handleInteractiveStockCardKeyDown(event, () => startEditItem(item))
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <p className="truncate font-semibold">{item.name}</p>
                    <span className="app-panel__chevron" aria-hidden="true" />
                  </div>
                  <p className="mt-1 text-sm text-neutral-500">
                    {inventoryCategoryLabel(item.category)} • {formatQty(item.balance || 0)} {item.unit}
                  </p>
                </div>
                <button
                  type="button"
                  className="app-button app-button-danger"
                  onClick={(event) => {
                    stopStockCardAction(event);
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
                      Pack: {item.purchasePackSize && item.purchasePackSize > 0 ? `${formatQty(item.purchasePackSize)} ${item.unit}` : 'nao definido'}
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
      </details>
      </BuilderLayoutItemSlot>
      ) : null}

      {!isOperationMode ? (
      <BuilderLayoutItemSlot id="movements">
      <details className="app-details">
        <summary>4. Conferir: historico de movimentacoes</summary>
      <div className="mt-3 grid gap-3">
        <div className="app-inline-actions">
          <button
            type="button"
            className="app-button app-button-danger"
            onClick={clearAllMovements}
          >
            Limpar todas as movimentacoes
          </button>
        </div>
        {movements.map((movement) => (
          <div key={movement.id} className="app-panel text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {itemMap.get(movement.itemId)?.name || `Item ${movement.itemId}`} •{' '}
                {movementTypeLabel(movement.type)} • {formatQty(movement.quantity)}{' '}
                {itemMap.get(movement.itemId)?.unit || 'un'} • {movement.reason || 'Sem observacao'}
              </div>
              <button
                className="app-button app-button-danger"
                onClick={() => removeMovement(movement.id!)}
              >
                Remover
              </button>
            </div>
          </div>
        ))}
      </div>
      </details>
      </BuilderLayoutItemSlot>
      ) : null}

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
