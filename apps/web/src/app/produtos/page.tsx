'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Product } from '@querobroapp/shared';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatCurrencyBR, formatMoneyInputBR, parseCurrencyBR, titleCase } from '@/lib/format';
import { consumeFocusQueryParam, scrollToLayoutSlot } from '@/lib/layout-scroll';
import { useSurfaceMode } from '@/hooks/use-surface-mode';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { useFeedback } from '@/components/feedback-provider';
import { FormField } from '@/components/form/FormField';
import { OnboardingTourCard } from '@/components/onboarding-tour-card';
import {
  BuilderLayoutCustomCards,
  BuilderLayoutItemSlot,
  BuilderLayoutProvider
} from '@/components/builder-layout';

const emptyProduct: Partial<Product> = {
  name: '',
  category: '',
  unit: 'un',
  price: 0,
  active: true
};

const productQuickTemplates: Array<{ label: string; helper: string; values: Partial<Product> }> = [
  {
    label: 'Broa',
    helper: 'Produto final para venda.',
    values: { category: 'Broas', unit: 'un', active: true }
  },
  {
    label: 'Sabor',
    helper: 'Recheio/sabor para combinacoes.',
    values: { category: 'Sabores', unit: 'un', active: true }
  },
  {
    label: 'Bebida',
    helper: 'Itens de bebidas do catalogo.',
    values: { category: 'Bebidas', unit: 'un', active: true }
  },
  {
    label: 'Embalagem',
    helper: 'Uso interno de embalagem.',
    values: { category: 'Embalagens', unit: 'un', active: true }
  }
];

const TUTORIAL_QUERY_VALUE = 'primeira_vez';

