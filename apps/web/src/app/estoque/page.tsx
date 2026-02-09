'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Product, StockMovement } from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';

const movementTypes = ['IN', 'OUT', 'ADJUST'];

export default function StockPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [productId, setProductId] = useState<number | ''>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [type, setType] = useState<string>('IN');
  const [reason, setReason] = useState<string>('');

  const load = async () => {
    const [productsData, movementsData] = await Promise.all([
      apiFetch<Product[]>('/products'),
      apiFetch<StockMovement[]>('/stock-movements')
    ]);
    setProducts(productsData);
    setMovements(movementsData);
  };

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const createMovement = async () => {
    if (!productId) return;
    await apiFetch('/stock-movements', {
      method: 'POST',
      body: JSON.stringify({
        productId: Number(productId),
        quantity: Number(quantity),
        type,
        reason
      })
    });
    setProductId('');
    setQuantity(1);
    setType('IN');
    setReason('');
    await load();
  };

  const balances = useMemo(() => {
    const balance = new Map<number, number>();
    for (const movement of movements) {
      const current = balance.get(movement.productId) || 0;
      if (movement.type === 'IN') balance.set(movement.productId, current + movement.quantity);
      if (movement.type === 'OUT') balance.set(movement.productId, current - movement.quantity);
      if (movement.type === 'ADJUST') balance.set(movement.productId, movement.quantity);
    }
    return balance;
  }, [movements]);

  return (
    <section className="grid gap-8">
      <div>
        <h2 className="text-2xl font-semibold">Estoque</h2>
        <p className="text-neutral-600">Movimentacoes e saldo por produto.</p>
      </div>

      <div className="grid gap-4 rounded-2xl border border-neutral-200 bg-white p-6">
        <h3 className="text-lg font-semibold">Nova movimentacao</h3>
        <div className="grid gap-3 md:grid-cols-4">
          <select
            className="rounded-lg border border-neutral-200 px-3 py-2"
            value={productId}
            onChange={(e) => setProductId(Number(e.target.value))}
          >
            <option value="">Produto</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select className="rounded-lg border border-neutral-200 px-3 py-2" value={type} onChange={(e) => setType(e.target.value)}>
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
        <h3 className="text-lg font-semibold">Saldo por produto</h3>
        {products.map((product) => (
          <div key={product.id} className="rounded-xl border border-neutral-200 bg-white p-4">
            <p className="font-semibold">{product.name}</p>
            <p className="text-sm text-neutral-500">Saldo: {balances.get(product.id!) ?? 0}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3">
        <h3 className="text-lg font-semibold">Movimentacoes</h3>
        {movements.map((movement) => (
          <div key={movement.id} className="rounded-xl border border-neutral-200 bg-white p-4 text-sm">
            Produto {movement.productId} • {movement.type} • {movement.quantity} • {movement.reason || 'Sem motivo'}
          </div>
        ))}
      </div>
    </section>
  );
}
