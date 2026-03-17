'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatCurrencyBR } from '@/lib/format';
import { useFeedback } from '@/components/feedback-provider';

type DashboardSummary = {
  asOf: string;
  rangeDays: number;
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

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function formatPercent(value: number) {
  return `${Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  })}%`;
}

function formatMetricValue(value: number, unit: string) {
  if (unit === 'score') {
    return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  }
  return `${Math.round(value || 0).toLocaleString('pt-BR')} ms`;
}

function StatCard(props: { eyebrow: string; value: string; detail: string }) {
  return (
    <div className="app-panel grid gap-2 rounded-[24px] p-4 sm:p-5">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-[color:var(--ink-muted)]">
        {props.eyebrow}
      </p>
      <strong className="text-[1.55rem] leading-none text-[color:var(--ink-strong)] sm:text-[1.9rem]">
        {props.value}
      </strong>
      <p className="text-sm leading-6 text-neutral-600">{props.detail}</p>
    </div>
  );
}

function DistributionList({
  items,
  valueKey = 'value'
}: {
  items: Array<{ label: string; value?: number; sessions?: number; clicks?: number }>;
  valueKey?: 'value' | 'sessions' | 'clicks';
}) {
  const maxValue = Math.max(
    1,
    ...items.map((item) => {
      const value = valueKey === 'value' ? item.value || 0 : valueKey === 'sessions' ? item.sessions || 0 : item.clicks || 0;
      return value;
    })
  );

  return (
    <div className="grid gap-3">
      {items.map((item) => {
        const value =
          valueKey === 'value' ? item.value || 0 : valueKey === 'sessions' ? item.sessions || 0 : item.clicks || 0;
        const width = `${Math.max(8, (value / maxValue) * 100)}%`;
        return (
          <div key={`${item.label}-${value}`} className="grid gap-1">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-neutral-700">{item.label}</span>
              <strong className="shrink-0 text-[color:var(--ink-strong)]">{formatNumber(value)}</strong>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[rgba(126,79,45,0.08)]">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,var(--ink-strong),var(--brand-accent,#c26a2d))]"
                style={{ width }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DailyRevenueBars({
  series,
  moneyKey,
  valueKey
}: {
  series: Array<Record<string, string | number>>;
  moneyKey?: string;
  valueKey: string;
}) {
  const maxValue = Math.max(1, ...series.map((entry) => Number(entry[valueKey] || 0)));
  return (
    <div className="grid gap-2">
      {series.map((entry) => {
        const value = Number(entry[valueKey] || 0);
        const width = `${Math.max(6, (value / maxValue) * 100)}%`;
        return (
          <div key={String(entry.date)} className="grid gap-1">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-neutral-600">{String(entry.date).slice(5)}</span>
              <strong className="text-[color:var(--ink-strong)]">
                {moneyKey ? formatCurrencyBR(Number(entry[moneyKey] || 0)) : formatNumber(value)}
              </strong>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[rgba(126,79,45,0.08)]">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#7e4f2d,#d96f2a)]"
                style={{ width }}
              />
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
        const data = payload as DashboardSummary;
        setSummary(data);
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

  return (
    <div className="grid gap-5 pb-8">
      <section className="app-panel grid gap-4 rounded-[28px] p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid gap-2">
            <p className="brand-wordmark brand-wordmark--display text-[1.45rem] text-[color:var(--ink-strong)] sm:text-[2rem]">
              @QUEROBROA
            </p>
            <div>
              <h2 className="text-[1.5rem] font-semibold tracking-[-0.03em] text-[color:var(--ink-strong)] sm:text-[2rem]">
                Dashboard oculto de operação e performance
              </h2>
              <p className="max-w-3xl text-sm leading-6 text-neutral-600 sm:text-[0.97rem]">
                Tráfego first-party, navegação, vitals, funil do site e a performance financeira completa da broa em uma
                única superfície.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                  rangeDays === option
                    ? 'border-[rgba(126,79,45,0.22)] bg-[rgba(126,79,45,0.1)] text-[color:var(--ink-strong)]'
                    : 'border-[rgba(126,79,45,0.12)] bg-white/70 text-neutral-600'
                }`}
                onClick={() => setRangeDays(option)}
              >
                {option} dias
              </button>
            ))}
            <button type="button" className="app-button-secondary" onClick={() => void load({ silent: true })}>
              {refreshing ? 'Atualizando...' : 'Atualizar'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-500">
          <span>Última leitura: {summary ? new Date(summary.asOf).toLocaleString('pt-BR') : 'carregando...'}</span>
          <span>Coleta first-party ativa</span>
          <span>Link direto no menu</span>
        </div>
      </section>

      {error ? <div className="app-panel border-dashed text-sm text-red-700">{error}</div> : null}

      {loading && !summary ? <div className="app-panel text-sm text-neutral-500">Carregando métricas do site e da operação...</div> : null}

      {summary ? (
        <>
          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  eyebrow="Sessões"
                  value={formatNumber(summary.traffic.totals.sessions)}
                  detail={`${formatNumber(summary.traffic.totals.publicSessions)} públicas e ${formatNumber(summary.traffic.totals.internalSessions)} internas em ${summary.traffic.windowLabel}.`}
                />
                <StatCard
                  eyebrow="Pageviews"
                  value={formatNumber(summary.traffic.totals.pageViews)}
                  detail={`${formatNumber(summary.traffic.totals.publicPageViews)} no site público e ${formatNumber(summary.traffic.totals.internalPageViews)} na operação.`}
                />
                <StatCard
                  eyebrow="Engajamento"
                  value={String(summary.traffic.totals.avgPagesPerSession).replace('.', ',')}
                  detail={`Média de páginas por sessão. Bounce estimado em ${formatPercent(summary.traffic.totals.bounceRatePct)}.`}
                />
                <StatCard
                  eyebrow="Conversão /pedido"
                  value={formatPercent(summary.traffic.funnel.orderPageConversionPct)}
                  detail={`${formatNumber(summary.traffic.funnel.submittedSessions)} sessões chegaram até envio confirmado depois de visitar /pedido.`}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="app-panel grid gap-4 rounded-[26px] p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[color:var(--ink-muted)]">
                        Funil do site
                      </p>
                      <h3 className="text-lg font-semibold text-[color:var(--ink-strong)]">Jornada pública</h3>
                    </div>
                    <span className="rounded-full bg-[rgba(126,79,45,0.08)] px-3 py-1 text-xs font-semibold text-[color:var(--ink-strong)]">
                      {summary.traffic.windowLabel}
                    </span>
                  </div>
                  <DistributionList
                    items={[
                      { label: 'Entraram na home', value: summary.traffic.funnel.homeSessions },
                      { label: 'Visitaram /pedido', value: summary.traffic.funnel.orderSessions },
                      { label: 'Conseguiram cotar frete', value: summary.traffic.funnel.quoteSuccessSessions },
                      { label: 'Enviaram pedido', value: summary.traffic.funnel.submittedSessions }
                    ]}
                  />
                  <div className="grid gap-1 text-sm text-neutral-600">
                    <p>Conversão do pedido: {formatPercent(summary.traffic.funnel.orderPageConversionPct)}</p>
                    <p>Quote → envio: {formatPercent(summary.traffic.funnel.quoteToSubmitPct)}</p>
                  </div>
                </div>

                <div className="app-panel grid gap-4 rounded-[26px] p-4 sm:p-5">
                  <div>
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[color:var(--ink-muted)]">
                      Performance técnica
                    </p>
                    <h3 className="text-lg font-semibold text-[color:var(--ink-strong)]">Web vitals e carga</h3>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {summary.traffic.vitalBenchmarks.map((metric) => (
                      <div key={metric.name} className="rounded-[20px] border border-[rgba(126,79,45,0.08)] bg-white/72 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                          {metric.name}
                        </p>
                        <strong className="mt-2 block text-xl text-[color:var(--ink-strong)]">
                          {formatMetricValue(metric.p75, metric.unit)}
                        </strong>
                        <p className="mt-1 text-sm text-neutral-600">
                          Mediana {formatMetricValue(metric.median, metric.unit)} · {formatNumber(metric.sampleSize)} amostras
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="app-panel grid gap-4 rounded-[26px] p-4 sm:p-5">
                <div>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[color:var(--ink-muted)]">
                    Origem e dispositivo
                  </p>
                  <h3 className="text-lg font-semibold text-[color:var(--ink-strong)]">Acesso</h3>
                </div>
                <div className="grid gap-4">
                  <div>
                    <p className="mb-2 text-sm font-medium text-neutral-700">Mix principal</p>
                    <DistributionList items={topTrafficMix} valueKey="sessions" />
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium text-neutral-700">Fontes</p>
                    <DistributionList items={summary.traffic.topSources} valueKey="sessions" />
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium text-neutral-700">Referrers</p>
                    <DistributionList items={summary.traffic.topReferrers} valueKey="sessions" />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)]">
            <div className="app-panel grid gap-4 rounded-[26px] p-4 sm:p-5">
              <div>
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[color:var(--ink-muted)]">
                  Navegação
                </p>
                <h3 className="text-lg font-semibold text-[color:var(--ink-strong)]">Rotas e links</h3>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-sm font-medium text-neutral-700">Top rotas</p>
                  <DistributionList
                    items={summary.traffic.topPaths.map((entry) => ({
                      label: `${entry.path} · ${entry.surface}`,
                      value: entry.views
                    }))}
                  />
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium text-neutral-700">Links clicados</p>
                  <DistributionList
                    items={summary.traffic.topLinks.map((entry) => ({
                      label: entry.label || entry.href,
                      clicks: entry.clicks
                    }))}
                    valueKey="clicks"
                  />
                </div>
              </div>
            </div>

            <div className="app-panel grid gap-4 rounded-[26px] p-4 sm:p-5">
              <div>
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[color:var(--ink-muted)]">
                  Páginas lentas
                </p>
                <h3 className="text-lg font-semibold text-[color:var(--ink-strong)]">Onde a experiência pesa</h3>
              </div>
              {summary.traffic.slowPages.length ? (
                <div className="grid gap-3">
                  {summary.traffic.slowPages.map((entry) => (
                    <div
                      key={`${entry.path}-${entry.metricName}`}
                      className="rounded-[20px] border border-[rgba(126,79,45,0.08)] bg-white/72 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <strong className="min-w-0 truncate text-[color:var(--ink-strong)]">
                          {entry.path}
                        </strong>
                        <span className="rounded-full bg-[rgba(126,79,45,0.08)] px-3 py-1 text-xs font-semibold text-[color:var(--ink-strong)]">
                          {entry.metricName}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-neutral-600">
                        p75 {formatMetricValue(entry.p75, 'ms')} · mediana {formatMetricValue(entry.median, 'ms')} ·{' '}
                        {formatNumber(entry.sampleSize)} amostras
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[20px] border border-dashed border-[rgba(126,79,45,0.14)] bg-white/60 p-4 text-sm text-neutral-500">
                  Ainda sem amostra suficiente de vitals por rota. Assim que você navegar e testar, essa leitura começa a preencher.
                </div>
              )}
            </div>
          </section>

          <section className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                eyebrow="Receita bruta"
                value={formatCurrencyBR(summary.business.kpis.grossRevenueInRange)}
                detail={`${summary.business.windowLabel} · ${formatCurrencyBR(summary.business.kpis.grossRevenueToday)} hoje.`}
              />
              <StatCard
                eyebrow="Receita recebida"
                value={formatCurrencyBR(summary.business.kpis.paidRevenueInRange)}
                detail={`${formatCurrencyBR(summary.business.kpis.outstandingBalance)} ainda em aberto.`}
              />
              <StatCard
                eyebrow="Margem estimada"
                value={formatPercent(summary.business.kpis.grossMarginPctInRange)}
                detail={`${formatCurrencyBR(summary.business.kpis.grossProfitInRange)} de lucro bruto sobre ${formatCurrencyBR(summary.business.kpis.productNetRevenueInRange)} líquidos.`}
              />
              <StatCard
                eyebrow="Ticket médio"
                value={formatCurrencyBR(summary.business.kpis.avgTicketInRange)}
                detail={`${formatNumber(summary.business.kpis.ordersInRange)} pedidos no período e ${formatNumber(summary.business.kpis.ordersToday)} hoje.`}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
              <div className="grid gap-4">
                <div className="app-panel grid gap-4 rounded-[26px] p-4 sm:p-5">
                  <div>
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[color:var(--ink-muted)]">
                      Financeiro completo
                    </p>
                    <h3 className="text-lg font-semibold text-[color:var(--ink-strong)]">Receita, custo e contribuição</h3>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-[20px] border border-[rgba(126,79,45,0.08)] bg-white/72 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">Receita líquida produto</p>
                      <strong className="mt-2 block text-xl text-[color:var(--ink-strong)]">
                        {formatCurrencyBR(summary.business.kpis.productNetRevenueInRange)}
                      </strong>
                    </div>
                    <div className="rounded-[20px] border border-[rgba(126,79,45,0.08)] bg-white/72 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">Frete cobrado</p>
                      <strong className="mt-2 block text-xl text-[color:var(--ink-strong)]">
                        {formatCurrencyBR(summary.business.kpis.deliveryRevenueInRange)}
                      </strong>
                    </div>
                    <div className="rounded-[20px] border border-[rgba(126,79,45,0.08)] bg-white/72 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">COGS estimado</p>
                      <strong className="mt-2 block text-xl text-[color:var(--ink-strong)]">
                        {formatCurrencyBR(summary.business.kpis.estimatedCogsInRange)}
                      </strong>
                    </div>
                    <div className="rounded-[20px] border border-[rgba(126,79,45,0.08)] bg-white/72 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">Contribuição pós-frete</p>
                      <strong className="mt-2 block text-xl text-[color:var(--ink-strong)]">
                        {formatCurrencyBR(summary.business.kpis.contributionAfterFreightInRange)}
                      </strong>
                    </div>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <p className="mb-2 text-sm font-medium text-neutral-700">Série diária de receita</p>
                      <DailyRevenueBars series={summary.business.dailySeries} valueKey="grossRevenue" moneyKey="grossRevenue" />
                    </div>
                    <div>
                      <p className="mb-2 text-sm font-medium text-neutral-700">Pedidos por dia</p>
                      <DailyRevenueBars series={summary.business.dailySeries} valueKey="orders" />
                    </div>
                  </div>
                </div>

                <div className="app-panel grid gap-4 rounded-[26px] p-4 sm:p-5">
                  <div>
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[color:var(--ink-muted)]">
                      Broas e mix
                    </p>
                    <h3 className="text-lg font-semibold text-[color:var(--ink-strong)]">Top produtos no período</h3>
                  </div>
                  <div className="grid gap-3">
                    {summary.business.topProducts.map((product) => (
                      <div
                        key={product.productId}
                        className="rounded-[20px] border border-[rgba(126,79,45,0.08)] bg-white/72 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <strong className="text-[color:var(--ink-strong)]">{product.productName}</strong>
                            <p className="text-sm text-neutral-600">{formatNumber(product.units)} unidades vendidas no período.</p>
                          </div>
                          <span className="rounded-full bg-[rgba(126,79,45,0.08)] px-3 py-1 text-xs font-semibold text-[color:var(--ink-strong)]">
                            {formatPercent(product.marginPct)}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2 text-sm text-neutral-600 sm:grid-cols-3">
                          <span>Receita {formatCurrencyBR(product.revenue)}</span>
                          <span>Custo {formatCurrencyBR(product.cogs)}</span>
                          <span>Lucro {formatCurrencyBR(product.profit)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-4">
                <div className="app-panel grid gap-4 rounded-[26px] p-4 sm:p-5">
                  <div>
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[color:var(--ink-muted)]">
                      Clientes e operação
                    </p>
                    <h3 className="text-lg font-semibold text-[color:var(--ink-strong)]">Base, status e entrega</h3>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[20px] border border-[rgba(126,79,45,0.08)] bg-white/72 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">Clientes totais</p>
                      <strong className="mt-2 block text-xl text-[color:var(--ink-strong)]">
                        {formatNumber(summary.business.kpis.totalCustomers)}
                      </strong>
                    </div>
                    <div className="rounded-[20px] border border-[rgba(126,79,45,0.08)] bg-white/72 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">Novos clientes</p>
                      <strong className="mt-2 block text-xl text-[color:var(--ink-strong)]">
                        {formatNumber(summary.business.customerMetrics.newCustomersInRange)}
                      </strong>
                    </div>
                    <div className="rounded-[20px] border border-[rgba(126,79,45,0.08)] bg-white/72 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">Clientes recorrentes</p>
                      <strong className="mt-2 block text-xl text-[color:var(--ink-strong)]">
                        {formatNumber(summary.business.customerMetrics.returningCustomersInRange)}
                      </strong>
                    </div>
                    <div className="rounded-[20px] border border-[rgba(126,79,45,0.08)] bg-white/72 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">Taxa de recorrência</p>
                      <strong className="mt-2 block text-xl text-[color:var(--ink-strong)]">
                        {formatPercent(summary.business.customerMetrics.repeatRatePct)}
                      </strong>
                    </div>
                  </div>
                  <div className="grid gap-4">
                    <div>
                      <p className="mb-2 text-sm font-medium text-neutral-700">Status dos pedidos</p>
                      <DistributionList items={summary.business.statusMix} />
                    </div>
                    <div>
                      <p className="mb-2 text-sm font-medium text-neutral-700">Entrega vs retirada</p>
                      <DistributionList items={summary.business.fulfillmentMix} />
                    </div>
                    <div>
                      <p className="mb-2 text-sm font-medium text-neutral-700">Status da cotação do frete</p>
                      <DistributionList items={summary.business.quoteMix} />
                    </div>
                  </div>
                </div>

                <div className="app-panel grid gap-4 rounded-[26px] p-4 sm:p-5">
                  <div>
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[color:var(--ink-muted)]">
                      Financeiro pendente
                    </p>
                    <h3 className="text-lg font-semibold text-[color:var(--ink-strong)]">Recebimentos em aberto</h3>
                  </div>
                  {summary.business.recentReceivables.length ? (
                    <div className="grid gap-3">
                      {summary.business.recentReceivables.map((entry) => (
                        <div
                          key={`${entry.orderId}-${entry.customerName}`}
                          className="rounded-[20px] border border-[rgba(126,79,45,0.08)] bg-white/72 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <strong className="text-[color:var(--ink-strong)]">
                              Pedido #{entry.orderId} · {entry.customerName}
                            </strong>
                            <span className="rounded-full bg-[rgba(126,79,45,0.08)] px-3 py-1 text-xs font-semibold text-[color:var(--ink-strong)]">
                              {entry.status}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-neutral-600">
                            Aberto: {formatCurrencyBR(entry.amount)}
                            {entry.dueDate ? ` · vencimento ${new Date(entry.dueDate).toLocaleDateString('pt-BR')}` : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[20px] border border-dashed border-[rgba(126,79,45,0.14)] bg-white/60 p-4 text-sm text-neutral-500">
                      Nenhum recebimento em aberto neste momento.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
