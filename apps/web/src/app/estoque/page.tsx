'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Bom, InventoryItem, InventoryMovement, Product } from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';

const movementTypes = ['IN', 'OUT', 'ADJUST'];

export default function StockPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
  const [itemId, setItemId] = useState<number | ''>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [type, setType] = useState<string>('IN');
  const [reason, setReason] = useState<string>('');

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
        <h3 className="text-lg font-semibold">Capacidade por produto (caixas)</h3>
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

      <div className="grid gap-3">
        <h3 className="text-lg font-semibold">Saldo por item</h3>
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-neutral-200 bg-white p-4">
            <p className="font-semibold">{item.name}</p>
            <p className="text-sm text-neutral-500">
              {item.category} • {balances.get(item.id!) ?? 0} {item.unit}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-3">
        <h3 className="text-lg font-semibold">Movimentacoes</h3>
        {movements.map((movement) => (
          <div key={movement.id} className="rounded-xl border border-neutral-200 bg-white p-4 text-sm">
            Item {movement.itemId} • {movement.type} • {movement.quantity} • {movement.reason || 'Sem motivo'}
          </div>
        ))}
      </div>
    </section>
  );
}
