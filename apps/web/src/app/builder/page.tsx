'use client';
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BuilderBlockKey,
  BuilderConfig,
  BuilderConfigPatch,
  BuilderLayoutPageKey,
  BuilderReceiptStockRule,
} from '@querobroapp/shared';
import {
  fetchBuilderConfigClient,
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
    subtitle: 'Cores e tipografia global do app',
  },
  {
    key: 'forms',
    label: 'Inputs e selecao',
    subtitle: 'Raio, borda, espacamento e checkbox',
  },
  {
    key: 'home',
    label: 'Home e landing',
    subtitle: 'Hero, textos e galeria de fotos',
  },
  {
    key: 'integrations',
    label: 'Integracoes e automacao',
    subtitle: 'Atalhos iOS, OCR e entrada automatica no estoque',
  },
  {
    key: 'layout',
    label: 'Blocos arrastaveis',
    subtitle: 'Ordem e visibilidade das secoes por pagina',
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
                  So itens com regra habilitada entram automaticamente no estoque como movimentacao
                  <code> IN </code> na categoria <code>INGREDIENTE</code>.
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
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-xs text-neutral-500">
                Essas configuracoes sao usadas pela API em <code>/receipts/parse</code>,{' '}
                <code>/receipts/parse-clipboard</code> e <code>/receipts/ingest</code>.
              </p>
            </div>
          ) : null}

          {activeBlock === 'layout' ? (
            <div className="grid gap-4">
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
                        <p className="builder-layout-item__title">{item.label}</p>
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
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-neutral-500">
                Arraste os blocos para reordenar. O app aplica a ordem em Dashboard, Produtos,
                Clientes, Pedidos e Estoque.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {message ? <p className="builder-status">{message}</p> : null}
    </section>
  );
}
