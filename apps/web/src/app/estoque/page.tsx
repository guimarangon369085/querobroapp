'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Bom, InventoryItem, InventoryMovement, Product } from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';

const movementTypes = ['IN', 'OUT', 'ADJUST'];

type BomItemInput = {
  itemId: number | '';
  qtyPerRecipe?: number | '';
  qtyPerSaleUnit?: number | '';
  qtyPerUnit?: number | '';
};

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

  const startEditBom = (bom: any) => {
    setEditingBomId(bom.id);
    setBomProductId(bom.productId);
    setBomName(bom.name || '');
    setBomSaleUnitLabel(bom.saleUnitLabel || '');
    setBomYieldUnits(String(bom.yieldUnits ?? ''));
    const items = (bom.items || []).map((item: any) => ({
      itemId: item.itemId,
      qtyPerRecipe: item.qtyPerRecipe ?? '',
      qtyPerSaleUnit: item.qtyPerSaleUnit ?? '',
      qtyPerUnit: item.qtyPerUnit ?? ''
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

  return (
    <section className="grid gap-8">
      <div>
        <h2 className="text-2xl font-semibold">Estoque detalhado</h2>
        <p className="text-neutral-600">Ingredientes + embalagens com capacidade de producao.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <p className="text-xs uppercase text-neutral-500">Itens</p>
          <p className="text-2xl font-semibold">{inventoryKpis.totalItems}</p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <p className="text-xs uppercase text-neutral-500">Ingredientes</p>
          <p className="text-2xl font-semibold">{inventoryKpis.ingredients}</p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <p className="text-xs uppercase text-neutral-500">Embalagens</p>
          <p className="text-2xl font-semibold">{inventoryKpis.packaging}</p>
        </div>
      </div>

      <div className="grid gap-3 rounded-2xl border border-neutral-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Capacidade por produto (caixas)</h3>
          <p className="text-sm text-neutral-500">Custo por caixa calculado por BOM</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {capacity.map((entry) => (
            <div key={entry.bom.id} className="rounded-xl border border-neutral-200 bg-white p-4">
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
            <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 p-6 text-sm text-neutral-500">
              Nenhuma BOM cadastrada.
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 rounded-2xl border border-neutral-200 bg-white p-6">
        <h3 className="text-lg font-semibold">Nova movimentacao de insumo</h3>
        <div className="grid gap-3 md:grid-cols-4">
          <select
            className="rounded-lg border border-neutral-200 px-3 py-2"
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
            className="rounded-lg border border-neutral-200 px-3 py-2"
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
            className="rounded-lg border border-neutral-200 px-3 py-2"
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
          <input
            className="rounded-lg border border-neutral-200 px-3 py-2"
            placeholder="Motivo"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <button className="rounded-full bg-neutral-900 px-4 py-2 text-white" onClick={createMovement}>
          Registrar
        </button>
      </div>

      <div className="grid gap-4 rounded-2xl border border-neutral-200 bg-white p-6">
        <h3 className="text-lg font-semibold">Fichas tecnicas (BOM)</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <select
            className="rounded-lg border border-neutral-200 px-3 py-2"
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
            className="rounded-lg border border-neutral-200 px-3 py-2"
            placeholder="Nome da ficha tecnica"
            value={bomName}
            onChange={(e) => setBomName(e.target.value)}
          />
          <input
            className="rounded-lg border border-neutral-200 px-3 py-2"
            placeholder="Unidade de venda (ex: Caixa com 7)"
            value={bomSaleUnitLabel}
            onChange={(e) => setBomSaleUnitLabel(e.target.value)}
          />
          <input
            className="rounded-lg border border-neutral-200 px-3 py-2"
            placeholder="Rendimento (caixas por receita)"
            value={bomYieldUnits}
            onChange={(e) => setBomYieldUnits(e.target.value)}
          />
        </div>
        <div className="grid gap-3">
          {bomItems.map((item, index) => (
            <div key={`${item.itemId}-${index}`} className="grid gap-3 md:grid-cols-5">
              <select
                className="rounded-lg border border-neutral-200 px-3 py-2"
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
                className="rounded-lg border border-neutral-200 px-3 py-2"
                placeholder="Qtd receita"
                value={item.qtyPerRecipe ?? ''}
                onChange={(e) => updateBomItem(index, { qtyPerRecipe: e.target.value })}
              />
              <input
                className="rounded-lg border border-neutral-200 px-3 py-2"
                placeholder="Qtd caixa"
                value={item.qtyPerSaleUnit ?? ''}
                onChange={(e) => updateBomItem(index, { qtyPerSaleUnit: e.target.value })}
              />
              <input
                className="rounded-lg border border-neutral-200 px-3 py-2"
                placeholder="Qtd unidade"
                value={item.qtyPerUnit ?? ''}
                onChange={(e) => updateBomItem(index, { qtyPerUnit: e.target.value })}
              />
              <button
                className="rounded-full border border-red-200 px-3 py-1 text-sm text-red-600"
                onClick={() => removeBomItem(index)}
              >
                Remover
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="rounded-full border border-neutral-200 px-4 py-2" onClick={addBomItem}>
            Adicionar item
          </button>
          <button className="rounded-full bg-neutral-900 px-4 py-2 text-white" onClick={saveBom}>
            {editingBomId ? 'Atualizar ficha tecnica' : 'Criar ficha tecnica'}
          </button>
        </div>

        <div className="grid gap-3">
          {boms.map((bom: any) => (
            <div key={bom.id} className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{bom.name}</p>
                  <p className="text-sm text-neutral-500">
                    Produto: {bom.product?.name || 'Produto'} • {bom.saleUnitLabel || 'Unidade'}
                  </p>
                </div>
                <button
                  className="rounded-full border border-neutral-200 px-3 py-1 text-sm"
                  onClick={() => startEditBom(bom)}
                >
                  Editar
                </button>
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

      <div className="grid gap-4 rounded-2xl border border-neutral-200 bg-white p-6">
        <h3 className="text-lg font-semibold">Custo de compra por embalagem</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <select
            className="rounded-lg border border-neutral-200 px-3 py-2"
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
            className="rounded-lg border border-neutral-200 px-3 py-2"
            placeholder="Tamanho embalagem"
            value={packSize}
            onChange={(e) => setPackSize(e.target.value)}
          />
          <input
            className="rounded-lg border border-neutral-200 px-3 py-2"
            placeholder="Custo embalagem (R$)"
            value={packCost}
            onChange={(e) => setPackCost(e.target.value)}
          />
        </div>
        <button className="rounded-full bg-neutral-900 px-4 py-2 text-white" onClick={updateItem}>
          Atualizar custo
        </button>
      </div>

      <div className="grid gap-3">
        <h3 className="text-lg font-semibold">Saldo por item</h3>
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-neutral-200 bg-white p-4">
            <p className="font-semibold">{item.name}</p>
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
          <div key={movement.id} className="rounded-xl border border-neutral-200 bg-white p-4 text-sm">
            {itemMap.get(movement.itemId)?.name || `Item ${movement.itemId}`} • {movement.type} •{' '}
            {movement.quantity} • {movement.reason || 'Sem motivo'}
          </div>
        ))}
      </div>
    </section>
  );
}
