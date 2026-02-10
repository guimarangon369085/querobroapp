'use client';

import { useEffect, useState } from 'react';
import type { Product } from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';
import { formatCurrencyBR, titleCase } from '@/lib/format';
import { FormField } from '@/components/form/FormField';

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
  const [error, setError] = useState<string | null>(null);

  const load = () => apiFetch<Product[]>('/products').then(setProducts);

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name || form.name.trim().length < 2) {
      setError('Informe um nome valido.');
      return;
    }
    if ((form.price ?? 0) < 0) {
      setError('Preco nao pode ser negativo.');
      return;
    }
    setError(null);

    const payload = {
      ...form,
      name: titleCase(form.name || ''),
      category: form.category ? titleCase(form.category) : '',
      unit: form.unit ? form.unit.trim().toLowerCase() : 'un',
      price: Number.isFinite(form.price) ? Math.round((form.price ?? 0) * 100) / 100 : 0
    };

    if (editingId) {
      await apiFetch(`/products/${editingId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
    } else {
      await apiFetch('/products', {
        method: 'POST',
        body: JSON.stringify(payload)
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
          <FormField label="Nome" error={error}>
            <input
              className="rounded-lg border border-neutral-200 px-3 py-2"
              placeholder="Nome do produto"
              value={form.name || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              onBlur={(e) => setForm((prev) => ({ ...prev, name: titleCase(e.target.value) }))}
            />
          </FormField>
          <FormField label="Categoria" hint="Ex: Bebidas, Lanches">
            <input
              className="rounded-lg border border-neutral-200 px-3 py-2"
              placeholder="Categoria"
              value={form.category || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
              onBlur={(e) => setForm((prev) => ({ ...prev, category: titleCase(e.target.value) }))}
            />
          </FormField>
          <FormField label="Unidade" hint="Ex: un, kg, pct">
            <input
              className="rounded-lg border border-neutral-200 px-3 py-2"
              placeholder="Unidade"
              value={form.unit || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))}
              onBlur={(e) =>
                setForm((prev) => ({
                  ...prev,
                  unit: e.target.value.trim().toLowerCase() || 'un'
                }))
              }
            />
          </FormField>
          <FormField label="Preco" hint="Use ponto para centavos">
            <input
              className="rounded-lg border border-neutral-200 px-3 py-2"
              placeholder="0.00"
              type="number"
              step="0.01"
              min={0}
              value={form.price ?? 0}
              onChange={(e) => setForm((prev) => ({ ...prev, price: Number(e.target.value) }))}
              onBlur={(e) =>
                setForm((prev) => ({
                  ...prev,
                  price: Math.round(Number(e.target.value || 0) * 100) / 100
                }))
              }
            />
          </FormField>
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
                {product.category || 'Sem categoria'} • {product.unit || 'un'} • {formatCurrencyBR(product.price)}
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
