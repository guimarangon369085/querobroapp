'use client';
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BuilderBlockKey,
  BuilderConfig,
  BuilderConfigPatch,
  BuilderLayoutItem,
  BuilderLayoutPageKey,
  BuilderReceiptStockRule,
  BuilderSupplierPriceSource
} from '@querobroapp/shared';
import {
  fetchBuilderConfigClient,
  getApiBaseUrl,
  getDefaultBuilderConfig,
  removeBuilderHomeImageClient,
  resolveBuilderImageSrc,
  updateBuilderConfigClient,
  uploadBuilderHomeImageClient,
} from '@/lib/builder';
import { useSearchParams } from 'next/navigation';
import { consumeFocusQueryParam } from '@/lib/layout-scroll';
import { normalizeLayouts, reorderLayoutItems, shiftLayoutItem } from '@/lib/builder-layout';

type BlockItem = {
  key: BuilderBlockKey;
  label: string;
  subtitle: string;
};

const blocks: BlockItem[] = [
  {
    key: 'theme',
    label: 'Tema visual',
    subtitle: 'Cores e tipografia do aplicativo',
  },
  {
    key: 'forms',
    label: 'Inputs e selecao',
    subtitle: 'Bordas, espacamento e seletores',
  },
  {
    key: 'home',
    label: 'Home e landing',
    subtitle: 'Texto principal e galeria de fotos',
  },
  {
    key: 'integrations',
    label: 'Integracoes e automacao',
    subtitle: 'Cupom, fornecedores e atualizacao automatica',
  },
  {
    key: 'layout',
    label: 'Cards e secoes',
    subtitle: 'Ordem, visibilidade e cards personalizados',
  },
];

const layoutPageOptions: Array<{ key: BuilderLayoutPageKey; label: string }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'produtos', label: 'Produtos' },
  { key: 'clientes', label: 'Clientes' },
  { key: 'pedidos', label: 'Pedidos' },
  { key: 'estoque', label: 'Estoque' },
];

const defaultBuilderConfig = getDefaultBuilderConfig();

function notifyRuntime(config: BuilderConfig) {
  window.dispatchEvent(new CustomEvent('builder:config-updated', { detail: config }));
}

