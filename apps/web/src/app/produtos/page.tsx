'use client';

import { useEffect, useState } from 'react';
import type { Product } from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';

const emptyProduct: Partial<Product> = {
  name: '',
  category: '',
  unit: 'un',
  price: 0,
  active: true
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<Partial<Product>>(emptyProduct);
  const [editingId, setEditingId] = useState<number | null>(null);

  const load = () => apiFetch<Product[]>('/products').then(setProducts);

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name) return;

    if (editingId) {
      await apiFetch(`/products/${editingId}`, {
        method: 'PUT',
        body: JSON.stringify(form)
      });
    } else {
      await apiFetch('/products', {
        method: 'POST',
        body: JSON.stringify(form)
      });
    }

    setForm(emptyProduct);
    setEditingId(null);
    await load();
  };

  const startEdit = (product: Product) => {
    setEditingId(product.id!);
    setForm({
      name: product.name,
      category: product.category ?? '',
      unit: product.unit ?? '',
      price: product.price,
      active: product.active
    });
  };

  const remove = async (id: number) => {
    await apiFetch(`/products/${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <section className="grid gap-8">
      <div>
        <h2 className="text-2xl font-semibold">Produtos</h2>
        <p className="text-neutral-600">Gerencie catalogo e precos.</p>
      </div>

      <form onSubmit={submit} className="grid gap-4 rounded-2xl border border-neutral-200 bg-white p-6">
        <div className="grid gap-3 md:grid-cols-2">
          <input
            className="rounded-lg border border-neutral-200 px-3 py-2"
            placeholder="Nome"
            value={form.name || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          />
          <input
            className="rounded-lg border border-neutral-200 px-3 py-2"
            placeholder="Categoria"
            value={form.category || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
          />
          <input
            className="rounded-lg border border-neutral-200 px-3 py-2"
            placeholder="Unidade"
            value={form.unit || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))}
          />
          <input
            className="rounded-lg border border-neutral-200 px-3 py-2"
            placeholder="Preco"
            type="number"
            step="0.01"
            value={form.price ?? 0}
            onChange={(e) => setForm((prev) => ({ ...prev, price: Number(e.target.value) }))}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.active ?? true}
            onChange={(e) => setForm((prev) => ({ ...prev, active: e.target.checked }))}
          />
          Ativo
        </label>
        <div className="flex gap-3">
          <button className="rounded-full bg-neutral-900 px-4 py-2 text-white" type="submit">
            {editingId ? 'Atualizar' : 'Criar'}
          </button>
          {editingId && (
            <button
              className="rounded-full border border-neutral-200 px-4 py-2"
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(emptyProduct);
              }}
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

      <div className="grid gap-3">
        {products.map((product) => (
          <div
            key={product.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-4"
          >
            <div>
              <p className="text-lg font-semibold">{product.name}</p>
              <p className="text-sm text-neutral-500">
                {product.category || 'Sem categoria'} • {product.unit || 'un'} • R$ {product.price}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded-full border border-neutral-200 px-3 py-1 text-sm"
                onClick={() => startEdit(product)}
              >
                Editar
              </button>
              <button
                className="rounded-full border border-red-200 px-3 py-1 text-sm text-red-600"
                onClick={() => remove(product.id!)}
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
