'use client';

import { useEffect, useMemo, useState } from 'react';
import { DeliveryPricingConfigSchema } from '@querobroapp/shared';
import type { DeliveryPricingConfig } from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';

const EMPTY_MESSAGE = 'FORA DA ÁREA DE ENTREGA';

function formatMoneyInput(value: number) {
  return Number.isFinite(value) ? String(value).replace('.', ',') : '0';
}

function parseMoneyInput(value: string) {
  const normalized = String(value || '').trim().replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDistanceInput(value: string) {
  const normalized = String(value || '').trim().replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildRangeLabel(index: number, maxKm: number, previousMaxKm: number | null) {
  if (index === 0 || previousMaxKm == null) {
    return `Até ${maxKm} km`;
  }
  return `${previousMaxKm + 1}-${maxKm} km`;
}

export default function FreteScreen() {
  const [config, setConfig] = useState<DeliveryPricingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await apiFetch<DeliveryPricingConfig>('/deliveries/pricing-config');
        if (!active) return;
        setConfig(DeliveryPricingConfigSchema.parse(result));
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar tabela de frete.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const orderedTiers = useMemo(
    () =>
      (config?.tiers || [])
        .map((tier, sourceIndex) => ({ ...tier, sourceIndex }))
        .sort((left, right) => left.maxKm - right.maxKm),
    [config?.tiers]
  );

  function updateTier(index: number, patch: Partial<DeliveryPricingConfig['tiers'][number]>) {
    setConfig((current) => {
      if (!current) return current;
      const nextTiers = current.tiers.map((tier, tierIndex) =>
        tierIndex === index
          ? {
              ...tier,
              ...patch
            }
          : tier
      );
      return {
        ...current,
        tiers: nextTiers
      };
    });
    setSuccess(null);
  }

  function removeTier(index: number) {
    setConfig((current) => {
      if (!current || current.tiers.length <= 1) return current;
      return {
        ...current,
        tiers: current.tiers.filter((_, tierIndex) => tierIndex !== index)
      };
    });
    setSuccess(null);
  }

  function addTier() {
    setConfig((current) => {
      if (!current) return current;
      const lastTier = [...current.tiers].sort((left, right) => left.maxKm - right.maxKm).at(-1);
      const nextMaxKm = lastTier ? Math.max(Math.round(lastTier.maxKm + 5), lastTier.maxKm + 1) : 5;
      const nextFee = lastTier?.fee ?? current.fallbackWithoutCoordinatesFee ?? 12;
      return {
        ...current,
        tiers: [...current.tiers, { maxKm: nextMaxKm, fee: nextFee }]
      };
    });
    setSuccess(null);
  }

  async function saveConfig() {
    if (!config) return;
    try {
      setSaving(true);
      setError(null);
      const payload = {
        ...config,
        outOfAreaMessage: String(config.outOfAreaMessage || '').trim() || EMPTY_MESSAGE
      };
      const result = await apiFetch<DeliveryPricingConfig>('/deliveries/pricing-config', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      setConfig(DeliveryPricingConfigSchema.parse(result));
      setSuccess('Tabela atualizada.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao salvar tabela de frete.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(234,223,200,0.46),transparent_32%),linear-gradient(180deg,#fbf4ea_0%,#f7efe3_100%)] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <section className="rounded-[28px] border border-[rgba(126,79,45,0.1)] bg-[rgba(255,252,248,0.96)] p-5 shadow-[0_20px_50px_rgba(70,44,26,0.08)] sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[color:var(--ink-muted)]">
                Operação
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-[color:var(--ink-strong)] sm:text-3xl">
                Frete
              </h1>
            </div>
            <button
              type="button"
              onClick={() => void saveConfig()}
              disabled={loading || saving || !config}
              className="rounded-full border border-[rgba(126,79,45,0.14)] bg-[color:var(--surface-strong)] px-4 py-2 text-sm font-semibold text-[color:var(--ink-strong)] shadow-[0_10px_24px_rgba(70,44,26,0.08)] transition hover:border-[rgba(126,79,45,0.24)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Salvando...' : 'Salvar tabela'}
            </button>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-[rgba(181,68,57,0.18)] bg-[rgb(255,244,240)] px-4 py-3 text-sm text-[color:var(--tone-danger-ink)]">
              {error}
            </div>
          ) : null}
          {success ? (
            <div className="mt-4 rounded-2xl border border-[rgba(92,132,88,0.18)] bg-[rgb(244,251,243)] px-4 py-3 text-sm text-[color:var(--tone-olive-ink)]">
              {success}
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-[24px] border border-[rgba(126,79,45,0.08)] bg-white/92 p-4 sm:p-5">
              <div className="overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="text-left text-[0.72rem] uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">
                      <th className="px-3 py-3">Faixa</th>
                      <th className="px-3 py-3">Até km</th>
                      <th className="px-3 py-3">Valor</th>
                      <th className="px-3 py-3 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-[color:var(--ink-muted)]">
                          Carregando tabela...
                        </td>
                      </tr>
                    ) : orderedTiers.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-[color:var(--ink-muted)]">
                          Nenhuma faixa cadastrada.
                        </td>
                      </tr>
                    ) : (
                      orderedTiers.map((tier, index) => {
                        const previous = orderedTiers[index - 1] ?? null;
                        const rangeLabel = buildRangeLabel(index, tier.maxKm, previous?.maxKm ?? null);
                        return (
                          <tr key={`${tier.maxKm}-${index}`} className="border-t border-[rgba(126,79,45,0.08)]">
                            <td className="px-3 py-3 font-medium text-[color:var(--ink-strong)]">{rangeLabel}</td>
                            <td className="px-3 py-3">
                              <input
                                inputMode="decimal"
                                value={String(tier.maxKm).replace('.', ',')}
                                onChange={(event) =>
                                  updateTier(tier.sourceIndex, {
                                    maxKm: parseDistanceInput(event.target.value)
                                  })
                                }
                                className="w-24 rounded-2xl border border-[rgba(126,79,45,0.12)] bg-[rgba(255,252,248,0.92)] px-3 py-2 text-[color:var(--ink-strong)] outline-none transition focus:border-[rgba(126,79,45,0.28)]"
                              />
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2">
                                <span className="text-[color:var(--ink-muted)]">R$</span>
                                <input
                                  inputMode="decimal"
                                  value={formatMoneyInput(tier.fee)}
                                onChange={(event) =>
                                  updateTier(tier.sourceIndex, {
                                    fee: parseMoneyInput(event.target.value)
                                  })
                                }
                                  className="w-28 rounded-2xl border border-[rgba(126,79,45,0.12)] bg-[rgba(255,252,248,0.92)] px-3 py-2 text-[color:var(--ink-strong)] outline-none transition focus:border-[rgba(126,79,45,0.28)]"
                                />
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => removeTier(tier.sourceIndex)}
                                disabled={orderedTiers.length <= 1}
                                className="rounded-full border border-[rgba(181,68,57,0.14)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--tone-danger-ink)] transition hover:bg-[rgba(181,68,57,0.06)] disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Remover
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={addTier}
                  disabled={loading || !config}
                  className="rounded-full border border-[rgba(126,79,45,0.14)] px-4 py-2 text-sm font-semibold text-[color:var(--ink-strong)] transition hover:bg-[rgba(126,79,45,0.06)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Adicionar faixa
                </button>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-[24px] border border-[rgba(126,79,45,0.08)] bg-white/92 p-4 sm:p-5">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">
                  Exceções
                </p>
                <div className="mt-4 grid gap-4">
                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-[color:var(--ink-strong)]">Sem coordenadas</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[color:var(--ink-muted)]">R$</span>
                      <input
                        inputMode="decimal"
                        value={formatMoneyInput(config?.fallbackWithoutCoordinatesFee ?? 12)}
                        onChange={(event) =>
                          setConfig((current) =>
                            current
                              ? {
                                  ...current,
                                  fallbackWithoutCoordinatesFee: parseMoneyInput(event.target.value)
                                }
                              : current
                          )
                        }
                        className="w-32 rounded-2xl border border-[rgba(126,79,45,0.12)] bg-[rgba(255,252,248,0.92)] px-3 py-2 text-[color:var(--ink-strong)] outline-none transition focus:border-[rgba(126,79,45,0.28)]"
                      />
                    </div>
                  </label>

                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-[color:var(--ink-strong)]">Fora da área</span>
                    <input
                      value={config?.outOfAreaMessage ?? EMPTY_MESSAGE}
                      onChange={(event) =>
                        setConfig((current) =>
                          current
                            ? {
                                ...current,
                                outOfAreaMessage: event.target.value
                              }
                            : current
                        )
                      }
                      className="rounded-2xl border border-[rgba(126,79,45,0.12)] bg-[rgba(255,252,248,0.92)] px-3 py-2 text-[color:var(--ink-strong)] outline-none transition focus:border-[rgba(126,79,45,0.28)]"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-[24px] border border-[rgba(126,79,45,0.08)] bg-white/92 p-4 sm:p-5">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">
                  Vigente
                </p>
                <div className="mt-4 grid gap-2">
                  {orderedTiers.map((tier, index) => {
                    const previous = orderedTiers[index - 1] ?? null;
                    return (
                      <div
                        key={`preview-${tier.maxKm}-${index}`}
                        className="flex items-center justify-between rounded-2xl border border-[rgba(126,79,45,0.08)] bg-[rgba(255,252,248,0.88)] px-3 py-2"
                      >
                        <span className="text-sm text-[color:var(--ink-strong)]">
                          {buildRangeLabel(index, tier.maxKm, previous?.maxKm ?? null)}
                        </span>
                        <span className="text-sm font-semibold text-[color:var(--ink-strong)]">
                          {tier.fee.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 rounded-2xl border border-[rgba(181,68,57,0.12)] bg-[rgb(255,244,240)] px-3 py-3 text-sm text-[color:var(--tone-danger-ink)]">
                  {config?.outOfAreaMessage ?? EMPTY_MESSAGE}
                </div>
                <p className="mt-3 text-xs text-[color:var(--ink-muted)]">
                  Atualizado em {config?.updatedAt ? new Date(config.updatedAt).toLocaleString('pt-BR') : 'agora'}
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