function numberFromInput(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function newCustomCardId() {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeConfigLayouts(next: BuilderConfig) {
  return {
    ...next,
    layouts: normalizeLayouts(next, defaultBuilderConfig),
  };
}

export default function BuilderPage() {
  const searchParams = useSearchParams();
  const [config, setConfig] = useState<BuilderConfig | null>(null);
  const [activeBlock, setActiveBlock] = useState<BuilderBlockKey>('theme');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>('');
  const [uploadAlt, setUploadAlt] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [activeLayoutPage, setActiveLayoutPage] = useState<BuilderLayoutPageKey>('dashboard');
  const [draggingLayoutId, setDraggingLayoutId] = useState<string | null>(null);
  const [syncingSupplierPrices, setSyncingSupplierPrices] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let mounted = true;

    fetchBuilderConfigClient()
      .then((loaded) => {
        if (!mounted) return;
        const normalized = normalizeConfigLayouts(loaded);
        setConfig(normalized);
        notifyRuntime(normalized);
      })
      .catch(() => {
        if (!mounted) return;
        const fallback = normalizeConfigLayouts(defaultBuilderConfig);
        setConfig(fallback);
        notifyRuntime(fallback);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!config) return;
    notifyRuntime(config);
  }, [config]);

  useEffect(() => {
    const focus = consumeFocusQueryParam(searchParams);
    if (!focus) return;

    if (focus === 'editor') {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(() => {
        editorRef.current
          ?.querySelector<HTMLElement>('input, select, textarea, button, [tabindex]:not([tabindex="-1"])')
          ?.focus({ preventScroll: true });
      }, 120);
      return;
    }

    if (focus === 'nav') {
      navRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [searchParams]);

  const activeMeta = useMemo(() => blocks.find((entry) => entry.key === activeBlock), [activeBlock]);
  const activeLayoutItems = useMemo(() => {
    if (!config) return [];
    return [...config.layouts[activeLayoutPage]].sort((a, b) => a.order - b.order);
  }, [config, activeLayoutPage]);

  function updateDraft(next: BuilderConfig) {
    setConfig(normalizeConfigLayouts(next));
    setMessage('Alteracoes locais prontas. Clique em "Salvar bloco" para persistir.');
  }

  async function reloadConfig() {
    setBusy(true);
    setMessage('Carregando configuracao mais recente...');
    try {
      const loaded = await fetchBuilderConfigClient();
      setConfig(normalizeConfigLayouts(loaded));
      setMessage('Configuracao recarregada da API.');
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'erro desconhecido';
      setMessage(`Falha ao recarregar: ${reason}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveBlock(block: BuilderBlockKey) {
    if (!config) return;

    let patch: BuilderConfigPatch;
    if (block === 'layout') {
      patch = { layouts: config.layouts };
    } else if (block === 'theme') {
      patch = { theme: config.theme };
    } else if (block === 'forms') {
      patch = { forms: config.forms };
    } else if (block === 'home') {
      patch = { home: config.home };
    } else {
      patch = { integrations: config.integrations };
    }

    setBusy(true);
    setMessage(`Salvando bloco "${block}"...`);

    try {
      const saved = await updateBuilderConfigClient(patch);
      setConfig(normalizeConfigLayouts(saved));
      setMessage(`Bloco "${block}" salvo com sucesso.`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'erro desconhecido';
      setMessage(`Falha ao salvar bloco "${block}": ${reason}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveAll() {
    if (!config) return;

    setBusy(true);
    setMessage('Salvando todos os blocos...');

    try {
      const saved = await updateBuilderConfigClient({
        theme: config.theme,
        forms: config.forms,
        home: config.home,
        integrations: config.integrations,
        layouts: config.layouts,
      });
      setConfig(normalizeConfigLayouts(saved));
      setMessage('Todos os blocos foram salvos.');
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'erro desconhecido';
      setMessage(`Falha ao salvar: ${reason}`);
    } finally {
      setBusy(false);
    }
  }

  async function uploadImage() {
    if (!pendingFile) {
      setMessage('Selecione uma imagem antes de enviar.');
      return;
    }

    setBusy(true);
    setMessage('Enviando imagem...');
    try {
      const result = await uploadBuilderHomeImageClient(pendingFile, uploadAlt);
      setConfig(normalizeConfigLayouts(result.config));
      setPendingFile(null);
      setUploadAlt('');
      setMessage('Imagem enviada para a galeria da home.');
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'erro desconhecido';
      setMessage(`Falha no upload: ${reason}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeImage(id: string) {
    setBusy(true);
    setMessage('Removendo imagem...');
    try {
      const next = await removeBuilderHomeImageClient(id);
      setConfig(normalizeConfigLayouts(next));
      setMessage('Imagem removida.');
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'erro desconhecido';
      setMessage(`Falha ao remover imagem: ${reason}`);
    } finally {
      setBusy(false);
    }
  }

  function updateLayoutForActivePage(nextItems: typeof activeLayoutItems) {
    if (!config) return;
    updateDraft({
      ...config,
      layouts: {
        ...config.layouts,
        [activeLayoutPage]: nextItems,
      },
    });
  }

  function toggleLayoutItemVisibility(id: string, visible: boolean) {
    const nextItems = activeLayoutItems.map((item) => (item.id === id ? { ...item, visible } : item));
    updateLayoutForActivePage(nextItems);
  }

  function moveLayoutItem(id: string, direction: -1 | 1) {
    updateLayoutForActivePage(shiftLayoutItem(activeLayoutItems, id, direction));
  }

  function startLayoutDrag(id: string) {
    setDraggingLayoutId(id);
  }

  function dropLayoutOn(targetId: string) {
    if (!draggingLayoutId) return;
    const nextItems = reorderLayoutItems(activeLayoutItems, draggingLayoutId, targetId);
    setDraggingLayoutId(null);
    updateLayoutForActivePage(nextItems);
  }

  function updateIntegrationRule(index: number, patch: Partial<BuilderReceiptStockRule>) {
    if (!config) return;
    const nextRules = config.integrations.receiptStockRules.map((rule, currentIndex) =>
      currentIndex === index ? { ...rule, ...patch } : rule
    );
    updateDraft({
      ...config,
      integrations: {
        ...config.integrations,
        receiptStockRules: nextRules,
      },
    });
  }

  function updateSupplierSource(index: number, patch: Partial<BuilderSupplierPriceSource>) {
    if (!config) return;
    const nextSources = config.integrations.supplierPriceSources.map((source, currentIndex) =>
      currentIndex === index ? { ...source, ...patch } : source
    );
    updateDraft({
      ...config,
      integrations: {
        ...config.integrations,
        supplierPriceSources: nextSources,
      },
    });
  }

  function addCustomLayoutCard() {
    if (!config) return;
    if (activeLayoutItems.length >= 40) {
      setMessage('Limite de 40 blocos atingido para esta pagina.');
      return;
    }

    const nextItems = [
      ...activeLayoutItems,
      {
        id: newCustomCardId(),
        label: 'Novo card',
        kind: 'custom',
        description: 'Descreva aqui o objetivo deste card.',
        actionLabel: '',
        actionHref: '',
        actionFocusSlot: '',
        visible: true,
        order: activeLayoutItems.length,
      } as BuilderLayoutItem,
    ].map((item, index) => ({ ...item, order: index }));

    updateLayoutForActivePage(nextItems);
  }

  function removeCustomLayoutCard(id: string) {
    const target = activeLayoutItems.find((item) => item.id === id);
    if (!target || target.kind !== 'custom') return;
    const nextItems = activeLayoutItems
      .filter((item) => item.id !== id)
      .map((item, index) => ({ ...item, order: index }));
    updateLayoutForActivePage(nextItems);
  }

  function updateLayoutItem(id: string, patch: Partial<BuilderLayoutItem>) {
    const nextItems = activeLayoutItems.map((item) => (item.id === id ? { ...item, ...patch } : item));
    updateLayoutForActivePage(nextItems);
  }

  async function syncSupplierPricesNow() {
    setSyncingSupplierPrices(true);
    setMessage('Sincronizando precos de fornecedor...');
    try {
      const response = await fetch(`${getApiBaseUrl()}/receipts/supplier-prices/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new Error(raw || `HTTP ${response.status}`);
      }

      let body: {
        appliedCount?: number;
        attemptedCount?: number;
        skippedCount?: number;
      } = {};
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        body = {};
      }

      setMessage(
        `Sincronizacao concluida: ${body.appliedCount || 0} aplicados, ${body.skippedCount || 0} ignorados em ${body.attemptedCount || 0} fontes.`
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'erro desconhecido';
      setMessage(`Falha ao sincronizar precos: ${reason}`);
    } finally {
      setSyncingSupplierPrices(false);
    }
  }

  if (!config) {
    return (
      <section className="app-panel">
        <p className="text-sm text-neutral-600">Carregando Builder...</p>
      </section>
    );
  }

  return (
    <section className="builder-page">
      <div className="app-panel builder-header">
        <div>
          <span className="app-chip">Modo LEGO</span>
          <h3 className="mt-3 text-3xl font-semibold">Builder modular interativo</h3>
          <p className="mt-2 text-sm text-neutral-700">
            Edite por blocos, veja impacto em tempo real e salve sem alterar codigo.
          </p>
        </div>
        <div className="builder-header__actions">
          <button className="app-button app-button-ghost" onClick={reloadConfig} disabled={busy}>
            Recarregar
          </button>
          <button className="app-button app-button-primary" onClick={saveAll} disabled={busy}>
            Salvar tudo
          </button>
        </div>
      </div>

      <div className="builder-grid">
        <aside ref={navRef} className="app-panel builder-nav" aria-label="Blocos do Builder">
          {blocks.map((block) => {
            const active = activeBlock === block.key;
            return (
              <button
                key={block.key}
                className={`builder-nav__item ${active ? 'builder-nav__item--active' : ''}`}
                onClick={() => {
                  setActiveBlock(block.key);
                  editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                disabled={busy}
              >
                <span className="builder-nav__label">{block.label}</span>
                <span className="builder-nav__subtitle">{block.subtitle}</span>
              </button>
            );
          })}
        </aside>

        <div id="builder-editor" ref={editorRef} className="app-panel builder-editor">
          <div className="builder-editor__header">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-neutral-500">Bloco ativo</p>
              <h4 className="mt-1 text-2xl font-semibold">{activeMeta?.label}</h4>
              <p className="mt-1 text-sm text-neutral-600">{activeMeta?.subtitle}</p>
            </div>
            <button
              className="app-button app-button-primary"
              onClick={() => saveBlock(activeBlock)}
              disabled={busy}
            >
              Salvar bloco
            </button>
          </div>

          {activeBlock === 'theme' ? (
            <div className="builder-form-grid">
              <label className="builder-field">
                Cor principal
                <input
                  type="color"
                  value={config.theme.primaryColor}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      theme: { ...config.theme, primaryColor: event.target.value },
                    })
                  }
                />
              </label>
              <label className="builder-field">
                Cor secundaria
                <input
                  type="color"
                  value={config.theme.secondaryColor}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      theme: { ...config.theme, secondaryColor: event.target.value },
                    })
                  }
                />
              </label>
              <label className="builder-field">
                Cor de fundo
                <input
                  type="color"
                  value={config.theme.backgroundColor}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      theme: { ...config.theme, backgroundColor: event.target.value },
                    })
                  }
                />
              </label>
              <label className="builder-field">
                Cor de superficie
                <input
                  type="color"
                  value={config.theme.surfaceColor}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      theme: { ...config.theme, surfaceColor: event.target.value },
                    })
                  }
                />
              </label>
              <label className="builder-field">
                Cor de texto
                <input
                  type="color"
                  value={config.theme.textColor}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      theme: { ...config.theme, textColor: event.target.value },
                    })
                  }
                />
              </label>
              <label className="builder-field">
                Cor de texto suave
                <input
                  type="color"
                  value={config.theme.mutedTextColor}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      theme: { ...config.theme, mutedTextColor: event.target.value },
                    })
                  }
                />
              </label>
              <label className="builder-field builder-field--wide">
                Fonte base (CSS font-family)
                <input
                  className="app-input"
                  value={config.theme.fontBody}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      theme: { ...config.theme, fontBody: event.target.value },
                    })
                  }
                />
              </label>
              <label className="builder-field builder-field--wide">
                Fonte de destaque (CSS font-family)
                <input
                  className="app-input"
                  value={config.theme.fontDisplay}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      theme: { ...config.theme, fontDisplay: event.target.value },
                    })
                  }
                />
              </label>
            </div>
          ) : null}

          {activeBlock === 'forms' ? (
            <div className="builder-form-grid">
              <label className="builder-field">
                Raio do input (px)
                <input
                  type="number"
                  min={0}
                  max={40}
                  className="app-input"
                  value={config.forms.inputRadius}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      forms: {
                        ...config.forms,
                        inputRadius: numberFromInput(event.target.value, config.forms.inputRadius),
                      },
                    })
                  }
                />
              </label>
              <label className="builder-field">
                Padding vertical (px)
                <input
                  type="number"
                  min={6}
                  max={30}
                  className="app-input"
                  value={config.forms.inputPaddingY}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      forms: {
                        ...config.forms,
                        inputPaddingY: numberFromInput(event.target.value, config.forms.inputPaddingY),
                      },
                    })
                  }
                />
              </label>
              <label className="builder-field">
                Padding horizontal (px)
                <input
                  type="number"
                  min={8}
                  max={40}
                  className="app-input"
                  value={config.forms.inputPaddingX}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      forms: {
                        ...config.forms,
                        inputPaddingX: numberFromInput(event.target.value, config.forms.inputPaddingX),
                      },
                    })
                  }
                />
              </label>
              <label className="builder-field">
                Espessura da borda (px)
                <input
                  type="number"
                  min={1}
                  max={4}
                  className="app-input"
                  value={config.forms.inputBorderWidth}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      forms: {
                        ...config.forms,
                        inputBorderWidth: numberFromInput(
                          event.target.value,
                          config.forms.inputBorderWidth
                        ),
                      },
                    })
                  }
                />
              </label>
              <label className="builder-field">
                Cor do checkbox/radio
                <input
                  type="color"
                  value={config.forms.checkboxAccentColor}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      forms: { ...config.forms, checkboxAccentColor: event.target.value },
                    })
                  }
                />
              </label>
            </div>
          ) : null}

          {activeBlock === 'home' ? (
            <div className="grid gap-4">
              <label className="builder-field builder-field--wide">
                Kicker
                <input
                  className="app-input"
                  value={config.home.kicker}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      home: { ...config.home, kicker: event.target.value },
                    })
                  }
                />
              </label>
              <label className="builder-field builder-field--wide">
                Titulo
                <input
                  className="app-input"
                  value={config.home.title}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      home: { ...config.home, title: event.target.value },
                    })
                  }
                />
              </label>
              <label className="builder-field builder-field--wide">
                Descricao
                <textarea
                  className="app-textarea"
                  rows={4}
                  value={config.home.description}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      home: { ...config.home, description: event.target.value },
                    })
                  }
                />
              </label>

              <div className="builder-upload app-panel">
                <p className="text-sm font-semibold">Upload de foto da home</p>
                <div className="builder-upload__grid">
                  <input
                    className="app-input"
                    type="file"
                    accept="image/*"
                    onChange={(event) => setPendingFile(event.target.files?.[0] || null)}
                  />
                  <input
                    className="app-input"
                    placeholder="Texto alternativo da imagem"
                    value={uploadAlt}
                    onChange={(event) => setUploadAlt(event.target.value)}
                  />
                  <button className="app-button app-button-primary" onClick={uploadImage} disabled={busy}>
                    Enviar imagem
                  </button>
                </div>
              </div>

              <div className="builder-gallery-list">
                {config.home.gallery.map((image) => (
                  <div key={image.id} className="builder-gallery-item">
                    <img src={resolveBuilderImageSrc(image.src)} alt={image.alt} />
                    <div className="builder-gallery-item__fields">
                      <input
                        className="app-input"
                        value={image.alt}
                        onChange={(event) =>
                          updateDraft({
                            ...config,
                            home: {
                              ...config.home,
                              gallery: config.home.gallery.map((entry) =>
                                entry.id === image.id ? { ...entry, alt: event.target.value } : entry
                              ),
                            },
                          })
                        }
                      />
                      <p className="text-xs text-neutral-500">{image.src}</p>
                    </div>
                    <button
                      className="app-button app-button-ghost"
                      onClick={() => removeImage(image.id)}
                      disabled={busy}
                    >
                      Remover
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {activeBlock === 'integrations' ? (
            <div className="builder-form-grid">
              <label className="builder-field builder-field--wide">
                <span>Atalhos iOS habilitados</span>
                <input
                  type="checkbox"
                  checked={config.integrations.shortcutsEnabled}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      integrations: {
                        ...config.integrations,
                        shortcutsEnabled: event.target.checked,
                      },
                    })
                  }
                />
              </label>

              <label className="builder-field builder-field--wide">
                <span>Lancar entradas no estoque automaticamente</span>
                <input
                  type="checkbox"
                  checked={config.integrations.receiptsAutoIngestEnabled}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      integrations: {
                        ...config.integrations,
                        receiptsAutoIngestEnabled: event.target.checked,
                      },
                    })
                  }
                />
              </label>

              <label className="builder-field builder-field--wide">
                <span>Atualizar custos por fornecedores</span>
                <input
                  type="checkbox"
                  checked={config.integrations.supplierPricesEnabled}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      integrations: {
                        ...config.integrations,
                        supplierPricesEnabled: event.target.checked,
                      },
                    })
                  }
                />
              </label>

              <div className="builder-field builder-field--wide">
                <span>Sincronizacao imediata de preco</span>
                <button
                  className="app-button app-button-ghost"
                  onClick={syncSupplierPricesNow}
                  disabled={syncingSupplierPrices}
                >
                  {syncingSupplierPrices ? 'Sincronizando...' : 'Sincronizar agora'}
                </button>
              </div>

              <label className="builder-field builder-field--wide">
                Webhook/Endpoint do Atalho
                <input
                  className="app-input"
                  placeholder="https://..."
                  value={config.integrations.shortcutsWebhookUrl}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      integrations: {
                        ...config.integrations,
                        shortcutsWebhookUrl: event.target.value,
                      },
                    })
                  }
                />
              </label>

              <label className="builder-field builder-field--wide">
                Observacoes operacionais
                <textarea
                  rows={3}
                  className="app-textarea"
                  value={config.integrations.shortcutsNotes}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      integrations: {
                        ...config.integrations,
                        shortcutsNotes: event.target.value,
                      },
                    })
                  }
                />
              </label>

              <label className="builder-field builder-field--wide">
                Prompt padrao para OCR de cupom
                <textarea
                  rows={6}
                  className="app-textarea"
                  value={config.integrations.receiptsPrompt}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      integrations: {
                        ...config.integrations,
                        receiptsPrompt: event.target.value,
                      },
                    })
                  }
                />
              </label>

              <label className="builder-field">
                Separador de colunas
                <input
                  className="app-input"
                  maxLength={4}
                  value={config.integrations.receiptsSeparator}
                  onChange={(event) =>
                    updateDraft({
                      ...config,
                      integrations: {
                        ...config.integrations,
                        receiptsSeparator: event.target.value,
                      },
                    })
                  }
                />
              </label>

              <div className="builder-field builder-field--wide">
                <span>Regras de itens de producao (editavel)</span>
                <p className="text-xs text-neutral-500">
                  Cada item pode entrar automaticamente com quantidade real por embalagem e custo real de compra.
                </p>
                <div className="builder-stock-rules">
                  {config.integrations.receiptStockRules.map((rule, index) => (
                    <div key={rule.officialItem} className="builder-stock-rule-item">
                      <div className="builder-stock-rule-item__header">
                        <p className="builder-stock-rule-item__title">{rule.officialItem}</p>
                        <label className="builder-layout-item__toggle">
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            onChange={(event) =>
                              updateIntegrationRule(index, { enabled: event.target.checked })
                            }
                          />
                          Automatizar
                        </label>
                      </div>
                      <div className="builder-stock-rule-item__grid">
                        <label className="builder-field">
                          Nome do item no estoque
                          <input
                            className="app-input"
                            value={rule.inventoryItemName}
                            onChange={(event) =>
                              updateIntegrationRule(index, {
                                inventoryItemName: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label className="builder-field">
                          Multiplicador da quantidade
                          <input
                            className="app-input"
                            type="number"
                            min={0.001}
                            max={100}
                            step={0.001}
                            value={rule.quantityMultiplier}
                            onChange={(event) =>
                              updateIntegrationRule(index, {
                                quantityMultiplier: numberFromInput(
                                  event.target.value,
                                  rule.quantityMultiplier
                                ),
                              })
                            }
                          />
                        </label>
                        <label className="builder-field">
                          Modo de quantidade
                          <select
                            className="app-select"
                            value={rule.quantityMode}
                            onChange={(event) =>
                              updateIntegrationRule(index, {
                                quantityMode: event.target.value as BuilderReceiptStockRule['quantityMode'],
                              })
                            }
                          >
                            <option value="PURCHASE_PACK">Multiplicar pelo tamanho da embalagem</option>
                            <option value="BASE_UNIT">Usar quantidade como unidade base</option>
                          </select>
                        </label>
                        <label className="builder-field">
                          Multiplicador do custo da embalagem
                          <input
                            className="app-input"
                            type="number"
                            min={0.001}
                            max={100}
                            step={0.001}
                            value={rule.purchasePackCostMultiplier}
                            onChange={(event) =>
                              updateIntegrationRule(index, {
                                purchasePackCostMultiplier: numberFromInput(
                                  event.target.value,
                                  rule.purchasePackCostMultiplier
                                ),
                              })
                            }
                          />
                        </label>
                        <label className="builder-field">
                          Rotulo amigavel da origem
                          <input
                            className="app-input"
                            value={rule.sourceLabel || ''}
                            onChange={(event) =>
                              updateIntegrationRule(index, { sourceLabel: event.target.value })
                            }
                          />
                        </label>
                        <label className="builder-field">
                          Atualizar custo do estoque
                          <input
                            type="checkbox"
                            checked={rule.applyPriceToInventoryCost}
                            onChange={(event) =>
                              updateIntegrationRule(index, {
                                applyPriceToInventoryCost: event.target.checked,
                              })
                            }
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="builder-field builder-field--wide">
                <span>Fontes de preco por fornecedor</span>
                <div className="builder-stock-rules">
                  {config.integrations.supplierPriceSources.map((source, index) => (
                    <div key={source.id} className="builder-stock-rule-item">
                      <div className="builder-stock-rule-item__header">
                        <p className="builder-stock-rule-item__title">{source.officialItem}</p>
                        <label className="builder-layout-item__toggle">
                          <input
                            type="checkbox"
                            checked={source.enabled}
                            onChange={(event) =>
                              updateSupplierSource(index, { enabled: event.target.checked })
                            }
                          />
                          Ativa
                        </label>
                      </div>
                      <div className="builder-stock-rule-item__grid">
                        <label className="builder-field">
                          Nome do fornecedor
                          <input
                            className="app-input"
                            value={source.supplierName}
                            onChange={(event) =>
                              updateSupplierSource(index, { supplierName: event.target.value })
                            }
                          />
                        </label>
                        <label className="builder-field">
                          Item no estoque
                          <input
                            className="app-input"
                            value={source.inventoryItemName}
                            onChange={(event) =>
                              updateSupplierSource(index, { inventoryItemName: event.target.value })
                            }
                          />
                        </label>
                        <label className="builder-field builder-field--wide">
                          URL do produto
                          <input
                            className="app-input"
                            value={source.url}
                            onChange={(event) => updateSupplierSource(index, { url: event.target.value })}
                          />
                        </label>
                        <label className="builder-field builder-field--wide">
                          XPath de referencia (opcional)
                          <input
                            className="app-input"
                            value={source.priceXPath || ''}
                            onChange={(event) =>
                              updateSupplierSource(index, { priceXPath: event.target.value })
                            }
                          />
                        </label>
                        <label className="builder-field">
                          Preco fallback
                          <input
                            className="app-input"
                            type="number"
                            min={0}
                            step={0.01}
                            value={source.fallbackPrice ?? ''}
                            onChange={(event) =>
                              updateSupplierSource(index, {
                                fallbackPrice: event.target.value
                                  ? numberFromInput(event.target.value, source.fallbackPrice || 0)
                                  : null,
                              })
                            }
                          />
                        </label>
                        <label className="builder-field">
                          Aplicar no custo do estoque
                          <input
                            type="checkbox"
                            checked={source.applyToInventoryCost}
                            onChange={(event) =>
                              updateSupplierSource(index, {
                                applyToInventoryCost: event.target.checked,
                              })
                            }
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-xs text-neutral-500">
                Essas configuracoes sao usadas pelos fluxos de cupom e sincronizacao de preco.
              </p>
            </div>
          ) : null}

          {activeBlock === 'layout' ? (
            <div className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <label className="builder-field builder-field--wide">
                  Pagina
                  <select
                    className="app-select"
                    value={activeLayoutPage}
                    onChange={(event) => setActiveLayoutPage(event.target.value as BuilderLayoutPageKey)}
                  >
                    {layoutPageOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="app-button app-button-primary self-end" onClick={addCustomLayoutCard}>
                  Adicionar card
                </button>
              </div>

              <div className="builder-layout-list">
                {activeLayoutItems.map((item) => (
                  <div
                    key={item.id}
                    className={`builder-layout-item ${draggingLayoutId === item.id ? 'builder-layout-item--dragging' : ''}`}
                    draggable
                    onDragStart={() => startLayoutDrag(item.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => dropLayoutOn(item.id)}
                  >
                    <div className="builder-layout-item__main">
                      <div>
                        <p className="builder-layout-item__title">{item.kind === 'custom' ? 'Card personalizado' : 'Secao da pagina'}</p>
                        <p className="builder-layout-item__id">{item.id}</p>
                      </div>
                      <label className="builder-layout-item__toggle">
                        <input
                          type="checkbox"
                          checked={item.visible}
                          onChange={(event) => toggleLayoutItemVisibility(item.id, event.target.checked)}
                        />
                        Visivel
                      </label>
                    </div>
                    <label className="builder-field">
                      Nome do card
                      <input
                        className="app-input"
                        value={item.label}
                        onChange={(event) => updateLayoutItem(item.id, { label: event.target.value })}
                      />
                    </label>
                    {item.kind === 'custom' ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="builder-field md:col-span-2">
                          Descricao
                          <textarea
                            className="app-textarea"
                            rows={2}
                            value={item.description || ''}
                            onChange={(event) =>
                              updateLayoutItem(item.id, { description: event.target.value })
                            }
                          />
                        </label>
                        <label className="builder-field">
                          Texto do botao
                          <input
                            className="app-input"
                            value={item.actionLabel || ''}
                            onChange={(event) =>
                              updateLayoutItem(item.id, { actionLabel: event.target.value })
                            }
                          />
                        </label>
                        <label className="builder-field">
                          Link de acao (opcional)
                          <input
                            className="app-input"
                            placeholder="/estoque?focus=movement"
                            value={item.actionHref || ''}
                            onChange={(event) =>
                              updateLayoutItem(item.id, { actionHref: event.target.value })
                            }
                          />
                        </label>
                        <label className="builder-field md:col-span-2">
                          Foco interno (opcional)
                          <input
                            className="app-input"
                            placeholder="movement"
                            value={item.actionFocusSlot || ''}
                            onChange={(event) =>
                              updateLayoutItem(item.id, { actionFocusSlot: event.target.value })
                            }
                          />
                        </label>
                      </div>
                    ) : null}
                    <div className="builder-layout-item__actions">
                      <button
                        className="app-button app-button-ghost"
                        onClick={() => moveLayoutItem(item.id, -1)}
                        disabled={busy}
                      >
                        Subir
                      </button>
                      <button
                        className="app-button app-button-ghost"
                        onClick={() => moveLayoutItem(item.id, 1)}
                        disabled={busy}
                      >
                        Descer
                      </button>
                      {item.kind === 'custom' ? (
                        <button
                          className="app-button app-button-danger"
                          onClick={() => removeCustomLayoutCard(item.id)}
                          disabled={busy}
                        >
                          Excluir
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-neutral-500">
                Arraste para reordenar. Cards personalizados aparecem automaticamente no fim de cada pagina.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {message ? <p className="builder-status">{message}</p> : null}
    </section>
  );
}
