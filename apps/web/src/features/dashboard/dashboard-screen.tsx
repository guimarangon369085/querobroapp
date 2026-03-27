'use client';

import type { Coupon } from '@querobroapp/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFeedback } from '@/components/feedback-provider';
import { formatCurrencyBR, formatDecimalInputBR, parseLocaleNumber } from '@/lib/format';
import { apiFetch } from '@/lib/api';

type DashboardTrafficSummary = {
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

type DashboardBusinessSummary = {
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
    marketingSamplesInvestmentInRange: number;
    deliveryRevenueInRange: number;
    productNetRevenueInRange: number;
    estimatedCogsInRange: number;
    costedOrdersInRange: number;
    cogsWarningsInRange: number;
    grossProfitInRange: number;
    grossMarginPctInRange: number;
    contributionAfterFreightInRange: number;
  };
  cogsAudit: {
    windowLabel: string;
    ordersCount: number;
    ingredientsCount: number;
    warningsCount: number;
    revenue: number;
    cogs: number;
    grossProfit: number;
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
  cogsByIngredient: Array<{
    ingredientId: number;
    ingredientName: string;
    unit: string;
    quantity: number;
    unitCost: number;
    amount: number;
    orderCount: number;
  }>;
  cogsByOrder: Array<{
    orderId: number;
    orderDisplayNumber: number;
    customerName: string;
    createdAt: string;
    scheduledAt: string | null;
    status: string;
    itemsCount: number;
    units: number;
    revenue: number;
    cogs: number;
    grossProfit: number;
    products: Array<{
      productId: number;
      productName: string;
      quantity: number;
      revenue: number;
      cogs: number;
    }>;
    ingredients: Array<{
      ingredientId: number;
      ingredientName: string;
      unit: string;
      quantity: number;
      unitCost: number;
      amount: number;
    }>;
    warnings: Array<{
      code: 'BOM_MISSING' | 'BOM_ITEM_MISSING_QTY';
      productId: number;
      productName: string;
      message: string;
    }>;
  }>;
  cogsWarnings: Array<{
    code: 'BOM_MISSING' | 'BOM_ITEM_MISSING_QTY';
    orderId: number;
    orderDisplayNumber: number;
    productId: number;
    productName: string;
    message: string;
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

type DashboardSummary = {
  asOf: string;
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
  traffic: DashboardTrafficSummary;
  business: DashboardBusinessSummary;
  selectedPeriod: {
    key: '24h' | '7d' | '30d';
    days: 1 | 7 | 30;
    label: string;
    traffic: DashboardTrafficSummary;
    business: DashboardBusinessSummary;
  };
};

type MonthlyCogsEntry = {
  monthKey: string;
  monthLabel: string;
  ordersCount: number;
  itemsCount: number;
  units: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  warningsCount: number;
  products: Array<{
    productId: number;
    productName: string;
    quantity: number;
    revenue: number;
    cogs: number;
  }>;
  ingredients: Array<{
    ingredientId: number;
    ingredientName: string;
    unit: string;
    quantity: number;
    unitCost: number;
    amount: number;
    orderCount: number;
  }>;
};

type DashboardPeriodDays = DashboardSummary['selectedPeriod']['days'];
type DashboardPeriodSelection = 'all' | DashboardPeriodDays;
type CouponDraft = {
  code: string;
  discountPct: string;
  hasUsageLimit: boolean;
  usageLimitPerCustomer: string;
  active: boolean;
};

type DashboardTone = 'amber' | 'sky' | 'mint' | 'rose' | 'ink';

const DASHBOARD_PERIOD_OPTIONS: Array<{ value: DashboardPeriodSelection; label: string }> = [
  { value: 'all', label: 'Periodo total' },
  { value: 1, label: 'Ultimas 24h' },
  { value: 7, label: 'Ultimos 7 dias' },
  { value: 30, label: 'Ultimos 30 dias' }
];

const PANEL_TONE_CLASSES: Record<DashboardTone, string> = {
  amber:
    'border-[color:var(--tone-gold-line)] bg-[linear-gradient(155deg,rgba(250,243,233,0.97),rgba(243,230,211,0.9))]',
  sky:
    'border-[color:var(--tone-sage-line)] bg-[linear-gradient(155deg,rgba(245,250,247,0.97),rgba(233,242,237,0.9))]',
  mint:
    'border-[color:var(--tone-olive-line)] bg-[linear-gradient(155deg,rgba(248,247,240,0.97),rgba(238,235,222,0.92))]',
  rose:
    'border-[color:var(--tone-blush-line)] bg-[linear-gradient(155deg,rgba(252,247,245,0.97),rgba(243,229,224,0.92))]',
  ink:
    'border-[rgba(57,45,35,0.14)] bg-[linear-gradient(155deg,rgba(255,252,249,0.98),rgba(238,233,226,0.92))]'
};

const BAR_TONE_CLASSES: Record<DashboardTone, string> = {
  amber: 'bg-[linear-gradient(90deg,var(--tone-gold-ink),var(--brand-gold))]',
  sky: 'bg-[linear-gradient(90deg,var(--tone-sage-ink),var(--brand-sage))]',
  mint: 'bg-[linear-gradient(90deg,var(--tone-olive-ink),var(--brand-olive))]',
  rose: 'bg-[linear-gradient(90deg,var(--tone-roast-ink),var(--brand-blush))]',
  ink: 'bg-[linear-gradient(90deg,var(--brand-cocoa),var(--brand-gold))]'
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

function formatMonthLabel(value: Date) {
  const label = value.toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric'
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function normalizeCouponCodeInput(value: string) {
  return value.replace(/\s+/g, ' ').trim().toUpperCase();
}

function buildCouponDraft(
  coupon?: Pick<Coupon, 'code' | 'discountPct' | 'active' | 'usageLimitPerCustomer'> | null
): CouponDraft {
  return {
    code: coupon?.code || '',
    discountPct: formatDecimalInputBR(coupon?.discountPct ?? '', {
      minFractionDigits: 0,
      maxFractionDigits: 2
    }),
    hasUsageLimit: typeof coupon?.usageLimitPerCustomer === 'number' && (coupon.usageLimitPerCustomer || 0) > 0,
    usageLimitPerCustomer:
      typeof coupon?.usageLimitPerCustomer === 'number' && (coupon.usageLimitPerCustomer || 0) > 0
        ? String(Math.floor(coupon.usageLimitPerCustomer || 0))
        : '',
    active: coupon?.active ?? true
  };
}

function parseCouponUsageLimit(value: string) {
  const parsed = Number.parseInt(String(value || '').replace(/\D/g, ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
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

function CogsAuditStat({
  label,
  value,
  emphasis = false
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-[22px] border px-4 py-3 ${
        emphasis
          ? 'border-[rgba(162,81,66,0.18)] bg-[rgba(255,248,246,0.9)]'
          : 'border-white/80 bg-white/78'
      }`}
    >
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">{label}</p>
      <strong className="mt-1 block text-lg tracking-[-0.03em] text-[color:var(--ink-strong)]">{value}</strong>
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
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<DashboardPeriodSelection>('all');
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponDrafts, setCouponDrafts] = useState<Record<number, CouponDraft>>({});
  const [newCouponDraft, setNewCouponDraft] = useState<CouponDraft>(() => buildCouponDraft());
  const [couponsLoading, setCouponsLoading] = useState(true);
  const [couponSavingKey, setCouponSavingKey] = useState<string | null>(null);
  const [couponDeletingId, setCouponDeletingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { notifyError, notifySuccess } = useFeedback();
  const summaryRef = useRef<DashboardSummary | null>(null);

  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);

  const loadCoupons = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!silent) {
        setCouponsLoading(true);
      }

      try {
        const payload = await apiFetch<Coupon[]>('/dashboard/coupons', {
          cache: 'no-store'
        });
        const normalizedCoupons = Array.isArray(payload) ? payload : [];
        setCoupons(normalizedCoupons);
        setCouponDrafts(
          Object.fromEntries(normalizedCoupons.map((coupon) => [coupon.id || 0, buildCouponDraft(coupon)]))
        );
      } catch (loadError) {
        if (!silent) {
          notifyError(loadError instanceof Error ? loadError.message : 'Nao foi possivel carregar os cupons.');
        }
      } finally {
        setCouponsLoading(false);
      }
    },
    [notifyError]
  );

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!silent) {
        setLoading(true);
      }

      try {
        const path =
          selectedPeriod !== 'all' ? `/dashboard/summary?days=${encodeURIComponent(String(selectedPeriod))}` : '/dashboard/summary';
        const payload = await apiFetch<DashboardSummary>(path, {
          cache: 'no-store'
        });
        setSummary(payload);
        setError(null);
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : 'Nao foi possivel carregar o dashboard.';
        const hasSummaryLoaded = summaryRef.current != null;
        setError(hasSummaryLoaded ? null : message);
        if (!silent && !hasSummaryLoaded) {
          notifyError(message);
        }
      } finally {
        setLoading(false);
      }
    },
    [notifyError, selectedPeriod]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadCoupons();
  }, [loadCoupons]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void load({ silent: true });
      }
    }, 180_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const activeTraffic =
    summary && selectedPeriod === 'all' ? summary.traffic : summary?.selectedPeriod.traffic || null;
  const activeBusiness =
    summary && selectedPeriod === 'all' ? summary.business : summary?.selectedPeriod.business || null;
  const activePeriodLabel =
    selectedPeriod === 'all'
      ? summary?.traffic.windowLabel || 'Base inteira'
      : summary?.selectedPeriod.label || 'Ultimos 7 dias';
  const topTrafficMix = useMemo(
    () =>
      activeTraffic
        ? [
            { label: 'Mobile', sessions: activeTraffic.deviceMix.find((entry) => entry.label === 'mobile')?.sessions || 0 },
            { label: 'Tablet', sessions: activeTraffic.deviceMix.find((entry) => entry.label === 'tablet')?.sessions || 0 },
            { label: 'Desktop', sessions: activeTraffic.deviceMix.find((entry) => entry.label === 'desktop')?.sessions || 0 }
          ]
        : [],
    [activeTraffic]
  );

  const asOfLabel = summary ? new Date(summary.asOf).toLocaleString('pt-BR') : 'carregando...';
  const recentTrafficSeries = activeTraffic ? activeTraffic.dailySeries.slice(-10) : [];
  const recentBusinessSeries = activeBusiness ? activeBusiness.dailySeries.slice(-10) : [];
  const cogsByMonth = useMemo<MonthlyCogsEntry[]>(() => {
    if (!summary) return [];

    const byMonth = new Map<
      string,
      {
        monthKey: string;
        monthLabel: string;
        ordersCount: number;
        itemsCount: number;
        units: number;
        revenue: number;
        cogs: number;
        grossProfit: number;
        warningsCount: number;
        products: Map<number, MonthlyCogsEntry['products'][number]>;
        ingredients: Map<number, MonthlyCogsEntry['ingredients'][number]>;
      }
    >();

    for (const entry of summary.business.cogsByOrder) {
      const referenceDate = new Date(entry.scheduledAt || entry.createdAt);
      const monthDate = Number.isNaN(referenceDate.getTime())
        ? new Date(entry.createdAt)
        : referenceDate;
      const monthKey = Number.isNaN(monthDate.getTime())
        ? 'sem-data'
        : `${monthDate.getFullYear()}-${`${monthDate.getMonth() + 1}`.padStart(2, '0')}`;
      const monthLabel = Number.isNaN(monthDate.getTime()) ? 'Sem data' : formatMonthLabel(monthDate);

      const current = byMonth.get(monthKey) || {
        monthKey,
        monthLabel,
        ordersCount: 0,
        itemsCount: 0,
        units: 0,
        revenue: 0,
        cogs: 0,
        grossProfit: 0,
        warningsCount: 0,
        products: new Map<number, MonthlyCogsEntry['products'][number]>(),
        ingredients: new Map<number, MonthlyCogsEntry['ingredients'][number]>()
      };

      current.ordersCount += 1;
      current.itemsCount += entry.itemsCount;
      current.units += entry.units;
      current.revenue += entry.revenue;
      current.cogs += entry.cogs;
      current.grossProfit += entry.grossProfit;
      current.warningsCount += entry.warnings.length;

      for (const product of entry.products) {
        const existingProduct = current.products.get(product.productId) || {
          productId: product.productId,
          productName: product.productName,
          quantity: 0,
          revenue: 0,
          cogs: 0
        };
        existingProduct.quantity += product.quantity;
        existingProduct.revenue += product.revenue;
        existingProduct.cogs += product.cogs;
        current.products.set(product.productId, existingProduct);
      }

      for (const ingredient of entry.ingredients) {
        const existingIngredient = current.ingredients.get(ingredient.ingredientId) || {
          ingredientId: ingredient.ingredientId,
          ingredientName: ingredient.ingredientName,
          unit: ingredient.unit,
          quantity: 0,
          unitCost: ingredient.unitCost,
          amount: 0,
          orderCount: 0
        };
        existingIngredient.quantity += ingredient.quantity;
        existingIngredient.amount += ingredient.amount;
        existingIngredient.unitCost = ingredient.unitCost;
        existingIngredient.orderCount += 1;
        current.ingredients.set(ingredient.ingredientId, existingIngredient);
      }

      byMonth.set(monthKey, current);
    }

    return Array.from(byMonth.values())
      .map((entry) => ({
        monthKey: entry.monthKey,
        monthLabel: entry.monthLabel,
        ordersCount: entry.ordersCount,
        itemsCount: entry.itemsCount,
        units: entry.units,
        revenue: entry.revenue,
        cogs: entry.cogs,
        grossProfit: entry.grossProfit,
        grossMarginPct: entry.revenue > 0 ? (entry.grossProfit / entry.revenue) * 100 : 0,
        warningsCount: entry.warningsCount,
        products: Array.from(entry.products.values())
          .sort((left, right) => right.cogs - left.cogs || right.quantity - left.quantity)
          .map((product) => ({
            ...product,
            revenue: Number(product.revenue.toFixed(2)),
            cogs: Number(product.cogs.toFixed(2))
          })),
        ingredients: Array.from(entry.ingredients.values())
          .sort((left, right) => right.amount - left.amount || right.quantity - left.quantity)
          .map((ingredient) => ({
            ...ingredient,
            quantity: Number(ingredient.quantity.toFixed(3)),
            amount: Number(ingredient.amount.toFixed(2)),
            unitCost: Number(ingredient.unitCost.toFixed(4))
          }))
      }))
      .sort((left, right) => right.monthKey.localeCompare(left.monthKey));
  }, [summary]);

  const activeCouponsCount = useMemo(
    () => coupons.reduce((sum, coupon) => sum + (coupon.active ? 1 : 0), 0),
    [coupons]
  );

  const setCouponDraftField = useCallback(
    (id: number, field: keyof CouponDraft, value: string | boolean) => {
      setCouponDrafts((current) => ({
        ...current,
        [id]: {
          ...(current[id] || buildCouponDraft(coupons.find((entry) => entry.id === id))),
          [field]:
            field === 'code'
              ? normalizeCouponCodeInput(String(value))
              : field === 'discountPct' || field === 'usageLimitPerCustomer'
                ? String(value)
                : Boolean(value)
        }
      }));
    },
    [coupons]
  );

  const setNewCouponField = useCallback((field: keyof CouponDraft, value: string | boolean) => {
    setNewCouponDraft((current) => ({
      ...current,
      [field]:
        field === 'code'
          ? normalizeCouponCodeInput(String(value))
          : field === 'discountPct' || field === 'usageLimitPerCustomer'
            ? String(value)
            : Boolean(value)
    }));
  }, []);

  const persistCoupon = useCallback(
    async (input: { id?: number; draft: CouponDraft }) => {
      const code = normalizeCouponCodeInput(input.draft.code);
      if (!code) {
        throw new Error('Informe o codigo do cupom.');
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

      return apiFetch<Coupon>(input.id ? `/dashboard/coupons/${input.id}` : '/dashboard/coupons', {
        method: input.id ? 'PUT' : 'POST',
        body: JSON.stringify({
          code,
          discountPct,
          usageLimitPerCustomer,
          active: Boolean(input.draft.active)
        })
      });
    },
    []
  );

  const handleSaveCoupon = useCallback(
    async (id: number) => {
      const draft = couponDrafts[id];
      if (!draft) return;

      try {
        setCouponSavingKey(`existing-${id}`);
        const saved = await persistCoupon({ id, draft });
        setCoupons((current) =>
          current.map((entry) => (entry.id === id ? saved : entry))
        );
        setCouponDrafts((current) => ({
          ...current,
          [id]: buildCouponDraft(saved)
        }));
        notifySuccess(`Cupom ${saved.code} atualizado.`);
      } catch (saveError) {
        notifyError(saveError instanceof Error ? saveError.message : 'Nao foi possivel salvar o cupom.');
      } finally {
        setCouponSavingKey(null);
      }
    },
    [couponDrafts, notifyError, notifySuccess, persistCoupon]
  );

  const handleAddCoupon = useCallback(async () => {
    try {
      setCouponSavingKey('new');
      const created = await persistCoupon({ draft: newCouponDraft });
      setCoupons((current) => [...current, created].sort((left, right) => left.code.localeCompare(right.code)));
      setCouponDrafts((current) => ({
        ...current,
        [created.id || 0]: buildCouponDraft(created)
      }));
      setNewCouponDraft(buildCouponDraft());
      notifySuccess(`Cupom ${created.code} criado.`);
    } catch (saveError) {
      notifyError(saveError instanceof Error ? saveError.message : 'Nao foi possivel criar o cupom.');
    } finally {
      setCouponSavingKey(null);
    }
  }, [newCouponDraft, notifyError, notifySuccess, persistCoupon]);

  const handleDeleteCoupon = useCallback(
    async (id: number) => {
      try {
        setCouponDeletingId(id);
        await apiFetch<{ ok: boolean }>(`/dashboard/coupons/${id}`, {
          method: 'DELETE'
        });
        setCoupons((current) => current.filter((entry) => entry.id !== id));
        setCouponDrafts((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        notifySuccess('Cupom excluido.');
      } catch (deleteError) {
        notifyError(deleteError instanceof Error ? deleteError.message : 'Nao foi possivel excluir o cupom.');
      } finally {
        setCouponDeletingId(null);
      }
    },
    [notifyError, notifySuccess]
  );

  const trafficMetrics = summary && activeTraffic
    ? [
        { label: 'Sessões', value: formatNumber(activeTraffic.totals.sessions), tone: 'sky' as const },
        { label: 'Pageviews', value: formatNumber(activeTraffic.totals.pageViews), tone: 'mint' as const },
        { label: 'Pág/sessão', value: formatDecimal(activeTraffic.totals.avgPagesPerSession), tone: 'amber' as const },
        { label: 'Bounce', value: formatPercent(activeTraffic.totals.bounceRatePct), tone: 'rose' as const },
        { label: 'Home → /pedido', value: formatPercent(activeTraffic.funnel.orderPageConversionPct), tone: 'sky' as const },
        { label: 'Quote → envio', value: formatPercent(activeTraffic.funnel.quoteToSubmitPct), tone: 'mint' as const },
        { label: 'Integrações ready', value: formatNumber(summary.integrations.readyCount), tone: 'ink' as const },
        { label: 'Integrações pending', value: formatNumber(summary.integrations.pendingCount), tone: 'amber' as const }
      ]
    : [];

  const businessMetrics = activeBusiness
    ? [
        { label: 'Pedidos', value: formatNumber(activeBusiness.kpis.ordersInRange), tone: 'amber' as const },
        { label: 'Receita', value: formatCurrencyBR(activeBusiness.kpis.grossRevenueInRange), tone: 'mint' as const },
        { label: 'Recebido', value: formatCurrencyBR(activeBusiness.kpis.paidRevenueInRange), tone: 'sky' as const },
        { label: 'Em aberto', value: formatCurrencyBR(activeBusiness.kpis.outstandingBalance), tone: 'rose' as const },
        { label: 'Ticket médio', value: formatCurrencyBR(activeBusiness.kpis.avgTicketInRange), tone: 'ink' as const },
        { label: 'Margem', value: formatPercent(activeBusiness.kpis.grossMarginPctInRange), tone: 'sky' as const },
        { label: 'Clientes', value: formatNumber(activeBusiness.kpis.totalCustomers), tone: 'mint' as const },
        { label: 'Recorrência', value: formatPercent(activeBusiness.customerMetrics.repeatRatePct), tone: 'amber' as const }
      ]
    : [];

  return (
    <div className="grid gap-4 pb-10">
      <section className="app-panel flex flex-wrap items-center justify-between gap-3 rounded-[30px] p-4 sm:p-5">
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full border border-white/70 bg-white/78 px-3 py-1.5 text-neutral-700">{asOfLabel}</span>
          <span className="rounded-full border border-white/70 bg-white/78 px-3 py-1.5 text-neutral-700">
            Periodo · {activePeriodLabel}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-full border border-white/70 bg-white/82 p-1">
          {DASHBOARD_PERIOD_OPTIONS.map((option) => {
            const active = option.value === selectedPeriod;
            return (
              <button
                key={String(option.value)}
                type="button"
                className={`app-button min-h-10 px-4 py-2 text-[0.78rem] ${active ? 'app-button-primary' : 'app-button-ghost'}`}
                onClick={() => setSelectedPeriod(option.value)}
              >
                {option.label}
              </button>
            );
          })}
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

          <SectionPanel
            title="Cupons"
            tone="ink"
            tag={
              <span className="rounded-full border border-white/80 bg-white/82 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-strong)]">
                {formatNumber(activeCouponsCount)} ativo(s)
              </span>
            }
          >
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Total de cupons" value={formatNumber(coupons.length)} tone="ink" />
                <MetricCard label="Ativos" value={formatNumber(activeCouponsCount)} tone="mint" />
                <MetricCard
                  label="Inativos"
                  value={formatNumber(Math.max(coupons.length - activeCouponsCount, 0))}
                  tone="rose"
                />
                <MetricCard label="Box operacional" value="Dashboard" tone="amber" meta="CRUD de cupom e desconto percentual." />
              </div>

              <div className="grid gap-3 rounded-[24px] border border-white/80 bg-white/82 p-4 shadow-[0_10px_24px_rgba(57,39,24,0.06)]">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">Adicionar novo</p>
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(140px,180px)_150px_minmax(120px,150px)_130px_auto] lg:items-end">
                  <label className="grid gap-1.5 text-sm text-neutral-600">
                    <span>Codigo</span>
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
              </div>

              {couponsLoading && !coupons.length ? (
                <CompactEmpty message="Carregando os cupons..." />
              ) : coupons.length ? (
                <div className="grid gap-3">
                  {coupons.map((coupon) => {
                    const draft = couponDrafts[coupon.id || 0] || buildCouponDraft(coupon);
                    const saving = couponSavingKey === `existing-${coupon.id}`;
                    const deleting = couponDeletingId === coupon.id;
                    return (
                      <div
                        key={coupon.id}
                        className="grid gap-3 rounded-[24px] border border-white/80 bg-white/82 p-4 shadow-[0_10px_24px_rgba(57,39,24,0.06)]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="text-[color:var(--ink-strong)]">{coupon.code}</strong>
                            <span className="rounded-full border border-white/70 bg-white px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)]">
                              {coupon.active ? 'Ativo' : 'Inativo'}
                            </span>
                            {typeof coupon.usageLimitPerCustomer === 'number' && coupon.usageLimitPerCustomer > 0 ? (
                              <span className="rounded-full border border-white/70 bg-white px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)]">
                                Limite {formatNumber(coupon.usageLimitPerCustomer)} / cliente
                              </span>
                            ) : null}
                          </div>
                          <span className="text-xs text-neutral-500">
                            Atualizado em {coupon.updatedAt ? new Date(coupon.updatedAt).toLocaleString('pt-BR') : 'agora'}
                          </span>
                        </div>
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(140px,180px)_150px_minmax(120px,150px)_130px_auto_auto] lg:items-end">
                          <label className="grid gap-1.5 text-sm text-neutral-600">
                            <span>Codigo</span>
                            <input
                              className="app-input"
                              value={draft.code}
                              onChange={(event) => setCouponDraftField(coupon.id || 0, 'code', event.target.value)}
                            />
                          </label>
                          <label className="grid gap-1.5 text-sm text-neutral-600">
                            <span>Desconto %</span>
                            <input
                              className="app-input"
                              inputMode="decimal"
                              value={draft.discountPct}
                              onChange={(event) =>
                                setCouponDraftField(coupon.id || 0, 'discountPct', event.target.value)
                              }
                            />
                          </label>
                          <label className="flex h-12 items-center gap-2 rounded-[16px] border border-white/80 bg-white px-4 text-sm font-medium text-[color:var(--ink-strong)]">
                            <input
                              checked={draft.hasUsageLimit}
                              onChange={(event) =>
                                setCouponDraftField(coupon.id || 0, 'hasUsageLimit', event.target.checked)
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
                                setCouponDraftField(coupon.id || 0, 'usageLimitPerCustomer', event.target.value)
                              }
                              placeholder="1"
                            />
                          </label>
                          <label className="flex h-12 items-center gap-2 rounded-[16px] border border-white/80 bg-white px-4 text-sm font-medium text-[color:var(--ink-strong)]">
                            <input
                              checked={draft.active}
                              onChange={(event) =>
                                setCouponDraftField(coupon.id || 0, 'active', event.target.checked)
                              }
                              type="checkbox"
                            />
                            Ativo
                          </label>
                          <button
                            type="button"
                            className="app-button app-button-primary"
                            disabled={saving || deleting}
                            onClick={() => void handleSaveCoupon(coupon.id || 0)}
                          >
                            {saving ? 'Salvando...' : 'Salvar'}
                          </button>
                          <button
                            type="button"
                            className="app-button app-button-ghost"
                            disabled={saving || deleting}
                            onClick={() => void handleDeleteCoupon(coupon.id || 0)}
                          >
                            {deleting ? 'Excluindo...' : 'Excluir'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <CompactEmpty message="Nenhum cupom cadastrado ainda." />
              )}
            </div>
          </SectionPanel>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
            <SectionPanel
              title="Funil"
              tone="sky"
              tag={
                <span className="rounded-full border border-white/80 bg-white/82 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-strong)]">
                  {activePeriodLabel}
                </span>
              }
            >
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Home" value={formatNumber(activeTraffic?.funnel.homeSessions || 0)} tone="sky" />
                <MetricCard label="/pedido" value={formatNumber(activeTraffic?.funnel.orderSessions || 0)} tone="mint" />
                <MetricCard label="Quote" value={formatNumber(activeTraffic?.funnel.quoteSuccessSessions || 0)} tone="amber" />
                <MetricCard label="Enviados" value={formatNumber(activeTraffic?.funnel.submittedSessions || 0)} tone="rose" />
              </div>
            </SectionPanel>

            <SectionPanel
              title="Mix"
              tone="mint"
              tag={
                <span className="rounded-full border border-white/80 bg-white/82 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-strong)]">
                  {activePeriodLabel}
                </span>
              }
            >
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Dispositivos</p>
                  <DistributionList items={topTrafficMix} valueKey="sessions" tone="mint" />
                </div>
                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Fontes</p>
                  <DistributionList items={activeTraffic?.topSources || []} valueKey="sessions" tone="sky" />
                </div>
                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Status</p>
                  <DistributionList items={activeBusiness?.statusMix || []} tone="rose" />
                </div>
                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Entrega / retirada</p>
                  <DistributionList items={activeBusiness?.fulfillmentMix || []} tone="amber" />
                </div>
              </div>
            </SectionPanel>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <SectionPanel
              title="Trafego diario"
              tone="amber"
              tag={
                <span className="rounded-full border border-white/80 bg-white/82 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-strong)]">
                  {activePeriodLabel}
                </span>
              }
            >
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

            <SectionPanel
              title="Financeiro"
              tone="rose"
              tag={
                <span className="rounded-full border border-white/80 bg-white/82 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-strong)]">
                  {activePeriodLabel}
                </span>
              }
            >
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <MetricCard label="Produto liquido" value={formatCurrencyBR(activeBusiness?.kpis.productNetRevenueInRange || 0)} tone="ink" />
                  <MetricCard label="Frete" value={formatCurrencyBR(activeBusiness?.kpis.deliveryRevenueInRange || 0)} tone="amber" />
                  <MetricCard
                    label="COGS"
                    value={formatCurrencyBR(activeBusiness?.kpis.estimatedCogsInRange || 0)}
                    tone="rose"
                    meta={`${formatNumber(activeBusiness?.kpis.costedOrdersInRange || 0)} pedidos auditados no periodo${
                      (activeBusiness?.kpis.cogsWarningsInRange || 0)
                        ? ` · ${formatNumber(activeBusiness?.kpis.cogsWarningsInRange || 0)} alerta(s)`
                        : ''
                    }`}
                  />
                  <MetricCard label="Lucro bruto" value={formatCurrencyBR(activeBusiness?.kpis.grossProfitInRange || 0)} tone="mint" />
                  <MetricCard label="Pos-frete" value={formatCurrencyBR(activeBusiness?.kpis.contributionAfterFreightInRange || 0)} tone="sky" />
                  <MetricCard label="Descontos" value={formatCurrencyBR(activeBusiness?.kpis.discountsInRange || 0)} tone="ink" />
                  <MetricCard
                    label="Marketing - amostras"
                    value={formatCurrencyBR(activeBusiness?.kpis.marketingSamplesInvestmentInRange || 0)}
                    tone="rose"
                  />
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

          <section className="grid gap-4 xl:grid-cols-[minmax(0,0.68fr)_minmax(0,1.32fr)]">
            <SectionPanel
              title="COGS da Base"
              tone="rose"
              tag={
                <span className="rounded-full border border-white/80 bg-white/82 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-strong)]">
                  {summary.business.cogsAudit.windowLabel}
                </span>
              }
            >
              <div className="grid gap-3">
                <p className="text-sm leading-6 text-neutral-600">
                  Auditoria completa do custo dos ingredientes consumidos em todos os pedidos ativos da base.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <CogsAuditStat
                    label="Pedidos auditados"
                    value={formatNumber(summary.business.cogsAudit.ordersCount)}
                    emphasis
                  />
                  <CogsAuditStat
                    label="Ingredientes mapeados"
                    value={formatNumber(summary.business.cogsAudit.ingredientsCount)}
                  />
                  <CogsAuditStat label="Receita líquida" value={formatCurrencyBR(summary.business.cogsAudit.revenue)} />
                  <CogsAuditStat label="COGS total" value={formatCurrencyBR(summary.business.cogsAudit.cogs)} emphasis />
                  <CogsAuditStat
                    label="Lucro bruto"
                    value={formatCurrencyBR(summary.business.cogsAudit.grossProfit)}
                  />
                  <CogsAuditStat
                    label="Alertas técnicos"
                    value={formatNumber(summary.business.cogsAudit.warningsCount)}
                  />
                </div>
                {summary.business.cogsWarnings.length ? (
                  <div className="rounded-[24px] border border-[rgba(162,81,66,0.18)] bg-[rgba(255,244,240,0.96)] p-4 text-sm text-[color:var(--ink-strong)]">
                    <p className="font-semibold">Alertas da base</p>
                    <div className="mt-2 grid gap-2">
                      {summary.business.cogsWarnings.slice(0, 6).map((warning) => (
                        <p key={`${warning.orderId}-${warning.code}-${warning.productId}`} className="text-neutral-700">
                          #{warning.orderDisplayNumber} · {warning.productName} · {warning.message}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </SectionPanel>

            <SectionPanel
              title="Ingredientes no COGS"
              tone="ink"
              tag={
                <span className="rounded-full border border-white/80 bg-white/82 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-strong)]">
                  {formatNumber(summary.business.cogsByIngredient.length)} itens
                </span>
              }
            >
              {summary.business.cogsByIngredient.length ? (
                <div className="grid gap-3">
                  {summary.business.cogsByIngredient.map((entry) => (
                    <div
                      key={entry.ingredientId}
                      className="rounded-[24px] border border-white/80 bg-white/82 p-4 shadow-[0_10px_24px_rgba(57,39,24,0.06)]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <strong className="text-[color:var(--ink-strong)]">{entry.ingredientName}</strong>
                        <span className="rounded-full border border-white/70 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)]">
                          {formatNumber(entry.orderCount)} pedido(s)
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 text-sm text-neutral-600 sm:grid-cols-3">
                        <span>
                          {formatDecimal(entry.quantity, 3)} {entry.unit}
                        </span>
                        <span>R$ {formatDecimal(entry.unitCost, 4)} / {entry.unit}</span>
                        <span>{formatCurrencyBR(entry.amount)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <CompactEmpty message="Sem consumo de ingrediente mapeado na base." />
              )}
            </SectionPanel>
          </section>

          <section className="grid gap-4">
            <SectionPanel
              title="COGS por mês"
              tone="rose"
              tag={
                <span className="rounded-full border border-white/80 bg-white/82 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-strong)]">
                  {formatNumber(cogsByMonth.length)} meses
                </span>
              }
            >
              {cogsByMonth.length ? (
                <div className="grid gap-3">
                  {cogsByMonth.map((entry) => (
                    <details
                      key={entry.monthKey}
                      className="group overflow-hidden rounded-[24px] border border-white/80 bg-white/86 shadow-[0_10px_24px_rgba(57,39,24,0.06)]"
                    >
                      <summary className="list-none cursor-pointer p-4 sm:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <strong className="text-[color:var(--ink-strong)]">
                                {entry.monthLabel}
                              </strong>
                              <span className="rounded-full border border-white/70 bg-white px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)]">
                                {formatNumber(entry.ordersCount)} pedido(s)
                              </span>
                              {entry.warningsCount ? (
                                <span className="rounded-full border border-[rgba(162,81,66,0.18)] bg-[rgba(255,244,240,0.92)] px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)]">
                                  {formatNumber(entry.warningsCount)} alerta(s)
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-2 text-sm text-neutral-600">
                              Resumo consolidado dos pedidos auditados nesse mês.
                            </p>
                            <div className="mt-3 grid gap-2 text-sm text-neutral-600 sm:grid-cols-2 xl:grid-cols-5">
                              <span>{formatNumber(entry.itemsCount)} item(ns)</span>
                              <span>{formatNumber(entry.units)} un</span>
                              <span>Receita {formatCurrencyBR(entry.revenue)}</span>
                              <span>COGS {formatCurrencyBR(entry.cogs)}</span>
                              <span>Lucro {formatCurrencyBR(entry.grossProfit)}</span>
                            </div>
                          </div>
                          <span className="rounded-full border border-white/80 bg-white/90 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-neutral-600 transition-transform group-open:rotate-180">
                            Detalhes
                          </span>
                        </div>
                      </summary>

                      <div className="border-t border-white/80 bg-[rgba(255,251,248,0.82)] p-4 sm:p-5">
                        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                          <div className="grid gap-3">
                            <div className="grid gap-2 rounded-[22px] border border-white/80 bg-white/78 p-4">
                              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">Resumo</p>
                              <div className="grid gap-2 text-sm text-neutral-600 sm:grid-cols-2">
                                <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/80 bg-white/70 px-3 py-2">
                                  <span>Pedidos</span>
                                  <span className="font-semibold text-neutral-900">{formatNumber(entry.ordersCount)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/80 bg-white/70 px-3 py-2">
                                  <span>Margem</span>
                                  <span className="font-semibold text-neutral-900">{formatPercent(entry.grossMarginPct)}</span>
                                </div>
                              </div>
                            </div>
                            <div className="grid gap-2 rounded-[22px] border border-white/80 bg-white/78 p-4">
                              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">Produtos</p>
                              <div className="grid gap-2 text-sm text-neutral-600">
                                {entry.products.slice(0, 6).map((product) => (
                                  <div
                                    key={`${entry.monthKey}-${product.productId}`}
                                    className="flex flex-wrap items-center justify-between gap-2"
                                  >
                                    <span>{product.productName} · {formatNumber(product.quantity)} un</span>
                                    <span>{formatCurrencyBR(product.cogs)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            {entry.warningsCount ? (
                              <div className="grid gap-2 rounded-[22px] border border-[rgba(162,81,66,0.18)] bg-[rgba(255,244,240,0.9)] p-4 text-sm text-[color:var(--ink-strong)]">
                                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
                                  Alertas técnicos
                                </p>
                                <p>{formatNumber(entry.warningsCount)} alerta(s) consolidados nesse mês.</p>
                              </div>
                            ) : null}
                          </div>

                          <div className="grid gap-2 rounded-[22px] border border-white/80 bg-white/78 p-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">Ingredientes</p>
                            <div className="grid gap-2 text-sm text-neutral-600">
                              {entry.ingredients.slice(0, 8).map((ingredient) => (
                                <div
                                  key={`${entry.monthKey}-${ingredient.ingredientId}`}
                                  className="flex flex-wrap items-center justify-between gap-2"
                                >
                                  <span>
                                    {ingredient.ingredientName} · {formatDecimal(ingredient.quantity, 3)} {ingredient.unit}
                                  </span>
                                  <span>{formatCurrencyBR(ingredient.amount)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <CompactEmpty message="Sem meses auditados na base." />
              )}
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
            <SectionPanel
              title="Vitals"
              tone="sky"
              tag={
                <span className="rounded-full border border-white/80 bg-white/82 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-strong)]">
                  {activePeriodLabel}
                </span>
              }
            >
              {activeTraffic?.vitalBenchmarks.length ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {activeTraffic.vitalBenchmarks.map((metric) => (
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

            <SectionPanel
              title="Rotas / links"
              tone="ink"
              tag={
                <span className="rounded-full border border-white/80 bg-white/82 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-strong)]">
                  {activePeriodLabel}
                </span>
              }
            >
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Rotas</p>
                  <DistributionList
                    items={(activeTraffic?.topPaths || []).map((entry) => ({
                      label: `${entry.path} · ${entry.surface}`,
                      value: entry.views
                    }))}
                    tone="amber"
                  />
                </div>
                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Links</p>
                  <DistributionList
                    items={(activeTraffic?.topLinks || []).map((entry) => ({
                      label: entry.label || entry.href,
                      clicks: entry.clicks
                    }))}
                    valueKey="clicks"
                    tone="rose"
                  />
                </div>
                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Páginas lentas</p>
                  {activeTraffic?.slowPages.length ? (
                    <div className="grid gap-3">
                      {activeTraffic.slowPages.map((entry) => (
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
