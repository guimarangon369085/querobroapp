'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useFeedback } from '@/components/feedback-provider';
import { formatCurrencyBR } from '@/lib/format';

type DashboardSummary = {
  asOf: string;
  rangeDays: number;
  identity: {
    brandName: string;
    legalName: string;
    cnpj: string;
    cnpjDisplay: string;
    officialPhoneDisplay: string;
    pixKey: string;
    pickupAddressDisplay: string;
    bank: {
      bankName: string;
      bankCode: string;
      branch: string;
      accountNumber: string;
      accountHolder: string;
    };
  };
  integrations: {
    readyCount: number;
    pendingCount: number;
    items: Array<{
      id: string;
      label: string;
      status: 'READY' | 'PENDING';
      detail: string;
      nextStep: string;
    }>;
  };
  traffic: {
    windowLabel: string;
    totals: {
      sessions: number;
      publicSessions: number;
      internalSessions: number;
      pageViews: number;
      publicPageViews: number;
      internalPageViews: number;
      avgPagesPerSession: number;
      bounceRatePct: number;
    };
    topPaths: Array<{
      path: string;
      views: number;
      sessions: number;
      surface: 'public' | 'internal';
    }>;
    topSources: Array<{ label: string; sessions: number }>;
    topReferrers: Array<{ label: string; sessions: number }>;
    topLinks: Array<{ href: string; label: string; clicks: number }>;
    deviceMix: Array<{ label: string; sessions: number }>;
    browserMix: Array<{ label: string; sessions: number }>;
    osMix: Array<{ label: string; sessions: number }>;
    vitalBenchmarks: Array<{
      name: string;
      unit: string;
      median: number;
      p75: number;
      sampleSize: number;
    }>;
    slowPages: Array<{
      path: string;
      metricName: string;
      median: number;
      p75: number;
      sampleSize: number;
    }>;
    dailySeries: Array<{
      date: string;
      pageViews: number;
      publicPageViews: number;
      internalPageViews: number;
      sessions: number;
    }>;
    funnel: {
      homeSessions: number;
      orderSessions: number;
      quoteSuccessSessions: number;
      submittedSessions: number;
      orderPageConversionPct: number;
      quoteToSubmitPct: number;
    };
  };
  business: {
    windowLabel: string;
    kpis: {
      totalCustomers: number;
      ordersToday: number;
      ordersInRange: number;
      ordersAllTime: number;
      grossRevenueToday: number;
      grossRevenueInRange: number;
      grossRevenueAllTime: number;
      paidRevenueInRange: number;
      outstandingBalance: number;
      avgTicketInRange: number;
      discountsInRange: number;
      deliveryRevenueInRange: number;
      productNetRevenueInRange: number;
      estimatedCogsInRange: number;
      grossProfitInRange: number;
      grossMarginPctInRange: number;
      contributionAfterFreightInRange: number;
    };
    customerMetrics: {
      newCustomersInRange: number;
      returningCustomersInRange: number;
      repeatRatePct: number;
    };
    statusMix: Array<{ label: string; value: number }>;
    fulfillmentMix: Array<{ label: string; value: number }>;
    quoteMix: Array<{ label: string; value: number }>;
    dailySeries: Array<{
      date: string;
      orders: number;
      grossRevenue: number;
      paidRevenue: number;
      cogs: number;
      grossProfit: number;
    }>;
    topProducts: Array<{
      productId: number;
      productName: string;
      units: number;
      revenue: number;
      cogs: number;
      profit: number;
      marginPct: number;
    }>;
    recentReceivables: Array<{
      orderId: number;
      customerName: string;
      amount: number;
      status: string;
      dueDate: string | null;
    }>;
  };
};

const RANGE_OPTIONS = [7, 30, 90] as const;

type DashboardTone = 'amber' | 'sky' | 'mint' | 'rose' | 'ink';

const PANEL_TONE_CLASSES: Record<DashboardTone, string> = {
  amber:
    'border-[rgba(192,118,43,0.18)] bg-[linear-gradient(155deg,rgba(255,249,239,0.97),rgba(247,231,210,0.88))]',
  sky:
    'border-[rgba(108,152,214,0.18)] bg-[linear-gradient(155deg,rgba(243,249,255,0.97),rgba(224,237,255,0.88))]',
  mint:
    'border-[rgba(102,165,128,0.18)] bg-[linear-gradient(155deg,rgba(244,252,247,0.97),rgba(223,241,231,0.88))]',
  rose:
    'border-[rgba(192,111,95,0.18)] bg-[linear-gradient(155deg,rgba(255,247,245,0.97),rgba(248,226,220,0.9))]',
  ink:
    'border-[rgba(57,45,35,0.14)] bg-[linear-gradient(155deg,rgba(255,252,249,0.98),rgba(236,231,226,0.92))]'
};

