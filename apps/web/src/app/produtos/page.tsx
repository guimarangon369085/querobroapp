'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'TODOS' | 'ATIVOS' | 'INATIVOS'>('TODOS');

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<Product[]>('/products');
      setProducts(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Falha ao carregar catalogo.');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => {
      // erro tratado via loadError
    });
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
    if (!confirm('Remover este produto?')) return;
    try {
      const result = await apiFetch<{ archived?: boolean; deleted?: boolean }>(`/products/${id}`, {
        method: 'DELETE'
      });
      if (result?.archived) {
        alert('Produto arquivado porque possui pedidos, movimentacoes ou ficha tecnica vinculados.');
      } else if (result?.deleted) {
        alert('Produto removido.');
      }
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Nao foi possivel remover o produto.');
    }
  };

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      if (activeFilter === 'ATIVOS' && !product.active) return false;
      if (activeFilter === 'INATIVOS' && product.active) return false;
      if (!query) return true;
      return (
        product.name.toLowerCase().includes(query) ||
        (product.category || '').toLowerCase().includes(query) ||
        `${product.id}`.includes(query)
      );
    });
  }, [products, search, activeFilter]);

  return (
    <section className="grid gap-8">
      <div className="app-section-title">
        <div>
          <span className="app-chip">Catalogo</span>
          <h2 className="mt-3 text-3xl font-semibold">Produtos e sabores</h2>
          <p className="text-neutral-600">
            Gerencie broas/produtos e variedades de sabor no mesmo cadastro.
          </p>
        </div>
      </div>

      <div className="app-panel">
        <p className="text-sm text-neutral-600">
          Convencao atual: cada sabor/variedade e cadastrado como <strong>produto</strong> na
          categoria <strong>Sabores</strong> (ex.: T, G, S, R, D).
        </p>
      </div>

      {loadError ? (
        <div className="app-panel">
          <p className="text-sm text-red-700">Nao foi possivel carregar produtos: {loadError}</p>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="app-kpi">
          <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Produtos</p>
          <p className="mt-2 text-3xl font-semibold">{products.length}</p>
        </div>
        <div className="app-panel md:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            <input
              className="app-input md:w-auto"
              placeholder="Buscar por nome ou categoria"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="app-select"
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value as 'TODOS' | 'ATIVOS' | 'INATIVOS')}
            >
              <option value="TODOS">Todos</option>
              <option value="ATIVOS">Ativos</option>
              <option value="INATIVOS">Inativos</option>
            </select>
          </div>
        </div>
      </div>

      <form onSubmit={submit} className="app-panel grid gap-5">
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Nome" error={error}>
            <input
              className="app-input"
              placeholder="Nome do produto"
              value={form.name || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              onBlur={(e) => setForm((prev) => ({ ...prev, name: titleCase(e.target.value) }))}
            />
          </FormField>
          <FormField label="Categoria" hint="Ex: Bebidas, Lanches">
            <input
              className="app-input"
              placeholder="Categoria (ex.: Sabores)"
              value={form.category || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
              onBlur={(e) => setForm((prev) => ({ ...prev, category: titleCase(e.target.value) }))}
            />
          </FormField>
          <FormField label="Unidade" hint="Ex: un, kg, pct">
            <input
              className="app-input"
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
              className="app-input"
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
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={form.active ?? true}
            onChange={(e) => setForm((prev) => ({ ...prev, active: e.target.checked }))}
          />
          Ativo
        </label>
        <div className="flex gap-3">
          <button className="app-button app-button-primary" type="submit">
            {editingId ? 'Atualizar' : 'Criar'}
          </button>
          {editingId && (
            <button
              className="app-button app-button-ghost"
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
        {loading ? (
          <div className="app-panel border-dashed text-sm text-neutral-500">
            Carregando produtos...
          </div>
        ) : (
          <>
            {filteredProducts.map((product) => (
              <div
                key={product.id}
                className="app-panel flex flex-wrap items-center justify-between gap-4"
              >
                <div>
                  <p className="text-lg font-semibold">{product.name}</p>
                  <p className="text-sm text-neutral-500">
                    {product.category || 'Sem categoria'} • {product.unit || 'un'} • {formatCurrencyBR(product.price)}
                  </p>
                </div>
            <div className="flex gap-2">
              <button
                className="app-button app-button-ghost"
                onClick={() => startEdit(product)}
              >
                Editar
              </button>
              <Link
                className="app-button app-button-ghost"
                href={`/estoque?bomProductId=${product.id}`}
              >
                Ficha tecnica
              </Link>
              <button
                className="app-button app-button-danger"
                onClick={() => remove(product.id!)}
              >
                Remover
                  </button>
                </div>
              </div>
            ))}
            {filteredProducts.length === 0 && (
              <div className="app-panel border-dashed text-sm text-neutral-500">
                {products.length === 0
                  ? 'Sem produtos/sabores ainda — cadastre o primeiro.'
                  : 'Nenhum produto encontrado com este filtro.'}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
