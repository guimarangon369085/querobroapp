'use client';

import type { Coupon } from '@querobroapp/shared';
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppIcon } from '@/components/app-icons';
import { useFeedback } from '@/components/feedback-provider';
import { formatCurrencyBR, formatDecimalInputBR, parseLocaleNumber } from '@/lib/format';
import { apiFetch } from '@/lib/api';
import { useDialogA11y } from '@/lib/use-dialog-a11y';

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
  attributedSources: Array<{
    label: string;
    sessions: number;
    orderSessions: number;
    quoteSuccessSessions: number;
    submittedSessions: number;
    sessionSharePct: number;
    orderReachPct: number;
    quoteRatePct: number;
    submitRatePct: number;
    submitSharePct: number;
  }>;
  attributedReferrers: Array<{
    label: string;
    sessions: number;
    orderSessions: number;
    quoteSuccessSessions: number;
    submittedSessions: number;
    sessionSharePct: number;
    orderReachPct: number;
    quoteRatePct: number;
    submitRatePct: number;
    submitSharePct: number;
  }>;
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
    homeSessions: number;
    orderSessions: number;
    quoteSuccessSessions: number;
    submittedSessions: number;
  }>;
  funnel: {
    homeSessions: number;
    orderSessions: number;
    quoteSuccessSessions: number;
    submittedSessions: number;
    homeToOrderPct: number;
    orderToSubmitPct: number;
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
    deliveryOrdersInRange: number;
    deliveryMarginInRange: number;
    deliveryCoveragePctInRange: number;
    productNetRevenueInRange: number;
    estimatedCogsInRange: number;
    costedOrdersInRange: number;
    cogsWarningsInRange: number;
    grossProfitInRange: number;
    grossMarginPctInRange: number;
    contributionAfterFreightInRange: number;
    bankInflowInRange: number;
    actualExpensesInRange: number;
    ingredientExpensesInRange: number;
    deliveryExpensesInRange: number;
    packagingExpensesInRange: number;
    softwareExpensesInRange: number;
    marketplaceAdjustmentsInRange: number;
    netCashFlowInRange: number;
    unmatchedInflowsInRange: number;
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
    deliveryRevenue: number;
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
  statement: {
    latestImport: {
      status: 'RUNNING' | 'ATTENTION' | 'PENDING';
      importedAt: string | null;
      fileName: string | null;
      fileKind: string | null;
      source: string | null;
      periodStart: string | null;
      periodEnd: string | null;
      transactionCount: number;
      matchedPaymentsCount: number;
      unmatchedInflowsCount: number;
      inflowTotal: number;
      outflowTotal: number;
    };
    kpis: {
      bankInflowInRange: number;
      actualExpensesInRange: number;
      ingredientExpensesInRange: number;
      deliveryExpensesInRange: number;
      packagingExpensesInRange: number;
      softwareExpensesInRange: number;
      marketplaceAdjustmentsInRange: number;
      netCashFlowInRange: number;
      unmatchedInflowsInRange: number;
    };
    dailySeries: Array<{
      date: string;
      bankInflow: number;
      matchedRevenue: number;
      actualExpenses: number;
      ingredientExpenses: number;
      deliveryExpenses: number;
      packagingExpenses: number;
      softwareExpenses: number;
      marketplaceAdjustments: number;
      netCashFlow: number;
      unmatchedInflows: number;
    }>;
    categories: Array<{
      key: string;
      label: string;
      amount: number;
      count: number;
      tone: 'positive' | 'neutral' | 'warning';
    }>;
    classificationBreakdown: Array<{
      code: string;
      label: string;
      baseCategory: string;
      tone: 'positive' | 'neutral' | 'warning';
      isOperational: boolean;
      amount: number;
      inflowAmount: number;
      outflowAmount: number;
      count: number;
    }>;
    reconciliation: {
      matchedRevenue: number;
      matchedTransactionsCount: number;
      unmatchedInflows: number;
      unmatchedTransactionsCount: number;
      otherInflows: number;
      operationalOutflows: number;
      nonOperationalInflows: number;
      nonOperationalOutflows: number;
      nonOperationalNet: number;
    };
    unmatchedInflows: Array<{
      externalId: string;
      date: string;
      amount: number;
      counterpartyName: string | null;
      description: string;
    }>;
  };
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
    runningCount: number;
    attentionCount: number;
    pendingCount: number;
    items: Array<{
      id: string;
      label: string;
      status: 'RUNNING' | 'ATTENTION' | 'PENDING';
      detail: string;
      nextStep: string;
      facts: Array<{
        label: string;
        value: string;
        tone: 'positive' | 'neutral' | 'warning';
      }>;
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

type StatementImportFeedback = {
  status: 'RUNNING' | 'ATTENTION' | 'PENDING';
  importedAt: string | null;
  fileName: string | null;
  fileKind: string | null;
  source: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  transactionCount: number;
  matchedPaymentsCount: number;
  unmatchedInflowsCount: number;
  inflowTotal: number;
  outflowTotal: number;
};

type StatementCategory =
  | 'SALES'
  | 'UNMATCHED_INFLOW'
  | 'MARKETPLACE_REFUND'
  | 'INGREDIENTS'
  | 'DELIVERY'
  | 'PACKAGING'
  | 'SOFTWARE'
  | 'MARKETPLACE'
  | 'OWNER'
  | 'OTHER_EXPENSE'
  | 'OTHER_INFLOW';

type StatementClassificationOption = {
  id: number;
  code: string;
  label: string;
  baseCategory: StatementCategory;
  tone: 'positive' | 'neutral' | 'warning';
  isOperational: boolean;
  active: boolean;
  system: boolean;
  sortOrder: number;
};

type StatementReviewTransaction = {
  id: number;
  latestImportId: number | null;
  externalId: string;
  bookedAt: string;
  amount: number;
  description: string;
  counterpartyName: string | null;
  direction: 'INFLOW' | 'OUTFLOW';
  transactionKind: 'PIX_IN' | 'PIX_OUT' | 'DEBIT_PURCHASE' | 'REFUND' | 'OTHER';
  category: StatementCategory;
  classificationCode: string | null;
  manualClassification: boolean;
  manualMatch: boolean;
  isOperational: boolean;
  matchedPaymentId: number | null;
  matchedOrderId: number | null;
  matchedPaymentLabel: string | null;
};

type StatementMatchCandidate = {
  matchType: 'PAYMENT' | 'ORDER';
  paymentId: number | null;
  orderId: number;
  publicNumber: number;
  customerName: string;
  amount: number;
  createdAt: string;
  dueAt: string | null;
  nameScore: number;
  current: boolean;
  label: string;
};

type StatementReviewPayload = {
  latestImport: StatementImportFeedback;
  transactions: StatementReviewTransaction[];
  classificationOptions: StatementClassificationOption[];
};

type StatementTransactionDraft = {
  classificationInput: string;
  matchInput: string;
};

type StatementOptionDraft = {
  label: string;
  baseCategory: StatementCategory;
  active: boolean;
};

type DashboardTrendPoint = {
  bucketKey: string;
  bucketLabel: string;
  shortLabel: string;
  granularity: 'day' | 'month';
  sessions: number;
  pageViews: number;
  publicPageViews: number;
  internalPageViews: number;
  homeSessions: number;
  orderSessions: number;
  quoteSuccessSessions: number;
  submittedSessions: number;
  orders: number;
  grossRevenue: number;
  paidRevenue: number;
  deliveryRevenue: number;
  deliveryExpenses: number;
  deliveryMargin: number;
  actualExpenses: number;
  netCashFlow: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  avgTicket: number;
  grossMarginPct: number;
  cashConversionPct: number;
  homeToOrderPct: number;
  orderToSubmitPct: number;
  quoteToSubmitPct: number;
  costedOrders: number;
  cogsWarnings: number;
};

type ComparableKpiKey =
  | 'sessions'
  | 'pageViews'
  | 'orders'
  | 'submittedSessions'
  | 'grossRevenue'
  | 'paidRevenue'
  | 'deliveryRevenue'
  | 'deliveryExpenses'
  | 'deliveryMargin'
  | 'actualExpenses'
  | 'netCashFlow'
  | 'netRevenue'
  | 'cogs'
  | 'grossProfit'
  | 'avgTicket'
  | 'grossMarginPct'
  | 'cashConversionPct'
  | 'homeToOrderPct'
  | 'orderToSubmitPct'
  | 'quoteToSubmitPct'
  | 'cogsWarnings';

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
  { value: 30, label: 'Ultimos 30 dias' },
];

const PANEL_TONE_CLASSES: Record<DashboardTone, string> = {
  amber:
    'border-[color:var(--tone-gold-line)] bg-[linear-gradient(155deg,rgba(255,250,244,0.98),rgba(248,238,221,0.94))]',
  sky: 'border-[color:var(--tone-sage-line)] bg-[linear-gradient(155deg,rgba(250,253,251,0.98),rgba(239,247,242,0.94))]',
  mint: 'border-[color:var(--tone-olive-line)] bg-[linear-gradient(155deg,rgba(251,249,243,0.98),rgba(242,239,228,0.95))]',
  rose: 'border-[color:var(--tone-blush-line)] bg-[linear-gradient(155deg,rgba(255,250,248,0.98),rgba(247,236,231,0.95))]',
  ink: 'border-[rgba(57,45,35,0.14)] bg-[linear-gradient(155deg,rgba(255,253,250,0.99),rgba(243,238,231,0.95))]',
};

const BAR_TONE_CLASSES: Record<DashboardTone, string> = {
  amber: 'bg-[linear-gradient(90deg,var(--tone-gold-ink),var(--brand-gold))]',
  sky: 'bg-[linear-gradient(90deg,var(--tone-sage-ink),var(--brand-sage))]',
  mint: 'bg-[linear-gradient(90deg,var(--tone-olive-ink),var(--brand-olive))]',
  rose: 'bg-[linear-gradient(90deg,var(--tone-roast-ink),var(--brand-blush))]',
  ink: 'bg-[linear-gradient(90deg,var(--brand-cocoa),var(--brand-gold))]',
};

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function formatPercent(value: number) {
  return `${Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })}%`;
}

function formatDecimal(value: number, maximumFractionDigits = 1) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

function formatMetricValue(value: number, unit: string) {
  if (unit === 'score') {
    return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  }
  return `${Math.round(value || 0).toLocaleString('pt-BR')} ms`;
}

function formatStatementStatusLabel(status?: 'RUNNING' | 'ATTENTION' | 'PENDING' | null) {
  if (status === 'RUNNING') return 'ATUALIZADO';
  if (status === 'ATTENTION') return 'DESATUALIZADO';
  return 'SEM EXTRATO';
}

const STATEMENT_CATEGORY_LABELS: Record<StatementCategory, string> = {
  SALES: 'Venda conciliada',
  UNMATCHED_INFLOW: 'Entrada sem match',
  MARKETPLACE_REFUND: 'Reembolso marketplace',
  INGREDIENTS: 'Insumos',
  DELIVERY: 'Frete',
  PACKAGING: 'Embalagem',
  SOFTWARE: 'Software',
  MARKETPLACE: 'Marketplace',
  OWNER: 'Sócios / capital',
  OTHER_EXPENSE: 'Outra saída',
  OTHER_INFLOW: 'Outra entrada',
};

function buildStatementOptionDraft(
  option?: Partial<StatementClassificationOption> | null,
): StatementOptionDraft {
  return {
    label: String(option?.label || ''),
    baseCategory: (option?.baseCategory || 'OTHER_EXPENSE') as StatementCategory,
    active: option?.active ?? true,
  };
}

function normalizeStatementLookupText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9# ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatStatementClassificationInputValue(option?: Partial<StatementClassificationOption> | null) {
  const label = String(option?.label || '').trim();
  const code = String(option?.code || '').trim();
  if (!label && !code) return '';
  if (!label) return code;
  if (!code) return label;
  return `${label} · ${code}`;
}

