'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Bom,
  InventoryItem,
  InventoryMovement,
  Order,
  Product,
  ProductionRequirementRow,
  ProductionRequirementWarning,
  ProductionRequirementsResponse,
} from '@querobroapp/shared';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { consumeFocusQueryParam, scrollToLayoutSlot } from '@/lib/layout-scroll';
import { parseLocaleNumber } from '@/lib/format';
import { useFeedback } from '@/components/feedback-provider';
import {
  BuilderLayoutCustomCards,
  BuilderLayoutItemSlot,
  BuilderLayoutProvider
} from '@/components/builder-layout';

const movementTypeOptions: Array<{ value: 'IN' | 'OUT' | 'ADJUST'; label: string }> = [
  { value: 'IN', label: 'Entrada' },
  { value: 'OUT', label: 'Saida' },
  { value: 'ADJUST', label: 'Ajuste de saldo' }
];

function movementTypeLabel(value: string) {
  return movementTypeOptions.find((entry) => entry.value === value)?.label || value;
}

type BomItemInput = {
  itemId: number | '';
  qtyPerRecipe?: string;
  qtyPerSaleUnit?: string;
  qtyPerUnit?: string;
};

type ProductionBasis = 'deliveryDate' | 'createdAtPlus1';
type StockExecutionStepId = 'organize' | 'buy' | 'bake' | 'deliver';

type StockExecutionStep = {
  id: StockExecutionStepId;
  title: string;
  summary: string;
  detail: string;
  actionLabel: string;
  focusSlot: 'ops' | 'd1' | 'movement' | 'balance';
};

type ShortageRowWithCategory = ProductionRequirementRow & { category: string };

const quickPurchaseSourceOptions = ['Pao de Acucar', 'Oba', 'Esquina', 'Online'] as const;

function defaultTomorrowDate() {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.toISOString().slice(0, 10);
}

function formatQty(value: number) {
  if (!Number.isFinite(value)) return '0';
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

function inventoryCategoryLabel(category: string) {
  if (category === 'INGREDIENTE') return 'Ingrediente';
  if (category === 'EMBALAGEM_INTERNA') return 'Embalagem interna';
  if (category === 'EMBALAGEM_EXTERNA') return 'Embalagem externa';
  return category;
}

function orderProductionDateFromCreatedAt(createdAt?: string | null) {
  if (!createdAt) return '';
  const base = new Date(createdAt);
  if (Number.isNaN(base.getTime())) return '';
  const productionDate = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + 1)
  );
  return productionDate.toISOString().slice(0, 10);
}

