'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppIcon, BroaMark, type AppIconName } from '@/components/app-icons';
import { useFeedback } from '@/components/feedback-provider';
import { formatCurrencyBR } from '@/lib/format';

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

const CHIP_TONE_CLASSES: Record<DashboardTone, string> = {
  amber: 'border-[rgba(192,118,43,0.2)] bg-white/78',
  sky: 'border-[rgba(108,152,214,0.2)] bg-white/82',
  mint: 'border-[rgba(102,165,128,0.2)] bg-white/82',
  rose: 'border-[rgba(192,111,95,0.2)] bg-white/82',
  ink: 'border-[rgba(57,45,35,0.12)] bg-white/78'
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

function InsightCard({
  eyebrow,
  title,
  value,
  detail,
  tone,
  iconName
}: {
  eyebrow: string;
  title: string;
  value: string;
  detail: string;
  tone: DashboardTone;
  iconName: AppIconName;
}) {
  return (
    <article className={`app-panel grid gap-4 rounded-[30px] p-5 sm:p-6 ${PANEL_TONE_CLASSES[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[color:var(--ink-muted)]">
            {eyebrow}
          </p>
          <h3 className="mt-2 text-lg font-semibold leading-tight text-[color:var(--ink-strong)]">{title}</h3>
        </div>
        <span
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] border shadow-[0_10px_24px_rgba(55,37,23,0.08)] ${CHIP_TONE_CLASSES[tone]}`}
        >
          <AppIcon name={iconName} className="h-5 w-5" />
        </span>
      </div>
      <strong className="text-[1.8rem] leading-none tracking-[-0.05em] text-[color:var(--ink-strong)] sm:text-[2.15rem]">
        {value}
      </strong>
      <p className="text-sm leading-6 text-neutral-700">{detail}</p>
    </article>
  );
}

function StoryPanel({
  eyebrow,
  title,
  description,
  tone,
  tag,
  children,
  className = ''
}: {
  eyebrow: string;
  title: string;
  description?: string;
  tone: DashboardTone;
  tag?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`app-panel grid gap-5 rounded-[34px] p-5 sm:p-6 ${PANEL_TONE_CLASSES[tone]} ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-2">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[color:var(--ink-muted)]">
            {eyebrow}
          </p>
          <div className="grid gap-1">
            <h2 className="text-[1.3rem] font-semibold tracking-[-0.03em] text-[color:var(--ink-strong)] sm:text-[1.55rem]">
              {title}
            </h2>
            {description ? <p className="max-w-3xl text-sm leading-6 text-neutral-700">{description}</p> : null}
          </div>
        </div>
        {tag}
      </div>
      {children}
    </section>
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

function ExperimentTrail({
  steps,
  tone = 'sky'
}: {
  steps: Array<{ label: string; value: number; detail: string }>;
  tone?: DashboardTone;
}) {
  const maxValue = Math.max(1, ...steps.map((step) => step.value));

  return (
    <div className="grid gap-3">
      {steps.map((step, index) => {
        const width = `${Math.max(10, (step.value / maxValue) * 100)}%`;
        return (
          <div
            key={step.label}
            className="rounded-[26px] border border-white/80 bg-white/76 p-4 shadow-[0_12px_28px_rgba(56,40,26,0.06)]"
          >
            <div className="flex items-start gap-3">
              <span
                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border text-sm font-semibold text-[color:var(--ink-strong)] ${CHIP_TONE_CLASSES[tone]}`}
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                      Etapa
                    </p>
                    <strong className="mt-1 block text-base text-[color:var(--ink-strong)]">{step.label}</strong>
                  </div>
                  <strong className="shrink-0 text-base text-[color:var(--ink-strong)]">{formatNumber(step.value)}</strong>
                </div>
                <p className="mt-2 text-sm leading-6 text-neutral-600">{step.detail}</p>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[rgba(126,79,45,0.08)]">
                  <div className={`h-full rounded-full ${BAR_TONE_CLASSES[tone]}`} style={{ width }} />
                </div>
              </div>
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

  const trafficHighlights = summary
    ? [
        {
          eyebrow: 'Pergunta 1',
          title: 'Quantas pessoas entraram no laboratório?',
          value: formatNumber(summary.traffic.totals.sessions),
          detail: `${formatNumber(summary.traffic.totals.publicSessions)} vieram do lado público e ${formatNumber(summary.traffic.totals.internalSessions)} estavam na operação.`,
          tone: 'sky' as const,
          iconName: 'external' as const
        },
        {
          eyebrow: 'Pergunta 2',
          title: 'Quantas portas elas abriram lá dentro?',
          value: formatNumber(summary.traffic.totals.pageViews),
          detail: `${formatNumber(summary.traffic.totals.publicPageViews)} pageviews no site e ${formatNumber(summary.traffic.totals.internalPageViews)} na operação.`,
          tone: 'mint' as const,
          iconName: 'spark' as const
        },
        {
          eyebrow: 'Pergunta 3',
          title: 'Quanto a visita ficou curiosa?',
          value: `${formatDecimal(summary.traffic.totals.avgPagesPerSession)} pág/sessão`,
          detail: `Cada visita olhou em média ${formatDecimal(summary.traffic.totals.avgPagesPerSession)} páginas. Bounce estimado: ${formatPercent(summary.traffic.totals.bounceRatePct)}.`,
          tone: 'amber' as const,
          iconName: 'refresh' as const
        },
        {
          eyebrow: 'Pergunta 4',
          title: 'Quantos chegaram até enviar pedido?',
          value: formatPercent(summary.traffic.funnel.orderPageConversionPct),
          detail: `${formatNumber(summary.traffic.funnel.submittedSessions)} sessões transformaram curiosidade em envio confirmado.`,
          tone: 'rose' as const,
          iconName: 'pedidos' as const
        }
      ]
    : [];

  const businessHighlights = summary
    ? [
        {
          eyebrow: 'Pergunta 5',
          title: 'Quanto dinheiro entrou na mochila?',
          value: formatCurrencyBR(summary.business.kpis.grossRevenueInRange),
          detail: `${formatCurrencyBR(summary.business.kpis.grossRevenueToday)} hoje e ${formatNumber(summary.business.kpis.ordersInRange)} pedidos nesta janela.`,
          tone: 'amber' as const,
          iconName: 'pedidos' as const
        },
        {
          eyebrow: 'Pergunta 6',
          title: 'Quanto já voltou de verdade?',
          value: formatCurrencyBR(summary.business.kpis.paidRevenueInRange),
          detail: `${formatCurrencyBR(summary.business.kpis.outstandingBalance)} ainda está esperando bater na porta.`,
          tone: 'mint' as const,
          iconName: 'refresh' as const
        },
        {
          eyebrow: 'Pergunta 7',
          title: 'Quanto sobra depois da massa?',
          value: formatPercent(summary.business.kpis.grossMarginPctInRange),
          detail: `${formatCurrencyBR(summary.business.kpis.grossProfitInRange)} de lucro bruto estimado no período.`,
          tone: 'sky' as const,
          iconName: 'spark' as const
        },
        {
          eyebrow: 'Pergunta 8',
          title: 'Quanto vale um pedido médio?',
          value: formatCurrencyBR(summary.business.kpis.avgTicketInRange),
          detail: `${formatNumber(summary.business.kpis.ordersToday)} pedidos hoje e ${formatNumber(summary.business.kpis.ordersAllTime)} pedidos na memória toda.`,
          tone: 'rose' as const,
          iconName: 'clientes' as const
        }
      ]
    : [];

  const funnelSteps = summary
    ? [
        {
          label: 'Entraram pela home',
          value: summary.traffic.funnel.homeSessions,
          detail: 'Esse é o começo da história: quantas visitas aterrissaram na página principal.'
        },
        {
          label: 'Foram até /pedido',
          value: summary.traffic.funnel.orderSessions,
          detail: 'Aqui a curiosidade vira intenção. A pessoa saiu do brilho e foi para a bancada de montar o pedido.'
        },
        {
          label: 'Conseguiram cotar frete',
          value: summary.traffic.funnel.quoteSuccessSessions,
          detail: 'Este passo mostra se a experiência de entrega deixou a conta clara antes do PIX.'
        },
        {
          label: 'Enviaram o pedido',
          value: summary.traffic.funnel.submittedSessions,
          detail: 'É quando o experimento fecha: a visita virou pedido enviado de verdade.'
        }
      ]
    : [];

  return (
    <div className="grid gap-5 pb-10">
      <section className="relative overflow-hidden rounded-[40px] border border-[rgba(73,43,22,0.08)] bg-[radial-gradient(1200px_500px_at_10%_0%,rgba(255,230,173,0.55),transparent_60%),radial-gradient(720px_420px_at_100%_10%,rgba(173,208,255,0.35),transparent_60%),linear-gradient(150deg,rgba(255,251,246,0.98),rgba(247,236,220,0.96))] p-5 shadow-[0_30px_70px_rgba(52,33,20,0.12)] sm:p-6 xl:p-8">
        <div className="pointer-events-none absolute -top-20 right-[-34px] h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(255,202,125,0.55),transparent_70%)] blur-2xl" />
        <div className="pointer-events-none absolute bottom-[-70px] left-[-36px] h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(146,198,255,0.38),transparent_72%)] blur-2xl" />
        <div className="pointer-events-none absolute right-[14%] top-[18%] h-16 w-16 rounded-full border border-white/35" />
        <div className="pointer-events-none absolute right-[11%] top-[12%] h-28 w-28 rounded-full border border-white/30" />

        <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] xl:gap-8">
          <div className="grid gap-5">
            <div className="inline-flex w-fit items-center gap-3 rounded-full border border-white/70 bg-white/72 px-3 py-2 shadow-[0_10px_24px_rgba(57,39,24,0.08)]">
              <BroaMark className="h-8 w-8 text-[color:var(--ink-strong)]" />
              <div className="grid gap-0.5">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[color:var(--ink-muted)]">
                  Observatório da Broa
                </p>
                <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Einstein explicando sem jargão</p>
              </div>
            </div>

            <div className="grid gap-3">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-[color:var(--ink-muted)]">
                Um painel para contar histórias com números
              </p>
              <h1 className="max-w-4xl text-[2rem] font-semibold leading-[0.95] tracking-[-0.06em] text-[color:var(--ink-strong)] sm:text-[2.75rem] xl:text-[3.2rem]">
                Se o Einstein da cozinha explicasse o <span className="brand-wordmark brand-wordmark--display">/dashboard</span>{' '}
                para uma criança.
              </h1>
              <p className="max-w-3xl text-[0.98rem] leading-7 text-neutral-700">
                Pense no site e na operação como um pequeno universo: primeiro a gente olha quem chegou, depois vê quais
                caminhos elas percorreram e no fim confere se o calor do forno virou pedido, dinheiro e cliente feliz.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-full border border-white/70 bg-white/78 px-3 py-1.5 text-neutral-700">
                Última leitura: {asOfLabel}
              </span>
              <span className="rounded-full border border-white/70 bg-white/78 px-3 py-1.5 text-neutral-700">
                Janela ativa: {summary ? summary.traffic.windowLabel : `${rangeDays} dias`}
              </span>
              <span className="rounded-full border border-white/70 bg-white/78 px-3 py-1.5 text-neutral-700">
                Coleta first-party ligada
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
                className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/80 px-4 py-2 text-sm font-semibold text-[color:var(--ink-strong)] shadow-[0_12px_24px_rgba(57,39,24,0.08)] transition hover:bg-white"
                onClick={() => void load({ silent: true })}
              >
                <AppIcon name="refresh" className="h-4 w-4" />
                {refreshing ? 'Atualizando...' : 'Atualizar leitura'}
              </button>
            </div>
          </div>

          <div className="grid gap-4 rounded-[34px] border border-[rgba(57,45,35,0.12)] bg-[linear-gradient(165deg,rgba(54,39,29,0.96),rgba(96,66,44,0.92))] p-5 text-white shadow-[0_20px_48px_rgba(31,20,14,0.24)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-white/70">
                  Resumo para contar em voz alta
                </p>
                <h2 className="mt-1 text-[1.35rem] font-semibold tracking-[-0.03em]">O experimento de hoje</h2>
              </div>
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-white/80">
                visão simples
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-[26px] border border-white/10 bg-white/8 p-4 backdrop-blur-sm">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/70">Pessoas no mapa</p>
                <strong className="mt-2 block text-[1.8rem] leading-none tracking-[-0.05em]">
                  {summary ? formatNumber(summary.traffic.totals.sessions) : '--'}
                </strong>
                <p className="mt-2 text-sm leading-6 text-white/78">Cada sessão é alguém entrando para olhar a broa.</p>
              </div>
              <div className="rounded-[26px] border border-white/10 bg-white/8 p-4 backdrop-blur-sm">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/70">Pedidos na janela</p>
                <strong className="mt-2 block text-[1.8rem] leading-none tracking-[-0.05em]">
                  {summary ? formatNumber(summary.business.kpis.ordersInRange) : '--'}
                </strong>
                <p className="mt-2 text-sm leading-6 text-white/78">É quantas vezes a curiosidade virou trabalho real.</p>
              </div>
              <div className="rounded-[26px] border border-white/10 bg-white/8 p-4 backdrop-blur-sm">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/70">Receita bruta</p>
                <strong className="mt-2 block text-[1.8rem] leading-none tracking-[-0.05em]">
                  {summary ? formatCurrencyBR(summary.business.kpis.grossRevenueInRange) : '--'}
                </strong>
                <p className="mt-2 text-sm leading-6 text-white/78">Aqui a gente vê quanto calor o forno gerou em dinheiro.</p>
              </div>
            </div>

            <div className="rounded-[26px] border border-white/10 bg-white/8 p-4">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/70">Einstein traduz</p>
              <div className="mt-3 grid gap-2 text-sm leading-6 text-white/82">
                <p>
                  Sessão é visita. Pageview é uma porta aberta. Conversão é quando a visita deixa de olhar e resolve agir.
                </p>
                <p>
                  Margem é o pedacinho que sobra depois de pagar ingredientes e fazer a conta ficar em pé.
                </p>
                <p>
                  Se o número cair em uma etapa e sumir na próxima, ali mora a próxima boa decisão de UX ou operação.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="app-panel rounded-[26px] border-dashed border-red-300 bg-red-50 text-sm text-red-700">{error}</div>
      ) : null}

      {loading && !summary ? (
        <div className="app-panel rounded-[26px] text-sm text-neutral-500">
          Montando o planetário da broa, buscando métricas do site e da operação...
        </div>
      ) : null}

      {summary ? (
        <>
          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
            <div className="grid gap-4 sm:grid-cols-2">
              {trafficHighlights.map((card) => (
                <InsightCard key={card.title} {...card} />
              ))}
            </div>

            <StoryPanel
              eyebrow="Como ler sem medo"
              title="O professor resumiria assim"
              description="Essas quatro frases ajudam a interpretar o painel sem cair no modo planilha."
              tone="ink"
              tag={
                <span className="rounded-full border border-white/70 bg-white/78 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)]">
                  leitura rápida
                </span>
              }
            >
              <div className="grid gap-3">
                <div className="rounded-[24px] border border-white/75 bg-white/78 p-4">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                    1. Entrada
                  </p>
                  <p className="mt-2 text-sm leading-6 text-neutral-700">
                    Se muita gente entra e poucas pessoas avançam para <strong>/pedido</strong>, o convite da home ainda não
                    está forte o bastante.
                  </p>
                </div>
                <div className="rounded-[24px] border border-white/75 bg-white/78 p-4">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                    2. Entendimento
                  </p>
                  <p className="mt-2 text-sm leading-6 text-neutral-700">
                    Se a pessoa chega ao pedido mas não consegue cotar frete, a conta ficou confusa antes de virar compra.
                  </p>
                </div>
                <div className="rounded-[24px] border border-white/75 bg-white/78 p-4">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                    3. Saúde do negócio
                  </p>
                  <p className="mt-2 text-sm leading-6 text-neutral-700">
                    Receita é barulho. Margem é música. O painel separa os dois para não confundir volume com saúde.
                  </p>
                </div>
              </div>
            </StoryPanel>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.06fr)_minmax(0,0.94fr)]">
            <StoryPanel
              eyebrow="Telescópio do site"
              title="Da curiosidade até o pedido"
              description="Aqui a história do funil aparece como se fosse uma experiência de ciências: cada etapa precisa empurrar a próxima."
              tone="sky"
              tag={
                <span className="rounded-full border border-white/70 bg-white/82 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)]">
                  {summary.traffic.windowLabel}
                </span>
              }
            >
              <div className="grid gap-4 lg:grid-cols-[minmax(0,0.94fr)_minmax(280px,1.06fr)]">
                <ExperimentTrail steps={funnelSteps} tone="sky" />

                <div className="grid gap-4">
                  <div className="rounded-[26px] border border-white/75 bg-white/78 p-4">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                      Ritmo dos últimos dias
                    </p>
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Sessões</p>
                        <DailyBars series={recentTrafficSeries} valueKey="sessions" tone="sky" />
                      </div>
                      <div className="grid gap-2">
                        <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Pageviews</p>
                        <DailyBars series={recentTrafficSeries} valueKey="pageViews" tone="mint" />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[26px] border border-white/75 bg-white/78 p-4">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                      Duas taxas que contam a verdade
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[22px] border border-white/80 bg-white/82 p-4">
                        <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Home → pedido</p>
                        <strong className="mt-2 block text-[1.6rem] leading-none tracking-[-0.04em] text-[color:var(--ink-strong)]">
                          {formatPercent(summary.traffic.funnel.orderPageConversionPct)}
                        </strong>
                        <p className="mt-2 text-sm leading-6 text-neutral-600">
                          Mostra quantas visitas aceitaram o convite de montar um pedido.
                        </p>
                      </div>
                      <div className="rounded-[22px] border border-white/80 bg-white/82 p-4">
                        <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Quote → envio</p>
                        <strong className="mt-2 block text-[1.6rem] leading-none tracking-[-0.04em] text-[color:var(--ink-strong)]">
                          {formatPercent(summary.traffic.funnel.quoteToSubmitPct)}
                        </strong>
                        <p className="mt-2 text-sm leading-6 text-neutral-600">
                          Mostra se o momento de pagar parece claro depois que o frete aparece.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </StoryPanel>

            <div className="grid gap-4">
              <StoryPanel
                eyebrow="Quem veio olhar"
                title="Dispositivo, origem e trilha de chegada"
                description="É o mapa das portas por onde as pessoas entram e do aparelho que carregam no bolso ou na mesa."
                tone="mint"
              >
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="grid gap-2">
                    <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Mix principal</p>
                    <DistributionList items={topTrafficMix} valueKey="sessions" tone="mint" />
                  </div>
                  <div className="grid gap-2">
                    <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Fontes</p>
                    <DistributionList items={summary.traffic.topSources} valueKey="sessions" tone="sky" />
                  </div>
                  <div className="grid gap-2">
                    <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Referrers</p>
                    <DistributionList items={summary.traffic.topReferrers} valueKey="sessions" tone="amber" />
                  </div>
                  <div className="grid gap-2">
                    <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Navegadores</p>
                    <DistributionList items={summary.traffic.browserMix} valueKey="sessions" tone="rose" />
                  </div>
                  <div className="grid gap-2 xl:col-span-2">
                    <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Sistemas operacionais</p>
                    <DistributionList items={summary.traffic.osMix} valueKey="sessions" tone="ink" />
                  </div>
                </div>
              </StoryPanel>

              <StoryPanel
                eyebrow="Quando a máquina faz careta"
                title="Vitals e páginas pesadas"
                description="Se algum número aqui engrossa demais, é sinal de que a experiência começou a pedir fôlego extra."
                tone="rose"
              >
                <div className="grid gap-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {summary.traffic.vitalBenchmarks.map((metric) => (
                      <div
                        key={metric.name}
                        className="rounded-[24px] border border-white/80 bg-white/82 p-4 shadow-[0_10px_24px_rgba(57,39,24,0.06)]"
                      >
                        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                          {metric.name}
                        </p>
                        <strong className="mt-2 block text-[1.55rem] leading-none tracking-[-0.04em] text-[color:var(--ink-strong)]">
                          {formatMetricValue(metric.p75, metric.unit)}
                        </strong>
                        <p className="mt-2 text-sm leading-6 text-neutral-600">
                          Mediana {formatMetricValue(metric.median, metric.unit)} com {formatNumber(metric.sampleSize)} amostras.
                        </p>
                      </div>
                    ))}
                  </div>

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
                          <p className="mt-2 text-sm leading-6 text-neutral-600">
                            p75 {formatMetricValue(entry.p75, 'ms')} · mediana {formatMetricValue(entry.median, 'ms')} ·{' '}
                            {formatNumber(entry.sampleSize)} amostras.
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[22px] border border-dashed border-[rgba(126,79,45,0.16)] bg-white/55 p-4 text-sm text-neutral-500">
                      Ainda não há amostra suficiente por rota. Assim que o time navegar mais, as páginas lentas começam a aparecer aqui.
                    </div>
                  )}
                </div>
              </StoryPanel>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.92fr)]">
            <StoryPanel
              eyebrow="Bancada de navegação"
              title="Rotas e links que puxam mais atenção"
              description="Essa parte mostra onde as pessoas passam mais tempo e quais botões estão chamando clique suficiente para merecer respeito."
              tone="amber"
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Rotas mais vistas</p>
                  <DistributionList
                    items={summary.traffic.topPaths.map((entry) => ({
                      label: `${entry.path} · ${entry.surface}`,
                      value: entry.views
                    }))}
                    tone="amber"
                  />
                </div>
                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Links mais clicados</p>
                  <DistributionList
                    items={summary.traffic.topLinks.map((entry) => ({
                      label: entry.label || entry.href,
                      clicks: entry.clicks
                    }))}
                    valueKey="clicks"
                    tone="rose"
                  />
                </div>
              </div>
            </StoryPanel>

            <StoryPanel
              eyebrow="Memória do experimento"
              title="Números que ajudam a não se enganar"
              description="Nem todo ganho aparece no caixa do dia. Aqui estão os lembretes que seguram a leitura no chão."
              tone="ink"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[24px] border border-white/80 bg-white/82 p-4">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                    Pedidos acumulados
                  </p>
                  <strong className="mt-2 block text-[1.55rem] leading-none tracking-[-0.04em] text-[color:var(--ink-strong)]">
                    {formatNumber(summary.business.kpis.ordersAllTime)}
                  </strong>
                </div>
                <div className="rounded-[24px] border border-white/80 bg-white/82 p-4">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                    Receita bruta acumulada
                  </p>
                  <strong className="mt-2 block text-[1.55rem] leading-none tracking-[-0.04em] text-[color:var(--ink-strong)]">
                    {formatCurrencyBR(summary.business.kpis.grossRevenueAllTime)}
                  </strong>
                </div>
                <div className="rounded-[24px] border border-white/80 bg-white/82 p-4">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                    Descontos concedidos
                  </p>
                  <strong className="mt-2 block text-[1.55rem] leading-none tracking-[-0.04em] text-[color:var(--ink-strong)]">
                    {formatCurrencyBR(summary.business.kpis.discountsInRange)}
                  </strong>
                </div>
                <div className="rounded-[24px] border border-white/80 bg-white/82 p-4">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                    Dinheiro em aberto
                  </p>
                  <strong className="mt-2 block text-[1.55rem] leading-none tracking-[-0.04em] text-[color:var(--ink-strong)]">
                    {formatCurrencyBR(summary.business.kpis.outstandingBalance)}
                  </strong>
                </div>
              </div>
            </StoryPanel>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {businessHighlights.map((card) => (
              <InsightCard key={card.title} {...card} />
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <div className="grid gap-4">
              <StoryPanel
                eyebrow="Mesa do laboratório"
                title="Receita, custo e o pedaço que sobra"
                description="Agora o painel deixa de ser visita e passa a ser cozinha. Aqui mora a matemática que decide se a broa está crescendo com saúde."
                tone="amber"
              >
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-[24px] border border-white/80 bg-white/82 p-4">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                      Receita líquida de produto
                    </p>
                    <strong className="mt-2 block text-[1.45rem] leading-none tracking-[-0.04em] text-[color:var(--ink-strong)]">
                      {formatCurrencyBR(summary.business.kpis.productNetRevenueInRange)}
                    </strong>
                  </div>
                  <div className="rounded-[24px] border border-white/80 bg-white/82 p-4">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                      Frete cobrado
                    </p>
                    <strong className="mt-2 block text-[1.45rem] leading-none tracking-[-0.04em] text-[color:var(--ink-strong)]">
                      {formatCurrencyBR(summary.business.kpis.deliveryRevenueInRange)}
                    </strong>
                  </div>
                  <div className="rounded-[24px] border border-white/80 bg-white/82 p-4">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                      COGS estimado
                    </p>
                    <strong className="mt-2 block text-[1.45rem] leading-none tracking-[-0.04em] text-[color:var(--ink-strong)]">
                      {formatCurrencyBR(summary.business.kpis.estimatedCogsInRange)}
                    </strong>
                  </div>
                  <div className="rounded-[24px] border border-white/80 bg-white/82 p-4">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                      Lucro bruto
                    </p>
                    <strong className="mt-2 block text-[1.45rem] leading-none tracking-[-0.04em] text-[color:var(--ink-strong)]">
                      {formatCurrencyBR(summary.business.kpis.grossProfitInRange)}
                    </strong>
                  </div>
                  <div className="rounded-[24px] border border-white/80 bg-white/82 p-4">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                      Contribuição pós-frete
                    </p>
                    <strong className="mt-2 block text-[1.45rem] leading-none tracking-[-0.04em] text-[color:var(--ink-strong)]">
                      {formatCurrencyBR(summary.business.kpis.contributionAfterFreightInRange)}
                    </strong>
                  </div>
                  <div className="rounded-[24px] border border-white/80 bg-white/82 p-4">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                      Receita recebida
                    </p>
                    <strong className="mt-2 block text-[1.45rem] leading-none tracking-[-0.04em] text-[color:var(--ink-strong)]">
                      {formatCurrencyBR(summary.business.kpis.paidRevenueInRange)}
                    </strong>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="grid gap-2">
                    <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Receita bruta por dia</p>
                    <DailyBars series={recentBusinessSeries} valueKey="grossRevenue" moneyKey="grossRevenue" tone="amber" />
                  </div>
                  <div className="grid gap-2">
                    <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Lucro bruto estimado por dia</p>
                    <DailyBars series={recentBusinessSeries} valueKey="grossProfit" moneyKey="grossProfit" tone="mint" />
                  </div>
                </div>
              </StoryPanel>

              <StoryPanel
                eyebrow="Sabores que puxam a turma"
                title="Top produtos do período"
                description="Se a criança perguntar quais broas mais brilharam, a resposta está aqui."
                tone="mint"
              >
                {summary.business.topProducts.length ? (
                  <div className="grid gap-3">
                    {summary.business.topProducts.map((product) => (
                      <div
                        key={product.productId}
                        className="rounded-[24px] border border-white/80 bg-white/82 p-4 shadow-[0_10px_24px_rgba(57,39,24,0.06)]"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <strong className="text-[color:var(--ink-strong)]">{product.productName}</strong>
                            <p className="mt-1 text-sm leading-6 text-neutral-600">
                              {formatNumber(product.units)} unidades vendidas no período.
                            </p>
                          </div>
                          <span className="rounded-full border border-white/70 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)]">
                            margem {formatPercent(product.marginPct)}
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
                ) : (
                  <div className="rounded-[22px] border border-dashed border-[rgba(126,79,45,0.16)] bg-white/55 p-4 text-sm text-neutral-500">
                    Ainda não há produto suficiente para montar um ranking confiável nesta janela.
                  </div>
                )}
              </StoryPanel>
            </div>

            <div className="grid gap-4">
              <StoryPanel
                eyebrow="Quem volta para brincar"
                title="Clientes, status e tipo de atendimento"
                description="Aqui a operação deixa pistas sobre fidelidade, andamento dos pedidos e peso relativo de entrega contra retirada."
                tone="sky"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[24px] border border-white/80 bg-white/82 p-4">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                      Clientes totais
                    </p>
                    <strong className="mt-2 block text-[1.45rem] leading-none tracking-[-0.04em] text-[color:var(--ink-strong)]">
                      {formatNumber(summary.business.kpis.totalCustomers)}
                    </strong>
                  </div>
                  <div className="rounded-[24px] border border-white/80 bg-white/82 p-4">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                      Novos clientes
                    </p>
                    <strong className="mt-2 block text-[1.45rem] leading-none tracking-[-0.04em] text-[color:var(--ink-strong)]">
                      {formatNumber(summary.business.customerMetrics.newCustomersInRange)}
                    </strong>
                  </div>
                  <div className="rounded-[24px] border border-white/80 bg-white/82 p-4">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                      Clientes recorrentes
                    </p>
                    <strong className="mt-2 block text-[1.45rem] leading-none tracking-[-0.04em] text-[color:var(--ink-strong)]">
                      {formatNumber(summary.business.customerMetrics.returningCustomersInRange)}
                    </strong>
                  </div>
                  <div className="rounded-[24px] border border-white/80 bg-white/82 p-4">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                      Taxa de recorrência
                    </p>
                    <strong className="mt-2 block text-[1.45rem] leading-none tracking-[-0.04em] text-[color:var(--ink-strong)]">
                      {formatPercent(summary.business.customerMetrics.repeatRatePct)}
                    </strong>
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Status dos pedidos</p>
                    <DistributionList items={summary.business.statusMix} tone="sky" />
                  </div>
                  <div className="grid gap-2">
                    <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Entrega vs retirada</p>
                    <DistributionList items={summary.business.fulfillmentMix} tone="mint" />
                  </div>
                  <div className="grid gap-2">
                    <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Status da cotação do frete</p>
                    <DistributionList items={summary.business.quoteMix} tone="amber" />
                  </div>
                </div>
              </StoryPanel>

              <StoryPanel
                eyebrow="Bilhetinhos para cobrar"
                title="Recebimentos em aberto"
                description="É a caixinha dos lembretes: dinheiro que já nasceu em pedido, mas ainda não encontrou o caixa."
                tone="rose"
              >
                {summary.business.recentReceivables.length ? (
                  <div className="grid gap-3">
                    {summary.business.recentReceivables.map((entry) => (
                      <div
                        key={`${entry.orderId}-${entry.customerName}`}
                        className="rounded-[24px] border border-white/80 bg-white/82 p-4 shadow-[0_10px_24px_rgba(57,39,24,0.06)]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <strong className="text-[color:var(--ink-strong)]">
                            Pedido #{entry.orderId} · {entry.customerName}
                          </strong>
                          <span className="rounded-full border border-white/70 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)]">
                            {entry.status}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-neutral-600">
                          Aberto: {formatCurrencyBR(entry.amount)}
                          {entry.dueDate ? ` · vencimento ${new Date(entry.dueDate).toLocaleDateString('pt-BR')}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[22px] border border-dashed border-[rgba(126,79,45,0.16)] bg-white/55 p-4 text-sm text-neutral-500">
                    Nenhum recebimento em aberto neste momento.
                  </div>
                )}
              </StoryPanel>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