function resolveStatementClassificationCodeFromInput(
  input: string,
  options: StatementClassificationOption[],
) {
  const normalizedInput = normalizeStatementLookupText(input);
  if (!normalizedInput) return null;

  const matches = options.filter((option) => {
    const normalizedCode = normalizeStatementLookupText(option.code);
    const normalizedLabel = normalizeStatementLookupText(option.label);
    const normalizedDisplay = normalizeStatementLookupText(formatStatementClassificationInputValue(option));
    return (
      normalizedInput === normalizedCode ||
      normalizedInput === normalizedLabel ||
      normalizedInput === normalizedDisplay
    );
  });

  return matches.length === 1 ? matches[0]?.code || null : null;
}

function resolveStatementMatchCandidateFromInput(
  input: string,
  candidates: StatementMatchCandidate[],
) {
  const normalizedInput = normalizeStatementLookupText(input);
  if (!normalizedInput) return null;

  const matches = candidates.filter((candidate) => {
    const normalizedLabel = normalizeStatementLookupText(candidate.label);
    const normalizedOrderNumber = normalizeStatementLookupText(String(candidate.publicNumber));
    const normalizedHashOrder = normalizeStatementLookupText(`#${candidate.publicNumber}`);
    const normalizedCustomerName = normalizeStatementLookupText(candidate.customerName);
    const normalizedPaymentId =
      candidate.paymentId != null ? normalizeStatementLookupText(String(candidate.paymentId)) : '';

    return [
      normalizedLabel,
      normalizedOrderNumber,
      normalizedHashOrder,
      normalizedCustomerName,
      normalizedPaymentId,
    ].some((entry) => entry && entry === normalizedInput);
  });

  return matches.length === 1 ? matches[0] || null : null;
}

function buildStatementTransactionDraft(
  transaction: StatementReviewTransaction,
  classificationOptions: StatementClassificationOption[] = [],
): StatementTransactionDraft {
  const selectedOption =
    classificationOptions.find((option) => option.code === (transaction.classificationCode || transaction.category)) ||
    null;
  return {
    classificationInput: formatStatementClassificationInputValue(selectedOption) ||
      transaction.classificationCode ||
      transaction.category,
    matchInput: transaction.matchedPaymentLabel || '',
  };
}

function formatShortDateLabel(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value.slice(5);
  return parsed.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function formatMonthLabel(value: Date) {
  const label = value.toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatCompactMonthLabel(value: Date) {
  const label = value.toLocaleDateString('pt-BR', {
    month: 'short',
    year: '2-digit',
  });
  return label.replace('.', '').replace(' de ', '/');
}

function toDateFromDateLike(value: string | Date) {
  const date =
    value instanceof Date
      ? value
      : /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T12:00:00`)
        : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthKeyFromDateLike(value: string | Date) {
  const date = toDateFromDateLike(value);
  if (!date) return 'sem-data';
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`;
}

function dayKeyFromDateLike(value: string | Date) {
  const date = toDateFromDateLike(value);
  if (!date) return 'sem-data';
  return date.toISOString().slice(0, 10);
}

function buildTrendBucketMeta(
  key: string,
  granularity: 'day' | 'month',
  sourceDate?: string | Date,
) {
  const date =
    sourceDate instanceof Date
      ? sourceDate
      : typeof sourceDate === 'string' && sourceDate
        ? toDateFromDateLike(sourceDate)
        : granularity === 'month' && /^\d{4}-\d{2}$/.test(key)
          ? toDateFromDateLike(`${key}-01`)
          : granularity === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(key)
            ? toDateFromDateLike(key)
            : null;

  if (!date) {
    return {
      bucketLabel: 'Sem data',
      shortLabel: 'Sem data',
    };
  }

  return granularity === 'month'
    ? {
        bucketLabel: formatMonthLabel(date),
        shortLabel: formatCompactMonthLabel(date),
      }
    : {
        bucketLabel: date.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        }),
        shortLabel: formatShortDateLabel(dayKeyFromDateLike(date)),
      };
}

function computeSeriesSpanDays(series: Array<{ date: string }>) {
  if (!series.length) return 0;
  const dates = series
    .map((entry) => toDateFromDateLike(entry.date))
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => left.getTime() - right.getTime());
  if (!dates.length) return 0;
  const first = dates[0].getTime();
  const last = dates[dates.length - 1].getTime();
  return Math.max(1, Math.round((last - first) / 86_400_000) + 1);
}

function buildTrendSeries(params: {
  traffic: DashboardTrafficSummary | null;
  business: DashboardBusinessSummary | null;
  granularity: 'day' | 'month';
}) {
  const { traffic, business, granularity } = params;
  if (!traffic || !business) return [] as DashboardTrendPoint[];

  const buckets = new Map<string, DashboardTrendPoint>();
  const ensureBucket = (key: string, sourceDate?: string | Date) => {
    const existing = buckets.get(key);
    if (existing) return existing;
    const labels = buildTrendBucketMeta(key, granularity, sourceDate);
    const entry: DashboardTrendPoint = {
      bucketKey: key,
      bucketLabel: labels.bucketLabel,
      shortLabel: labels.shortLabel,
      granularity,
      sessions: 0,
      pageViews: 0,
      publicPageViews: 0,
      internalPageViews: 0,
      homeSessions: 0,
      orderSessions: 0,
      quoteSuccessSessions: 0,
      submittedSessions: 0,
      orders: 0,
      grossRevenue: 0,
      paidRevenue: 0,
      deliveryRevenue: 0,
      deliveryExpenses: 0,
      deliveryMargin: 0,
      actualExpenses: 0,
      netCashFlow: 0,
      netRevenue: 0,
      cogs: 0,
      grossProfit: 0,
      avgTicket: 0,
      grossMarginPct: 0,
      cashConversionPct: 0,
      homeToOrderPct: 0,
      orderToSubmitPct: 0,
      quoteToSubmitPct: 0,
      costedOrders: 0,
      cogsWarnings: 0,
    };
    buckets.set(key, entry);
    return entry;
  };

  for (const entry of traffic.dailySeries) {
    const bucketKey =
      granularity === 'month' ? monthKeyFromDateLike(entry.date) : dayKeyFromDateLike(entry.date);
    const current = ensureBucket(bucketKey, entry.date);
    current.sessions += entry.sessions;
    current.pageViews += entry.pageViews;
    current.publicPageViews += entry.publicPageViews;
    current.internalPageViews += entry.internalPageViews;
    current.homeSessions += entry.homeSessions;
    current.orderSessions += entry.orderSessions;
    current.quoteSuccessSessions += entry.quoteSuccessSessions;
    current.submittedSessions += entry.submittedSessions;
  }

  for (const entry of business.dailySeries) {
    const bucketKey =
      granularity === 'month' ? monthKeyFromDateLike(entry.date) : dayKeyFromDateLike(entry.date);
    const current = ensureBucket(bucketKey, entry.date);
    current.orders += entry.orders;
    current.grossRevenue += entry.grossRevenue;
    current.paidRevenue += entry.paidRevenue;
    current.deliveryRevenue += entry.deliveryRevenue;
  }

  for (const entry of business.statement.dailySeries) {
    const bucketKey =
      granularity === 'month' ? monthKeyFromDateLike(entry.date) : dayKeyFromDateLike(entry.date);
    const current = ensureBucket(bucketKey, entry.date);
    current.actualExpenses += entry.actualExpenses;
    current.deliveryExpenses += entry.deliveryExpenses;
    current.netCashFlow += entry.netCashFlow;
  }

  for (const order of business.cogsByOrder) {
    const sourceDate = order.createdAt;
    const bucketKey =
      granularity === 'month' ? monthKeyFromDateLike(sourceDate) : dayKeyFromDateLike(sourceDate);
    const current = ensureBucket(bucketKey, sourceDate);
    current.netRevenue += order.revenue;
    current.cogs += order.cogs;
    current.grossProfit += order.grossProfit;
    current.costedOrders += 1;
    current.cogsWarnings += order.warnings.length;
  }

  return [...buckets.values()]
    .map((entry) => ({
      ...entry,
      grossRevenue: Number(entry.grossRevenue.toFixed(2)),
      paidRevenue: Number(entry.paidRevenue.toFixed(2)),
      deliveryRevenue: Number(entry.deliveryRevenue.toFixed(2)),
      deliveryExpenses: Number(entry.deliveryExpenses.toFixed(2)),
      deliveryMargin: Number((entry.deliveryRevenue - entry.deliveryExpenses).toFixed(2)),
      actualExpenses: Number(entry.actualExpenses.toFixed(2)),
      netCashFlow: Number(entry.netCashFlow.toFixed(2)),
      netRevenue: Number(entry.netRevenue.toFixed(2)),
      cogs: Number(entry.cogs.toFixed(2)),
      grossProfit: Number(entry.grossProfit.toFixed(2)),
      avgTicket: entry.orders > 0 ? Number((entry.grossRevenue / entry.orders).toFixed(2)) : 0,
      grossMarginPct:
        entry.netRevenue > 0
          ? Number(((entry.grossProfit / entry.netRevenue) * 100).toFixed(1))
          : 0,
      cashConversionPct:
        entry.grossRevenue > 0
          ? Number(((entry.paidRevenue / entry.grossRevenue) * 100).toFixed(1))
          : 0,
      homeToOrderPct:
        entry.homeSessions > 0
          ? Number(((entry.orderSessions / entry.homeSessions) * 100).toFixed(1))
          : 0,
      orderToSubmitPct:
        entry.orderSessions > 0
          ? Number(((entry.submittedSessions / entry.orderSessions) * 100).toFixed(1))
          : 0,
      quoteToSubmitPct:
        entry.quoteSuccessSessions > 0
          ? Number(((entry.submittedSessions / entry.quoteSuccessSessions) * 100).toFixed(1))
          : 0,
    }))
    .sort((left, right) => left.bucketKey.localeCompare(right.bucketKey));
}

function formatDeltaLabel(
  current: number,
  previous: number,
  formatter: (value: number) => string,
  suffix = '',
) {
  const delta = Number(current || 0) - Number(previous || 0);
  if (Math.abs(delta) < 0.005) return 'sem variação relevante';
  const prefix = delta > 0 ? '+' : '-';
  return `${prefix}${formatter(Math.abs(delta))}${suffix}`;
}

function normalizeCouponCodeInput(value: string) {
  return value.replace(/\s+/g, ' ').trim().toUpperCase();
}