function normalizeDateOnly(value?: string | null) {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function orderDateForProductionBasis(order: Order, basis: ProductionBasis) {
  if (basis === 'deliveryDate') {
    const deliveryDate = (order as Order & { deliveryDate?: string | null }).deliveryDate;
    const normalizedDeliveryDate = normalizeDateOnly(deliveryDate);
    if (normalizedDeliveryDate) return normalizedDeliveryDate;
  }

  return orderProductionDateFromCreatedAt(order.createdAt);
}

function parseTimeToMinutes(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function formatMinutesAsDuration(totalMinutes: number) {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return '0 min';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}min`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}min`;
}

function formatMinutesAsClock(totalMinutes: number) {
  if (!Number.isFinite(totalMinutes)) return '--:--';
  const normalized = ((Math.trunc(totalMinutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
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

function StockPageContent() {
  const searchParams = useSearchParams();
  const bomSectionRef = useRef<HTMLDivElement | null>(null);
  const openedBomProductIdRef = useRef<number | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
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
  const [bomYieldUnits, setBomYieldUnits] = useState<string>('12');
  const [bomItems, setBomItems] = useState<BomItemInput[]>([]);
  const [d1Date, setD1Date] = useState<string>(defaultTomorrowDate());
  const [d1Rows, setD1Rows] = useState<ProductionRequirementRow[]>([]);
  const [d1Warnings, setD1Warnings] = useState<ProductionRequirementWarning[]>([]);
  const [d1Basis, setD1Basis] = useState<ProductionBasis>('createdAtPlus1');
  const [d1Loading, setD1Loading] = useState(false);
  const [d1Error, setD1Error] = useState<string | null>(null);
  const [flavorCombos, setFlavorCombos] = useState<Array<{ code: string; composition: string }>>([]);
  const [flavorComboTotal, setFlavorComboTotal] = useState<number>(0);
  const [flavorComboLoading, setFlavorComboLoading] = useState(false);
  const [plannerExtraBroas, setPlannerExtraBroas] = useState<string>('0');
  const [plannerDeadline, setPlannerDeadline] = useState<string>('15:00');
  const [viewMode, setViewMode] = useState<'operation' | 'full'>('full');
  const [quickPurchaseSource, setQuickPurchaseSource] = useState<(typeof quickPurchaseSourceOptions)[number]>(
    'Pao de Acucar'
  );
  const [quickPurchaseLoading, setQuickPurchaseLoading] = useState(false);
  const [shoppingChecklist, setShoppingChecklist] = useState<number[]>([]);
  const { confirm, notifyError, notifySuccess, notifyUndo } = useFeedback();

  const advancedSlots = useMemo(
    () => new Set(['capacity', 'bom', 'packaging', 'movements']),
    []
  );
  const isOperationMode = viewMode === 'operation';

  const load = async () => {
    const [productsData, ordersData, itemsData, movementsData, bomsData] = await Promise.all([
      apiFetch<Product[]>('/products'),
      apiFetch<Order[]>('/orders'),
      apiFetch<InventoryItem[]>('/inventory-items'),
      apiFetch<InventoryMovement[]>('/inventory-movements'),
      apiFetch<any[]>('/boms')
    ]);
    setProducts(productsData);
    setOrders(ordersData);
    setItems(itemsData);
    setMovements(movementsData);
    setBoms(bomsData as Bom[]);
  };

  useEffect(() => {
    load().catch(console.error);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth <= 1024) {
      setViewMode('operation');
    }
  }, []);

  useEffect(() => {
    const focus = consumeFocusQueryParam(searchParams);
    if (!focus) return;

    const allowed = new Set([
      'header',
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

    if (isOperationMode && advancedSlots.has(focus)) {
      setViewMode('full');
      scrollToLayoutSlot(focus, {
        delayMs: 140,
        focus: focus === 'movement' || focus === 'bom' || focus === 'packaging',
        focusSelector: 'input, select, textarea, button'
      });
      return;
    }

    scrollToLayoutSlot(focus, {
      focus: focus === 'movement' || focus === 'bom' || focus === 'packaging' || focus === 'ops',
      focusSelector: 'input, select, textarea, button'
    });
  }, [advancedSlots, isOperationMode, searchParams]);

  const loadD1 = async (targetDate: string) => {
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
  };

  useEffect(() => {
    loadD1(d1Date).catch(console.error);
  }, [d1Date]);

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
    loadFlavorCombinations().catch(console.error);
  }, [loadFlavorCombinations]);

  const syncSupplierCosts = async () => {
    try {
      await apiFetch('/receipts/supplier-prices/sync', { method: 'POST' });
      await load();
      notifySuccess('Custos sincronizados com as fontes de fornecedor.');
      scrollToLayoutSlot('packaging');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel sincronizar custos.');
    }
  };

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

  const createMovementEntry = useCallback(
    async (payload: {
      itemId: number;
      quantity: number;
      type: 'IN' | 'OUT' | 'ADJUST';
      reason?: string;
      orderId?: number;
    }) => {
      await apiFetch('/inventory-movements', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    },
    []
  );

  const createMovement = async () => {
    if (!itemId) return;
    const parsedQty = parseRequiredNumber(quantity, 'Quantidade');
    if (parsedQty === null) return;
    if (parsedQty <= 0) {
      notifyError('Quantidade deve ser maior que zero.');
      return;
    }

    try {
      await createMovementEntry({
        itemId: Number(itemId),
        quantity: parsedQty,
        type: type as 'IN' | 'OUT' | 'ADJUST',
        reason
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

  const startEditItem = (item: InventoryItem) => {
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

    openBomForProduct(parsed)
      .then(() => load())
      .catch(console.error);
  }, [searchParams, openBomForProduct]);

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

  const canSaveBom = Boolean(bomProductId) && bomName.trim().length > 0;

  const balances = useMemo(() => {
    const balance = new Map<number, number>();
    for (const movement of movements) {
      const current = balance.get(movement.itemId) || 0;
      if (movement.type === 'IN') balance.set(movement.itemId, current + movement.quantity);
      if (movement.type === 'OUT') balance.set(movement.itemId, current - movement.quantity);
      if (movement.type === 'ADJUST') balance.set(movement.itemId, movement.quantity);
    }
    return balance;
  }, [movements]);

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

  const itemMap = useMemo(() => new Map(items.map((item) => [item.id!, item])), [items]);
  const autoReceiptMovements = useMemo(
    () =>
      movements.filter(
        (movement) =>
          movement.source === 'CUPOM' ||
          (movement.reason || '').toLowerCase().includes('entrada automatica por cupom')
      ),
    [movements]
  );
  const latestAutoReceiptMovements = useMemo(() => autoReceiptMovements.slice(0, 8), [autoReceiptMovements]);

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

  const capacity = useMemo(() => {
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
        const balance = balances.get(item.itemId) || 0;
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
  }, [boms, balances]);

  const totalCapacityBoxes = useMemo(
    () => capacity.reduce((sum, entry) => sum + Math.max(0, entry.maxUnits), 0),
    [capacity]
  );

  const bomByProductId = useMemo(() => {
    const map = new Map<number, any>();
    for (const bom of boms as any[]) {
      if (!map.has(bom.productId)) {
        map.set(bom.productId, bom);
      }
    }
    return map;
  }, [boms]);

  const plannedOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          order.status !== 'CANCELADO' &&
          order.status !== 'ENTREGUE' &&
          orderDateForProductionBasis(order, d1Basis) === d1Date
      ),
    [orders, d1Basis, d1Date]
  );

  const plannedDemand = useMemo(() => {
    let saleUnits = 0;
    let broas = 0;
    let itemsWithoutBom = 0;

    for (const order of plannedOrders) {
      for (const entry of order.items || []) {
        const qty = Number(entry.quantity) || 0;
        if (qty <= 0) continue;
        saleUnits += qty;
        const bom = bomByProductId.get(entry.productId);
        if (!bom) {
          itemsWithoutBom += 1;
          continue;
        }
        broas += qty * parseSaleUnitCount(bom.saleUnitLabel);
      }
    }

    return {
      saleUnits,
      broas,
      itemsWithoutBom
    };
  }, [plannedOrders, bomByProductId]);

  const d1Shortages = useMemo(() => d1Rows.filter((row) => row.shortageQty > 0), [d1Rows]);

  const d1ShortagesByCategory = useMemo<ShortageRowWithCategory[]>(() => {
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

  useEffect(() => {
    const validIds = new Set(d1ShortagesByCategory.map((row) => row.ingredientId));
    setShoppingChecklist((prev) => prev.filter((id) => validIds.has(id)));
  }, [d1ShortagesByCategory]);

  const shoppingChecklistSet = useMemo(() => new Set(shoppingChecklist), [shoppingChecklist]);
  const selectedShortages = useMemo(
    () => d1ShortagesByCategory.filter((row) => shoppingChecklistSet.has(row.ingredientId)),
    [d1ShortagesByCategory, shoppingChecklistSet]
  );
  const selectedShortageQty = useMemo(
    () => selectedShortages.reduce((sum, row) => sum + row.shortageQty, 0),
    [selectedShortages]
  );

  const toggleShoppingItem = useCallback((ingredientId: number) => {
    setShoppingChecklist((prev) =>
      prev.includes(ingredientId) ? prev.filter((id) => id !== ingredientId) : [...prev, ingredientId]
    );
  }, []);

  const selectAllShortages = useCallback(() => {
    setShoppingChecklist(d1ShortagesByCategory.map((row) => row.ingredientId));
  }, [d1ShortagesByCategory]);

  const clearShoppingChecklist = useCallback(() => {
    setShoppingChecklist([]);
  }, []);

  const applyQuickPurchaseRows = async (rows: ShortageRowWithCategory[]) => {
    const validRows = rows.filter((row) => row.shortageQty > 0);
    if (validRows.length === 0) {
      notifyError('Nenhum item com falta para lancar.');
      return;
    }

    setQuickPurchaseLoading(true);
    try {
      for (const row of validRows) {
        await createMovementEntry({
          itemId: row.ingredientId,
          quantity: row.shortageQty,
          type: 'IN',
          reason: `Compra D+1 ${d1Date} • ${quickPurchaseSource}`
        });
      }
      await load();
      await loadD1(d1Date);
      notifySuccess(`${validRows.length} item(ns) de compra lancado(s) no estoque.`);
      clearShoppingChecklist();
      scrollToLayoutSlot('movement');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel lancar compras.');
    } finally {
      setQuickPurchaseLoading(false);
    }
  };

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

  const plannerExtra = useMemo(() => {
    const parsed = parseLocaleNumber(plannerExtraBroas);
    if (parsed === null || parsed < 0) return 0;
    return parsed;
  }, [plannerExtraBroas]);

  const plannerTargetBroas = Math.max(0, Math.ceil(plannedDemand.broas + plannerExtra));
  const plannerFornadas = plannerTargetBroas > 0 ? Math.ceil(plannerTargetBroas / 14) : 0;
  const plannerOvenMinutes = plannerFornadas * 50;
  const plannerDeadlineMinutes = parseTimeToMinutes(plannerDeadline);
  const plannerStartMinutes =
    plannerDeadlineMinutes == null ? null : plannerDeadlineMinutes - plannerOvenMinutes;
  const plannerNeedsPreviousDay = plannerStartMinutes != null && plannerStartMinutes < 0;
  const negativeBalanceItems = useMemo(
    () =>
      items.filter((item) => {
        const current = balances.get(item.id!) || 0;
        return current < 0;
      }),
    [balances, items]
  );

  const inventoryKpis = useMemo(() => {
    const totalItems = items.length;
    const ingredients = items.filter((i) => i.category === 'INGREDIENTE').length;
    const packaging = items.filter((i) => i.category !== 'INGREDIENTE').length;
    return {
      totalItems,
      ingredients,
      packaging,
      d1Shortages: d1Shortages.length,
      plannedOrders: plannedOrders.length,
      plannedBroas: plannerTargetBroas,
      plannedFornadas: plannerFornadas,
      capacityBoxes: totalCapacityBoxes,
      negativeBalanceItems: negativeBalanceItems.length
    };
  }, [
    d1Shortages.length,
    items,
    negativeBalanceItems.length,
    plannedOrders.length,
    plannerFornadas,
    plannerTargetBroas,
    totalCapacityBoxes
  ]);

  const readyToDeliverCount = useMemo(
    () => plannedOrders.filter((order) => order.status === 'PRONTO').length,
    [plannedOrders]
  );

  const nextExecutionStepId = useMemo<StockExecutionStepId>(() => {
    if (plannedOrders.length === 0) return 'organize';
    if (d1Shortages.length > 0 || negativeBalanceItems.length > 0) return 'buy';
    if (plannerFornadas > 0) return 'bake';
    return 'deliver';
  }, [d1Shortages.length, negativeBalanceItems.length, plannedOrders.length, plannerFornadas]);

  const executionSteps = useMemo<StockExecutionStep[]>(
    () => [
      {
        id: 'organize',
        title: 'Organizar o dia',
        summary: `${plannedOrders.length} pedidos para ${d1Date}`,
        detail:
          plannedOrders.length > 0
            ? `Fila montada: ${plannedOrders.length} pedidos nao entregues e inicio sugerido ${plannerStartMinutes == null ? '--:--' : plannerNeedsPreviousDay ? `dia anterior, ${formatMinutesAsClock(plannerStartMinutes)}` : formatMinutesAsClock(plannerStartMinutes)}.`
            : 'Sem pedidos na fila D+1. Revise horario limite e use margem extra apenas se necessario.',
        actionLabel: 'Abrir ritmo de fornadas',
        focusSlot: 'ops'
      },
      {
        id: 'buy',
        title: 'Comprar faltas',
        summary: `${d1Shortages.length} item(ns) em falta`,
        detail:
          d1Shortages.length > 0
            ? `Prioridade: ${d1ShortagesByCategory
                .slice(0, 2)
                .map((row) => `${row.name} (${formatQty(row.shortageQty)} ${row.unit})`)
                .join(' • ')}.`
            : 'Sem faltas no quadro D+1. Se houver saldo negativo, ajuste antes de assar.',
        actionLabel: 'Abrir compras D+1',
        focusSlot: 'd1'
      },
      {
        id: 'bake',
        title: 'Rodar fornadas',
        summary: `${plannerFornadas} fornada(s) • ${formatMinutesAsDuration(plannerOvenMinutes)}`,
        detail:
          plannerFornadas > 0
            ? `Plano sugerido: ${plannerTargetBroas} broas alvo com ciclos de 35 + 15 minutos por fornada.`
            : 'Sem fornada necessaria para a fila atual. Siga para conferencia e entrega.',
        actionLabel: 'Abrir plano de producao',
        focusSlot: 'ops'
      },
      {
        id: 'deliver',
        title: 'Fechar e entregar',
        summary: `${readyToDeliverCount} pedido(s) pronto(s)`,
        detail:
          readyToDeliverCount > 0
            ? 'Pedidos prontos para despacho. Confira saldo final e lance ajustes antes do Uber.'
            : 'Sem pedidos prontos agora. Continue acompanhando preparo e pagamentos.',
        actionLabel: 'Conferir saldo final',
        focusSlot: 'balance'
      }
    ],
    [
      d1Date,
      d1Shortages.length,
      d1ShortagesByCategory,
      plannedOrders.length,
      plannerFornadas,
      plannerNeedsPreviousDay,
      plannerOvenMinutes,
      plannerStartMinutes,
      plannerTargetBroas,
      readyToDeliverCount
    ]
  );

  const nextExecutionIndex = Math.max(
    0,
    executionSteps.findIndex((step) => step.id === nextExecutionStepId)
  );

  const executionProgressPercent = Math.round((nextExecutionIndex / executionSteps.length) * 100);

  const [operationStep, setOperationStep] = useState<StockExecutionStepId | null>(null);
  const [operationSelectionMode, setOperationSelectionMode] = useState<'auto' | 'manual'>('auto');

  useEffect(() => {
    if (!isOperationMode) {
      if (operationStep !== null) setOperationStep(null);
      if (operationSelectionMode !== 'auto') setOperationSelectionMode('auto');
      return;
    }
    if (
      operationSelectionMode === 'auto' ||
      !operationStep ||
      !executionSteps.some((step) => step.id === operationStep)
    ) {
      setOperationStep(nextExecutionStepId);
    }
  }, [
    executionSteps,
    isOperationMode,
    nextExecutionStepId,
    operationSelectionMode,
    operationStep
  ]);

  const activeOperationStepId = isOperationMode ? operationStep || nextExecutionStepId : null;
  const activeExecutionStep =
    executionSteps.find((step) => step.id === activeOperationStepId) || executionSteps[0];
  const activeExecutionIndex = executionSteps.findIndex((step) => step.id === activeExecutionStep.id);

  const jumpToExecutionStep = useCallback(
    (stepId: StockExecutionStepId, mode: 'auto' | 'manual' = 'manual') => {
      const target = executionSteps.find((step) => step.id === stepId);
      if (!target) return;
      if (isOperationMode) {
        setOperationSelectionMode(mode);
        setOperationStep(stepId);
      }
      scrollToLayoutSlot(target.focusSlot, {
        delayMs: isOperationMode ? 80 : 0,
        focus: true,
        focusSelector: 'input, select, textarea, button'
      });
    },
    [executionSteps, isOperationMode]
  );

  const jumpToNextExecutionStep = useCallback(() => {
    const next = executionSteps[Math.min(activeExecutionIndex + 1, executionSteps.length - 1)];
    if (!next) return;
    jumpToExecutionStep(next.id);
  }, [activeExecutionIndex, executionSteps, jumpToExecutionStep]);

  const showOpsSlot =
    !isOperationMode ||
    activeOperationStepId === 'organize' ||
    activeOperationStepId === 'buy' ||
    activeOperationStepId === 'bake';
  const showD1Slot = !isOperationMode || activeOperationStepId === 'buy';
  const showMovementSlot = !isOperationMode || activeOperationStepId === 'buy';
  const showBalanceSlot = !isOperationMode || activeOperationStepId === 'deliver';

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
    <BuilderLayoutProvider page="estoque">
      <section className="grid gap-8">
      <BuilderLayoutItemSlot id="header">
      <div className="app-section-title">
        <div>
          <span className="app-chip">Estoque</span>
          <h2 className="mt-3 text-3xl font-semibold">Operacao diaria: estoque e producao</h2>
          <p className="text-neutral-600">
            Primeiro planeje faltas, depois rode fornadas, e por fim confira saldo e historico.
          </p>
        </div>
        <div className="stock-view-toggle" role="group" aria-label="Modo de visualizacao do estoque">
          <button
            type="button"
            className={`stock-view-toggle__button ${viewMode === 'operation' ? 'stock-view-toggle__button--active' : ''}`}
            onClick={() => setViewMode('operation')}
          >
            execucao
          </button>
          <button
            type="button"
            className={`stock-view-toggle__button ${viewMode === 'full' ? 'stock-view-toggle__button--active' : ''}`}
            onClick={() => setViewMode('full')}
          >
            completo
          </button>
        </div>
      </div>
      {isOperationMode ? (
        <div className="stock-flag stock-flag--focus">
          Modo foco ativo: blocos tecnicos ficam ocultos para reduzir carga cognitiva.
        </div>
      ) : null}
      {inventoryKpis.negativeBalanceItems > 0 ? (
        <div className="stock-flag stock-flag--warning">
          {inventoryKpis.negativeBalanceItems} item(ns) com saldo negativo precisam de ajuste.
        </div>
      ) : null}
      {isOperationMode ? (
        <section className="stock-exec" aria-label="Modo execucao">
          <div className="stock-exec__top">
            <div>
              <p className="stock-exec__eyebrow">Modo execucao fast-lane</p>
              <h3 className="stock-exec__title">Uma decisao por vez</h3>
              <p className="stock-exec__subtitle">
                Gargalo atual: <strong>{executionSteps[nextExecutionIndex]?.title || 'Organizar o dia'}</strong>
              </p>
            </div>
            <div className="stock-exec__chips">
              <span className="stock-exec__chip">fila: {plannedOrders.length}</span>
              <span className="stock-exec__chip">faltas: {d1Shortages.length}</span>
              <span className="stock-exec__chip">fornadas: {plannerFornadas}</span>
              <span className="stock-exec__chip">prontos: {readyToDeliverCount}</span>
            </div>
          </div>

          <div className="stock-exec__progress" aria-hidden>
            <span
              className="stock-exec__progress-fill"
              style={{ width: `${executionProgressPercent}%` }}
            />
          </div>

          <div className="stock-exec__steps">
            {executionSteps.map((step, index) => {
              const isActive = step.id === activeExecutionStep.id;
              const isNext = step.id === nextExecutionStepId;
              const isDone = index < nextExecutionIndex;
              return (
                <button
                  key={step.id}
                  type="button"
                  className={[
                    'stock-exec__step',
                    isActive ? 'stock-exec__step--active' : '',
                    isNext ? 'stock-exec__step--next' : '',
                    isDone ? 'stock-exec__step--done' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => jumpToExecutionStep(step.id)}
                >
                  <span className="stock-exec__step-index">{index + 1}</span>
                  <span className="stock-exec__step-name">{step.title}</span>
                  <span className="stock-exec__step-metric">{step.summary}</span>
                </button>
              );
            })}
          </div>

          <div className="stock-exec__focus">
            <p className="stock-exec__focus-kicker">
              Etapa ativa {activeExecutionIndex + 1}/4
              {activeExecutionStep.id === nextExecutionStepId
                ? ' • gargalo atual'
                : operationSelectionMode === 'manual'
                ? ' • selecao manual'
                : ''}
            </p>
            <p className="stock-exec__focus-title">{activeExecutionStep.title}</p>
            <p className="stock-exec__focus-detail">{activeExecutionStep.detail}</p>
            <div className="stock-exec__actions">
              <button
                type="button"
                className="app-button app-button-primary"
                onClick={() => jumpToExecutionStep(activeExecutionStep.id)}
              >
                {activeExecutionStep.actionLabel}
              </button>
              {activeExecutionStep.id !== nextExecutionStepId ? (
                <button
                  type="button"
                  className="app-button app-button-ghost"
                  onClick={() => jumpToExecutionStep(nextExecutionStepId, 'auto')}
                >
                  Voltar ao gargalo
                </button>
              ) : null}
              <button
                type="button"
                className="app-button app-button-ghost"
                onClick={jumpToNextExecutionStep}
                disabled={activeExecutionIndex >= executionSteps.length - 1}
              >
                Proxima etapa
              </button>
            </div>
          </div>
        </section>
      ) : (
        <div className="app-quickflow app-quickflow--columns mt-4">
          <button
            type="button"
            className="app-quickflow__step text-left"
            onClick={() => scrollToLayoutSlot('ops', { focus: true })}
          >
            <p className="app-quickflow__step-title">1. Organizar o dia</p>
            <p className="app-quickflow__step-subtitle">Fila de pedidos, fornadas e hora de inicio.</p>
          </button>
          <button
            type="button"
            className="app-quickflow__step text-left"
            onClick={() => scrollToLayoutSlot('d1', { focus: true })}
          >
            <p className="app-quickflow__step-title">2. Planejar compras</p>
            <p className="app-quickflow__step-subtitle">Veja faltas por ingrediente e embalagem.</p>
          </button>
          <button
            type="button"
            className="app-quickflow__step text-left"
            onClick={() => scrollToLayoutSlot('movement', { focus: true })}
          >
            <p className="app-quickflow__step-title">3. Registrar compras/consumo</p>
            <p className="app-quickflow__step-subtitle">Entradas e saidas em poucos toques.</p>
          </button>
          <button
            type="button"
            className="app-quickflow__step text-left"
            onClick={() => scrollToLayoutSlot('balance', { focus: true })}
          >
            <p className="app-quickflow__step-title">4. Fechar conferencia</p>
            <p className="app-quickflow__step-subtitle">Valide saldo por item e historico.</p>
          </button>
        </div>
      )}
      </BuilderLayoutItemSlot>

      {!isOperationMode ? (
      <BuilderLayoutItemSlot id="kpis">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div className="app-kpi">
          <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Fila D+1</p>
          <p className="mt-2 text-3xl font-semibold">{inventoryKpis.plannedOrders}</p>
          <p className="mt-1 text-xs text-neutral-500">
            pedidos nao entregues para {d1Date} ({d1Basis === 'deliveryDate' ? 'entrega' : 'pedido + 1 dia'})
          </p>
        </div>
        <div className="app-kpi">
          <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Broas alvo</p>
          <p className="mt-2 text-3xl font-semibold">{inventoryKpis.plannedBroas}</p>
          <p className="mt-1 text-xs text-neutral-500">
            {plannedDemand.saleUnits} caixas na base + {formatQty(plannerExtra)} extra
          </p>
        </div>
        <div className="app-kpi">
          <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Fornadas</p>
          <p className="mt-2 text-3xl font-semibold">{inventoryKpis.plannedFornadas}</p>
          <p className="mt-1 text-xs text-neutral-500">{formatMinutesAsDuration(plannerOvenMinutes)} de forno</p>
        </div>
        <div className="app-kpi">
          <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Faltas D+1</p>
          <p className="mt-2 text-3xl font-semibold">{inventoryKpis.d1Shortages}</p>
          <p className="mt-1 text-xs text-neutral-500">itens com compra necessaria</p>
        </div>
        <div
          className={`app-kpi ${inventoryKpis.negativeBalanceItems > 0 ? 'stock-kpi--alert' : ''}`}
        >
          <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Capacidade</p>
          <p className="mt-2 text-3xl font-semibold">{inventoryKpis.capacityBoxes}</p>
          <p className="mt-1 text-xs text-neutral-500">
            caixas possiveis com saldo atual
            {inventoryKpis.negativeBalanceItems > 0 ? ' • revisar saldos negativos' : ''}
          </p>
        </div>
      </div>
      </BuilderLayoutItemSlot>
      ) : null}

      {showOpsSlot ? (
      <BuilderLayoutItemSlot id="ops">
      <div className="stock-ops-grid">
        <div className="app-panel stock-ops-panel stock-ops-panel--production grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold">Ritmo de fornadas para {d1Date}</h3>
              <p className="text-sm text-neutral-500">
                Regra atual: 14 broas por fornada e ciclo de 50min (35 + 15).
              </p>
            </div>
            {plannedDemand.itemsWithoutBom > 0 ? (
              <p className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
                {plannedDemand.itemsWithoutBom} item(ns) sem BOM
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-3">
              <p className="text-xs uppercase tracking-[0.15em] text-neutral-500">Caixas na fila</p>
              <p className="mt-1 text-2xl font-semibold">{plannedDemand.saleUnits}</p>
            </div>
            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-3">
              <p className="text-xs uppercase tracking-[0.15em] text-neutral-500">Broas base</p>
              <p className="mt-1 text-2xl font-semibold">{formatQty(plannedDemand.broas)}</p>
            </div>
            <div className="rounded-xl border border-white/60 bg-white/70 px-3 py-3">
              <p className="text-xs uppercase tracking-[0.15em] text-neutral-500">Broas alvo</p>
              <p className="mt-1 text-2xl font-semibold">{plannerTargetBroas}</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_1fr_1.2fr]">
            <label className="text-sm text-neutral-600">
              Margem extra (broas)
              <input
                className="app-input mt-1"
                type="number"
                value={plannerExtraBroas}
                onChange={(event) => setPlannerExtraBroas(event.target.value)}
                inputMode="numeric"
                min="0"
                step="1"
              />
            </label>
            <label className="text-sm text-neutral-600">
              Hora limite de entrega
              <input
                className="app-input mt-1"
                type="time"
                value={plannerDeadline}
                onChange={(event) => setPlannerDeadline(event.target.value)}
              />
            </label>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-3 text-sm text-emerald-900">
              <p className="text-xs uppercase tracking-[0.14em] text-emerald-700">Plano rapido</p>
              <p className="mt-1">
                {plannerFornadas} fornadas ({formatMinutesAsDuration(plannerOvenMinutes)} de forno)
              </p>
              <p className="mt-1">
                Inicio sugerido:{' '}
                {plannerStartMinutes == null
                  ? '--:--'
                  : plannerNeedsPreviousDay
                  ? `dia anterior, ${formatMinutesAsClock(plannerStartMinutes)}`
                  : formatMinutesAsClock(plannerStartMinutes)}
              </p>
            </div>
          </div>
        </div>

        <div className="app-panel stock-ops-panel stock-ops-panel--shopping grid gap-3">
          <div>
            <h3 className="text-xl font-semibold">Lista rapida de compras</h3>
            <p className="text-sm text-neutral-500">Gerada automaticamente pelas faltas do D+1.</p>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-white/80 bg-white/70 px-2 py-1 text-neutral-700">
              Ingredientes: {d1ShortageSummary.ingredients}
            </span>
            <span className="rounded-full border border-white/80 bg-white/70 px-2 py-1 text-neutral-700">
              Emb. interna: {d1ShortageSummary.internalPackaging}
            </span>
            <span className="rounded-full border border-white/80 bg-white/70 px-2 py-1 text-neutral-700">
              Emb. externa: {d1ShortageSummary.externalPackaging}
            </span>
          </div>

          <div className="rounded-xl border border-white/70 bg-white/70 px-3 py-3">
            <p className="text-xs uppercase tracking-[0.15em] text-neutral-500">Checklist de mercado</p>
            <div className="mt-2 grid gap-2">
              <label className="text-xs font-semibold text-neutral-600">
                Fonte de compra
                <select
                  className="app-select mt-1"
                  value={quickPurchaseSource}
                  onChange={(event) =>
                    setQuickPurchaseSource(
                      event.target.value as (typeof quickPurchaseSourceOptions)[number]
                    )
                  }
                >
                  {quickPurchaseSourceOptions.map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="app-button app-button-ghost"
                  onClick={selectAllShortages}
                  disabled={d1ShortagesByCategory.length === 0}
                >
                  Selecionar faltas
                </button>
                <button
                  type="button"
                  className="app-button app-button-ghost"
                  onClick={clearShoppingChecklist}
                  disabled={shoppingChecklist.length === 0}
                >
                  Limpar
                </button>
              </div>

              <p className="text-xs text-neutral-600">
                {selectedShortages.length} item(ns) marcados • total {formatQty(selectedShortageQty)} un base
              </p>
            </div>
          </div>

          <div className="grid max-h-[340px] gap-2 overflow-auto pr-1">
            {d1ShortagesByCategory.length === 0 ? (
              <p className="text-sm text-emerald-700">Sem faltas para a data selecionada.</p>
            ) : (
              d1ShortagesByCategory.map((row) => (
                <div key={`short-${row.ingredientId}`} className="rounded-xl border border-white/70 bg-white/70 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-neutral-900">{row.name}</p>
                      <p className="text-xs text-neutral-600">
                        {inventoryCategoryLabel(row.category)} • falta {formatQty(row.shortageQty)} {row.unit}
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-600">
                      <input
                        type="checkbox"
                        checked={shoppingChecklistSet.has(row.ingredientId)}
                        onChange={() => toggleShoppingItem(row.ingredientId)}
                      />
                      marcar
                    </label>
                  </div>
                  <p className="text-xs text-neutral-600">
                    disponivel {formatQty(row.availableQty)} • necessario {formatQty(row.requiredQty)}
                  </p>
                  <div className="mt-2">
                    <button
                      type="button"
                      className="app-button app-button-ghost"
                      onClick={() => applyQuickPurchaseRows([row])}
                      disabled={quickPurchaseLoading || row.shortageQty <= 0}
                    >
                      {quickPurchaseLoading ? 'Lancando...' : 'Baixar compra deste item'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="app-form-actions">
            <button
              type="button"
              className="app-button app-button-primary"
              onClick={() => applyQuickPurchaseRows(selectedShortages)}
              disabled={quickPurchaseLoading || selectedShortages.length === 0}
            >
              {quickPurchaseLoading
                ? 'Lancando compras...'
                : `Baixar selecionados (${selectedShortages.length})`}
            </button>
            <button
              type="button"
              className="app-button app-button-ghost"
              onClick={() => scrollToLayoutSlot('movement', { focus: true })}
            >
              Lancar manualmente
            </button>
            <button
              type="button"
              className="app-button app-button-ghost"
              onClick={() => scrollToLayoutSlot('d1')}
            >
              Abrir quadro D+1
            </button>
          </div>
        </div>
      </div>
      </BuilderLayoutItemSlot>
      ) : null}

      {!isOperationMode ? (
      <BuilderLayoutItemSlot id="capacity">
      <div className="app-panel grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xl font-semibold">Capacidade por produto</h3>
          <p className="text-sm text-neutral-500">Estimativa de caixas e custo atual por ficha tecnica</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {capacity.map((entry) => (
            <div
              key={entry.bom.id}
              className={`app-panel ${entry.hasNegativeInput || entry.missingQtyDefinitions ? 'stock-capacity-card--warning' : ''}`}
            >
              <p className="font-semibold">{entry.bom.name}</p>
              <p className="text-sm text-neutral-500">
                Produto: {entry.bom.product?.name || 'Produto'}
              </p>
              <p className="text-sm text-neutral-500">
                Capacidade: {entry.maxUnits} caixas
              </p>
              {entry.limitingItemName ? (
                <p className="text-xs text-neutral-500">Gargalo: {entry.limitingItemName}</p>
              ) : null}
              {entry.hasNegativeInput ? (
                <p className="text-xs font-semibold text-rose-700">Saldo negativo impactando a capacidade.</p>
              ) : null}
              {entry.missingQtyDefinitions ? (
                <p className="text-xs font-semibold text-amber-700">BOM sem quantidades suficientes para calcular capacidade.</p>
              ) : null}
              <p className="text-sm text-neutral-500">
                Custo por caixa: R${' '}
                {(bomCosts.find((cost) => cost.bomId === entry.bom.id)?.cost ?? 0).toFixed(2)}
              </p>
            </div>
          ))}
          {capacity.length === 0 && (
            <div className="app-panel border-dashed text-sm text-neutral-500">
              Nenhuma BOM cadastrada.
            </div>
          )}
        </div>
      </div>
      </BuilderLayoutItemSlot>
      ) : null}

      {showD1Slot ? (
      <BuilderLayoutItemSlot id="d1">
      <div className="app-panel grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold">Planejamento de amanha (D+1)</h3>
            <p className="text-sm text-neutral-500">
              Necessidade por insumo para a data selecionada. Base usada:{' '}
              {d1Basis === 'deliveryDate' ? 'data de entrega' : 'pedido + 1 dia'}.
            </p>
          </div>
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

        {d1Warnings.length > 0 && (
          <div className="grid gap-2">
            <h4 className="font-semibold text-neutral-800">Alertas de BOM</h4>
            {d1Warnings.map((warning, index) => (
              <div key={`${warning.orderId}-${warning.productId}-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Pedido #{warning.orderId} • {warning.productName}: {warning.message}
              </div>
            ))}
          </div>
        )}
      </div>
      </BuilderLayoutItemSlot>
      ) : null}

      {showMovementSlot ? (
      <BuilderLayoutItemSlot id="movement">
      <div className="app-panel grid gap-4">
        <h3 className="text-lg font-semibold">Nova movimentacao</h3>
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
      <BuilderLayoutItemSlot id="bom">
      <div className="app-panel grid gap-4">
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
          <input
            className="app-input"
            placeholder="Unidade de venda (ex: Caixa com 7)"
            value={bomSaleUnitLabel}
            onChange={(e) => setBomSaleUnitLabel(e.target.value)}
          />
          <input
            className="app-input"
            placeholder="Rendimento (caixas por receita)"
            value={bomYieldUnits}
            onChange={(e) => setBomYieldUnits(e.target.value)}
          />
        </div>
        <div className="grid gap-3">
          {bomItems.map((item, index) => (
            <div key={`${item.itemId}-${index}`} className="grid gap-3 md:grid-cols-5">
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
                placeholder="Qtd receita"
                value={item.qtyPerRecipe ?? ''}
                onChange={(e) => updateBomItem(index, { qtyPerRecipe: e.target.value })}
              />
              <input
                className="app-input"
                placeholder="Qtd caixa"
                value={item.qtyPerSaleUnit ?? ''}
                onChange={(e) => updateBomItem(index, { qtyPerSaleUnit: e.target.value })}
              />
              <input
                className="app-input"
                placeholder="Qtd unidade"
                value={item.qtyPerUnit ?? ''}
                onChange={(e) => updateBomItem(index, { qtyPerUnit: e.target.value })}
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
          {boms.map((bom: any) => (
            <div key={bom.id} className="app-panel">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{bom.name}</p>
                  <p className="text-sm text-neutral-500">
                    Produto: {bom.product?.name || 'Produto'} • {bom.saleUnitLabel || 'Unidade'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="app-button app-button-ghost"
                    onClick={() => startEditBom(bom)}
                  >
                    Editar
                  </button>
                  <button
                    className="app-button app-button-danger"
                    onClick={() => removeBom(bom.id)}
                  >
                    Remover
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-sm text-neutral-500">
                {(bom.items || []).map((item: any) => (
                  <div key={item.id}>
                    {item.item?.name || `Item ${item.itemId}`} • receita: {item.qtyPerRecipe ?? '-'} • caixa:{' '}
                    {item.qtyPerSaleUnit ?? '-'} • unidade: {item.qtyPerUnit ?? '-'}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="app-panel">
          <p className="font-semibold text-neutral-900">
            Combinacoes de sabores (7 broas): {flavorComboTotal}
          </p>
          <p className="mt-1 text-sm text-neutral-600">
            Mostrando as primeiras {flavorCombos.length} combinacoes para consulta rapida.
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
      </BuilderLayoutItemSlot>
      ) : null}

      {!isOperationMode ? (
      <BuilderLayoutItemSlot id="packaging">
      <div className="app-panel grid gap-4">
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
          />
          <input
            className="app-input"
            placeholder="Custo embalagem (R$)"
            value={packCost}
            onChange={(e) => setPackCost(e.target.value)}
          />
        </div>
        <div className="app-form-actions app-form-actions--mobile-sticky">
          <button className="app-button app-button-ghost" onClick={syncSupplierCosts}>
            Sincronizar custos
          </button>
          <button className="app-button app-button-primary" onClick={updateItem}>
            Atualizar custo
          </button>
        </div>
      </div>
      </BuilderLayoutItemSlot>
      ) : null}

      {showBalanceSlot ? (
      <BuilderLayoutItemSlot id="balance">
      <div className="grid gap-3">
        <h3 className="text-lg font-semibold">Saldo por item</h3>
        {items.map((item) => (
          <div key={item.id} className="app-panel">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{item.name}</p>
              <button
                className="app-button app-button-danger"
                onClick={() => removeItem(item.id!)}
              >
                Remover
              </button>
            </div>
            <p className="text-sm text-neutral-500">
              {inventoryCategoryLabel(item.category)} • {balances.get(item.id!) ?? 0} {item.unit} • custo unitario R${' '}
              {(unitCostMap.get(item.id!) ?? 0).toFixed(4)}
            </p>
          </div>
        ))}
      </div>
      </BuilderLayoutItemSlot>
      ) : null}

      {!isOperationMode ? (
      <BuilderLayoutItemSlot id="movements">
      <div className="grid gap-3">
        <h3 className="text-lg font-semibold">Historico de movimentacoes</h3>
        <div className="app-panel">
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">
            Entradas automaticas por cupom
          </p>
          <p className="mt-1 text-sm text-neutral-700">
            Itens aplicados: <strong>{autoReceiptMovements.length}</strong>
          </p>
          <div className="mt-2 grid gap-1 text-xs text-neutral-600">
            {latestAutoReceiptMovements.length === 0 ? (
              <p>Nenhuma entrada automatica registrada ainda.</p>
            ) : (
              latestAutoReceiptMovements.map((movement) => (
                <p key={`auto-${movement.id}`}>
                  {itemMap.get(movement.itemId)?.name || `Item ${movement.itemId}`} •{' '}
                  {formatQty(movement.quantity)} {itemMap.get(movement.itemId)?.unit || 'un'} •{' '}
                  origem: {movement.sourceLabel || 'Cupom fiscal'} •{' '}
                  custo unitario: R$ {(movement.unitCost || 0).toFixed(4)}
                </p>
              ))
            )}
          </div>
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
      </BuilderLayoutItemSlot>
      ) : null}

      {!isOperationMode ? <BuilderLayoutCustomCards /> : null}
      </section>
    </BuilderLayoutProvider>
  );
}

export default function StockPage() {
  return (
    <Suspense fallback={null}>
      <StockPageContent />
    </Suspense>
  );
}
