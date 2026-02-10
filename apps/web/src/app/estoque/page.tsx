'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  Bom,
  InventoryItem,
  InventoryMovement,
  Product,
  ProductionRequirementRow,
  ProductionRequirementWarning,
  ProductionRequirementsResponse,
} from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';

const movementTypes = ['IN', 'OUT', 'ADJUST'];

type BomItemInput = {
  itemId: number | '';
  qtyPerRecipe?: string;
  qtyPerSaleUnit?: string;
  qtyPerUnit?: string;
};

function defaultTomorrowDate() {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.toISOString().slice(0, 10);
}

function formatQty(value: number) {
  if (!Number.isFinite(value)) return '0';
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

export default function StockPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
  const [itemId, setItemId] = useState<number | ''>('');
  const [quantity, setQuantity] = useState<number>(1);
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
  const [d1Basis, setD1Basis] = useState<'deliveryDate' | 'createdAtPlus1'>('createdAtPlus1');
  const [d1Loading, setD1Loading] = useState(false);
  const [d1Error, setD1Error] = useState<string | null>(null);

  const load = async () => {
    const [productsData, itemsData, movementsData, bomsData] = await Promise.all([
      apiFetch<Product[]>('/products'),
      apiFetch<InventoryItem[]>('/inventory-items'),
      apiFetch<InventoryMovement[]>('/inventory-movements'),
      apiFetch<any[]>('/boms')
    ]);
    setProducts(productsData);
    setItems(itemsData);
    setMovements(movementsData);
    setBoms(bomsData as Bom[]);
  };

  useEffect(() => {
    load().catch(console.error);
  }, []);

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

  const parseSaleUnits = (label?: string | null) => {
    if (!label) return 1;
    const match = label.match(/(\d+)/);
    return match ? Number(match[1]) : 1;
  };

  const createMovement = async () => {
    if (!itemId) return;
    await apiFetch('/inventory-movements', {
      method: 'POST',
      body: JSON.stringify({
        itemId: Number(itemId),
        quantity: Number(quantity),
        type,
        reason
      })
    });
    setItemId('');
    setQuantity(1);
    setType('IN');
    setReason('');
    await load();
  };

  const removeMovement = async (id: number) => {
    if (!confirm('Remover esta movimentacao?')) return;
    try {
      await apiFetch(`/inventory-movements/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Nao foi possivel remover a movimentacao.');
    }
  };

  const startEditItem = (item: InventoryItem) => {
    setEditingItemId(item.id!);
    setPackSize(String(item.purchasePackSize ?? 0));
    setPackCost(String(item.purchasePackCost ?? 0));
  };

  const updateItem = async () => {
    if (!editingItemId) return;
    await apiFetch(`/inventory-items/${editingItemId}`, {
      method: 'PUT',
      body: JSON.stringify({
        purchasePackSize: Number(packSize || 0),
        purchasePackCost: Number(packCost || 0)
      })
    });
    setEditingItemId('');
    setPackSize('0');
    setPackCost('0');
    await load();
  };

  const removeItem = async (id: number) => {
    if (!confirm('Remover este item do estoque?')) return;
    try {
      await apiFetch(`/inventory-items/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Nao foi possivel remover o item.');
    }
  };

  const startEditBom = (bom: any) => {
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
  };

  const addBomItem = () => {
    setBomItems((prev) => [...prev, { itemId: '', qtyPerRecipe: '', qtyPerSaleUnit: '', qtyPerUnit: '' }]);
  };

  const updateBomItem = (index: number, patch: Partial<BomItemInput>) => {
    setBomItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const removeBomItem = (index: number) => {
    setBomItems((prev) => prev.filter((_, i) => i !== index));
  };

  const saveBom = async () => {
    if (!bomProductId || Number(bomProductId) <= 0) {
      alert('Selecione um produto para a ficha tecnica.');
      return;
    }

    if (!bomName.trim()) {
      alert('Informe o nome da ficha tecnica.');
      return;
    }

    const payload = {
      productId: Number(bomProductId),
      name: bomName,
      saleUnitLabel: bomSaleUnitLabel || null,
      yieldUnits: bomYieldUnits ? Number(bomYieldUnits) : null,
      items: bomItems
        .filter((item) => item.itemId)
        .map((item) => ({
          itemId: Number(item.itemId),
          qtyPerRecipe: item.qtyPerRecipe === '' ? null : Number(item.qtyPerRecipe),
          qtyPerSaleUnit: item.qtyPerSaleUnit === '' ? null : Number(item.qtyPerSaleUnit),
          qtyPerUnit: item.qtyPerUnit === '' ? null : Number(item.qtyPerUnit)
        }))
    };

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
  };

  const removeBom = async (id: number) => {
    if (!confirm('Remover esta ficha tecnica?')) return;
    try {
      await apiFetch(`/boms/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Nao foi possivel remover a ficha tecnica.');
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

  const bomCosts = useMemo(() => {
    return (boms as any[]).map((bom) => {
      const unitsPerSale = parseSaleUnits(bom.saleUnitLabel);
      let cost = 0;
      for (const item of bom.items || []) {
        let perSale = item.qtyPerSaleUnit ?? null;
        if (perSale === null && item.qtyPerUnit != null) {
          perSale = item.qtyPerUnit * unitsPerSale;
        }
        if (perSale === null && item.qtyPerRecipe != null && bom.yieldUnits) {
          perSale = item.qtyPerRecipe / bom.yieldUnits;
        }
        if (perSale === null) continue;
        cost += perSale * (unitCostMap.get(item.itemId) || 0);
      }
      return { bomId: bom.id, cost };
    });
  }, [boms, unitCostMap]);

  const capacity = useMemo(() => {
    return boms.map((bom: any) => {
      const items = bom.items || [];
      const perSale = items.filter((item: any) => item.qtyPerSaleUnit && item.qtyPerSaleUnit > 0);
      let maxUnits = Infinity;
      for (const item of perSale) {
        const balance = balances.get(item.itemId) || 0;
        const capacity = balance / item.qtyPerSaleUnit;
        if (capacity < maxUnits) maxUnits = capacity;
      }
      if (!Number.isFinite(maxUnits)) maxUnits = 0;
      return { bom, maxUnits: Math.floor(maxUnits) };
    });
  }, [boms, balances]);

  const inventoryKpis = useMemo(() => {
    const totalItems = items.length;
    const ingredients = items.filter((i) => i.category === 'INGREDIENTE').length;
    const packaging = items.filter((i) => i.category !== 'INGREDIENTE').length;
    return { totalItems, ingredients, packaging };
  }, [items]);

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
    <section className="grid gap-8">
      <div className="app-section-title">
        <div>
          <span className="app-chip">Inventario</span>
          <h2 className="mt-3 text-3xl font-semibold">Estoque detalhado</h2>
          <p className="text-neutral-600">Ingredientes + embalagens com capacidade de producao.</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="app-kpi">
          <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Itens</p>
          <p className="mt-2 text-3xl font-semibold">{inventoryKpis.totalItems}</p>
        </div>
        <div className="app-kpi">
          <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Ingredientes</p>
          <p className="mt-2 text-3xl font-semibold">{inventoryKpis.ingredients}</p>
        </div>
        <div className="app-kpi">
          <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Embalagens</p>
          <p className="mt-2 text-3xl font-semibold">{inventoryKpis.packaging}</p>
        </div>
      </div>

      <div className="app-panel grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xl font-semibold">Capacidade por produto (caixas)</h3>
          <p className="text-sm text-neutral-500">Custo por caixa calculado por BOM</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {capacity.map((entry) => (
            <div key={entry.bom.id} className="app-panel">
              <p className="font-semibold">{entry.bom.name}</p>
              <p className="text-sm text-neutral-500">
                Produto: {entry.bom.product?.name || 'Produto'}
              </p>
              <p className="text-sm text-neutral-500">
                Capacidade: {entry.maxUnits} caixas
              </p>
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

      <div className="app-panel grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold">Quadro D+1 (producao e compras)</h3>
            <p className="text-sm text-neutral-500">
              Necessidade por insumo para a data alvo. Base atual: {d1Basis === 'deliveryDate' ? 'deliveryDate' : 'createdAt + 1 dia'}.
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
              Recalcular
            </button>
          </div>
        </div>

        {d1Error ? <p className="text-sm text-red-700">{d1Error}</p> : null}
        {d1Loading ? <p className="text-sm text-neutral-500">Calculando D+1...</p> : null}

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

      <div className="app-panel grid gap-4">
        <h3 className="text-lg font-semibold">Nova movimentacao de insumo</h3>
        <div className="grid gap-3 md:grid-cols-4">
          <select
            className="app-select"
            value={itemId}
            onChange={(e) => setItemId(Number(e.target.value))}
          >
            <option value="">Item</option>
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
            {movementTypes.map((movement) => (
              <option key={movement} value={movement}>
                {movement}
              </option>
            ))}
          </select>
          <input
            className="app-input"
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
          <input
            className="app-input"
            placeholder="Motivo"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <button className="app-button app-button-primary" onClick={createMovement}>
          Registrar
        </button>
      </div>

      <div className="app-panel grid gap-4">
        <h3 className="text-lg font-semibold">Fichas tecnicas (BOM)</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <select
            className="app-select"
            value={bomProductId}
            onChange={(e) => setBomProductId(Number(e.target.value))}
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
                onChange={(e) => updateBomItem(index, { itemId: Number(e.target.value) })}
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
        <div className="flex flex-wrap gap-3">
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
      </div>

      <div className="app-panel grid gap-4">
        <h3 className="text-lg font-semibold">Custo de compra por embalagem</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <select
            className="app-select"
            value={editingItemId}
            onChange={(e) => {
              const id = Number(e.target.value);
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
        <button className="app-button app-button-primary" onClick={updateItem}>
          Atualizar custo
        </button>
      </div>

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
              {item.category} • {balances.get(item.id!) ?? 0} {item.unit} • custo unitario R${' '}
              {(unitCostMap.get(item.id!) ?? 0).toFixed(4)}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-3">
        <h3 className="text-lg font-semibold">Movimentacoes</h3>
        {movements.map((movement) => (
          <div key={movement.id} className="app-panel text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {itemMap.get(movement.itemId)?.name || `Item ${movement.itemId}`} • {movement.type} •{' '}
                {movement.quantity} • {movement.reason || 'Sem motivo'}
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
    </section>
  );
}