function buildCouponDraft(
  coupon?: Pick<Coupon, 'code' | 'discountPct' | 'active' | 'usageLimitPerCustomer'> | null,
): CouponDraft {
  return {
    code: coupon?.code || '',
    discountPct: formatDecimalInputBR(coupon?.discountPct ?? '', {
      minFractionDigits: 0,
      maxFractionDigits: 2,
    }),
    hasUsageLimit:
      typeof coupon?.usageLimitPerCustomer === 'number' && (coupon.usageLimitPerCustomer || 0) > 0,
    usageLimitPerCustomer:
      typeof coupon?.usageLimitPerCustomer === 'number' && (coupon.usageLimitPerCustomer || 0) > 0
        ? String(Math.floor(coupon.usageLimitPerCustomer || 0))
        : '',
    active: coupon?.active ?? true,
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
  meta,
}: {
  label: string;
  value: string;
  tone?: DashboardTone;
  meta?: string;
}) {
  return (
    <article
      className={`app-panel grid gap-2 rounded-[26px] p-4 sm:p-5 ${PANEL_TONE_CLASSES[tone]}`}
    >
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
  className = '',
}: {
  title: string;
  tone?: DashboardTone;
  tag?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`app-panel grid gap-4 rounded-[30px] p-5 sm:p-6 ${PANEL_TONE_CLASSES[tone]} ${className}`}
    >
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
  emptyMessage = 'Nada para mostrar ainda.',
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
      valueKey === 'value'
        ? item.value || 0
        : valueKey === 'sessions'
          ? item.sessions || 0
          : item.clicks || 0,
    ),
  );

  return (
    <div className="grid gap-3">
      {items.map((item) => {
        const value =
          valueKey === 'value'
            ? item.value || 0
            : valueKey === 'sessions'
              ? item.sessions || 0
              : item.clicks || 0;
        const width = `${Math.max(10, (value / maxValue) * 100)}%`;

        return (
          <div key={`${item.label}-${value}`} className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-neutral-700">{item.label}</span>
              <strong className="shrink-0 text-[color:var(--ink-strong)]">
                {formatNumber(value)}
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

type ComparableKpiDefinition = {
  label: string;
  description: string;
  tone: DashboardTone;
  scaleGroup: 'count' | 'currency' | 'percent';
  strokeColor: string;
  fillColor: string;
  formatter: (value: number) => string;
  accessor: (point: DashboardTrendPoint) => number;
};

const COMPARABLE_KPI_DEFINITIONS: Record<ComparableKpiKey, ComparableKpiDefinition> = {
  sessions: {
    label: 'Sessões',
    description: 'Tráfego operacional e comercial consolidado por bucket de tempo.',
    tone: 'sky',
    scaleGroup: 'count',
    strokeColor: 'var(--tone-sage-ink)',
    fillColor: 'var(--tone-sage-surface)',
    formatter: formatNumber,
    accessor: (point) => point.sessions,
  },
  pageViews: {
    label: 'Pageviews',
    description: 'Volume bruto de navegação.',
    tone: 'mint',
    scaleGroup: 'count',
    strokeColor: 'var(--tone-olive-ink)',
    fillColor: 'var(--tone-olive-surface)',
    formatter: formatNumber,
    accessor: (point) => point.pageViews,
  },
  orders: {
    label: 'Pedidos',
    description: 'Pedidos ativos criados no bucket selecionado.',
    tone: 'amber',
    scaleGroup: 'count',
    strokeColor: 'var(--tone-gold-ink)',
    fillColor: 'var(--tone-gold-surface)',
    formatter: formatNumber,
    accessor: (point) => point.orders,
  },
  submittedSessions: {
    label: 'Envios',
    description: 'Sessões que concluíram o envio do pedido.',
    tone: 'rose',
    scaleGroup: 'count',
    strokeColor: 'var(--tone-blush-ink)',
    fillColor: 'var(--tone-blush-surface)',
    formatter: formatNumber,
    accessor: (point) => point.submittedSessions,
  },
  grossRevenue: {
    label: 'Receita bruta',
    description: 'Faturamento bruto do bucket, incluindo frete.',
    tone: 'amber',
    scaleGroup: 'currency',
    strokeColor: 'var(--tone-gold-line)',
    fillColor: 'var(--tone-gold-surface)',
    formatter: formatCurrencyBR,
    accessor: (point) => point.grossRevenue,
  },
  paidRevenue: {
    label: 'Recebido',
    description: 'Entradas efetivamente liquidadas no bucket.',
    tone: 'sky',
    scaleGroup: 'currency',
    strokeColor: 'var(--tone-pix-line)',
    fillColor: 'var(--tone-pix-surface)',
    formatter: formatCurrencyBR,
    accessor: (point) => point.paidRevenue,
  },
  deliveryRevenue: {
    label: 'Frete cobrado',
    description: 'Frete cobrado dos clientes no bucket.',
    tone: 'amber',
    scaleGroup: 'currency',
    strokeColor: 'var(--tone-gold-line)',
    fillColor: 'var(--tone-gold-surface)',
    formatter: formatCurrencyBR,
    accessor: (point) => point.deliveryRevenue,
  },
  deliveryExpenses: {
    label: 'Uber real',
    description: 'Custo real do frete capturado no extrato.',
    tone: 'rose',
    scaleGroup: 'currency',
    strokeColor: 'var(--tone-danger-line)',
    fillColor: 'var(--tone-danger-surface)',
    formatter: formatCurrencyBR,
    accessor: (point) => point.deliveryExpenses,
  },
  deliveryMargin: {
    label: 'Saldo do frete',
    description: 'Diferença entre frete cobrado e custo real do Uber.',
    tone: 'mint',
    scaleGroup: 'currency',
    strokeColor: 'var(--tone-olive-line)',
    fillColor: 'var(--tone-olive-surface)',
    formatter: formatCurrencyBR,
    accessor: (point) => point.deliveryMargin,
  },
  actualExpenses: {
    label: 'Custos reais',
    description: 'Saídas operacionais do extrato no bucket.',
    tone: 'rose',
    scaleGroup: 'currency',
    strokeColor: 'var(--tone-danger-line)',
    fillColor: 'var(--tone-danger-surface)',
    formatter: formatCurrencyBR,
    accessor: (point) => point.actualExpenses,
  },
  netCashFlow: {
    label: 'Fluxo de caixa',
    description: 'Saldo líquido operacional no bucket.',
    tone: 'mint',
    scaleGroup: 'currency',
    strokeColor: 'var(--tone-olive-line)',
    fillColor: 'var(--tone-olive-surface)',
    formatter: formatCurrencyBR,
    accessor: (point) => point.netCashFlow,
  },
  netRevenue: {
    label: 'Receita líquida',
    description: 'Subtotal dos produtos menos descontos, antes do frete.',
    tone: 'ink',
    scaleGroup: 'currency',
    strokeColor: 'var(--brand-cocoa)',
    fillColor: 'var(--surface-strong)',
    formatter: formatCurrencyBR,
    accessor: (point) => point.netRevenue,
  },
  cogs: {
    label: 'COGS',
    description: 'Consumo estimado de insumos no bucket.',
    tone: 'rose',
    scaleGroup: 'currency',
    strokeColor: 'var(--tone-roast-line)',
    fillColor: 'var(--tone-roast-surface)',
    formatter: formatCurrencyBR,
    accessor: (point) => point.cogs,
  },
  grossProfit: {
    label: 'Lucro bruto',
    description: 'Lucro após desconto e custo dos insumos.',
    tone: 'mint',
    scaleGroup: 'currency',
    strokeColor: 'var(--tone-olive-line)',
    fillColor: 'var(--tone-olive-surface)',
    formatter: formatCurrencyBR,
    accessor: (point) => point.grossProfit,
  },
  avgTicket: {
    label: 'Ticket médio',
    description: 'Receita bruta média por pedido.',
    tone: 'ink',
    scaleGroup: 'currency',
    strokeColor: 'var(--brand-cocoa)',
    fillColor: 'var(--surface-strong)',
    formatter: formatCurrencyBR,
    accessor: (point) => point.avgTicket,
  },
  grossMarginPct: {
    label: 'Margem bruta',
    description: 'Percentual de margem sobre a receita líquida dos produtos.',
    tone: 'mint',
    scaleGroup: 'percent',
    strokeColor: 'var(--tone-sage-line)',
    fillColor: 'var(--tone-sage-surface)',
    formatter: formatPercent,
    accessor: (point) => point.grossMarginPct,
  },
  cashConversionPct: {
    label: 'Conversão em caixa',
    description: 'Recebido como percentual da receita bruta do mesmo bucket.',
    tone: 'sky',
    scaleGroup: 'percent',
    strokeColor: 'var(--tone-pix-line)',
    fillColor: 'var(--tone-pix-surface)',
    formatter: formatPercent,
    accessor: (point) => point.cashConversionPct,
  },
  homeToOrderPct: {
    label: 'Home → /pedido',
    description: 'Conversão de visita da home em sessão que chegou à jornada de pedido.',
    tone: 'sky',
    scaleGroup: 'percent',
    strokeColor: 'var(--tone-sage-line)',
    fillColor: 'var(--tone-sage-surface)',
    formatter: formatPercent,
    accessor: (point) => point.homeToOrderPct,
  },
  orderToSubmitPct: {
    label: 'Pedido → envio',
    description: 'Conversão de sessão do pedido em envio concluído.',
    tone: 'rose',
    scaleGroup: 'percent',
    strokeColor: 'var(--tone-blush-line)',
    fillColor: 'var(--tone-blush-surface)',
    formatter: formatPercent,
    accessor: (point) => point.orderToSubmitPct,
  },
  quoteToSubmitPct: {
    label: 'Quote → envio',
    description: 'Eficiência do orçamento até a submissão.',
    tone: 'rose',
    scaleGroup: 'percent',
    strokeColor: 'var(--tone-blush-ink)',
    fillColor: 'var(--tone-blush-surface)',
    formatter: formatPercent,
    accessor: (point) => point.quoteToSubmitPct,
  },
  cogsWarnings: {
    label: 'Alertas COGS',
    description: 'Ocorrências técnicas de BOM ausente ou incompleta.',
    tone: 'rose',
    scaleGroup: 'count',
    strokeColor: 'var(--tone-danger-line)',
    fillColor: 'var(--tone-danger-surface)',
    formatter: formatNumber,
    accessor: (point) => point.cogsWarnings,
  },
};

const SALES_COST_TREND_KEYS: ComparableKpiKey[] = [
  'grossRevenue',
  'paidRevenue',
  'actualExpenses',
  'netCashFlow',
];

function buildLinePath(points: Array<{ x: number; y: number }>) {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
}

function KpiCompareChart({
  series,
  selectedKeys,
  emptyMessage,
  compact = false,
}: {
  series: DashboardTrendPoint[];
  selectedKeys: ComparableKpiKey[];
  emptyMessage: string;
  compact?: boolean;
}) {
  if (!series.length || !selectedKeys.length) {
    return <CompactEmpty message={emptyMessage} />;
  }

  const width = 960;
  const height = 340;
  const left = 28;
  const right = 28;
  const top = 18;
  const bottom = 44;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const step = series.length > 1 ? innerWidth / (series.length - 1) : 0;
  const labelStride = Math.max(1, Math.ceil(series.length / 8));
  const gridLines = 4;
  const selectedDefinitions = selectedKeys.map((key) => COMPARABLE_KPI_DEFINITIONS[key]);
  const usesMixedScaleGroups =
    new Set(selectedDefinitions.map((definition) => definition.scaleGroup)).size > 1;
  const allSelectedValues = selectedKeys.flatMap((key) =>
    series.map((point) => COMPARABLE_KPI_DEFINITIONS[key].accessor(point)),
  );
  const sharedMinValue = Math.min(0, ...allSelectedValues);
  const sharedMaxValue = Math.max(...allSelectedValues, 0);
  const sharedRange = sharedMaxValue - sharedMinValue || 1;

  const plottedSeries = selectedKeys.map((key) => {
    const definition = COMPARABLE_KPI_DEFINITIONS[key];
    const values = series.map((point) => definition.accessor(point));
    const ownMinValue = Math.min(0, ...values);
    const ownMaxValue = Math.max(...values, 0);
    const ownRange = ownMaxValue - ownMinValue || 1;
    const minValue = usesMixedScaleGroups ? ownMinValue : sharedMinValue;
    const maxValue = usesMixedScaleGroups ? ownMaxValue : sharedMaxValue;
    const range = usesMixedScaleGroups ? ownRange : sharedRange;
    const points = values.map((value, index) => ({
      x: left + step * index,
      y: top + innerHeight - ((value - minValue) / range) * innerHeight,
      value,
    }));
    const baselineY = top + innerHeight - ((0 - minValue) / range) * innerHeight;
    return {
      key,
      definition,
      minValue,
      maxValue,
      points,
      baselineY,
    };
  });

  return (
    <div className="grid gap-4">
      {compact ? null : (
        <div className="grid gap-3 xl:grid-cols-2">
          {plottedSeries.map((entry) => {
            const latest = entry.points[entry.points.length - 1]?.value || 0;
            const previous = entry.points[entry.points.length - 2]?.value || 0;
            return (
              <div
                key={entry.key}
                className={`rounded-[22px] border p-4 ${PANEL_TONE_CLASSES[entry.definition.tone]}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">
                      {entry.definition.label}
                    </p>
                    <strong className="mt-2 block text-xl tracking-[-0.04em] text-[color:var(--ink-strong)]">
                      {entry.definition.formatter(latest)}
                    </strong>
                  </div>
                  <span className="rounded-full border border-white/80 bg-white/86 px-3 py-1 text-xs font-semibold text-[color:var(--ink-strong)]">
                    {formatDeltaLabel(latest, previous, entry.definition.formatter)}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-neutral-600">
                  {entry.definition.description}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <div className="overflow-hidden rounded-[24px] border border-white/80 bg-white/86 p-4 shadow-[0_10px_24px_rgba(57,39,24,0.06)]">
        {compact ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {plottedSeries.map((entry) => (
              <span
                key={entry.key}
                className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/82 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)]"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: entry.definition.strokeColor }}
                />
                {entry.definition.label}
              </span>
            ))}
          </div>
        ) : (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
            <span>
              {usesMixedScaleGroups
                ? 'KPIs com unidades diferentes usam escala própria; compare tendência e delta, não a altura absoluta entre linhas.'
                : 'KPIs na mesma unidade compartilham a mesma escala; a altura das linhas é comparável.'}
            </span>
            <span className="font-semibold text-[color:var(--ink-strong)]">
              {usesMixedScaleGroups ? 'Escala independente por KPI' : 'Escala compartilhada'}
            </span>
          </div>
        )}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-[320px] w-full"
          preserveAspectRatio="none"
        >
          {Array.from({ length: gridLines + 1 }, (_, index) => {
            const y = top + (innerHeight / gridLines) * index;
            return (
              <line
                key={`grid-${index}`}
                x1={left}
                x2={width - right}
                y1={y}
                y2={y}
                stroke="rgba(98, 74, 52, 0.12)"
                strokeDasharray="4 6"
              />
            );
          })}

          {plottedSeries.map((entry) => (
            <g key={entry.key}>
              <path
                d={`${buildLinePath(entry.points)} L ${entry.points[entry.points.length - 1]?.x ?? left} ${entry.baselineY.toFixed(
                  2,
                )} L ${entry.points[0]?.x ?? left} ${entry.baselineY.toFixed(2)} Z`}
                fill={entry.definition.fillColor}
                opacity="0.22"
              />
              <path
                d={buildLinePath(entry.points)}
                fill="none"
                stroke={entry.definition.strokeColor}
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {entry.points.map((point, index) => (
                <circle
                  key={`${entry.key}-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r="4.5"
                  fill="white"
                  stroke={entry.definition.strokeColor}
                  strokeWidth="2.5"
                />
              ))}
            </g>
          ))}

          {series.map((point, index) => {
            const showLabel =
              index === 0 || index === series.length - 1 || index % labelStride === 0;
            return showLabel ? (
              <text
                key={`label-${point.bucketKey}`}
                x={left + step * index}
                y={height - 12}
                textAnchor="middle"
                fontSize="12"
                fill="rgba(98, 74, 52, 0.78)"
              >
                {point.shortLabel}
              </text>
            ) : null;
          })}
        </svg>
      </div>
    </div>
  );
}

function AttributionTable({
  items,
  overallSubmitRatePct,
  title,
  emptyMessage = 'Sem atribuição suficiente neste recorte.',
}: {
  items: DashboardTrafficSummary['attributedSources'];
  overallSubmitRatePct: number;
  title: string;
  emptyMessage?: string;
}) {
  if (!items.length) {
    return <CompactEmpty message={emptyMessage} />;
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm font-semibold text-[color:var(--ink-strong)]">{title}</p>
      <div className="overflow-x-auto rounded-[24px] border border-white/80 bg-white/86 shadow-[0_10px_24px_rgba(57,39,24,0.06)]">
        <table className="min-w-full divide-y divide-white/80 text-sm">
          <thead className="bg-white/82">
            <tr className="text-left text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-neutral-500">
              <th className="px-4 py-3">Canal</th>
              <th className="px-4 py-3">Sessões</th>
              <th className="px-4 py-3">Share</th>
              <th className="px-4 py-3">Chegou /pedido</th>
              <th className="px-4 py-3">Envio</th>
              <th className="px-4 py-3">Índice</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/70">
            {items.map((item) => {
              const efficiencyIndex =
                overallSubmitRatePct > 0
                  ? Number((item.submitRatePct / overallSubmitRatePct).toFixed(2))
                  : 0;
              return (
                <tr
                  key={`${title}-${item.label}`}
                  className="bg-white/62 text-[color:var(--ink-strong)]"
                >
                  <td className="px-4 py-3 font-semibold">{item.label}</td>
                  <td className="px-4 py-3">{formatNumber(item.sessions)}</td>
                  <td className="px-4 py-3">{formatPercent(item.sessionSharePct)}</td>
                  <td className="px-4 py-3">{formatPercent(item.orderReachPct)}</td>
                  <td className="px-4 py-3">{formatPercent(item.submitRatePct)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                        efficiencyIndex >= 1.15
                          ? 'border-[color:var(--tone-sage-line)] bg-[color:var(--tone-sage-surface)] text-[color:var(--tone-sage-ink)]'
                          : efficiencyIndex <= 0.85
                            ? 'border-[color:var(--tone-gold-line)] bg-[color:var(--tone-gold-surface)] text-[color:var(--tone-gold-ink)]'
                            : 'border-white/80 bg-white/70 text-[color:var(--ink-strong)]'
                      }`}
                    >
                      {efficiencyIndex > 0 ? `${formatDecimal(efficiencyIndex, 2)}x` : 'n/d'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
  const [statementFile, setStatementFile] = useState<File | null>(null);
  const [statementUploading, setStatementUploading] = useState(false);
  const [statementImportFeedback, setStatementImportFeedback] =
    useState<StatementImportFeedback | null>(null);
  const [isStatementDrawerOpen, setIsStatementDrawerOpen] = useState(false);
  const [statementReview, setStatementReview] = useState<StatementReviewPayload | null>(null);
  const [statementReviewLoading, setStatementReviewLoading] = useState(false);
  const [statementReviewError, setStatementReviewError] = useState<string | null>(null);
  const [statementTransactionDrafts, setStatementTransactionDrafts] = useState<
    Record<number, StatementTransactionDraft>
  >({});
  const [statementMatchCandidates, setStatementMatchCandidates] = useState<
    Record<number, StatementMatchCandidate[]>
  >({});
  const [statementTransactionSavingId, setStatementTransactionSavingId] = useState<number | null>(
    null,
  );
  const [statementOptionDrafts, setStatementOptionDrafts] = useState<
    Record<number, StatementOptionDraft>
  >({});
  const [statementOptionSavingKey, setStatementOptionSavingKey] = useState<string | null>(null);
  const [newStatementOptionDraft, setNewStatementOptionDraft] = useState<StatementOptionDraft>(
    () => buildStatementOptionDraft(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { notifyError, notifySuccess } = useFeedback();
  const deferredSummary = useDeferredValue(summary);
  const deferredCoupons = useDeferredValue(coupons);
  const summaryRef = useRef<DashboardSummary | null>(null);
  const statementMatchCandidatesRef = useRef<Record<number, StatementMatchCandidate[]>>({});
  const statementFileInputRef = useRef<HTMLInputElement | null>(null);
  const statementDrawerDialogRef = useRef<HTMLDivElement | null>(null);
  const statementDrawerCloseRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);

  useEffect(() => {
    statementMatchCandidatesRef.current = statementMatchCandidates;
  }, [statementMatchCandidates]);

  const syncStatementReviewState = useCallback((payload: StatementReviewPayload) => {
    startTransition(() => {
      setStatementReview(payload);
      setStatementImportFeedback(payload.latestImport);
      setStatementReviewError(null);
      setStatementTransactionDrafts(
        Object.fromEntries(
          payload.transactions.map((transaction) => [
            transaction.id,
            buildStatementTransactionDraft(transaction, payload.classificationOptions),
          ]),
        ),
      );
      setStatementOptionDrafts(
        Object.fromEntries(
          payload.classificationOptions.map((option) => [option.id, buildStatementOptionDraft(option)]),
        ),
      );
      setNewStatementOptionDraft(buildStatementOptionDraft());
    });
  }, []);

  const loadStatementReview = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!silent) {
        setStatementReviewLoading(true);
      }

      try {
        const payload = await apiFetch<StatementReviewPayload>('/dashboard/bank-statements/review', {
          cache: 'no-store',
        });
        syncStatementReviewState(payload);
      } catch (loadError) {
        const message =
          loadError instanceof Error
            ? loadError.message
            : 'Não foi possível carregar a revisão do extrato.';
        setStatementReviewError(message);
        if (!silent) {
          notifyError(message);
        }
      } finally {
        setStatementReviewLoading(false);
      }
    },
    [notifyError, syncStatementReviewState],
  );

  const loadStatementMatchCandidates = useCallback(
    async (transactionId: number) => {
      if (statementMatchCandidatesRef.current[transactionId]) return;
      try {
        const payload = await apiFetch<StatementMatchCandidate[]>(
          `/dashboard/bank-statements/transactions/${transactionId}/match-candidates`,
          {
            cache: 'no-store',
          },
        );
        setStatementMatchCandidates((current) => ({
          ...current,
          [transactionId]: payload,
        }));
      } catch {
        setStatementMatchCandidates((current) => ({
          ...current,
          [transactionId]: [],
        }));
      }
    },
    [],
  );

  const openStatementDrawer = useCallback(() => {
    setIsStatementDrawerOpen(true);
    void loadStatementReview();
  }, [loadStatementReview]);

  const closeStatementDrawer = useCallback(() => {
    setIsStatementDrawerOpen(false);
  }, []);

  useDialogA11y({
    isOpen: isStatementDrawerOpen,
    dialogRef: statementDrawerDialogRef,
    onClose: closeStatementDrawer,
    initialFocusRef: statementDrawerCloseRef,
  });

  const loadCoupons = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!silent) {
        setCouponsLoading(true);
      }

      try {
        const payload = await apiFetch<Coupon[]>('/dashboard/coupons', {
          cache: 'no-store',
        });
        const normalizedCoupons = Array.isArray(payload) ? payload : [];
        startTransition(() => {
          setCoupons(normalizedCoupons);
          setCouponDrafts(
            Object.fromEntries(
              normalizedCoupons.map((coupon) => [coupon.id || 0, buildCouponDraft(coupon)]),
            ),
          );
        });
      } catch (loadError) {
        if (!silent) {
          notifyError(
          loadError instanceof Error ? loadError.message : 'Não foi possível carregar os cupons.',
          );
        }
      } finally {
        setCouponsLoading(false);
      }
    },
    [notifyError],
  );

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!silent) {
        setLoading(true);
      }

      try {
        const path =
          selectedPeriod !== 'all'
            ? `/dashboard/summary?days=${encodeURIComponent(String(selectedPeriod))}`
            : '/dashboard/summary';
        const payload = await apiFetch<DashboardSummary>(path, {
          cache: 'no-store',
        });
        startTransition(() => {
          setSummary(payload);
          setError(null);
        });
      } catch (loadError) {
        const message =
          loadError instanceof Error ? loadError.message : 'Não foi possível carregar o dashboard.';
        const hasSummaryLoaded = summaryRef.current != null;
        setError(hasSummaryLoaded ? null : message);
        if (!silent && !hasSummaryLoaded) {
          notifyError(message);
        }
      } finally {
        setLoading(false);
      }
    },
    [notifyError, selectedPeriod],
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

  const handleImportStatement = useCallback(async () => {
    if (!statementFile) {
      notifyError('Selecione um arquivo .eml, .csv ou .ofx antes de atualizar o extrato.');
      return;
    }

    const formData = new FormData();
    formData.append('file', statementFile);

    try {
      setStatementUploading(true);
      const importPayload = await apiFetch<{
        ok: true;
        import: StatementImportFeedback;
      }>('/dashboard/bank-statements/import', {
        method: 'POST',
        body: formData,
      });
      setStatementImportFeedback(importPayload.import);
      setStatementFile(null);
      if (statementFileInputRef.current) {
        statementFileInputRef.current.value = '';
      }
      await load({ silent: true });
      if (isStatementDrawerOpen) {
        await loadStatementReview({ silent: true });
      }
      notifySuccess('Extrato atualizado e cálculos financeiros recalculados.');
    } catch (importError) {
      notifyError(
        importError instanceof Error
          ? importError.message
          : 'Não foi possível atualizar o extrato.',
      );
    } finally {
      setStatementUploading(false);
    }
  }, [isStatementDrawerOpen, load, loadStatementReview, notifyError, notifySuccess, statementFile]);

  const setStatementTransactionDraftField = useCallback(
    (transactionId: number, field: keyof StatementTransactionDraft, value: string) => {
      setStatementTransactionDrafts((current) => ({
        ...current,
        [transactionId]: {
          ...(current[transactionId] || { classificationInput: '', matchInput: '' }),
          [field]: value,
        },
      }));
    },
    [],
  );

  const handleSaveStatementTransaction = useCallback(
    async (transactionId: number) => {
      const draft = statementTransactionDrafts[transactionId];
      const transaction = statementReview?.transactions.find((entry) => entry.id === transactionId) || null;
      if (!draft) return;
      if (!transaction) return;

      const activeClassificationOptions = (statementReview?.classificationOptions || []).filter(
        (option) =>
          option.active ||
          option.code === transaction.classificationCode ||
          option.code === transaction.category,
      );
      const classificationCode = resolveStatementClassificationCodeFromInput(
        draft.classificationInput,
        activeClassificationOptions,
      );

      if (!classificationCode) {
        notifyError('Classificação não reconhecida. Use uma opção existente ou crie uma nova.');
        return;
      }

      const candidates = statementMatchCandidates[transactionId] || [];
      const matchCandidate =
        transaction.direction === 'INFLOW'
          ? resolveStatementMatchCandidateFromInput(draft.matchInput, candidates)
          : null;
      const shouldClearMatch = transaction.direction !== 'INFLOW' || !draft.matchInput.trim();

      if (transaction.direction === 'INFLOW' && !shouldClearMatch && !matchCandidate) {
        notifyError('Pedido não reconhecido. Escolha um identificador sugerido para salvar.');
        return;
      }

      try {
        setStatementTransactionSavingId(transactionId);
        const payload = await apiFetch<StatementReviewPayload>(
          `/dashboard/bank-statements/transactions/${transactionId}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              classificationCode,
              matchedPaymentId:
                !shouldClearMatch && matchCandidate?.matchType === 'PAYMENT'
                  ? matchCandidate.paymentId
                  : null,
              matchedOrderId:
                !shouldClearMatch && matchCandidate?.matchType === 'ORDER'
                  ? matchCandidate.orderId
                  : null,
            }),
          },
        );
        syncStatementReviewState(payload);
        setStatementMatchCandidates({});
        void load({ silent: true });
        notifySuccess('Lançamento do extrato atualizado.');
      } catch (saveError) {
        notifyError(
          saveError instanceof Error
            ? saveError.message
            : 'Não foi possível atualizar o lançamento do extrato.',
        );
      } finally {
        setStatementTransactionSavingId(null);
      }
    },
    [
      load,
      notifyError,
      notifySuccess,
      statementMatchCandidates,
      statementReview,
      statementTransactionDrafts,
      syncStatementReviewState,
    ],
  );

  const setStatementOptionDraftField = useCallback(
    (optionId: number, field: keyof StatementOptionDraft, value: string | boolean) => {
      setStatementOptionDrafts((current) => ({
        ...current,
        [optionId]: {
          ...(current[optionId] || buildStatementOptionDraft()),
          [field]:
            field === 'active'
              ? Boolean(value)
              : (String(value) as StatementOptionDraft[keyof StatementOptionDraft]),
        } as StatementOptionDraft,
      }));
    },
    [],
  );

  const setNewStatementOptionField = useCallback(
    (field: keyof StatementOptionDraft, value: string | boolean) => {
      setNewStatementOptionDraft((current) => ({
        ...current,
        [field]:
          field === 'active'
            ? Boolean(value)
            : (String(value) as StatementOptionDraft[keyof StatementOptionDraft]),
      }));
    },
    [],
  );

  const persistStatementOption = useCallback(
    async (input: { id?: number; draft: StatementOptionDraft }) => {
      const label = String(input.draft.label || '').trim();
      if (!label) {
        throw new Error('Informe o nome da classificação.');
      }

      const path = input.id
        ? `/dashboard/bank-statements/classification-options/${input.id}`
        : '/dashboard/bank-statements/classification-options';
      const method = input.id ? 'PUT' : 'POST';
      return apiFetch<StatementReviewPayload>(path, {
        method,
        body: JSON.stringify({
          label,
          baseCategory: input.draft.baseCategory,
          active: Boolean(input.draft.active),
        }),
      });
    },
    [],
  );

  const handleSaveStatementOption = useCallback(
    async (optionId: number) => {
      const draft = statementOptionDrafts[optionId];
      if (!draft) return;
      try {
        setStatementOptionSavingKey(`existing-${optionId}`);
        const payload = await persistStatementOption({ id: optionId, draft });
        syncStatementReviewState(payload);
        void load({ silent: true });
        notifySuccess('Classificação atualizada.');
      } catch (saveError) {
        notifyError(
          saveError instanceof Error
            ? saveError.message
            : 'Não foi possível salvar a classificação.',
        );
      } finally {
        setStatementOptionSavingKey(null);
      }
    },
    [load, notifyError, notifySuccess, persistStatementOption, statementOptionDrafts, syncStatementReviewState],
  );

  const handleAddStatementOption = useCallback(async () => {
    try {
      setStatementOptionSavingKey('new');
      const payload = await persistStatementOption({ draft: newStatementOptionDraft });
      syncStatementReviewState(payload);
      void load({ silent: true });
      notifySuccess('Nova classificação adicionada ao extrato.');
    } catch (saveError) {
      notifyError(
        saveError instanceof Error
          ? saveError.message
          : 'Não foi possível criar a classificação.',
      );
    } finally {
      setStatementOptionSavingKey(null);
    }
  }, [load, newStatementOptionDraft, notifyError, notifySuccess, persistStatementOption, syncStatementReviewState]);

  const displaySummary = deferredSummary ?? summary;
  const activeTraffic =
    displaySummary && selectedPeriod === 'all'
      ? displaySummary.traffic
      : displaySummary?.selectedPeriod.traffic || null;
  const activeBusiness =
    displaySummary && selectedPeriod === 'all'
      ? displaySummary.business
      : displaySummary?.selectedPeriod.business || null;
  const activePeriodLabel =
    selectedPeriod === 'all'
      ? displaySummary?.traffic.windowLabel || 'Base inteira'
      : displaySummary?.selectedPeriod.label || 'Ultimos 7 dias';
  const topTrafficMix = useMemo(
    () =>
      activeTraffic
        ? [
            {
              label: 'Mobile',
              sessions:
                activeTraffic.deviceMix.find((entry) => entry.label === 'mobile')?.sessions || 0,
            },
            {
              label: 'Tablet',
              sessions:
                activeTraffic.deviceMix.find((entry) => entry.label === 'tablet')?.sessions || 0,
            },
            {
              label: 'Desktop',
              sessions:
                activeTraffic.deviceMix.find((entry) => entry.label === 'desktop')?.sessions || 0,
            },
          ]
        : [],
    [activeTraffic],
  );

  const asOfLabel = displaySummary
    ? new Date(displaySummary.asOf).toLocaleString('pt-BR')
    : 'carregando...';
  const analysisSpanDays = useMemo(
    () =>
      Math.max(
        computeSeriesSpanDays(activeTraffic?.dailySeries || []),
        computeSeriesSpanDays(activeBusiness?.dailySeries || []),
      ),
    [activeBusiness, activeTraffic],
  );
  const analysisGranularity = analysisSpanDays > 0 && analysisSpanDays < 120 ? 'day' : 'month';
  const trendSeries = useMemo(
    () =>
      buildTrendSeries({
        traffic: activeTraffic,
        business: activeBusiness,
        granularity: analysisGranularity,
      }),
    [activeBusiness, activeTraffic, analysisGranularity],
  );
  const trendEmptyMessage =
    analysisGranularity === 'day'
      ? 'Sem histórico diário suficiente para comparar KPIs neste recorte.'
      : 'Sem histórico mensal suficiente para comparar KPIs nesta base.';
  const overallSessionToSubmitPct =
    activeTraffic && activeTraffic.totals.sessions > 0
      ? Number(
          ((activeTraffic.funnel.submittedSessions / activeTraffic.totals.sessions) * 100).toFixed(
            1,
          ),
        )
      : 0;
  const statementOverview = activeBusiness?.statement || null;
  const latestStatementImport = statementImportFeedback || statementOverview?.latestImport || null;
  const statementDrawerLatestImport = statementReview?.latestImport || latestStatementImport;
  const statementStatusLabel = statementUploading
    ? 'PROCESSANDO...'
    : formatStatementStatusLabel(latestStatementImport?.status);
  const statementFeedbackMessage = statementUploading
    ? 'Processando o extrato e recalculando os indicadores financeiros...'
      : latestStatementImport?.importedAt
        ? `Última atualização: ${new Date(latestStatementImport.importedAt).toLocaleString('pt-BR')} · ${formatNumber(latestStatementImport.transactionCount)} linha(s) · ${formatNumber(latestStatementImport.unmatchedInflowsCount)} sem match`
      : 'Aceita .eml, .csv ou .ofx do Nu Empresas';
  const statementInsightCards = useMemo(() => {
    if (!statementOverview) return [];
    return [
      {
        label: 'Receita conciliada',
        value: formatCurrencyBR(statementOverview.reconciliation.matchedRevenue),
        tone: 'mint' as const,
        meta: `${formatNumber(statementOverview.reconciliation.matchedTransactionsCount)} lançamento(s)`,
      },
      {
        label: 'Entradas sem match',
        value: formatCurrencyBR(statementOverview.reconciliation.unmatchedInflows),
        tone:
          statementOverview.reconciliation.unmatchedInflows > 0
            ? ('amber' as const)
            : ('mint' as const),
        meta: `${formatNumber(statementOverview.reconciliation.unmatchedTransactionsCount)} lançamento(s)`,
      },
      {
        label: 'Saídas operacionais',
        value: formatCurrencyBR(statementOverview.reconciliation.operationalOutflows),
        tone: 'rose' as const,
        meta: `${formatCurrencyBR(statementOverview.kpis.actualExpensesInRange)} entrando nos custos reais`,
      },
      {
        label: 'Mov. não operacionais',
        value: formatCurrencyBR(statementOverview.reconciliation.nonOperationalNet),
        tone:
          statementOverview.reconciliation.nonOperationalNet >= 0
            ? ('sky' as const)
            : ('ink' as const),
        meta: `${formatCurrencyBR(statementOverview.reconciliation.nonOperationalOutflows)} aplicados · ${formatCurrencyBR(statementOverview.reconciliation.nonOperationalInflows)} resgatados`,
      },
    ];
  }, [statementOverview]);
  const statementClassificationLeaders = useMemo(
    () => (statementOverview?.classificationBreakdown || []).slice(0, 8),
    [statementOverview],
  );
  const sourceEfficiencyCards = useMemo(() => {
    if (!activeTraffic?.attributedSources?.length) return [];
    const bestSubmitRate = [...activeTraffic.attributedSources]
      .filter((entry) => entry.sessions >= 2)
      .sort((left, right) => right.submitRatePct - left.submitRatePct)[0];
    const highestShare = [...activeTraffic.attributedSources].sort(
      (left, right) => right.sessionSharePct - left.sessionSharePct,
    )[0];
    const highestSubmitShare = [...activeTraffic.attributedSources].sort(
      (left, right) => right.submitSharePct - left.submitSharePct,
    )[0];
    return [
      bestSubmitRate
        ? {
            label: 'Canal mais eficiente',
            value: bestSubmitRate.label,
            meta: `${formatPercent(bestSubmitRate.submitRatePct)} de sessão → envio`,
            tone: 'mint' as const,
          }
        : null,
      highestShare
        ? {
            label: 'Maior share de tráfego',
            value: highestShare.label,
            meta: `${formatPercent(highestShare.sessionSharePct)} das sessões`,
            tone: 'sky' as const,
          }
        : null,
      highestSubmitShare
        ? {
            label: 'Maior share de envios',
            value: highestSubmitShare.label,
            meta: `${formatPercent(highestSubmitShare.submitSharePct)} dos envios`,
            tone: 'amber' as const,
          }
        : null,
    ].filter(Boolean) as Array<{ label: string; value: string; meta: string; tone: DashboardTone }>;
  }, [activeTraffic]);
  const cockpitMetrics = useMemo(() => {
    if (!displaySummary || !activeBusiness) return [];
    return [
      {
        label: 'Receita bruta',
        value: formatCurrencyBR(activeBusiness.kpis.grossRevenueInRange),
        tone: 'amber' as const,
        meta: `${formatNumber(activeBusiness.kpis.ordersInRange)} pedidos`,
      },
      {
        label: 'Receita líquida',
        value: formatCurrencyBR(activeBusiness.kpis.productNetRevenueInRange),
        tone: 'ink' as const,
        meta: `${formatCurrencyBR(activeBusiness.kpis.discountsInRange)} em descontos`,
      },
      {
        label: 'Recebido',
        value: formatCurrencyBR(activeBusiness.kpis.paidRevenueInRange),
        tone: 'sky' as const,
        meta: `${formatPercent(
          activeBusiness.kpis.grossRevenueInRange > 0
            ? (activeBusiness.kpis.paidRevenueInRange / activeBusiness.kpis.grossRevenueInRange) *
                100
            : 0,
        )} em caixa`,
      },
      {
        label: 'Fluxo de caixa',
        value: formatCurrencyBR(activeBusiness.kpis.netCashFlowInRange),
        tone:
          activeBusiness.kpis.netCashFlowInRange >= 0 ? ('mint' as const) : ('rose' as const),
        meta: `${formatCurrencyBR(activeBusiness.kpis.bankInflowInRange)} de entradas`,
      },
      {
        label: 'Custos reais',
        value: formatCurrencyBR(activeBusiness.kpis.actualExpensesInRange),
        tone: 'rose' as const,
        meta: `${formatCurrencyBR(activeBusiness.kpis.ingredientExpensesInRange)} em insumos`,
      },
      {
        label: 'COGS técnico',
        value: formatCurrencyBR(activeBusiness.kpis.estimatedCogsInRange),
        tone: 'amber' as const,
        meta: `${formatNumber(activeBusiness.kpis.costedOrdersInRange)} pedidos auditados`,
      },
      {
        label: 'Frete cobrado',
        value: formatCurrencyBR(activeBusiness.kpis.deliveryRevenueInRange),
        tone: 'amber' as const,
        meta: `${formatNumber(activeBusiness.kpis.deliveryOrdersInRange)} entrega(s)`,
      },
      {
        label: 'Uber real',
        value: formatCurrencyBR(activeBusiness.kpis.deliveryExpensesInRange),
        tone: 'rose' as const,
        meta: `${formatPercent(activeBusiness.kpis.deliveryCoveragePctInRange)} de cobertura`,
      },
      {
        label: 'Saldo do frete',
        value: formatCurrencyBR(activeBusiness.kpis.deliveryMarginInRange),
        tone:
          activeBusiness.kpis.deliveryMarginInRange >= 0 ? ('mint' as const) : ('rose' as const),
        meta:
          activeBusiness.kpis.deliveryMarginInRange >= 0
            ? 'Frete cobrindo o custo real'
            : 'Frete abaixo do custo real',
      },
      {
        label: 'Ticket médio',
        value: formatCurrencyBR(activeBusiness.kpis.avgTicketInRange),
        tone: 'ink' as const,
        meta: `${formatPercent(activeBusiness.customerMetrics.repeatRatePct)} recorrência`,
      },
      {
        label: 'Recebíveis',
        value: formatCurrencyBR(activeBusiness.kpis.outstandingBalance),
        tone: activeBusiness.kpis.outstandingBalance > 0 ? ('rose' as const) : ('mint' as const),
        meta: `${formatNumber(displaySummary.business.recentReceivables.length)} no radar`,
      },
      {
        label: 'Sem match',
        value: formatCurrencyBR(activeBusiness.kpis.unmatchedInflowsInRange),
        tone:
          activeBusiness.kpis.unmatchedInflowsInRange > 0 ? ('amber' as const) : ('mint' as const),
        meta: `${formatNumber(statementOverview?.latestImport.unmatchedInflowsCount || 0)} entrada(s)`,
      },
      {
        label: 'Extrato',
        value: formatStatementStatusLabel(statementOverview?.latestImport.status),
        tone:
          statementOverview?.latestImport.status === 'RUNNING'
            ? ('mint' as const)
            : statementOverview?.latestImport.status === 'ATTENTION'
              ? ('amber' as const)
              : ('ink' as const),
        meta:
          statementOverview?.latestImport.periodEnd
            ? `Cobertura até ${new Date(statementOverview.latestImport.periodEnd).toLocaleDateString('pt-BR')}`
            : 'Sem extrato importado',
      },
    ];
  }, [activeBusiness, displaySummary, statementOverview]);
  const digitalOverviewCards = useMemo(() => {
    if (!activeTraffic) return [];
    return [
      {
        label: 'Sessões',
        value: formatNumber(activeTraffic.totals.sessions),
        tone: 'ink' as const,
        meta: `${formatNumber(activeTraffic.totals.pageViews)} pageviews`,
      },
      {
        label: 'Home → /pedido',
        value: formatPercent(activeTraffic.funnel.homeToOrderPct),
        tone: 'mint' as const,
        meta: `${formatNumber(activeTraffic.funnel.orderSessions)} sessões`,
      },
      {
        label: 'Pedido → envio',
        value: formatPercent(activeTraffic.funnel.orderToSubmitPct),
        tone: 'amber' as const,
        meta: `${formatNumber(activeTraffic.funnel.submittedSessions)} envios`,
      },
      {
        label: 'Quote → envio',
        value: formatPercent(activeTraffic.funnel.quoteToSubmitPct),
        tone: 'sky' as const,
        meta: `${formatNumber(activeTraffic.funnel.quoteSuccessSessions)} quotes`,
      },
      {
        label: 'Bounce rate',
        value: formatPercent(activeTraffic.totals.bounceRatePct),
        tone: 'rose' as const,
        meta: `${formatDecimal(activeTraffic.totals.avgPagesPerSession, 1)} páginas / sessão`,
      },
      {
        label: 'Mobile share',
        value: formatPercent(
          activeTraffic.totals.sessions > 0
            ? ((topTrafficMix.find((entry) => entry.label === 'Mobile')?.sessions || 0) /
                activeTraffic.totals.sessions) *
                100
            : 0,
        ),
        tone: 'sky' as const,
        meta: `${formatNumber(topTrafficMix.find((entry) => entry.label === 'Mobile')?.sessions || 0)} sessões`,
      },
    ];
  }, [activeTraffic, topTrafficMix]);

  const activeCouponsCount = useMemo(
    () => deferredCoupons.reduce((sum, coupon) => sum + (coupon.active ? 1 : 0), 0),
    [deferredCoupons],
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
                : Boolean(value),
        },
      }));
    },
    [coupons],
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

    return apiFetch<Coupon>(input.id ? `/dashboard/coupons/${input.id}` : '/dashboard/coupons', {
      method: input.id ? 'PUT' : 'POST',
      body: JSON.stringify({
        code,
        discountPct,
        usageLimitPerCustomer,
        active: Boolean(input.draft.active),
      }),
    });
  }, []);

  const handleSaveCoupon = useCallback(
    async (id: number) => {
      const draft = couponDrafts[id];
      if (!draft) return;

      try {
        setCouponSavingKey(`existing-${id}`);
        const saved = await persistCoupon({ id, draft });
        setCoupons((current) => current.map((entry) => (entry.id === id ? saved : entry)));
        setCouponDrafts((current) => ({
          ...current,
          [id]: buildCouponDraft(saved),
        }));
        notifySuccess(`Cupom ${saved.code} atualizado.`);
      } catch (saveError) {
        notifyError(
          saveError instanceof Error ? saveError.message : 'Não foi possível salvar o cupom.',
        );
      } finally {
        setCouponSavingKey(null);
      }
    },
    [couponDrafts, notifyError, notifySuccess, persistCoupon],
  );

  const handleAddCoupon = useCallback(async () => {
    try {
      setCouponSavingKey('new');
      const created = await persistCoupon({ draft: newCouponDraft });
      setCoupons((current) =>
        [...current, created].sort((left, right) => left.code.localeCompare(right.code)),
      );
      setCouponDrafts((current) => ({
        ...current,
        [created.id || 0]: buildCouponDraft(created),
      }));
      setNewCouponDraft(buildCouponDraft());
      notifySuccess(`Cupom ${created.code} criado.`);
    } catch (saveError) {
      notifyError(
        saveError instanceof Error ? saveError.message : 'Não foi possível criar o cupom.',
      );
    } finally {
      setCouponSavingKey(null);
    }
  }, [newCouponDraft, notifyError, notifySuccess, persistCoupon]);

  const handleDeleteCoupon = useCallback(
    async (id: number) => {
      try {
        setCouponDeletingId(id);
        await apiFetch<{ ok: boolean }>(`/dashboard/coupons/${id}`, {
          method: 'DELETE',
        });
        setCoupons((current) => current.filter((entry) => entry.id !== id));
        setCouponDrafts((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        notifySuccess('Cupom excluído.');
      } catch (deleteError) {
        notifyError(
          deleteError instanceof Error ? deleteError.message : 'Não foi possível excluir o cupom.',
        );
      } finally {
        setCouponDeletingId(null);
      }
    },
    [notifyError, notifySuccess],
  );

  return (
    <div className="grid gap-4 pb-10">
      <section className="app-panel flex flex-wrap items-end justify-between gap-4 rounded-[30px] p-5 sm:p-6">
        <div className="grid gap-2">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[color:var(--ink-muted)]">
            Dashboard
          </p>
          <h1 className="text-[1.8rem] leading-none tracking-[-0.06em] text-[color:var(--ink-strong)] sm:text-[2.3rem]">
            QUEROBROA
          </h1>
        </div>
        <span className="rounded-full border border-white/70 bg-white/80 px-4 py-2 text-sm text-neutral-700">
          Atualizado em {asOfLabel}
        </span>
      </section>

      {error ? (
        <div className="app-panel rounded-[26px] border-dashed border-red-300 bg-red-50 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading && !summary ? (
        <div className="app-panel rounded-[26px] text-sm text-neutral-500">Carregando...</div>
      ) : null}

      {summary ? (
        <>
          <section className="app-panel flex flex-wrap items-center justify-between gap-3 rounded-[30px] p-4 sm:p-5">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-full border border-white/70 bg-white/78 px-3 py-1.5 text-neutral-700">
                Período · {activePeriodLabel}
              </span>
              <span className="rounded-full border border-white/70 bg-white/78 px-3 py-1.5 text-neutral-700">
                {analysisGranularity === 'day' ? 'Leitura diária' : 'Leitura mensal'}
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

          <SectionPanel
            title="EXTRATO BANCÁRIO"
            tone="amber"
            tag={
              <span className="rounded-full border border-white/80 bg-white/82 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-strong)]">
                {statementStatusLabel}
              </span>
            }
          >
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Última importação"
                  value={
                    statementDrawerLatestImport?.importedAt
                      ? new Date(statementDrawerLatestImport.importedAt).toLocaleDateString(
                          'pt-BR',
                        )
                      : 'Pendente'
                  }
                  tone="ink"
                  meta={
                    statementDrawerLatestImport?.fileName || 'Sem extrato importado ainda'
                  }
                />
                <MetricCard
                  label="Cobertura"
                  value={
                    statementDrawerLatestImport?.periodEnd
                      ? new Date(statementDrawerLatestImport.periodEnd).toLocaleDateString(
                          'pt-BR',
                        )
                      : 'Sem data'
                  }
                  tone="sky"
                  meta={
                    statementDrawerLatestImport?.periodStart
                      ? `Desde ${new Date(statementDrawerLatestImport.periodStart).toLocaleDateString('pt-BR')}`
                      : 'Período não identificado'
                  }
                />
                <MetricCard
                  label="Linhas"
                  value={formatNumber(statementDrawerLatestImport?.transactionCount || 0)}
                  tone="amber"
                  meta={formatCurrencyBR(statementDrawerLatestImport?.inflowTotal || 0)}
                />
                <MetricCard
                  label="Conciliação"
                  value={formatNumber(statementDrawerLatestImport?.matchedPaymentsCount || 0)}
                  tone={
                    (statementDrawerLatestImport?.unmatchedInflowsCount || 0) > 0
                      ? 'rose'
                      : 'mint'
                  }
                  meta={`${formatNumber(statementDrawerLatestImport?.unmatchedInflowsCount || 0)} sem match`}
                />
              </div>

            <div className="grid gap-3 rounded-[24px] border border-white/80 bg-white/84 p-4 shadow-[0_10px_24px_rgba(57,39,24,0.06)]">
                <div className="grid gap-2">
                  <input
                    ref={statementFileInputRef}
                    type="file"
                    accept=".eml,.csv,.ofx"
                    className="app-input min-h-12 file:mr-3 file:rounded-full file:border-0 file:bg-[color:var(--brand-cocoa)] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                  onChange={(event) => setStatementFile(event.target.files?.[0] || null)}
                />
                <p className="text-xs text-neutral-500">
                  {statementFile ? statementFile.name : statementFeedbackMessage}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  className="app-button app-button-primary min-h-12"
                  disabled={statementUploading || !statementFile}
                  onClick={() => void handleImportStatement()}
                >
                  {statementUploading ? 'PROCESSANDO EXTRATO...' : 'ATUALIZAR EXTRATO'}
                </button>
                <button
                  type="button"
                  className="app-button app-button-ghost min-h-12"
                  disabled={statementUploading}
                  onClick={openStatementDrawer}
                >
                  ABRIR EXTRATO
                </button>
              </div>
              {statementFile ? (
                <p className="text-xs text-neutral-500">
                  Ao confirmar, o dashboard recalcula caixa, custos e conciliação PIX.
                </p>
              ) : null}
            </div>
          </div>

            {statementOverview ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
                <div className="grid gap-3 rounded-[24px] border border-white/80 bg-white/86 p-4 shadow-[0_10px_24px_rgba(57,39,24,0.06)]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[color:var(--ink-strong)]">
                      Plano de contas
                    </p>
                    <span className="text-xs text-neutral-500">
                      {formatNumber(statementOverview.classificationBreakdown.length)} leitura(s)
                    </span>
                  </div>
                  {statementClassificationLeaders.length ? (
                    <div className="grid gap-3">
                      {statementClassificationLeaders.map((entry) => (
                        <div
                          key={entry.code}
                          className="flex flex-wrap items-start justify-between gap-3 rounded-[20px] border border-white/75 bg-white/78 px-4 py-3"
                        >
                          <div className="grid gap-1">
                            <strong className="text-sm text-[color:var(--ink-strong)]">
                              {entry.label}
                            </strong>
                            <p className="text-xs text-neutral-500">
                              {STATEMENT_CATEGORY_LABELS[entry.baseCategory as StatementCategory]} ·{' '}
                              {formatNumber(entry.count)} lançamento(s)
                              {entry.isOperational ? ' · operacional' : ' · não operacional'}
                            </p>
                          </div>
                          <div className="grid gap-1 text-right">
                            <strong className="text-sm text-[color:var(--ink-strong)]">
                              {formatCurrencyBR(entry.amount)}
                            </strong>
                            <p className="text-xs text-neutral-500">
                              Entradas {formatCurrencyBR(entry.inflowAmount)} · Saídas{' '}
                              {formatCurrencyBR(entry.outflowAmount)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <CompactEmpty message="Sem plano de contas disponível neste recorte." />
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {statementInsightCards.map((card) => (
                    <MetricCard
                      key={card.label}
                      label={card.label}
                      value={card.value}
                      tone={card.tone}
                      meta={card.meta}
                    />
                  ))}
                </div>
              </div>
            ) : null}
        </SectionPanel>

          <SectionPanel
            title="COCKPIT COMPLETO"
            tone="ink"
            tag={
              <span className="rounded-full border border-white/80 bg-white/82 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-strong)]">
                {activePeriodLabel}
              </span>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {cockpitMetrics.map((card) => (
                <MetricCard
                  key={card.label}
                  label={card.label}
                  value={card.value}
                  tone={card.tone}
                  meta={card.meta}
                />
              ))}
            </div>
          </SectionPanel>

          <SectionPanel
            title="EVOLUÇÃO DIÁRIA DE VENDAS E CUSTOS"
            tone="ink"
            tag={
              <span className="rounded-full border border-white/80 bg-white/82 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-strong)]">
                {analysisGranularity === 'day' ? 'Linha diária' : 'Linha mensal'}
              </span>
            }
          >
            <div className="grid gap-4">
              <KpiCompareChart
                series={trendSeries}
                selectedKeys={SALES_COST_TREND_KEYS}
                emptyMessage={trendEmptyMessage}
                compact
              />

              <div className="overflow-x-auto rounded-[24px] border border-white/80 bg-white/86 shadow-[0_10px_24px_rgba(57,39,24,0.06)]">
                <table className="min-w-full divide-y divide-white/80 text-sm">
                  <thead className="bg-white/82">
                    <tr className="text-left text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
                      <th className="px-4 py-3">{analysisGranularity === 'day' ? 'Dia' : 'Mês'}</th>
                      <th className="px-4 py-3">Pedidos</th>
                      <th className="px-4 py-3">Receita</th>
                      <th className="px-4 py-3">Recebido</th>
                      <th className="px-4 py-3">Frete cobrado</th>
                      <th className="px-4 py-3">Uber real</th>
                      <th className="px-4 py-3">Saldo frete</th>
                      <th className="px-4 py-3">Custos reais</th>
                      <th className="px-4 py-3">Fluxo caixa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/70">
                    {trendSeries.map((entry) => (
                      <tr
                        key={entry.bucketKey}
                        className="bg-white/62 text-[color:var(--ink-strong)]"
                      >
                        <td className="px-4 py-3 font-semibold">{entry.bucketLabel}</td>
                        <td className="px-4 py-3">{formatNumber(entry.orders)}</td>
                        <td className="px-4 py-3">{formatCurrencyBR(entry.grossRevenue)}</td>
                        <td className="px-4 py-3">{formatCurrencyBR(entry.paidRevenue)}</td>
                        <td className="px-4 py-3">{formatCurrencyBR(entry.deliveryRevenue)}</td>
                        <td className="px-4 py-3">{formatCurrencyBR(entry.deliveryExpenses)}</td>
                        <td className="px-4 py-3">{formatCurrencyBR(entry.deliveryMargin)}</td>
                        <td className="px-4 py-3">{formatCurrencyBR(entry.actualExpenses)}</td>
                        <td className="px-4 py-3">{formatCurrencyBR(entry.netCashFlow)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </SectionPanel>

          <SectionPanel
            title="OVERVIEW DIGITAL COMPLETO"
            tone="sky"
            tag={
              <span className="rounded-full border border-white/80 bg-white/82 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-strong)]">
                {activePeriodLabel}
              </span>
            }
          >
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
                {digitalOverviewCards.map((card) => (
                  <MetricCard
                    key={card.label}
                    label={card.label}
                    value={card.value}
                    tone={card.tone}
                    meta={card.meta}
                  />
                ))}
              </div>

              {sourceEfficiencyCards.length ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  {sourceEfficiencyCards.map((card) => (
                    <MetricCard
                      key={card.label}
                      label={card.label}
                      value={card.value}
                      tone={card.tone}
                      meta={card.meta}
                    />
                  ))}
                </div>
              ) : null}

              <div className="grid gap-4 xl:grid-cols-2">
                <AttributionTable
                  items={activeTraffic?.attributedSources || []}
                  overallSubmitRatePct={overallSessionToSubmitPct}
                  title="Origens"
                />
                <AttributionTable
                  items={activeTraffic?.attributedReferrers || []}
                  overallSubmitRatePct={overallSessionToSubmitPct}
                  title="Referrers"
                  emptyMessage="Sem referrer relevante neste recorte."
                />
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Rotas</p>
                    <DistributionList
                      items={(activeTraffic?.topPaths || []).map((entry) => ({
                        label: `${entry.path} · ${entry.surface}`,
                        value: entry.views,
                      }))}
                      tone="amber"
                    />
                  </div>
                  <div className="grid gap-2">
                    <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Links</p>
                    <DistributionList
                      items={(activeTraffic?.topLinks || []).map((entry) => ({
                        label: entry.label || entry.href,
                        clicks: entry.clicks,
                      }))}
                      valueKey="clicks"
                      tone="rose"
                    />
                  </div>
                  <div className="grid gap-2">
                    <p className="text-sm font-semibold text-[color:var(--ink-strong)]">
                      Dispositivos
                    </p>
                    <DistributionList items={topTrafficMix} valueKey="sessions" tone="mint" />
                  </div>
                  <div className="grid gap-2">
                    <p className="text-sm font-semibold text-[color:var(--ink-strong)]">
                      Páginas lentas
                    </p>
                    {activeTraffic?.slowPages.length ? (
                      <div className="grid gap-3">
                        {activeTraffic.slowPages.slice(0, 4).map((entry) => (
                          <div
                            key={`${entry.path}-${entry.metricName}`}
                            className="rounded-[24px] border border-white/80 bg-white/82 p-4 shadow-[0_10px_24px_rgba(57,39,24,0.06)]"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <strong className="min-w-0 truncate text-[color:var(--ink-strong)]">
                                {entry.path}
                              </strong>
                              <span className="rounded-full border border-white/70 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)]">
                                {entry.metricName}
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-neutral-600">
                              {formatMetricValue(entry.p75, 'ms')} ·{' '}
                              {formatMetricValue(entry.median, 'ms')}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <CompactEmpty message="Sem rota lenta relevante." />
                    )}
                  </div>
                </div>

                <div className="grid gap-4">
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
                    <CompactEmpty message="Sem amostra de Web Vitals neste recorte." />
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <p className="text-sm font-semibold text-[color:var(--ink-strong)]">
                        Browsers
                      </p>
                      <DistributionList
                        items={(activeTraffic?.browserMix || []).map((entry) => ({
                          label: entry.label,
                          sessions: entry.sessions,
                        }))}
                        valueKey="sessions"
                        tone="sky"
                        emptyMessage="Sem amostra de browser neste recorte."
                      />
                    </div>
                    <div className="grid gap-2">
                      <p className="text-sm font-semibold text-[color:var(--ink-strong)]">
                        Sistemas
                      </p>
                      <DistributionList
                        items={(activeTraffic?.osMix || []).map((entry) => ({
                          label: entry.label,
                          sessions: entry.sessions,
                        }))}
                        valueKey="sessions"
                        tone="mint"
                        emptyMessage="Sem amostra de sistema neste recorte."
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </SectionPanel>

          {isStatementDrawerOpen ? (
            <div className="order-detail-modal" role="presentation" onClick={closeStatementDrawer}>
              <div
                className="order-detail-modal__dialog"
                ref={statementDrawerDialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="statement-review-title"
                tabIndex={-1}
                onClick={(event) => event.stopPropagation()}
              >
                <h2 id="statement-review-title" className="sr-only">
                  Revisão do extrato consolidado
                </h2>
                <button
                  ref={statementDrawerCloseRef}
                  type="button"
                  className="order-detail-modal__close"
                  onClick={closeStatementDrawer}
                >
                  <AppIcon name="close" className="h-4 w-4" />
                  Fechar
                </button>
                <div className="app-panel order-detail-modal__panel grid gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="grid gap-1">
                      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-[color:var(--ink-muted)]">
                        Extrato consolidado
                      </p>
                      <h3 className="text-[1.35rem] font-semibold tracking-[-0.05em] text-[color:var(--ink-strong)]">
                        Lançamentos e conciliação
                      </h3>
                    </div>
                    <span className="rounded-full border border-white/80 bg-white/82 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-strong)]">
                      {formatStatementStatusLabel(statementDrawerLatestImport?.status)}
                    </span>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <MetricCard
                      label="Importado"
                      value={
                        statementDrawerLatestImport?.importedAt
                          ? new Date(statementDrawerLatestImport.importedAt).toLocaleDateString(
                              'pt-BR',
                            )
                          : 'Pendente'
                      }
                      tone="ink"
                      meta={statementDrawerLatestImport?.fileName || 'Sem arquivo'}
                    />
                    <MetricCard
                      label="Linhas"
                      value={formatNumber(statementDrawerLatestImport?.transactionCount || 0)}
                      tone="amber"
                      meta={formatCurrencyBR(statementDrawerLatestImport?.inflowTotal || 0)}
                    />
                    <MetricCard
                      label="Match"
                      value={formatNumber(statementDrawerLatestImport?.matchedPaymentsCount || 0)}
                      tone="mint"
                      meta={`${formatNumber(statementDrawerLatestImport?.unmatchedInflowsCount || 0)} sem match`}
                    />
                    <MetricCard
                      label="Saídas"
                      value={formatCurrencyBR(statementDrawerLatestImport?.outflowTotal || 0)}
                      tone="rose"
                      meta={
                        statementDrawerLatestImport?.periodEnd
                          ? `Até ${new Date(statementDrawerLatestImport.periodEnd).toLocaleDateString('pt-BR')}`
                          : 'Cobertura pendente'
                      }
                    />
                  </div>

                  {statementReviewError ? (
                    <div className="rounded-[24px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {statementReviewError}
                    </div>
                  ) : null}

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.8fr)]">
                    <div className="grid gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-[color:var(--ink-strong)]">
                          Lançamentos
                        </p>
                        <span className="text-xs text-neutral-500">
                          {statementReviewLoading
                            ? 'Carregando...'
                            : `${formatNumber(statementReview?.transactions.length || 0)} item(ns)`}
                        </span>
                      </div>

                      {statementReviewLoading && !statementReview ? (
                        <CompactEmpty message="Carregando o extrato..." />
                      ) : statementReview?.transactions.length ? (
                        <div className="overflow-hidden rounded-[24px] border border-white/80 bg-white/88 shadow-[0_10px_24px_rgba(57,39,24,0.06)]">
                          <div className="max-h-[68vh] overflow-auto">
                            <table className="min-w-full divide-y divide-white/80 text-sm">
                              <thead className="sticky top-0 z-10 bg-[rgba(250,247,242,0.96)] backdrop-blur">
                                <tr className="text-left text-[0.68rem] uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                                  <th className="px-4 py-3 font-semibold">Data</th>
                                  <th className="px-4 py-3 font-semibold">Valor</th>
                                  <th className="px-4 py-3 font-semibold">Lançamento</th>
                                  <th className="px-4 py-3 font-semibold">Classificação</th>
                                  <th className="px-4 py-3 font-semibold">Pedido</th>
                                  <th className="px-4 py-3 font-semibold">Ação</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-white/70">
                                {statementReview.transactions.map((transaction) => {
                                  const draft =
                                    statementTransactionDrafts[transaction.id] ||
                                    buildStatementTransactionDraft(
                                      transaction,
                                      statementReview.classificationOptions,
                                    );
                                  const isSaving = statementTransactionSavingId === transaction.id;
                                  const candidates = statementMatchCandidates[transaction.id] || [];
                                  const classificationOptions = (statementReview.classificationOptions || []).filter(
                                    (option) =>
                                      option.active ||
                                      option.code === transaction.classificationCode ||
                                      option.code === transaction.category,
                                  );
                                  const activeMatchBadge = transaction.matchedPaymentLabel
                                    ? transaction.matchedPaymentLabel
                                    : transaction.direction === 'INFLOW'
                                      ? 'Sem match'
                                      : 'Sem pedido';
                                  return (
                                    <tr key={transaction.id} className="align-top">
                                      <td className="px-4 py-3 text-xs text-neutral-500">
                                        <div className="grid gap-1">
                                          <span>{new Date(transaction.bookedAt).toLocaleDateString('pt-BR')}</span>
                                          <span className="rounded-full border border-white/70 bg-white px-2 py-1 text-[0.64rem] font-semibold uppercase tracking-[0.12em] text-[color:var(--ink-strong)]">
                                            {transaction.direction === 'INFLOW' ? 'Entrada' : 'Saída'}
                                          </span>
                                        </div>
                                      </td>
                                      <td className="px-4 py-3">
                                        <div className="grid gap-1">
                                          <strong className="text-[color:var(--ink-strong)]">
                                            {formatCurrencyBR(transaction.amount)}
                                          </strong>
                                          <span
                                            className={`text-[0.72rem] font-medium ${
                                              transaction.matchedPaymentLabel
                                                ? 'text-[color:var(--tone-sage-ink)]'
                                                : transaction.direction === 'INFLOW'
                                                  ? 'text-[color:var(--tone-rose-ink)]'
                                                  : 'text-neutral-500'
                                            }`}
                                          >
                                            {activeMatchBadge}
                                          </span>
                                        </div>
                                      </td>
                                      <td className="px-4 py-3">
                                        <div className="grid gap-1">
                                          <p className="font-medium leading-5 text-[color:var(--ink-strong)]">
                                            {transaction.description}
                                          </p>
                                          <p className="text-xs text-neutral-500">
                                            {transaction.counterpartyName || 'Sem contraparte identificada'}
                                          </p>
                                          <p className="text-[0.72rem] text-neutral-400">
                                            {STATEMENT_CATEGORY_LABELS[transaction.category]}
                                            {transaction.manualClassification ? ' · manual' : ''}
                                            {transaction.manualMatch ? ' · match manual' : ''}
                                          </p>
                                        </div>
                                      </td>
                                      <td className="px-4 py-3">
                                        <input
                                          list={`statement-classification-options-${transaction.id}`}
                                          className="app-input min-w-[220px]"
                                          value={draft.classificationInput}
                                          onChange={(event) =>
                                            setStatementTransactionDraftField(
                                              transaction.id,
                                              'classificationInput',
                                              event.target.value,
                                            )
                                          }
                                        />
                                        <datalist id={`statement-classification-options-${transaction.id}`}>
                                          {classificationOptions.map((option) => (
                                            <option
                                              key={`${transaction.id}-${option.code}`}
                                              value={formatStatementClassificationInputValue(option)}
                                            />
                                          ))}
                                        </datalist>
                                      </td>
                                      <td className="px-4 py-3">
                                        <input
                                          list={`statement-match-options-${transaction.id}`}
                                          className="app-input min-w-[260px]"
                                          value={draft.matchInput}
                                          disabled={transaction.direction !== 'INFLOW'}
                                          placeholder={
                                            transaction.direction === 'INFLOW'
                                              ? 'Pedido # ou nome do cliente'
                                              : 'Sem pedido'
                                          }
                                          onFocus={() => {
                                            if (transaction.direction === 'INFLOW') {
                                              void loadStatementMatchCandidates(transaction.id);
                                            }
                                          }}
                                          onChange={(event) =>
                                            setStatementTransactionDraftField(
                                              transaction.id,
                                              'matchInput',
                                              event.target.value,
                                            )
                                          }
                                        />
                                        <datalist id={`statement-match-options-${transaction.id}`}>
                                          {candidates.map((candidate) => (
                                            <option
                                              key={`${transaction.id}-${candidate.matchType}-${candidate.paymentId ?? candidate.orderId}`}
                                              value={candidate.label}
                                            />
                                          ))}
                                        </datalist>
                                      </td>
                                      <td className="px-4 py-3">
                                        <button
                                          type="button"
                                          className="app-button app-button-primary min-h-11 whitespace-nowrap"
                                          disabled={isSaving}
                                          onClick={() => void handleSaveStatementTransaction(transaction.id)}
                                        >
                                          {isSaving ? 'SALVANDO...' : 'SALVAR'}
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : (
                        <CompactEmpty message="Nenhum lançamento disponível no extrato atual." />
                      )}
                    </div>

                    <div className="grid gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-[color:var(--ink-strong)]">
                          Classificações
                        </p>
                        <span className="text-xs text-neutral-500">
                          {formatNumber(statementReview?.classificationOptions.length || 0)} opção(ões)
                        </span>
                      </div>

                      <div className="grid gap-3 rounded-[24px] border border-white/80 bg-white/84 p-4 shadow-[0_10px_24px_rgba(57,39,24,0.06)]">
                        <div className="grid gap-3">
                          <label className="grid gap-1.5 text-sm text-neutral-600">
                            <span>Nova classificação</span>
                            <input
                              className="app-input"
                              value={newStatementOptionDraft.label}
                              onChange={(event) =>
                                setNewStatementOptionField('label', event.target.value)
                              }
                              placeholder="Ex.: Embalagem atacado"
                            />
                          </label>
                          <label className="grid gap-1.5 text-sm text-neutral-600">
                            <span>Base financeira</span>
                            <select
                              className="app-input"
                              value={newStatementOptionDraft.baseCategory}
                              onChange={(event) =>
                                setNewStatementOptionField(
                                  'baseCategory',
                                  event.target.value as StatementCategory,
                                )
                              }
                            >
                              {Object.entries(STATEMENT_CATEGORY_LABELS).map(([key, label]) => (
                                <option key={`new-option-${key}`} value={key}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex h-12 items-center gap-2 rounded-[16px] border border-white/80 bg-white px-4 text-sm font-medium text-[color:var(--ink-strong)]">
                            <input
                              checked={newStatementOptionDraft.active}
                              onChange={(event) =>
                                setNewStatementOptionField('active', event.target.checked)
                              }
                              type="checkbox"
                            />
                            Ativa
                          </label>
                          <button
                            type="button"
                            className="app-button app-button-primary min-h-12"
                            disabled={statementOptionSavingKey === 'new'}
                            onClick={() => void handleAddStatementOption()}
                          >
                            {statementOptionSavingKey === 'new' ? 'SALVANDO...' : 'ADICIONAR'}
                          </button>
                        </div>
                      </div>

                      {statementReview?.classificationOptions.length ? (
                        <div className="grid gap-3">
                          {statementReview.classificationOptions.map((option) => {
                            const draft =
                              statementOptionDrafts[option.id] || buildStatementOptionDraft(option);
                            const isSaving = statementOptionSavingKey === `existing-${option.id}`;
                            return (
                              <div
                                key={option.id}
                                className="grid gap-3 rounded-[24px] border border-white/80 bg-white/84 p-4 shadow-[0_10px_24px_rgba(57,39,24,0.06)]"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <strong className="text-[color:var(--ink-strong)]">
                                      {option.code}
                                    </strong>
                                    <span className="rounded-full border border-white/70 bg-white px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)]">
                                      {option.system ? 'Sistema' : 'Custom'}
                                    </span>
                                  </div>
                                  <span className="text-xs text-neutral-500">
                                    {STATEMENT_CATEGORY_LABELS[option.baseCategory]}
                                  </span>
                                </div>
                                <div className="grid gap-3">
                                  <label className="grid gap-1.5 text-sm text-neutral-600">
                                    <span>Nome</span>
                                    <input
                                      className="app-input"
                                      value={draft.label}
                                      onChange={(event) =>
                                        setStatementOptionDraftField(
                                          option.id,
                                          'label',
                                          event.target.value,
                                        )
                                      }
                                    />
                                  </label>
                                  <label className="grid gap-1.5 text-sm text-neutral-600">
                                    <span>Base financeira</span>
                                    <select
                                      className="app-input"
                                      value={draft.baseCategory}
                                      onChange={(event) =>
                                        setStatementOptionDraftField(
                                          option.id,
                                          'baseCategory',
                                          event.target.value as StatementCategory,
                                        )
                                      }
                                    >
                                      {Object.entries(STATEMENT_CATEGORY_LABELS).map(([key, label]) => (
                                        <option key={`${option.id}-${key}`} value={key}>
                                          {label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="flex h-12 items-center gap-2 rounded-[16px] border border-white/80 bg-white px-4 text-sm font-medium text-[color:var(--ink-strong)]">
                                    <input
                                      checked={draft.active}
                                      onChange={(event) =>
                                        setStatementOptionDraftField(
                                          option.id,
                                          'active',
                                          event.target.checked,
                                        )
                                      }
                                      type="checkbox"
                                    />
                                    Ativa
                                  </label>
                                  <button
                                    type="button"
                                    className="app-button app-button-ghost min-h-12"
                                    disabled={isSaving}
                                    onClick={() => void handleSaveStatementOption(option.id)}
                                  >
                                    {isSaving ? 'SALVANDO...' : 'SALVAR'}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <CompactEmpty message="Sem classificações disponíveis." />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

        </>
      ) : null}
    </div>
  );
}