function ProductsPageContent() {
  const searchParams = useSearchParams();
  const { tutorialMode, isSpotlightSlot } = useTutorialSpotlight(searchParams, TUTORIAL_QUERY_VALUE);
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<Partial<Product>>(emptyProduct);
  const [priceInput, setPriceInput] = useState('0,00');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'TODOS' | 'ATIVOS' | 'INATIVOS'>('TODOS');
  const { isOperationMode } = useSurfaceMode('produtos');
  const productNameInputRef = useRef<HTMLInputElement | null>(null);
  const { confirm, notifyError, notifyInfo, notifySuccess, notifyUndo } = useFeedback();

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

  useEffect(() => {
    const focus = consumeFocusQueryParam(searchParams);
    if (!focus) return;

    const allowed = new Set(['header', 'note', 'load_error', 'kpis_filters', 'form', 'list']);
    if (!allowed.has(focus)) return;

    scrollToLayoutSlot(focus, {
      focus: focus === 'form',
      focusSelector: focus === 'form' ? 'input, select, textarea' : undefined
    });
  }, [searchParams]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsedPrice = parseCurrencyBR(priceInput);

    if (!form.name || form.name.trim().length < 2) {
      setError('Informe um nome valido.');
      return;
    }
    if (parsedPrice < 0) {
      setError('Preco nao pode ser negativo.');
      return;
    }
    setError(null);

    const payload = {
      ...form,
      name: titleCase(form.name || ''),
      category: form.category ? titleCase(form.category) : '',
      unit: form.unit ? form.unit.trim().toLowerCase() : 'un',
      price: Math.round(parsedPrice * 100) / 100
    };

    try {
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
      setPriceInput('0,00');
      setEditingId(null);
      await load();
      notifySuccess(editingId ? 'Produto atualizado com sucesso.' : 'Produto criado com sucesso.');
      scrollToLayoutSlot('list');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel salvar o produto.');
    }
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
    setPriceInput(formatMoneyInputBR(product.price) || '0,00');
    scrollToLayoutSlot('form', { focus: true, focusSelector: 'input, select, textarea' });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyProduct);
    setPriceInput('0,00');
  };

  const applyTemplate = (template: (typeof productQuickTemplates)[number]) => {
    setForm((prev) => ({
      ...prev,
      ...template.values,
      name: prev.name || ''
    }));
    productNameInputRef.current?.focus();
  };

  const remove = async (id: number) => {
    const productToRestore = products.find((entry) => entry.id === id);
    const accepted = await confirm({
      title: 'Remover produto?',
      description: 'Essa acao remove o produto da lista. Se houver vinculos, ele pode ser arquivado.',
      confirmLabel: 'Remover',
      cancelLabel: 'Cancelar',
      danger: true
    });
    if (!accepted) return;
    try {
      const result = await apiFetch<{ archived?: boolean; deleted?: boolean }>(`/products/${id}`, {
        method: 'DELETE'
      });
      if (result?.archived) {
        notifyInfo('Produto arquivado porque possui pedidos, movimentacoes ou ficha tecnica vinculados.');
      } else if (result?.deleted) {
        if (editingId === id) {
          cancelEdit();
        }
        if (productToRestore) {
          notifyUndo(`Produto ${productToRestore.name} removido com sucesso.`, async () => {
            await apiFetch('/products', {
              method: 'POST',
              body: JSON.stringify({
                name: productToRestore.name,
                category: productToRestore.category ?? '',
                unit: productToRestore.unit ?? 'un',
                price: productToRestore.price ?? 0,
                active: productToRestore.active ?? true
              })
            });
            await load();
            notifySuccess('Produto restaurado com sucesso.');
            scrollToLayoutSlot('list');
          });
        } else {
          notifySuccess('Produto removido com sucesso.');
        }
      }
      await load();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel remover o produto.');
    }
  };

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const effectiveFilter = isOperationMode ? 'ATIVOS' : activeFilter;
    return products.filter((product) => {
      if (effectiveFilter === 'ATIVOS' && !product.active) return false;
      if (effectiveFilter === 'INATIVOS' && product.active) return false;
      if (!query) return true;
      return (
        product.name.toLowerCase().includes(query) ||
        (product.category || '').toLowerCase().includes(query) ||
        `${product.id}`.includes(query)
      );
    });
  }, [activeFilter, isOperationMode, products, search]);

  return (
    <BuilderLayoutProvider page="produtos">
      <section className="grid gap-8">
        <BuilderLayoutItemSlot
          id="header"
          className={isSpotlightSlot('header') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'}
        >
          <div className="app-section-title">
            <div>
              <span className="app-chip">Catalogo</span>
              <h2 className="mt-3 text-3xl font-semibold">Produtos e sabores</h2>
              <p className="text-neutral-600">
                Gerencie broas/produtos e variedades de sabor no mesmo cadastro.
              </p>
            </div>
          </div>
          {tutorialMode ? (
            <OnboardingTourCard
              stepLabel="Tutorial 1a vez · passo 1 de 5"
              title="Cadastre a broa base antes de vender"
              description="O produto e o ponto de partida do sistema. Sem ele, nao existe pedido, preco nem ficha tecnica."
              points={[
                { label: 'Agora', value: 'Crie 1 produto real com nome e preco.' },
                { label: 'Depois', value: 'Siga para a ficha tecnica e conecte os insumos.' }
              ]}
              actions={[
                {
                  label: 'Ir para ficha tecnica',
                  href: '/estoque?focus=bom&tutorial=primeira_vez',
                  variant: 'primary'
                },
                {
                  label: 'Pular para clientes',
                  href: '/clientes?focus=form&tutorial=primeira_vez',
                  variant: 'ghost'
                }
              ]}
            />
          ) : null}
          {isOperationMode ? (
            <div className="app-quickflow app-quickflow--columns mt-4">
              <button
                type="button"
                className={`app-quickflow__step text-left ${form.name ? 'app-quickflow__step--done' : ''}`}
                onClick={() => scrollToLayoutSlot('form', { focus: true })}
              >
                <p className="app-quickflow__step-title">1. Cadastro rapido</p>
                <p className="app-quickflow__step-subtitle">Template + nome + preco para publicar.</p>
              </button>
              <button
                type="button"
                className={`app-quickflow__step text-left ${filteredProducts.length > 0 ? 'app-quickflow__step--done' : ''}`}
                onClick={() => scrollToLayoutSlot('list', { focus: true })}
              >
                <p className="app-quickflow__step-title">2. Revisar ativos</p>
                <p className="app-quickflow__step-subtitle">Lista operacional mostrando apenas itens ativos.</p>
              </button>
            </div>
          ) : (
            <div className="app-quickflow app-quickflow--columns mt-4">
              <button
                type="button"
                className="app-quickflow__step text-left"
                onClick={() => scrollToLayoutSlot('kpis_filters', { focus: true })}
              >
                <p className="app-quickflow__step-title">1. Auditar filtros</p>
                <p className="app-quickflow__step-subtitle">Cruze ativos, inativos e busca textual.</p>
              </button>
              <button
                type="button"
                className="app-quickflow__step text-left"
                onClick={() => scrollToLayoutSlot('form', { focus: true })}
              >
                <p className="app-quickflow__step-title">2. Ajustar categoria</p>
                <p className="app-quickflow__step-subtitle">Gerencie unidade, status e taxonomia.</p>
              </button>
            </div>
          )}
        </BuilderLayoutItemSlot>

        <BuilderLayoutItemSlot id="note">
          <div className="app-panel">
            <p className="text-sm text-neutral-600">Use a categoria &quot;Sabores&quot; para separar os recheios.</p>
          </div>
        </BuilderLayoutItemSlot>

        <BuilderLayoutItemSlot id="load_error">
          {loadError ? (
            <div className="app-panel">
              <p className="text-sm text-red-700">Nao foi possivel carregar produtos: {loadError}</p>
            </div>
          ) : null}
        </BuilderLayoutItemSlot>

        <BuilderLayoutItemSlot
          id="kpis_filters"
          className={
            isSpotlightSlot('kpis_filters') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'
          }
        >
          <div className="grid gap-3 md:grid-cols-3">
            <div className="app-kpi">
              <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Produtos</p>
              <p className="mt-2 text-3xl font-semibold">{products.length}</p>
            </div>
            <div className="app-panel md:col-span-2">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  className="app-input md:w-auto"
                  placeholder={
                    isOperationMode
                      ? 'Buscar produto ativo por nome ou categoria'
                      : 'Buscar por nome ou categoria'
                  }
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {!isOperationMode ? (
                  <select
                    className="app-select"
                    value={activeFilter}
                    onChange={(e) =>
                      setActiveFilter(e.target.value as 'TODOS' | 'ATIVOS' | 'INATIVOS')
                    }
                  >
                    <option value="TODOS">Todos</option>
                    <option value="ATIVOS">Ativos</option>
                    <option value="INATIVOS">Inativos</option>
                  </select>
                ) : (
                  <span className="text-xs text-neutral-500">Mostrando apenas produtos ativos.</span>
                )}
              </div>
            </div>
          </div>
        </BuilderLayoutItemSlot>

        <BuilderLayoutItemSlot
          id="form"
          className={isSpotlightSlot('form') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'}
        >
          <form onSubmit={submit} className="app-panel grid gap-5">
            <div className="grid gap-2">
              <p className="text-sm font-semibold text-neutral-700">Preenchimento rapido</p>
              <div className="app-inline-actions">
                {productQuickTemplates.map((template) => (
                  <button
                    key={template.label}
                    type="button"
                    className="app-button app-button-ghost"
                    title={template.helper}
                    onClick={() => applyTemplate(template)}
                  >
                    {template.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-neutral-500">
                Selecione um atalho e complete apenas nome e preco.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <FormField label="Nome" error={error}>
                <input
                  className="app-input"
                  placeholder="Nome do produto"
                  ref={productNameInputRef}
                  value={form.name || ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  onBlur={(e) => setForm((prev) => ({ ...prev, name: titleCase(e.target.value) }))}
                />
              </FormField>
              <FormField label="Preco" hint="Ex: 12,50">
                <input
                  className="app-input"
                  placeholder="0,00"
                  inputMode="decimal"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  onBlur={() => {
                    const formatted = formatMoneyInputBR(priceInput || '0');
                    setPriceInput(formatted || '0,00');
                    setForm((prev) => ({ ...prev, price: parseCurrencyBR(formatted || '0') }));
                  }}
                />
              </FormField>
            </div>

            {isOperationMode ? null : (
              <details className="app-details" open>
                <summary>Campos avancados (categoria, unidade e status)</summary>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <FormField label="Categoria" hint="Ex: Broas, Sabores, Bebidas">
                    <input
                      className="app-input"
                      placeholder="Categoria"
                      value={form.category || ''}
                      onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                      onBlur={(e) =>
                        setForm((prev) => ({ ...prev, category: titleCase(e.target.value) }))
                      }
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
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    checked={form.active ?? true}
                    onChange={(e) => setForm((prev) => ({ ...prev, active: e.target.checked }))}
                  />
                  Produto ativo
                </label>
              </details>
            )}
            <div className="app-form-actions app-form-actions--mobile-sticky">
              <button className="app-button app-button-primary" type="submit">
                {editingId ? 'Atualizar' : 'Criar'}
              </button>
              {editingId && (
                <button
                  className="app-button app-button-ghost"
                  type="button"
                  onClick={cancelEdit}
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </BuilderLayoutItemSlot>

        <BuilderLayoutItemSlot
          id="list"
          className={isSpotlightSlot('list') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'}
        >
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
                        {product.category || 'Sem categoria'} • {product.unit || 'un'} •{' '}
                        {formatCurrencyBR(product.price)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button className="app-button app-button-ghost" onClick={() => startEdit(product)}>
                        Editar
                      </button>
                      <Link className="app-button app-button-ghost" href={`/estoque?bomProductId=${product.id}`}>
                        Ficha tecnica
                      </Link>
                      {!isOperationMode ? (
                        <button className="app-button app-button-danger" onClick={() => remove(product.id!)}>
                          Remover
                        </button>
                      ) : null}
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
        </BuilderLayoutItemSlot>

        {!isOperationMode ? <BuilderLayoutCustomCards /> : null}
      </section>
    </BuilderLayoutProvider>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={null}>
      <ProductsPageContent />
    </Suspense>
  );
}