const BAR_TONE_CLASSES: Record<DashboardTone, string> = {
  amber: 'bg-[linear-gradient(90deg,#7e4f2d,#d96f2a)]',
  sky: 'bg-[linear-gradient(90deg,#4978b7,#8ec8ff)]',
  mint: 'bg-[linear-gradient(90deg,#2d7b59,#8bd3ad)]',
  rose: 'bg-[linear-gradient(90deg,#a25142,#f2a38a)]',
  ink: 'bg-[linear-gradient(90deg,#5e4c3d,#c89f77)]'
};

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function formatPercent(value: number) {
  return `${Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  })}%`;
}

function formatDecimal(value: number, maximumFractionDigits = 1) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits
  });
}

function formatMetricValue(value: number, unit: string) {
  if (unit === 'score') {
    return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  }
  return `${Math.round(value || 0).toLocaleString('pt-BR')} ms`;
}

function formatShortDateLabel(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value.slice(5);
  return parsed.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function MetricCard({
  label,
  value,
  tone = 'ink',
  meta
}: {
  label: string;
  value: string;
  tone?: DashboardTone;
  meta?: string;
}) {
  return (
    <article className={`app-panel grid gap-2 rounded-[26px] p-4 sm:p-5 ${PANEL_TONE_CLASSES[tone]}`}>
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">{label}</p>
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
  className = ''
}: {
  title: string;
  tone?: DashboardTone;
  tag?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`app-panel grid gap-4 rounded-[30px] p-5 sm:p-6 ${PANEL_TONE_CLASSES[tone]} ${className}`}>
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

function DistributionList({
  items,
  valueKey = 'value',
  tone = 'amber',
  emptyMessage = 'Nada para mostrar ainda.'
}: {
  items: Array<{ label: string; value?: number; sessions?: number; clicks?: number }>;
  valueKey?: 'value' | 'sessions' | 'clicks';
  tone?: DashboardTone;
  emptyMessage?: string;
}) {
  if (!items.length) {
    return (
      <div className="rounded-[22px] border border-dashed border-[rgba(126,79,45,0.16)] bg-white/55 p-4 text-sm text-neutral-500">
        {emptyMessage}
      </div>
    );
  }

  const maxValue = Math.max(
    1,
    ...items.map((item) =>
      valueKey === 'value' ? item.value || 0 : valueKey === 'sessions' ? item.sessions || 0 : item.clicks || 0
    )
  );

  return (
    <div className="grid gap-3">
      {items.map((item) => {
        const value =
          valueKey === 'value' ? item.value || 0 : valueKey === 'sessions' ? item.sessions || 0 : item.clicks || 0;
        const width = `${Math.max(10, (value / maxValue) * 100)}%`;

        return (
          <div key={`${item.label}-${value}`} className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-neutral-700">{item.label}</span>
              <strong className="shrink-0 text-[color:var(--ink-strong)]">{formatNumber(value)}</strong>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/75">
              <div className={`h-full rounded-full ${BAR_TONE_CLASSES[tone]}`} style={{ width }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DailyBars({
  series,
  valueKey,
  moneyKey,
  tone = 'amber',
  emptyMessage = 'Ainda sem ritmo suficiente para desenhar esta trilha.'
}: {
  series: Array<Record<string, string | number>>;
  valueKey: string;
  moneyKey?: string;
  tone?: DashboardTone;
  emptyMessage?: string;
}) {
  if (!series.length) {
    return (
      <div className="rounded-[22px] border border-dashed border-[rgba(126,79,45,0.16)] bg-white/55 p-4 text-sm text-neutral-500">
        {emptyMessage}
      </div>
    );
  }

  const maxValue = Math.max(1, ...series.map((entry) => Number(entry[valueKey] || 0)));

  return (
    <div className="grid gap-2.5">
      {series.map((entry) => {
        const value = Number(entry[valueKey] || 0);
        const width = `${Math.max(8, (value / maxValue) * 100)}%`;
        return (
          <div key={String(entry.date)} className="grid gap-1">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-neutral-600">{formatShortDateLabel(String(entry.date))}</span>
              <strong className="text-[color:var(--ink-strong)]">
                {moneyKey ? formatCurrencyBR(Number(entry[moneyKey] || 0)) : formatNumber(value)}
              </strong>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/75">
              <div className={`h-full rounded-full ${BAR_TONE_CLASSES[tone]}`} style={{ width }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function DashboardScreen() {
  const [rangeDays, setRangeDays] = useState<(typeof RANGE_OPTIONS)[number]>(30);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { notifyError } = useFeedback();

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const response = await fetch(`/api/dashboard-summary?days=${rangeDays}`, {
          cache: 'no-store'
        });
        const raw = await response.text();
        let payload: unknown = null;

        try {
          payload = raw ? JSON.parse(raw) : null;
        } catch {
          payload = raw ? { message: raw } : null;
        }

        if (!response.ok) {
          const message =
            payload &&
            typeof payload === 'object' &&
            'message' in payload &&
            typeof (payload as { message?: unknown }).message === 'string'
              ? (payload as { message: string }).message
              : 'Nao foi possivel carregar o dashboard.';
          throw new Error(message);
        }

        setSummary(payload as DashboardSummary);
        setError(null);
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : 'Nao foi possivel carregar o dashboard.';
        setError(message);
        if (!silent) {
          notifyError(message);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [notifyError, rangeDays]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void load({ silent: true });
      }
    }, 180_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const topTrafficMix = useMemo(
    () =>
      summary
        ? [
            { label: 'Mobile', sessions: summary.traffic.deviceMix.find((entry) => entry.label === 'mobile')?.sessions || 0 },
            { label: 'Tablet', sessions: summary.traffic.deviceMix.find((entry) => entry.label === 'tablet')?.sessions || 0 },
            { label: 'Desktop', sessions: summary.traffic.deviceMix.find((entry) => entry.label === 'desktop')?.sessions || 0 }
          ]
        : [],
    [summary]
  );

  const asOfLabel = summary ? new Date(summary.asOf).toLocaleString('pt-BR') : 'carregando...';
  const recentTrafficSeries = summary ? summary.traffic.dailySeries.slice(-10) : [];
  const recentBusinessSeries = summary ? summary.business.dailySeries.slice(-10) : [];

  const trafficMetrics = summary
    ? [
        { label: 'Sessões', value: formatNumber(summary.traffic.totals.sessions), tone: 'sky' as const },
        { label: 'Pageviews', value: formatNumber(summary.traffic.totals.pageViews), tone: 'mint' as const },
        { label: 'Pág/sessão', value: formatDecimal(summary.traffic.totals.avgPagesPerSession), tone: 'amber' as const },
        { label: 'Bounce', value: formatPercent(summary.traffic.totals.bounceRatePct), tone: 'rose' as const },
        { label: 'Home → /pedido', value: formatPercent(summary.traffic.funnel.orderPageConversionPct), tone: 'sky' as const },
        { label: 'Quote → envio', value: formatPercent(summary.traffic.funnel.quoteToSubmitPct), tone: 'mint' as const },
        { label: 'Integrações ready', value: formatNumber(summary.integrations.readyCount), tone: 'ink' as const },
        { label: 'Integrações pending', value: formatNumber(summary.integrations.pendingCount), tone: 'amber' as const }
      ]
    : [];

  const businessMetrics = summary
    ? [
        { label: 'Pedidos', value: formatNumber(summary.business.kpis.ordersInRange), tone: 'amber' as const },
        { label: 'Receita', value: formatCurrencyBR(summary.business.kpis.grossRevenueInRange), tone: 'mint' as const },
        { label: 'Recebido', value: formatCurrencyBR(summary.business.kpis.paidRevenueInRange), tone: 'sky' as const },
        { label: 'Em aberto', value: formatCurrencyBR(summary.business.kpis.outstandingBalance), tone: 'rose' as const },
        { label: 'Ticket médio', value: formatCurrencyBR(summary.business.kpis.avgTicketInRange), tone: 'ink' as const },
        { label: 'Margem', value: formatPercent(summary.business.kpis.grossMarginPctInRange), tone: 'sky' as const },
        { label: 'Clientes', value: formatNumber(summary.business.kpis.totalCustomers), tone: 'mint' as const },
        { label: 'Recorrência', value: formatPercent(summary.business.customerMetrics.repeatRatePct), tone: 'amber' as const }
      ]
    : [];

  return (
    <div className="grid gap-4 pb-10">
      <section className="app-panel flex flex-wrap items-center justify-between gap-3 rounded-[30px] p-4 sm:p-5">
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full border border-white/70 bg-white/78 px-3 py-1.5 text-neutral-700">{asOfLabel}</span>
          <span className="rounded-full border border-white/70 bg-white/78 px-3 py-1.5 text-neutral-700">
            {summary ? summary.traffic.windowLabel : `${rangeDays} dias`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                rangeDays === option
                  ? 'border-[rgba(126,79,45,0.24)] bg-[rgba(78,53,35,0.92)] text-white shadow-[0_12px_24px_rgba(57,39,24,0.18)]'
                  : 'border-white/70 bg-white/72 text-neutral-700 hover:bg-white'
              }`}
              onClick={() => setRangeDays(option)}
            >
              {option} dias
            </button>
          ))}
          <button
            type="button"
            className="rounded-full border border-white/70 bg-white/80 px-4 py-2 text-sm font-semibold text-[color:var(--ink-strong)] shadow-[0_12px_24px_rgba(57,39,24,0.08)] transition hover:bg-white"
            onClick={() => void load({ silent: true })}
          >
            {refreshing ? 'Atualizando...' : 'Atualizar'}
          </button>
        </div>
      </section>

      {error ? (
        <div className="app-panel rounded-[26px] border-dashed border-red-300 bg-red-50 text-sm text-red-700">{error}</div>
      ) : null}

      {loading && !summary ? (
        <div className="app-panel rounded-[26px] text-sm text-neutral-500">Carregando...</div>
      ) : null}

      {summary ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {trafficMetrics.map((card) => (
              <MetricCard key={card.label} label={card.label} value={card.value} tone={card.tone} />
            ))}
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {businessMetrics.map((card) => (
              <MetricCard key={card.label} label={card.label} value={card.value} tone={card.tone} />
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
            <SectionPanel title="Funil" tone="sky">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Home" value={formatNumber(summary.traffic.funnel.homeSessions)} tone="sky" />
                <MetricCard label="/pedido" value={formatNumber(summary.traffic.funnel.orderSessions)} tone="mint" />
                <MetricCard label="Quote" value={formatNumber(summary.traffic.funnel.quoteSuccessSessions)} tone="amber" />
                <MetricCard label="Enviados" value={formatNumber(summary.traffic.funnel.submittedSessions)} tone="rose" />
              </div>
            </SectionPanel>

            <SectionPanel title="Mix" tone="mint">
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Dispositivos</p>
                  <DistributionList items={topTrafficMix} valueKey="sessions" tone="mint" />
                </div>
                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Fontes</p>
                  <DistributionList items={summary.traffic.topSources} valueKey="sessions" tone="sky" />
                </div>
                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Status</p>
                  <DistributionList items={summary.business.statusMix} tone="rose" />
                </div>
                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Entrega / retirada</p>
                  <DistributionList items={summary.business.fulfillmentMix} tone="amber" />
                </div>
              </div>
            </SectionPanel>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <SectionPanel title="Tráfego diário" tone="amber">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Sessões</p>
                  <DailyBars series={recentTrafficSeries} valueKey="sessions" tone="sky" />
                </div>
                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Pageviews</p>
                  <DailyBars series={recentTrafficSeries} valueKey="pageViews" tone="mint" />
                </div>
              </div>
            </SectionPanel>

            <SectionPanel title="Financeiro" tone="rose">
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <MetricCard label="Produto líquido" value={formatCurrencyBR(summary.business.kpis.productNetRevenueInRange)} tone="ink" />
                  <MetricCard label="Frete" value={formatCurrencyBR(summary.business.kpis.deliveryRevenueInRange)} tone="amber" />
                  <MetricCard label="COGS" value={formatCurrencyBR(summary.business.kpis.estimatedCogsInRange)} tone="rose" />
                  <MetricCard label="Lucro bruto" value={formatCurrencyBR(summary.business.kpis.grossProfitInRange)} tone="mint" />
                  <MetricCard label="Pós-frete" value={formatCurrencyBR(summary.business.kpis.contributionAfterFreightInRange)} tone="sky" />
                  <MetricCard label="Descontos" value={formatCurrencyBR(summary.business.kpis.discountsInRange)} tone="ink" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Receita</p>
                    <DailyBars series={recentBusinessSeries} valueKey="grossRevenue" moneyKey="grossRevenue" tone="amber" />
                  </div>
                  <div className="grid gap-2">
                    <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Lucro</p>
                    <DailyBars series={recentBusinessSeries} valueKey="grossProfit" moneyKey="grossProfit" tone="mint" />
                  </div>
                </div>
              </div>
            </SectionPanel>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <SectionPanel title="Top produtos" tone="mint">
              {summary.business.topProducts.length ? (
                <div className="grid gap-3">
                  {summary.business.topProducts.map((product) => (
                    <div
                      key={product.productId}
                      className="rounded-[24px] border border-white/80 bg-white/82 p-4 shadow-[0_10px_24px_rgba(57,39,24,0.06)]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <strong className="text-[color:var(--ink-strong)]">{product.productName}</strong>
                        <span className="rounded-full border border-white/70 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)]">
                          {formatPercent(product.marginPct)}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 text-sm text-neutral-600 sm:grid-cols-4">
                        <span>{formatNumber(product.units)} un</span>
                        <span>{formatCurrencyBR(product.revenue)}</span>
                        <span>{formatCurrencyBR(product.cogs)}</span>
                        <span>{formatCurrencyBR(product.profit)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <CompactEmpty message="Sem ranking." />
              )}
            </SectionPanel>

            <SectionPanel title="Recebíveis" tone="rose">
              {summary.business.recentReceivables.length ? (
                <div className="grid gap-3">
                  {summary.business.recentReceivables.map((entry) => (
                    <div
                      key={`${entry.orderId}-${entry.customerName}`}
                      className="rounded-[24px] border border-white/80 bg-white/82 p-4 shadow-[0_10px_24px_rgba(57,39,24,0.06)]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <strong className="text-[color:var(--ink-strong)]">#{entry.orderId} · {entry.customerName}</strong>
                        <span className="rounded-full border border-white/70 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)]">
                          {entry.status}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-neutral-600">
                        {formatCurrencyBR(entry.amount)}
                        {entry.dueDate ? ` · ${new Date(entry.dueDate).toLocaleDateString('pt-BR')}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <CompactEmpty message="Sem aberto." />
              )}
            </SectionPanel>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <SectionPanel title="Vitals" tone="sky">
              {summary.traffic.vitalBenchmarks.length ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {summary.traffic.vitalBenchmarks.map((metric) => (
                    <MetricCard
                      key={metric.name}
                      label={metric.name}
                      value={formatMetricValue(metric.p75, metric.unit)}
                      meta={`${formatMetricValue(metric.median, metric.unit)} · ${formatNumber(metric.sampleSize)}`}
                      tone="sky"
                    />
                  ))}
                </div>
              ) : (
                <CompactEmpty message="Sem amostra." />
              )}
            </SectionPanel>

            <SectionPanel title="Rotas / links" tone="ink">
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Rotas</p>
                  <DistributionList
                    items={summary.traffic.topPaths.map((entry) => ({
                      label: `${entry.path} · ${entry.surface}`,
                      value: entry.views
                    }))}
                    tone="amber"
                  />
                </div>
                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Links</p>
                  <DistributionList
                    items={summary.traffic.topLinks.map((entry) => ({
                      label: entry.label || entry.href,
                      clicks: entry.clicks
                    }))}
                    valueKey="clicks"
                    tone="rose"
                  />
                </div>
                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Páginas lentas</p>
                  {summary.traffic.slowPages.length ? (
                    <div className="grid gap-3">
                      {summary.traffic.slowPages.map((entry) => (
                        <div
                          key={`${entry.path}-${entry.metricName}`}
                          className="rounded-[24px] border border-white/80 bg-white/82 p-4 shadow-[0_10px_24px_rgba(57,39,24,0.06)]"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <strong className="min-w-0 truncate text-[color:var(--ink-strong)]">{entry.path}</strong>
                            <span className="rounded-full border border-white/70 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)]">
                              {entry.metricName}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-neutral-600">
                            {formatMetricValue(entry.p75, 'ms')} · {formatMetricValue(entry.median, 'ms')}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <CompactEmpty message="Sem rota lenta." />
                  )}
                </div>
              </div>
            </SectionPanel>
          </section>
        </>
      ) : null}
    </div>
  );
}
