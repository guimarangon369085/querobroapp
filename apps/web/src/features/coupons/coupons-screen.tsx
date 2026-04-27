'use client';

import { startTransition, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useFeedback } from '@/components/feedback-provider';
import { apiFetch } from '@/lib/api';
import { formatCurrencyBR, parseLocaleNumber } from '@/lib/format';

type CouponTone = 'amber' | 'sky' | 'mint' | 'rose' | 'ink';

type CouponDraft = {
  code: string;
  discountPct: string;
  hasUsageLimit: boolean;
  usageLimitPerCustomer: string;
  active: boolean;
};

type CouponRecord = {
  id?: number;
  code: string;
  discountPct: number;
  usageLimitPerCustomer?: number | null;
  active: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type CouponAnalytics = CouponRecord & {
  historicalOnly?: boolean;
  metrics: {
    uses: number;
    distinctCustomers: number;
    discountInvestmentTotal: number;
    subtotalTotal: number;
    netRevenueTotal: number;
    averageDiscountAmount: number;
    lastUsedAt?: string | null;
  };
  customers: Array<{
    customerId?: number | null;
    customerDisplayNumber?: number | null;
    customerName?: string | null;
    customerPhone?: string | null;
    uses: number;
    discountInvestmentTotal: number;
    subtotalTotal: number;
    netRevenueTotal: number;
    lastUsedAt?: string | null;
  }>;
  recentOrders: Array<{
    orderId: number;
    orderDisplayNumber?: number | null;
    customerId?: number | null;
    customerDisplayNumber?: number | null;
    customerName?: string | null;
    customerPhone?: string | null;
    createdAt: string;
    scheduledAt?: string | null;
    subtotal: number;
    discountAmount: number;
    total: number;
  }>;
};

const PANEL_TONE_CLASSES: Record<CouponTone, string> = {
  amber:
    'border-[color:var(--tone-gold-line)] bg-[linear-gradient(155deg,rgba(255,250,244,0.98),rgba(248,238,221,0.94))]',
  sky: 'border-[color:var(--tone-sage-line)] bg-[linear-gradient(155deg,rgba(250,253,251,0.98),rgba(239,247,242,0.94))]',
  mint: 'border-[color:var(--tone-olive-line)] bg-[linear-gradient(155deg,rgba(251,249,243,0.98),rgba(242,239,228,0.95))]',
  rose: 'border-[color:var(--tone-blush-line)] bg-[linear-gradient(155deg,rgba(255,250,248,0.98),rgba(247,236,231,0.95))]',
  ink: 'border-[rgba(57,45,35,0.14)] bg-[linear-gradient(155deg,rgba(255,253,250,0.99),rgba(243,238,231,0.95))]',
};

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function normalizeCouponCodeInput(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trimStart()
    .toUpperCase();
}

function buildCouponDraft(
  coupon?: Pick<CouponAnalytics, 'code' | 'discountPct' | 'active' | 'usageLimitPerCustomer'> | null,
): CouponDraft {
  return {
    code: coupon?.code || '',
    discountPct:
      typeof coupon?.discountPct === 'number' && Number.isFinite(coupon.discountPct)
        ? String(coupon.discountPct).replace('.', ',')
        : '',
    hasUsageLimit:
      typeof coupon?.usageLimitPerCustomer === 'number' && coupon.usageLimitPerCustomer > 0,
    usageLimitPerCustomer:
      typeof coupon?.usageLimitPerCustomer === 'number' && coupon.usageLimitPerCustomer > 0
        ? String(Math.floor(coupon.usageLimitPerCustomer))
        : '',
    active: coupon?.active ?? true,
  };
}

function parseCouponUsageLimit(value: string) {
  const parsed = Number.parseInt(String(value || '').replace(/\D/g, ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function formatDateTime(value?: string | null) {
  if (!value) return 'nunca';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('pt-BR');
}

function resolveCouponKey(coupon: Pick<CouponAnalytics, 'id' | 'code'>) {
  return typeof coupon.id === 'number' && coupon.id > 0 ? `id-${coupon.id}` : `code-${coupon.code}`;
}

function buildCouponAnalyticsRecord(coupon: CouponRecord): CouponAnalytics {
  return {
    id: coupon.id,
    code: coupon.code,
    discountPct: coupon.discountPct,
    usageLimitPerCustomer: coupon.usageLimitPerCustomer ?? null,
    active: coupon.active,
    createdAt: coupon.createdAt ?? null,
    updatedAt: coupon.updatedAt ?? null,
    historicalOnly: false,
    metrics: {
      uses: 0,
      distinctCustomers: 0,
      discountInvestmentTotal: 0,
      subtotalTotal: 0,
      netRevenueTotal: 0,
      averageDiscountAmount: 0,
      lastUsedAt: null,
    },
    customers: [],
    recentOrders: [],
  };
}

function mergeCouponPayloads(params: {
  analyticsPayload?: CouponAnalytics[] | null;
  couponsPayload?: CouponRecord[] | null;
}) {
  const analyticsPayload = Array.isArray(params.analyticsPayload) ? params.analyticsPayload : [];
  const couponsPayload = Array.isArray(params.couponsPayload) ? params.couponsPayload : [];
  const merged = new Map<string, CouponAnalytics>();

  for (const coupon of analyticsPayload) {
    const normalizedCode = normalizeCouponCodeInput(coupon.code);
    if (!normalizedCode) continue;
    merged.set(normalizedCode, {
      ...coupon,
      code: normalizedCode,
      historicalOnly: Boolean(coupon.historicalOnly),
    });
  }

  for (const coupon of couponsPayload) {
    const normalizedCode = normalizeCouponCodeInput(coupon.code);
    if (!normalizedCode) continue;

    const existing = merged.get(normalizedCode);
    if (existing) {
      merged.set(normalizedCode, {
        ...existing,
        id: coupon.id,
        code: normalizedCode,
        discountPct: coupon.discountPct,
        usageLimitPerCustomer: coupon.usageLimitPerCustomer ?? null,
        active: coupon.active,
        createdAt: coupon.createdAt ?? existing.createdAt ?? null,
        updatedAt: coupon.updatedAt ?? existing.updatedAt ?? null,
        historicalOnly: false,
      });
      continue;
    }

    merged.set(normalizedCode, buildCouponAnalyticsRecord({ ...coupon, code: normalizedCode }));
  }

  return Array.from(merged.values()).sort(
    (left, right) =>
      Number(right.active) - Number(left.active) ||
      Number(left.historicalOnly) - Number(right.historicalOnly) ||
      right.metrics.uses - left.metrics.uses ||
      left.code.localeCompare(right.code, 'pt-BR'),
  );
}

function MetricCard({
  label,
  value,
  tone = 'ink',
  meta,
}: {
  label: string;
  value: string;
  tone?: CouponTone;
  meta?: string;
}) {
  return (
    <article className={`app-panel grid gap-2 rounded-[26px] p-4 sm:p-5 ${PANEL_TONE_CLASSES[tone]}`}>
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
        {label}
      </p>
      <strong className="text-[1.55rem] leading-none tracking-[-0.05em] text-[color:var(--ink-strong)] sm:text-[1.9rem]">
        {value}
      </strong>
      {meta ? <p className="text-xs text-neutral-600">{meta}</p> : null}
    </article>
  );
}

function SectionPanel({
  title,
  tone = 'ink',
  tag,
  children,
}: {
  title: string;
  tone?: CouponTone;
  tag?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`app-panel grid gap-4 rounded-[30px] p-5 sm:p-6 ${PANEL_TONE_CLASSES[tone]}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[1.05rem] font-semibold tracking-[-0.03em] text-[color:var(--ink-strong)] sm:text-[1.2rem]">
          {title}
        </h2>
        {tag}
      </div>
      {children}
    </section>
  );
}

function CompactEmpty({ message }: { message: string }) {
  return (
    <div className="rounded-[22px] border border-dashed border-[rgba(126,79,45,0.16)] bg-white/55 p-4 text-sm text-neutral-500">
      {message}
    </div>
  );
}

export default function CouponsScreen() {
  const [coupons, setCoupons] = useState<CouponAnalytics[]>([]);
  const [couponDrafts, setCouponDrafts] = useState<Record<string, CouponDraft>>({});
  const [newCouponDraft, setNewCouponDraft] = useState<CouponDraft>(() => buildCouponDraft());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [couponSavingKey, setCouponSavingKey] = useState<string | null>(null);
  const [couponDeletingKey, setCouponDeletingKey] = useState<string | null>(null);
  const { notifyError, notifySuccess } = useFeedback();

  const syncCoupons = useCallback((payload: CouponAnalytics[]) => {
    const normalized = Array.isArray(payload) ? payload : [];
    startTransition(() => {
      setCoupons(normalized);
      setCouponDrafts(
        Object.fromEntries(
          normalized.map((coupon) => [resolveCouponKey(coupon), buildCouponDraft(coupon)]),
        ),
      );
    });
  }, []);

  const loadCoupons = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!silent) {
        setLoading(true);
      }

      try {
        const [analyticsResult, couponsResult] = await Promise.allSettled([
          apiFetch<CouponAnalytics[]>('/dashboard/coupons/analytics', {
            cache: 'no-store',
          }),
          apiFetch<CouponRecord[]>('/dashboard/coupons', {
            cache: 'no-store',
          }),
        ]);

        if (analyticsResult.status === 'rejected' && couponsResult.status === 'rejected') {
          throw analyticsResult.reason instanceof Error
            ? analyticsResult.reason
            : couponsResult.reason instanceof Error
              ? couponsResult.reason
              : new Error('Não foi possível carregar os cupons.');
        }

        syncCoupons(
          mergeCouponPayloads({
            analyticsPayload:
              analyticsResult.status === 'fulfilled' ? analyticsResult.value : [],
            couponsPayload: couponsResult.status === 'fulfilled' ? couponsResult.value : [],
          }),
        );
        setError(null);
      } catch (loadError) {
        const message =
          loadError instanceof Error ? loadError.message : 'Não foi possível carregar os cupons.';
        setError(message);
        if (!silent) {
          notifyError(message);
        }
      } finally {
        setLoading(false);
      }
    },
    [notifyError, syncCoupons],
  );

  useEffect(() => {
    void loadCoupons();
  }, [loadCoupons]);

  const activeCouponsCount = useMemo(
    () => coupons.reduce((sum, coupon) => sum + (coupon.active ? 1 : 0), 0),
    [coupons],
  );
  const usedCouponsCount = useMemo(
    () => coupons.reduce((sum, coupon) => sum + (coupon.metrics.uses > 0 ? 1 : 0), 0),
    [coupons],
  );
  const totalUses = useMemo(
    () => coupons.reduce((sum, coupon) => sum + coupon.metrics.uses, 0),
    [coupons],
  );
  const totalDiscountInvestment = useMemo(
    () =>
      coupons.reduce((sum, coupon) => sum + coupon.metrics.discountInvestmentTotal, 0),
    [coupons],
  );

  const setCouponDraftField = useCallback(
    (couponKey: string, field: keyof CouponDraft, value: string | boolean) => {
      setCouponDrafts((current) => ({
        ...current,
        [couponKey]: {
          ...(current[couponKey] || buildCouponDraft()),
          [field]:
            field === 'code'
              ? normalizeCouponCodeInput(String(value))
              : field === 'discountPct' || field === 'usageLimitPerCustomer'
                ? String(value)
                : Boolean(value),
        },
      }));
    },
    [],
  );

  const setNewCouponField = useCallback((field: keyof CouponDraft, value: string | boolean) => {
    setNewCouponDraft((current) => ({
      ...current,
      [field]:
        field === 'code'
          ? normalizeCouponCodeInput(String(value))
          : field === 'discountPct' || field === 'usageLimitPerCustomer'
            ? String(value)
            : Boolean(value),
    }));
  }, []);

  const persistCoupon = useCallback(async (input: { id?: number; draft: CouponDraft }) => {
    const code = normalizeCouponCodeInput(input.draft.code);
    if (!code) {
      throw new Error('Informe o código do cupom.');
    }

    const discountPct = parseLocaleNumber(input.draft.discountPct);
    if (discountPct == null || discountPct < 0 || discountPct > 100) {
      throw new Error('Informe um desconto entre 0 e 100.');
    }

    const usageLimitPerCustomer = input.draft.hasUsageLimit
      ? parseCouponUsageLimit(input.draft.usageLimitPerCustomer)
      : null;
    if (input.draft.hasUsageLimit && !usageLimitPerCustomer) {
      throw new Error('Informe um limite por cliente maior que zero.');
    }

    return apiFetch<CouponAnalytics>(input.id ? `/dashboard/coupons/${input.id}` : '/dashboard/coupons', {
      method: input.id ? 'PUT' : 'POST',
      body: JSON.stringify({
        code,
        discountPct,
        usageLimitPerCustomer,
        active: Boolean(input.draft.active),
      }),
    });
  }, []);

  const handleAddCoupon = useCallback(async () => {
    try {
      setCouponSavingKey('new');
      const created = await persistCoupon({ draft: newCouponDraft });
      await loadCoupons({ silent: true });
      setNewCouponDraft(buildCouponDraft());
      notifySuccess(`Cupom ${created.code} criado.`);
    } catch (saveError) {
      notifyError(
        saveError instanceof Error ? saveError.message : 'Não foi possível criar o cupom.',
      );
    } finally {
      setCouponSavingKey(null);
    }
  }, [loadCoupons, newCouponDraft, notifyError, notifySuccess, persistCoupon]);

  const handleSaveCoupon = useCallback(
    async (coupon: CouponAnalytics) => {
      const couponKey = resolveCouponKey(coupon);
      const draft = couponDrafts[couponKey];
      if (!draft) return;

      try {
        setCouponSavingKey(couponKey);
        const saved = await persistCoupon({ id: coupon.id, draft });
        await loadCoupons({ silent: true });
        notifySuccess(
          coupon.id ? `Cupom ${saved.code} atualizado.` : `Cupom ${saved.code} recuperado.`,
        );
      } catch (saveError) {
        notifyError(
          saveError instanceof Error ? saveError.message : 'Não foi possível salvar o cupom.',
        );
      } finally {
        setCouponSavingKey(null);
      }
    },
    [couponDrafts, loadCoupons, notifyError, notifySuccess, persistCoupon],
  );

  const handleDeleteCoupon = useCallback(
    async (coupon: CouponAnalytics) => {
      if (!coupon.id) return;
      const couponKey = resolveCouponKey(coupon);

      try {
        setCouponDeletingKey(couponKey);
        await apiFetch<{ ok: boolean }>(`/dashboard/coupons/${coupon.id}`, {
          method: 'DELETE',
        });
        await loadCoupons({ silent: true });
        notifySuccess('Cupom excluído.');
      } catch (deleteError) {
        notifyError(
          deleteError instanceof Error ? deleteError.message : 'Não foi possível excluir o cupom.',
        );
      } finally {
        setCouponDeletingKey(null);
      }
    },
    [loadCoupons, notifyError, notifySuccess],
  );

  return (
    <div className="grid gap-4 pb-10">
      <section className="app-panel flex flex-wrap items-end justify-between gap-4 rounded-[30px] p-5 sm:p-6">
        <div className="grid gap-2">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[color:var(--ink-muted)]">
            Cupons
          </p>
          <h1 className="text-[1.8rem] leading-none tracking-[-0.06em] text-[color:var(--ink-strong)] sm:text-[2.3rem]">
            Gestão de cupons
          </h1>
          <p className="max-w-3xl text-sm text-neutral-600">
            Toda a operação de cupom saiu do dashboard e fica consolidada aqui com cadastro,
            histórico de uso, clientes impactados e investimento em desconto.
          </p>
        </div>
        <span className="rounded-full border border-white/70 bg-white/80 px-4 py-2 text-sm text-neutral-700">
          {formatNumber(totalUses)} uso(s) registrados
        </span>
      </section>

      {error ? (
        <div className="app-panel rounded-[26px] border-dashed border-red-300 bg-red-50 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading && !coupons.length ? (
        <div className="app-panel rounded-[26px] text-sm text-neutral-500">Carregando...</div>
      ) : null}

      <SectionPanel
        title="Radar"
        tone="ink"
        tag={
          <span className="rounded-full border border-white/80 bg-white/82 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-strong)]">
            {formatNumber(activeCouponsCount)} ativo(s)
          </span>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Total" value={formatNumber(coupons.length)} tone="ink" />
          <MetricCard label="Ativos" value={formatNumber(activeCouponsCount)} tone="mint" />
          <MetricCard label="Com uso" value={formatNumber(usedCouponsCount)} tone="amber" />
          <MetricCard label="Usos" value={formatNumber(totalUses)} tone="sky" />
          <MetricCard
            label="Investimento"
            value={formatCurrencyBR(totalDiscountInvestment)}
            tone="rose"
          />
        </div>
      </SectionPanel>

      <SectionPanel title="Novo cupom" tone="mint">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(140px,180px)_150px_minmax(120px,150px)_130px_auto] lg:items-end">
          <label className="grid gap-1.5 text-sm text-neutral-600">
            <span>Código</span>
            <input
              className="app-input"
              value={newCouponDraft.code}
              onChange={(event) => setNewCouponField('code', event.target.value)}
              placeholder="Ex.: BROA10"
            />
          </label>
          <label className="grid gap-1.5 text-sm text-neutral-600">
            <span>Desconto %</span>
            <input
              className="app-input"
              inputMode="decimal"
              value={newCouponDraft.discountPct}
              onChange={(event) => setNewCouponField('discountPct', event.target.value)}
              placeholder="10"
            />
          </label>
          <label className="flex h-12 items-center gap-2 rounded-[16px] border border-white/80 bg-white px-4 text-sm font-medium text-[color:var(--ink-strong)]">
            <input
              checked={newCouponDraft.hasUsageLimit}
              onChange={(event) => setNewCouponField('hasUsageLimit', event.target.checked)}
              type="checkbox"
            />
            Limite
          </label>
          <label className="grid gap-1.5 text-sm text-neutral-600">
            <span>Usos por cliente</span>
            <input
              className="app-input"
              inputMode="numeric"
              disabled={!newCouponDraft.hasUsageLimit}
              value={newCouponDraft.usageLimitPerCustomer}
              onChange={(event) => setNewCouponField('usageLimitPerCustomer', event.target.value)}
              placeholder="1"
            />
          </label>
          <label className="flex h-12 items-center gap-2 rounded-[16px] border border-white/80 bg-white px-4 text-sm font-medium text-[color:var(--ink-strong)]">
            <input
              checked={newCouponDraft.active}
              onChange={(event) => setNewCouponField('active', event.target.checked)}
              type="checkbox"
            />
            Ativo
          </label>
          <button
            type="button"
            className="app-button app-button-primary"
            disabled={couponSavingKey === 'new'}
            onClick={() => void handleAddCoupon()}
          >
            {couponSavingKey === 'new' ? 'Salvando...' : 'Adicionar'}
          </button>
        </div>
      </SectionPanel>

      <SectionPanel title="Base de cupons" tone="ink">
        {coupons.length ? (
          <div className="grid gap-4">
            {coupons.map((coupon) => {
              const couponKey = resolveCouponKey(coupon);
              const draft = couponDrafts[couponKey] || buildCouponDraft(coupon);
              const saving = couponSavingKey === couponKey;
              const deleting = couponDeletingKey === couponKey;

              return (
                <article
                  key={couponKey}
                  className="grid gap-4 rounded-[24px] border border-white/80 bg-white/82 p-4 shadow-[0_10px_24px_rgba(57,39,24,0.06)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-[1rem] text-[color:var(--ink-strong)]">{coupon.code}</strong>
                      <span className="rounded-full border border-white/70 bg-white px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)]">
                        {coupon.active ? 'Ativo' : 'Inativo'}
                      </span>
                      {coupon.historicalOnly ? (
                        <span className="rounded-full border border-[color:var(--tone-gold-line)] bg-[color:var(--tone-gold-surface)] px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--tone-gold-ink)]">
                          Histórico
                        </span>
                      ) : null}
                      {typeof coupon.usageLimitPerCustomer === 'number' && coupon.usageLimitPerCustomer > 0 ? (
                        <span className="rounded-full border border-white/70 bg-white px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)]">
                          Limite {formatNumber(coupon.usageLimitPerCustomer)} / cliente
                        </span>
                      ) : null}
                    </div>

                    <div className="grid justify-items-end gap-1 text-xs text-neutral-500">
                      <span>Último uso · {formatDateTime(coupon.metrics.lastUsedAt)}</span>
                      <span>Atualizado · {formatDateTime(coupon.updatedAt)}</span>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <MetricCard label="Usos" value={formatNumber(coupon.metrics.uses)} tone="ink" />
                    <MetricCard
                      label="Clientes"
                      value={formatNumber(coupon.metrics.distinctCustomers)}
                      tone="sky"
                    />
                    <MetricCard
                      label="Investimento"
                      value={formatCurrencyBR(coupon.metrics.discountInvestmentTotal)}
                      tone="rose"
                    />
                    <MetricCard
                      label="Subtotal impactado"
                      value={formatCurrencyBR(coupon.metrics.subtotalTotal)}
                      tone="amber"
                    />
                    <MetricCard
                      label="Receita líquida"
                      value={formatCurrencyBR(coupon.metrics.netRevenueTotal)}
                      tone="mint"
                      meta={`Médio por uso ${formatCurrencyBR(coupon.metrics.averageDiscountAmount)}`}
                    />
                  </div>

                  {coupon.historicalOnly ? (
                    <div className="rounded-[20px] border border-dashed border-[color:var(--tone-gold-line)] bg-[color:var(--tone-gold-surface)] px-4 py-3 text-sm text-[color:var(--tone-gold-ink)]">
                      Este código sobreviveu no histórico de pedidos. Salve abaixo para recriar o cadastro editável.
                    </div>
                  ) : null}

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(140px,180px)_150px_minmax(120px,150px)_130px_auto_auto] lg:items-end">
                      <label className="grid gap-1.5 text-sm text-neutral-600">
                        <span>Código</span>
                        <input
                          className="app-input"
                          value={draft.code}
                          onChange={(event) =>
                            setCouponDraftField(couponKey, 'code', event.target.value)
                          }
                        />
                      </label>
                      <label className="grid gap-1.5 text-sm text-neutral-600">
                        <span>Desconto %</span>
                        <input
                          className="app-input"
                          inputMode="decimal"
                          value={draft.discountPct}
                          onChange={(event) =>
                            setCouponDraftField(couponKey, 'discountPct', event.target.value)
                          }
                        />
                      </label>
                      <label className="flex h-12 items-center gap-2 rounded-[16px] border border-white/80 bg-white px-4 text-sm font-medium text-[color:var(--ink-strong)]">
                        <input
                          checked={draft.hasUsageLimit}
                          onChange={(event) =>
                            setCouponDraftField(couponKey, 'hasUsageLimit', event.target.checked)
                          }
                          type="checkbox"
                        />
                        Limite
                      </label>
                      <label className="grid gap-1.5 text-sm text-neutral-600">
                        <span>Usos por cliente</span>
                        <input
                          className="app-input"
                          inputMode="numeric"
                          disabled={!draft.hasUsageLimit}
                          value={draft.usageLimitPerCustomer}
                          onChange={(event) =>
                            setCouponDraftField(
                              couponKey,
                              'usageLimitPerCustomer',
                              event.target.value,
                            )
                          }
                          placeholder="1"
                        />
                      </label>
                      <label className="flex h-12 items-center gap-2 rounded-[16px] border border-white/80 bg-white px-4 text-sm font-medium text-[color:var(--ink-strong)]">
                        <input
                          checked={draft.active}
                          onChange={(event) =>
                            setCouponDraftField(couponKey, 'active', event.target.checked)
                          }
                          type="checkbox"
                        />
                        Ativo
                      </label>
                      <button
                        type="button"
                        className="app-button app-button-primary"
                        disabled={saving || deleting}
                        onClick={() => void handleSaveCoupon(coupon)}
                      >
                        {saving ? 'Salvando...' : coupon.id ? 'Salvar' : 'Recuperar'}
                      </button>
                      {coupon.id ? (
                        <button
                          type="button"
                          className="app-button app-button-ghost"
                          disabled={saving || deleting}
                          onClick={() => void handleDeleteCoupon(coupon)}
                        >
                          {deleting ? 'Excluindo...' : 'Excluir'}
                        </button>
                      ) : null}
                    </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
                    <section className="grid gap-3 rounded-[22px] border border-white/75 bg-white/72 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                          Quem usou
                        </h3>
                        <span className="text-xs text-neutral-500">
                          {formatNumber(coupon.metrics.distinctCustomers)} cliente(s)
                        </span>
                      </div>
                      {coupon.customers.length ? (
                        <div className="grid max-h-[320px] gap-2 overflow-y-auto pr-1">
                          {coupon.customers.map((customer) => (
                            <div
                              key={`${couponKey}-${customer.customerId || customer.customerPhone || customer.customerName}`}
                              className="rounded-[18px] border border-white/70 bg-white/80 px-4 py-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <strong className="text-sm text-[color:var(--ink-strong)]">
                                  {customer.customerName || 'Cliente sem nome'}
                                </strong>
                                <span className="text-xs text-neutral-500">
                                  {formatNumber(customer.uses)} uso(s)
                                </span>
                              </div>
                              <div className="mt-1 grid gap-1 text-xs text-neutral-600">
                                <span>
                                  {customer.customerDisplayNumber
                                    ? `Cliente #${customer.customerDisplayNumber}`
                                    : 'Cliente sem número público'}
                                  {customer.customerPhone ? ` · ${customer.customerPhone}` : ''}
                                </span>
                                <span>
                                  Investimento {formatCurrencyBR(customer.discountInvestmentTotal)} · líquida{' '}
                                  {formatCurrencyBR(customer.netRevenueTotal)}
                                </span>
                                <span>Último uso · {formatDateTime(customer.lastUsedAt)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <CompactEmpty message="Nenhum cliente usou este cupom ainda." />
                      )}
                    </section>

                    <section className="grid gap-3 rounded-[22px] border border-white/75 bg-white/72 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                          Usos registrados
                        </h3>
                        <span className="text-xs text-neutral-500">
                          {formatNumber(coupon.metrics.uses)} pedido(s)
                        </span>
                      </div>
                      {coupon.recentOrders.length ? (
                        <div className="grid max-h-[320px] gap-2 overflow-y-auto pr-1">
                          {coupon.recentOrders.map((order) => (
                            <div
                              key={`${couponKey}-order-${order.orderId}`}
                              className="rounded-[18px] border border-white/70 bg-white/80 px-4 py-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <strong className="text-sm text-[color:var(--ink-strong)]">
                                  Pedido #{order.orderDisplayNumber || order.orderId}
                                </strong>
                                <span className="text-xs text-neutral-500">
                                  {formatDateTime(order.createdAt)}
                                </span>
                              </div>
                              <div className="mt-1 grid gap-1 text-xs text-neutral-600">
                                <span>
                                  {order.customerName || 'Cliente sem nome'}
                                  {order.customerDisplayNumber ? ` · Cliente #${order.customerDisplayNumber}` : ''}
                                  {order.customerPhone ? ` · ${order.customerPhone}` : ''}
                                </span>
                                <span>
                                  Subtotal {formatCurrencyBR(order.subtotal)} · desconto{' '}
                                  {formatCurrencyBR(order.discountAmount)} · total {formatCurrencyBR(order.total)}
                                </span>
                                <span>
                                  Agenda {order.scheduledAt ? formatDateTime(order.scheduledAt) : 'sem agendamento'}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <CompactEmpty message="Nenhum uso registrado para este cupom." />
                      )}
                    </section>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <CompactEmpty message="Nenhum cupom cadastrado ou histórico encontrado." />
        )}
      </SectionPanel>
    </div>
  );
}
