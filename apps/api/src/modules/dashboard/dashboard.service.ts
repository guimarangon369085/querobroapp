import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import {
  CouponResolveRequestSchema,
  CouponResolveResponseSchema,
  CouponSchema,
  CouponUpsertSchema,
  parseMarketingSamplesDiscountPct,
  resolveDisplayNumber,
  roundMoney
} from '@querobroapp/shared';
import { PrismaService } from '../../prisma.service.js';
import { readBusinessRuntimeProfile } from '../../common/business-profile.js';
import { normalizeCouponCode } from '../../common/coupons.js';
import {
  OFFICIAL_BROA_FLAVOR_CODES,
  ORDER_BOX_UNITS,
  emptyOfficialBroaFlavorCounts,
  resolveOfficialBroaFlavorCodeFromProductName,
  type OfficialBroaFlavorCode
} from '../inventory/inventory-formulas.js';

type LoadedOrder = Awaited<ReturnType<DashboardService['loadOrders']>>[number];
type LoadedAnalyticsEvent = Awaited<ReturnType<DashboardService['loadAnalyticsEvents']>>[number];
type LoadedBom = {
  id: number;
  productId: number;
  saleUnitLabel: string | null;
  yieldUnits: number | null;
  items: Array<{
    itemId: number;
    qtyPerRecipe: number | null;
    qtyPerSaleUnit: number | null;
    qtyPerUnit: number | null;
  }>;
};
type LoadedInventoryItem = {
  id: number;
  name: string;
  unit: string;
  purchasePackSize: number;
  purchasePackCost: number;
};
type LoadedInventoryPriceEntry = {
  itemId: number;
  purchasePackSize: number;
  purchasePackCost: number;
  effectiveAt: Date;
};
type LoadedProduct = {
  id: number;
  name: string;
  category: string | null;
  active: boolean;
};
type OfficialBroaFlavorCounts = Record<OfficialBroaFlavorCode, number>;

type DashboardCogsWarningCode = 'BOM_MISSING' | 'BOM_ITEM_MISSING_QTY';

type DashboardCogsWarning = {
  code: DashboardCogsWarningCode;
  orderId: number;
  orderDisplayNumber: number;
  productId: number;
  productName: string;
  message: string;
};

type DashboardOrderIngredientCost = {
  ingredientId: number;
  ingredientName: string;
  unit: string;
  quantity: number;
  unitCost: number;
  amount: number;
};

type DashboardOrderProductCost = {
  productId: number;
  productName: string;
  quantity: number;
  revenue: number;
  cogs: number;
};

type DashboardOrderCogsEntry = {
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
  products: DashboardOrderProductCost[];
  ingredients: DashboardOrderIngredientCost[];
  warnings: Array<{
    code: DashboardCogsWarningCode;
    productId: number;
    productName: string;
    message: string;
  }>;
};

type DashboardIngredientCogsEntry = {
  ingredientId: number;
  ingredientName: string;
  unit: string;
  quantity: number;
  unitCost: number;
  amount: number;
  orderCount: number;
};

type DashboardCogsAuditSummary = {
  windowLabel: string;
  ordersCount: number;
  ingredientsCount: number;
  warningsCount: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
};

type DashboardWindowDays = 1 | 7 | 30;
type DashboardWindowKey = '24h' | '7d' | '30d';

type DashboardWindowSelection = {
  key: DashboardWindowKey;
  days: DashboardWindowDays;
  label: string;
  startsAt: Date;
};

const SAO_PAULO_TIMEZONE = 'America/Sao_Paulo';
const LEGACY_IMPORTED_ORDER_MARKER = '[IMPORTADO_PLANILHA_LEGADA]';
const LEGACY_HISTORICAL_BOX_PRODUCT_KEY = 'CAIXA HISTORICA SEM COMPOSICAO';
const LEGACY_PREMIUM_BROA_FLAVOR_CODES = OFFICIAL_BROA_FLAVOR_CODES.filter(
  (code): code is Exclude<OfficialBroaFlavorCode, 'T'> => code !== 'T'
);
const SUPPORTED_DASHBOARD_WINDOW_DAYS: DashboardWindowDays[] = [1, 7, 30];
const saoPauloFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SAO_PAULO_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function round2(value: number) {
  return roundMoney(value);
}

function round3(value: number) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function normalizeDashboardWindowDays(value?: string | number | null): DashboardWindowDays {
  const parsed = Math.floor(Number(value || 0));
  return SUPPORTED_DASHBOARD_WINDOW_DAYS.includes(parsed as DashboardWindowDays)
    ? (parsed as DashboardWindowDays)
    : 7;
}

function buildDashboardWindowSelection(reference: Date, value?: string | number | null): DashboardWindowSelection {
  const days = normalizeDashboardWindowDays(value);
  return {
    key: days === 1 ? '24h' : days === 7 ? '7d' : '30d',
    days,
    label: days === 1 ? 'Ultimas 24h' : days === 7 ? 'Ultimos 7 dias' : 'Ultimos 30 dias',
    startsAt: new Date(reference.getTime() - days * 24 * 60 * 60 * 1000)
  };
}

function normalizeLegacyText(value?: string | null) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function isLegacyImportedOrder(value?: string | null) {
  return String(value || '').includes(LEGACY_IMPORTED_ORDER_MARKER);
}

function isLegacyHistoricalBoxName(value?: string | null) {
  return normalizeLegacyText(value).includes(LEGACY_HISTORICAL_BOX_PRODUCT_KEY);
}

function cloneFlavorCounts(
  source?: Partial<Record<OfficialBroaFlavorCode, number>> | null
): OfficialBroaFlavorCounts {
  const counts = emptyOfficialBroaFlavorCounts();
  for (const code of OFFICIAL_BROA_FLAVOR_CODES) {
    counts[code] = Math.max(Math.floor(Number(source?.[code] || 0)), 0);
  }
  return counts;
}

function sumFlavorCounts(source?: Partial<Record<OfficialBroaFlavorCode, number>> | null) {
  return OFFICIAL_BROA_FLAVOR_CODES.reduce(
    (sum, code) => sum + Math.max(Math.floor(Number(source?.[code] || 0)), 0),
    0
  );
}

function addFlavorCounts(
  target: OfficialBroaFlavorCounts,
  source?: Partial<Record<OfficialBroaFlavorCode, number>> | null
) {
  for (const code of OFFICIAL_BROA_FLAVOR_CODES) {
    target[code] += Math.max(Math.floor(Number(source?.[code] || 0)), 0);
  }
}

function buildExactFlavorBoxCounts(code: OfficialBroaFlavorCode) {
  const counts = emptyOfficialBroaFlavorCounts();
  counts[code] = ORDER_BOX_UNITS;
  return counts;
}

function buildExactMixedFlavorBoxCounts(code: Exclude<OfficialBroaFlavorCode, 'T'>) {
  const counts = emptyOfficialBroaFlavorCounts();
  counts.T = 4;
  counts[code] = 3;
  return counts;
}

function allocateWeightedFlavorCounts(params: {
  weights?: Partial<Record<OfficialBroaFlavorCode, number>> | null;
  totalUnits: number;
  availableCodes?: OfficialBroaFlavorCode[];
}) {
  const totalUnits = Math.max(Math.floor(Number(params.totalUnits || 0)), 0);
  const availableCodes =
    params.availableCodes && params.availableCodes.length > 0
      ? params.availableCodes
      : [...OFFICIAL_BROA_FLAVOR_CODES];
  const counts = emptyOfficialBroaFlavorCounts();
  if (totalUnits <= 0 || availableCodes.length <= 0) {
    return counts;
  }

  const weightedCodes = availableCodes.filter((code) => Number(params.weights?.[code] || 0) > 0);
  const candidateCodes = weightedCodes.length > 0 ? weightedCodes : availableCodes;
  const totalWeight = candidateCodes.reduce((sum, code) => sum + Number(params.weights?.[code] || 0), 0);
  const useEqualShare = totalWeight <= 0;
  const rawEntries = candidateCodes.map((code, index) => {
    const raw = useEqualShare
      ? totalUnits / candidateCodes.length
      : (totalUnits * Number(params.weights?.[code] || 0)) / totalWeight;
    const floor = Math.floor(raw);
    counts[code] = floor;
    return {
      code,
      index,
      remainder: raw - floor
    };
  });

  let allocated = sumFlavorCounts(counts);
  let remaining = Math.max(totalUnits - allocated, 0);
  rawEntries.sort(
    (left, right) => right.remainder - left.remainder || left.index - right.index
  );

  while (remaining > 0 && rawEntries.length > 0) {
    for (const entry of rawEntries) {
      if (remaining <= 0) break;
      counts[entry.code] += 1;
      remaining -= 1;
    }
  }

  return counts;
}

function replaceLegacyFlavorNamesWithCodes(value: string) {
  return value
    .replace(/REQUEIJAO DE CORTE/g, 'R')
    .replace(/REQUEIJAO/g, 'R')
    .replace(/QUEIJO DO SERRO/g, 'Q')
    .replace(/QUEIJO/g, 'Q')
    .replace(/DOCE DE LEITE/g, 'D')
    .replace(/GOIABADA/g, 'G')
    .replace(/TRADICIONAL/g, 'T');
}

function parseLegacyBoxSegment(params: {
  rawSegment: string;
  genericProxyWeights: OfficialBroaFlavorCounts;
  premiumProxyWeights: OfficialBroaFlavorCounts;
  availableCodes: OfficialBroaFlavorCode[];
}) {
  const normalizedSegment = normalizeLegacyText(params.rawSegment);
  if (!normalizedSegment) return emptyOfficialBroaFlavorCounts();

  if (normalizedSegment === 'SABORES' || normalizedSegment === 'M') {
    return allocateWeightedFlavorCounts({
      weights: params.genericProxyWeights,
      totalUnits: ORDER_BOX_UNITS,
      availableCodes: params.availableCodes
    });
  }

  if (normalizedSegment === '2 CADA' || normalizedSegment === '2 DE CADA') {
    const premiumAvailableCodes = params.availableCodes.filter((code) => code !== 'T');
    return allocateWeightedFlavorCounts({
      weights: params.premiumProxyWeights,
      totalUnits: ORDER_BOX_UNITS,
      availableCodes: premiumAvailableCodes
    });
  }

  if (/^[TGDQR]$/.test(normalizedSegment)) {
    return buildExactFlavorBoxCounts(normalizedSegment as OfficialBroaFlavorCode);
  }

  const exactMixedMatch = normalizedSegment.match(/^M([GDQR])$/);
  if (exactMixedMatch) {
    return buildExactMixedFlavorBoxCounts(exactMixedMatch[1] as Exclude<OfficialBroaFlavorCode, 'T'>);
  }

  const mixedWithModifierMatch = normalizedSegment.match(/^M([GDQR])(?:\s*[-+]\s*(.+))$/);
  if (mixedWithModifierMatch) {
    const primaryCode = mixedWithModifierMatch[1] as Exclude<OfficialBroaFlavorCode, 'T'>;
    const counts = buildExactMixedFlavorBoxCounts(primaryCode);
    const modifierText = replaceLegacyFlavorNamesWithCodes(mixedWithModifierMatch[2] || '');
    const replacementCodes = [
      ...modifierText.matchAll(/\b(\d+)\s*([TGDQR])\b/g),
      ...modifierText.matchAll(/\b([TGDQR])\s*x\s*(\d+)\b/g),
      ...modifierText.matchAll(/\b(\d+)([TGDQR])\b/g)
    ].flatMap((match) => {
      if (match.length < 3) return [];
      const left = match[1] || '';
      const right = match[2] || '';
      const quantity = /^\d+$/.test(left) ? Number(left) : Number(right);
      const code = (/^[TGDQR]$/.test(left) ? left : right) as OfficialBroaFlavorCode;
      if (!quantity || !code) return [];
      return Array.from({ length: quantity }, () => code);
    });

    if (replacementCodes.length === 0) {
      const compactTail = modifierText.replace(/[^TGDQR]/g, '');
      for (const code of compactTail) {
        replacementCodes.push(code as OfficialBroaFlavorCode);
      }
    }

    for (const code of replacementCodes) {
      const donorCode =
        counts[primaryCode] > 0
          ? primaryCode
          : counts.T > 0
            ? 'T'
            : OFFICIAL_BROA_FLAVOR_CODES.find((candidate) => counts[candidate] > 0) || null;
      if (!donorCode) continue;
      counts[donorCode] = Math.max(counts[donorCode] - 1, 0);
      counts[code] += 1;
    }

    return counts;
  }

  const explicitCounts = emptyOfficialBroaFlavorCounts();
  const explicitWeights = emptyOfficialBroaFlavorCounts();
  const mentionOrder = replaceLegacyFlavorNamesWithCodes(normalizedSegment)
    .match(/[TGDQR]/g)
    ?.map((entry) => entry as OfficialBroaFlavorCode)
    .filter((code, index, values) => values.indexOf(code) === index) || [];
  let codeText = replaceLegacyFlavorNamesWithCodes(normalizedSegment)
    .replace(/\bCOLOCAR\b/g, ' ')
    .replace(/\bEXTRAS?\b/g, ' ');

  const consumeExplicitMatch = (quantity: number, code: string) => {
    if (!Number.isFinite(quantity) || quantity <= 0 || !/^[TGDQR]$/.test(code)) return;
    const flavorCode = code as OfficialBroaFlavorCode;
    explicitCounts[flavorCode] += quantity;
    explicitWeights[flavorCode] += quantity;
  };

  codeText = codeText.replace(/\b(\d+)\s*([TGDQR])\b/g, (_match, rawQty, rawCode) => {
    consumeExplicitMatch(Number(rawQty), rawCode);
    return ' ';
  });
  codeText = codeText.replace(/\b([TGDQR])\s*x\s*(\d+)\b/g, (_match, rawCode, rawQty) => {
    consumeExplicitMatch(Number(rawQty), rawCode);
    return ' ';
  });
  codeText = codeText.replace(/\b(\d+)([TGDQR])\b/g, (_match, rawQty, rawCode) => {
    consumeExplicitMatch(Number(rawQty), rawCode);
    return ' ';
  });

  const compactCodes = codeText.replace(/[^TGDQR]/g, '');
  if (compactCodes.length >= 2 && compactCodes.length <= 3 && /^[TGDQR]+$/.test(compactCodes)) {
    for (const rawCode of compactCodes) {
      const flavorCode = rawCode as OfficialBroaFlavorCode;
      explicitCounts[flavorCode] += 1;
      explicitWeights[flavorCode] += 1;
    }
  } else {
    for (const match of codeText.matchAll(/\b([TGDQR])\b/g)) {
      const flavorCode = match[1] as OfficialBroaFlavorCode;
      explicitCounts[flavorCode] += 1;
      explicitWeights[flavorCode] += 1;
    }
  }

  const baseUnits = sumFlavorCounts(explicitCounts);
  const orderedExplicitCodes = mentionOrder.filter((code) => Number(explicitWeights[code] || 0) > 0);
  if (baseUnits >= ORDER_BOX_UNITS) {
    return allocateWeightedFlavorCounts({
      weights: explicitCounts,
      totalUnits: ORDER_BOX_UNITS,
      availableCodes: orderedExplicitCodes.length > 0 ? orderedExplicitCodes : params.availableCodes
    });
  }

  const allocationSource = sumFlavorCounts(explicitWeights) > 0 ? explicitWeights : params.genericProxyWeights;
  const weightedAvailableCodes = params.availableCodes.filter((code) => Number(allocationSource[code] || 0) > 0);
  const allocationCodes =
    orderedExplicitCodes.length > 0
      ? orderedExplicitCodes
      : weightedAvailableCodes;
  addFlavorCounts(
    explicitCounts,
    allocateWeightedFlavorCounts({
      weights: allocationSource,
      totalUnits: ORDER_BOX_UNITS - baseUnits,
      availableCodes: allocationCodes.length > 0 ? allocationCodes : params.availableCodes
    })
  );
  return explicitCounts;
}

function buildLegacyHistoricalFlavorCounts(params: {
  notes?: string | null;
  placeholderBoxCount: number;
  actualFlavorCounts: OfficialBroaFlavorCounts;
  genericProxyWeights: OfficialBroaFlavorCounts;
  premiumProxyWeights: OfficialBroaFlavorCounts;
  availableCodes: OfficialBroaFlavorCode[];
}) {
  const targetUnits = Math.max(Math.floor(params.placeholderBoxCount || 0), 0) * ORDER_BOX_UNITS;
  if (targetUnits <= 0) return emptyOfficialBroaFlavorCounts();

  const noteText = String(params.notes || '');
  const boxesMatch = noteText.match(/caixas=([^\n]+)/i);
  const parsedFlavorCounts = emptyOfficialBroaFlavorCounts();

  if (boxesMatch?.[1]) {
    for (const rawSegment of boxesMatch[1].split(/\s*\|\s*/)) {
      addFlavorCounts(
        parsedFlavorCounts,
        parseLegacyBoxSegment({
          rawSegment,
          genericProxyWeights: params.genericProxyWeights,
          premiumProxyWeights: params.premiumProxyWeights,
          availableCodes: params.availableCodes
        })
      );
    }
  }

  const unresolvedFlavorCounts = emptyOfficialBroaFlavorCounts();
  for (const code of OFFICIAL_BROA_FLAVOR_CODES) {
    unresolvedFlavorCounts[code] = Math.max(
      parsedFlavorCounts[code] - Math.max(Math.floor(params.actualFlavorCounts[code] || 0), 0),
      0
    );
  }

  const unresolvedUnits = sumFlavorCounts(unresolvedFlavorCounts);
  if (unresolvedUnits === targetUnits) {
    return unresolvedFlavorCounts;
  }

  if (unresolvedUnits > 0) {
    return allocateWeightedFlavorCounts({
      weights: unresolvedFlavorCounts,
      totalUnits: targetUnits,
      availableCodes: params.availableCodes
    });
  }

  return allocateWeightedFlavorCounts({
    weights:
      sumFlavorCounts(parsedFlavorCounts) > 0 ? parsedFlavorCounts : params.genericProxyWeights,
    totalUnits: targetUnits,
    availableCodes: params.availableCodes
  });
}

function readSaoPauloParts(reference: Date): ZonedDateParts {
  const rawParts = saoPauloFormatter.formatToParts(reference);
  const map = Object.fromEntries(rawParts.map((entry) => [entry.type, entry.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

function resolveSaoPauloOffsetMilliseconds(reference: Date) {
  const zoned = readSaoPauloParts(reference);
  const zonedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second, 0);
  return zonedAsUtc - reference.getTime();
}

function saoPauloDateTimeToUtc(
  parts: Pick<ZonedDateParts, 'year' | 'month' | 'day' | 'hour' | 'minute'> & { second?: number }
) {
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second ?? 0, 0);
  const firstOffset = resolveSaoPauloOffsetMilliseconds(new Date(utcGuess));
  let adjusted = utcGuess - firstOffset;
  const secondOffset = resolveSaoPauloOffsetMilliseconds(new Date(adjusted));
  if (secondOffset !== firstOffset) {
    adjusted = utcGuess - secondOffset;
  }
  return new Date(adjusted);
}

function toDayKey(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);
}

function isPublicPath(path?: string | null) {
  return path === '/' || Boolean(path && path.startsWith('/pedido'));
}

function toPercent(numerator: number, denominator: number) {
  if (!denominator || !Number.isFinite(denominator)) return 0;
  return round2((numerator / denominator) * 100);
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rawIndex = (percentileValue / 100) * (sorted.length - 1);
  const lower = Math.floor(rawIndex);
  const upper = Math.ceil(rawIndex);
  if (lower === upper) return round2(sorted[lower] || 0);
  const ratio = rawIndex - lower;
  return round2((sorted[lower] || 0) + ((sorted[upper] || 0) - (sorted[lower] || 0)) * ratio);
}

function median(values: number[]) {
  return percentile(values, 50);
}

function sumBy<T>(items: T[], iteratee: (item: T) => number) {
  return items.reduce((sum, item) => sum + iteratee(item), 0);
}

function pushMapValue(map: Map<string, number[]>, key: string, value: number) {
  const current = map.get(key) || [];
  current.push(value);
  map.set(key, current);
}

function parseSaleUnits(label?: string | null) {
  if (!label) return 1;
  const match = label.match(/(\d+)/);
  const parsed = match ? Number(match[1]) : 1;
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return parsed;
}

function perOrderedUnitQty(
  bom: {
    saleUnitLabel?: string | null;
    yieldUnits?: number | null;
  },
  bomItem: {
    qtyPerSaleUnit?: number | null;
    qtyPerUnit?: number | null;
    qtyPerRecipe?: number | null;
  }
) {
  if (bomItem.qtyPerUnit != null && bomItem.qtyPerUnit > 0) return bomItem.qtyPerUnit;
  const unitsPerSale = parseSaleUnits(bom.saleUnitLabel);
  if (bomItem.qtyPerSaleUnit != null && bomItem.qtyPerSaleUnit > 0) {
    return unitsPerSale > 0 ? bomItem.qtyPerSaleUnit / unitsPerSale : bomItem.qtyPerSaleUnit;
  }
  if (bomItem.qtyPerRecipe != null && bomItem.qtyPerRecipe > 0 && bom.yieldUnits && bom.yieldUnits > 0) {
    return bomItem.qtyPerRecipe / bom.yieldUnits;
  }
  return null;
}

function unitCostFromPack(purchasePackCost: number, purchasePackSize: number) {
  if (!Number.isFinite(purchasePackCost) || !Number.isFinite(purchasePackSize) || purchasePackSize <= 0) return 0;
  return purchasePackCost / purchasePackSize;
}

function formatSourceLabel(event: LoadedAnalyticsEvent) {
  if (event.source) {
    const medium = event.medium ? ` / ${event.medium}` : '';
    return `${event.source}${medium}`;
  }
  if (event.referrerHost) return event.referrerHost;
  return 'Direto';
}

type IntegrationStatus = 'READY' | 'PENDING';

type IntegrationRail = {
  id: string;
  label: string;
  status: IntegrationStatus;
  detail: string;
  nextStep: string;
};

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private formatCouponRecord(coupon: {
    id: number;
    code: string;
    discountPct: number;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return CouponSchema.parse({
      id: coupon.id,
      code: coupon.code,
      discountPct: round2(coupon.discountPct),
      active: coupon.active,
      createdAt: coupon.createdAt.toISOString(),
      updatedAt: coupon.updatedAt.toISOString()
    });
  }

  private hasEnv(name: string) {
    return Boolean(String(process.env[name] || '').trim());
  }

  private hasAnyEnv(names: string[]) {
    return names.some((name) => this.hasEnv(name));
  }

  async listCoupons() {
    const coupons = await this.prisma.coupon.findMany({
      orderBy: [{ active: 'desc' }, { code: 'asc' }]
    });
    return coupons.map((coupon) => this.formatCouponRecord(coupon));
  }

  async createCoupon(payload: unknown) {
    const parsed = CouponUpsertSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const data = parsed.data;
    const code = normalizeCouponCode(data.code);
    if (!code) {
      throw new BadRequestException('Codigo do cupom obrigatorio.');
    }
    try {
      const created = await this.prisma.coupon.create({
        data: {
          code,
          discountPct: round2(data.discountPct),
          active: data.active
        }
      });
      return this.formatCouponRecord(created);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        throw new ConflictException('Codigo do cupom ja cadastrado.');
      }
      throw error;
    }
  }

  async updateCoupon(id: number, payload: unknown) {
    const parsed = CouponUpsertSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const data = parsed.data;
    const code = normalizeCouponCode(data.code);
    if (!code) {
      throw new BadRequestException('Codigo do cupom obrigatorio.');
    }
    const existing = await this.prisma.coupon.findUnique({
      where: { id }
    });
    if (!existing) {
      throw new NotFoundException('Cupom nao encontrado.');
    }
    try {
      const updated = await this.prisma.coupon.update({
        where: { id },
        data: {
          code,
          discountPct: round2(data.discountPct),
          active: data.active
        }
      });
      return this.formatCouponRecord(updated);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        throw new ConflictException('Codigo do cupom ja cadastrado.');
      }
      throw error;
    }
  }

  async removeCoupon(id: number) {
    try {
      await this.prisma.coupon.delete({
        where: { id }
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
        throw new NotFoundException('Cupom nao encontrado.');
      }
      throw error;
    }
  }

  async resolveCoupon(payload: unknown) {
    const parsed = CouponResolveRequestSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const data = parsed.data;
    const code = normalizeCouponCode(data.code);
    if (!code) {
      throw new BadRequestException('Informe um codigo de cupom valido.');
    }
    const coupon = await this.prisma.coupon.findFirst({
      where: {
        code
      }
    });
    const activeCouponsCount = await this.prisma.coupon.count({
      where: {
        active: true
      }
    });
    if (!coupon) {
      this.logger.warn(
        JSON.stringify({
          event: 'coupon_resolve_failed',
          reason: activeCouponsCount > 0 ? 'CODE_NOT_FOUND' : 'NO_ACTIVE_COUPONS',
          code,
          subtotal: round2(data.subtotal),
          activeCouponsCount
        })
      );
      throw new BadRequestException(
        activeCouponsCount > 0
          ? `Cupom ${code} nao encontrado entre os cupons ativos.`
          : 'Nenhum cupom ativo cadastrado no momento.'
      );
    }
    if (!coupon.active) {
      this.logger.warn(
        JSON.stringify({
          event: 'coupon_resolve_failed',
          reason: 'COUPON_INACTIVE',
          code,
          subtotal: round2(data.subtotal),
          activeCouponsCount
        })
      );
      throw new BadRequestException(`Cupom ${code} esta inativo.`);
    }
    const subtotal = round2(data.subtotal);
    const discountAmount = round2((subtotal * round2(coupon.discountPct)) / 100);
    return CouponResolveResponseSchema.parse({
      code: coupon.code,
      discountPct: round2(coupon.discountPct),
      subtotal,
      discountAmount,
      subtotalAfterDiscount: round2(Math.max(subtotal - discountAmount, 0))
    });
  }

  private buildIdentitySummary() {
    const profile = readBusinessRuntimeProfile();
    return {
      brandName: profile.brandName,
      legalName: profile.legalName,
      cnpj: profile.cnpj,
      cnpjDisplay: profile.cnpjDisplay,
      officialPhoneDisplay: profile.officialPhoneDisplay,
      pixKey: profile.pixKey,
      pickupAddressDisplay: profile.pickupAddressDisplay,
      bank: profile.bank
    };
  }

  private buildIntegrationRails() {
    const hasRealtimeBankWebhook = this.hasAnyEnv(['BANK_SYNC_WEBHOOK_TOKEN']);
    const rails: IntegrationRail[] = [
      {
        id: 'pix_settlement_bridge',
        label: 'Bridge Nubank Web',
        status: hasRealtimeBankWebhook ? 'READY' : 'PENDING',
        detail: hasRealtimeBankWebhook
          ? 'Bridge local do Nubank PJ armado para ler o webapp autenticado e reconciliar PIX no backend.'
          : 'Backend pronto para receber conciliacao segura a partir do webapp autenticado do Nubank PJ.',
        nextStep: 'Definir BANK_SYNC_WEBHOOK_TOKEN e manter a sessao autenticada do Nubank PJ no Mac operacional.'
      }
    ];

    return {
      readyCount: rails.filter((item) => item.status === 'READY').length,
      pendingCount: rails.filter((item) => item.status === 'PENDING').length,
      items: rails
    };
  }

  private buildOrderCogsBreakdown(params: {
    rangeOrders: LoadedOrder[];
    boms: LoadedBom[];
    inventoryItems: LoadedInventoryItem[];
    priceEntries: LoadedInventoryPriceEntry[];
    products: LoadedProduct[];
  }) {
    const { rangeOrders, boms, inventoryItems, priceEntries, products } = params;
    const latestBomByProductId = new Map<number, LoadedBom>();
    for (const bom of boms) {
      if (!latestBomByProductId.has(bom.productId)) {
        latestBomByProductId.set(bom.productId, bom);
      }
    }

    const inventoryItemById = new Map(inventoryItems.map((item) => [item.id, item]));
    const priceEntriesByItemId = new Map<number, LoadedInventoryPriceEntry[]>();
    for (const entry of priceEntries) {
      const current = priceEntriesByItemId.get(entry.itemId) || [];
      current.push(entry);
      priceEntriesByItemId.set(entry.itemId, current);
    }

    const resolveIngredientUnitCost = (inventoryItem: LoadedInventoryItem, orderCreatedAt: Date) => {
      const itemPriceEntries = priceEntriesByItemId.get(inventoryItem.id) || [];
      const applicablePriceEntry =
        [...itemPriceEntries]
          .reverse()
          .find((entry) => entry.effectiveAt.getTime() <= orderCreatedAt.getTime()) || null;
      const averageHistoricalUnitCost =
        itemPriceEntries.length > 0
          ? itemPriceEntries.reduce(
              (sum, entry) => sum + unitCostFromPack(entry.purchasePackCost, entry.purchasePackSize),
              0
            ) / itemPriceEntries.length
          : 0;
      return applicablePriceEntry
        ? unitCostFromPack(applicablePriceEntry.purchasePackCost, applicablePriceEntry.purchasePackSize)
        : averageHistoricalUnitCost > 0
          ? averageHistoricalUnitCost
          : unitCostFromPack(inventoryItem.purchasePackCost, inventoryItem.purchasePackSize);
    };

    const accumulateProductUnitsCost = (params: {
      productId: number;
      units: number;
      orderCreatedAt: Date;
      ingredientMap: Map<number, DashboardOrderIngredientCost>;
    }) => {
      const bom = latestBomByProductId.get(params.productId);
      if (!bom) {
        return {
          cogs: 0,
          hasBom: false,
          hasMissingQty: false
        };
      }

      let totalAmount = 0;
      let hasMissingQty = false;

      for (const bomItem of bom.items) {
        // Order item quantities are stored in broas, not in boxes.
        const perUnit = perOrderedUnitQty(bom, bomItem);
        if (perUnit == null) {
          hasMissingQty = true;
          continue;
        }

        const inventoryItem = inventoryItemById.get(bomItem.itemId);
        if (!inventoryItem) continue;

        const ingredientQty = perUnit * params.units;
        const unitCost = resolveIngredientUnitCost(inventoryItem, params.orderCreatedAt);
        const amount = ingredientQty * unitCost;
        totalAmount += amount;

        const ingredientEntry = params.ingredientMap.get(inventoryItem.id) || {
          ingredientId: inventoryItem.id,
          ingredientName: inventoryItem.name,
          unit: inventoryItem.unit,
          quantity: 0,
          unitCost: round3(unitCost),
          amount: 0
        };
        ingredientEntry.quantity = round3(ingredientEntry.quantity + ingredientQty);
        ingredientEntry.amount = round2(ingredientEntry.amount + amount);
        params.ingredientMap.set(inventoryItem.id, ingredientEntry);
      }

      return {
        cogs: round2(totalAmount),
        hasBom: true,
        hasMissingQty
      };
    };

    const officialFlavorProductCandidates = products
      .map((product) => ({
        product,
        flavorCode: resolveOfficialBroaFlavorCodeFromProductName(product.name),
        hasBom: latestBomByProductId.has(product.id)
      }))
      .filter(
        (
          entry
        ): entry is {
          product: LoadedProduct;
          flavorCode: OfficialBroaFlavorCode;
          hasBom: boolean;
        } => Boolean(entry.flavorCode)
      )
      .sort((left, right) => {
        const activeDelta = Number(right.product.active !== false) - Number(left.product.active !== false);
        if (activeDelta !== 0) return activeDelta;
        const categoryDelta =
          Number(normalizeLegacyText(right.product.category) === 'SABORES') -
          Number(normalizeLegacyText(left.product.category) === 'SABORES');
        if (categoryDelta !== 0) return categoryDelta;
        const bomDelta = Number(right.hasBom) - Number(left.hasBom);
        if (bomDelta !== 0) return bomDelta;
        return left.product.id - right.product.id;
      });

    const officialFlavorProductByCode = new Map<
      OfficialBroaFlavorCode,
      {
        productId: number;
        productName: string;
      }
    >();
    for (const candidate of officialFlavorProductCandidates) {
      if (!candidate.hasBom || officialFlavorProductByCode.has(candidate.flavorCode)) continue;
      officialFlavorProductByCode.set(candidate.flavorCode, {
        productId: candidate.product.id,
        productName: candidate.product.name
      });
    }
    const availableOfficialFlavorCodes = OFFICIAL_BROA_FLAVOR_CODES.filter((code) =>
      officialFlavorProductByCode.has(code)
    );

    const genericLegacyProxyWeights = emptyOfficialBroaFlavorCounts();
    for (const code of availableOfficialFlavorCodes) {
      genericLegacyProxyWeights[code] = 1;
    }
    for (const order of rangeOrders) {
      for (const item of order.items) {
        if (isLegacyImportedOrder(order.notes) && isLegacyHistoricalBoxName(item.product?.name)) {
          continue;
        }
        const flavorCode = resolveOfficialBroaFlavorCodeFromProductName(item.product?.name);
        if (!flavorCode || !officialFlavorProductByCode.has(flavorCode)) continue;
        genericLegacyProxyWeights[flavorCode] += Math.max(Math.floor(item.quantity || 0), 0);
      }
    }
    const premiumLegacyProxyWeights = emptyOfficialBroaFlavorCounts();
    for (const code of LEGACY_PREMIUM_BROA_FLAVOR_CODES) {
      premiumLegacyProxyWeights[code] =
        genericLegacyProxyWeights[code] > 0 ? genericLegacyProxyWeights[code] : 1;
    }

    const ingredientTotals = new Map<number, DashboardIngredientCogsEntry>();
    const orderEntries: DashboardOrderCogsEntry[] = [];
    const warnings: DashboardCogsWarning[] = [];

    for (const order of rangeOrders) {
      const ingredientMap = new Map<number, DashboardOrderIngredientCost>();
      const productMap = new Map<number, DashboardOrderProductCost>();
      const orderWarnings: DashboardOrderCogsEntry['warnings'] = [];
      const warningKeys = new Set<string>();
      const orderDisplayNumber = resolveDisplayNumber(order) ?? order.id;
      const customerName =
        order.customer?.name ||
        `Cliente #${resolveDisplayNumber(order.customer) ?? order.customerId}`;

      const pushWarning = (
        code: DashboardCogsWarningCode,
        productId: number,
        productName: string,
        message: string
      ) => {
        const key = `${code}:${productId}`;
        if (warningKeys.has(key)) return;
        warningKeys.add(key);
        orderWarnings.push({ code, productId, productName, message });
        warnings.push({
          code,
          orderId: order.id,
          orderDisplayNumber,
          productId,
          productName,
          message
        });
      };

      let totalUnits = 0;
      const legacyImportedOrder = isLegacyImportedOrder(order.notes);
      const actualFlavorCounts = emptyOfficialBroaFlavorCounts();
      let legacyPlaceholderBoxCount = 0;

      for (const item of order.items) {
        const quantity = Math.max(item.quantity || 0, 0);
        if (quantity <= 0) continue;
        if (legacyImportedOrder && isLegacyHistoricalBoxName(item.product?.name)) {
          legacyPlaceholderBoxCount += quantity;
          continue;
        }
        const flavorCode = resolveOfficialBroaFlavorCodeFromProductName(item.product?.name);
        if (!flavorCode || !officialFlavorProductByCode.has(flavorCode)) continue;
        actualFlavorCounts[flavorCode] += quantity;
      }

      const legacyHistoricalFlavorCounts =
        legacyImportedOrder && legacyPlaceholderBoxCount > 0
          ? buildLegacyHistoricalFlavorCounts({
              notes: order.notes,
              placeholderBoxCount: legacyPlaceholderBoxCount,
              actualFlavorCounts,
              genericProxyWeights: genericLegacyProxyWeights,
              premiumProxyWeights: premiumLegacyProxyWeights,
              availableCodes: availableOfficialFlavorCodes
            })
          : emptyOfficialBroaFlavorCounts();
      const legacyHistoricalUnits = sumFlavorCounts(legacyHistoricalFlavorCounts);
      let legacyHistoricalCostApplied = false;

      for (const item of order.items) {
        const quantity = Math.max(item.quantity || 0, 0);
        const productName = item.product?.name || `Produto #${item.productId}`;
        const revenue = round2(item.total || (item.unitPrice || 0) * quantity);
        const productEntry = productMap.get(item.productId) || {
          productId: item.productId,
          productName,
          quantity: 0,
          revenue: 0,
          cogs: 0
        };
        productEntry.quantity += quantity;
        productEntry.revenue = round2(productEntry.revenue + revenue);

        const legacyHistoricalItem = legacyImportedOrder && isLegacyHistoricalBoxName(item.product?.name);
        if (legacyHistoricalItem) {
          if (!legacyHistoricalCostApplied) {
            totalUnits += legacyHistoricalUnits;
            let legacyItemCogs = 0;

            for (const code of availableOfficialFlavorCodes) {
              const units = Math.max(Math.floor(legacyHistoricalFlavorCounts[code] || 0), 0);
              if (units <= 0) continue;
              const officialProduct = officialFlavorProductByCode.get(code);
              if (!officialProduct) continue;

              const costResult = accumulateProductUnitsCost({
                productId: officialProduct.productId,
                units,
                orderCreatedAt: order.createdAt,
                ingredientMap
              });
              if (!costResult.hasBom) {
                pushWarning(
                  'BOM_MISSING',
                  officialProduct.productId,
                  officialProduct.productName,
                  'Produto sem ficha técnica ativa no COGS.'
                );
                continue;
              }
              if (costResult.hasMissingQty) {
                pushWarning(
                  'BOM_ITEM_MISSING_QTY',
                  officialProduct.productId,
                  officialProduct.productName,
                  'Ficha técnica com ingrediente sem quantidade suficiente para o COGS.'
                );
              }
              legacyItemCogs = round2(legacyItemCogs + costResult.cogs);
            }

            productEntry.cogs = round2(productEntry.cogs + legacyItemCogs);
            legacyHistoricalCostApplied = true;
          }
          productMap.set(item.productId, productEntry);
          continue;
        }

        totalUnits += quantity;
        const costResult = accumulateProductUnitsCost({
          productId: item.productId,
          units: quantity,
          orderCreatedAt: order.createdAt,
          ingredientMap
        });
        if (!costResult.hasBom) {
          pushWarning(
            'BOM_MISSING',
            item.productId,
            productName,
            'Produto sem ficha técnica ativa no COGS.'
          );
          productMap.set(item.productId, productEntry);
          continue;
        }

        if (costResult.hasMissingQty) {
          pushWarning(
            'BOM_ITEM_MISSING_QTY',
            item.productId,
            productName,
            'Ficha técnica com ingrediente sem quantidade suficiente para o COGS.'
          );
        }

        productEntry.cogs = round2(productEntry.cogs + costResult.cogs);
        productMap.set(item.productId, productEntry);
      }

      const orderIngredients = [...ingredientMap.values()]
        .map((entry) => ({
          ...entry,
          quantity: round3(entry.quantity),
          unitCost: round3(entry.unitCost),
          amount: round2(entry.amount)
        }))
        .sort((left, right) => right.amount - left.amount || left.ingredientName.localeCompare(right.ingredientName, 'pt-BR'));

      for (const ingredient of orderIngredients) {
        const aggregate = ingredientTotals.get(ingredient.ingredientId) || {
          ingredientId: ingredient.ingredientId,
          ingredientName: ingredient.ingredientName,
          unit: ingredient.unit,
          quantity: 0,
          unitCost: ingredient.unitCost,
          amount: 0,
          orderCount: 0
        };
        aggregate.quantity = round3(aggregate.quantity + ingredient.quantity);
        aggregate.amount = round2(aggregate.amount + ingredient.amount);
        aggregate.orderCount += 1;
        ingredientTotals.set(ingredient.ingredientId, aggregate);
      }

      const orderRevenue = Math.max(round2(order.subtotal || 0) - round2(order.discount || 0), 0);
      const orderCogs = round2(sumBy(orderIngredients, (entry) => entry.amount));
      orderEntries.push({
        orderId: order.id,
        orderDisplayNumber,
        customerName,
        createdAt: order.createdAt.toISOString(),
        scheduledAt: order.scheduledAt?.toISOString() || null,
        status: order.status,
        itemsCount: order.items.length,
        units: totalUnits,
        revenue: round2(orderRevenue),
        cogs: orderCogs,
        grossProfit: round2(orderRevenue - orderCogs),
        products: [...productMap.values()]
          .map((entry) => ({
            ...entry,
            cogs: round2(entry.cogs),
            revenue: round2(entry.revenue)
          }))
          .sort((left, right) => right.cogs - left.cogs || right.revenue - left.revenue),
        ingredients: orderIngredients,
        warnings: orderWarnings
      });
    }

    return {
      orders: orderEntries.sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime() ||
          right.orderId - left.orderId
      ),
      ingredients: [...ingredientTotals.values()]
        .map((entry) => ({
          ...entry,
          quantity: round3(entry.quantity),
          unitCost: round3(entry.unitCost),
          amount: round2(entry.amount)
        }))
        .sort((left, right) => right.amount - left.amount || left.ingredientName.localeCompare(right.ingredientName, 'pt-BR')),
      warnings
    };
  }

  private loadAnalyticsEvents() {
    return this.prisma.siteAnalyticsEvent.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
  }

  private loadOrders() {
    return this.prisma.order.findMany({
      include: {
        customer: true,
        payments: true,
        items: {
          include: {
            product: true
          }
        }
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
  }

  async getSummary(options?: { days?: string | number | null }) {
    const asOf = new Date();
    const selectedWindow = buildDashboardWindowSelection(asOf, options?.days);
    const [events, orders, customers, boms, inventoryItems, priceEntries, products] = await Promise.all([
      this.loadAnalyticsEvents(),
      this.loadOrders(),
      this.prisma.customer.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' }
      }),
      this.prisma.bom.findMany({
        include: { items: true },
        orderBy: { id: 'desc' }
      }),
      this.prisma.inventoryItem.findMany({
        orderBy: { id: 'asc' }
      }),
      this.prisma.inventoryPriceEntry.findMany({
        orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }]
      }),
      this.prisma.product.findMany({
        select: {
          id: true,
          name: true,
          category: true,
          active: true
        },
        orderBy: { id: 'asc' }
      })
    ]);

    const traffic = this.buildTrafficSummary(events, { windowLabel: 'Base inteira' });
    const business = this.buildBusinessSummary({
      orders,
      customers,
      boms,
      inventoryItems,
      priceEntries,
      products,
      windowLabel: 'Base inteira',
      asOf
    });
    const selectedTraffic = this.buildTrafficSummary(
      events.filter((event) => event.createdAt.getTime() >= selectedWindow.startsAt.getTime()),
      { windowLabel: selectedWindow.label }
    );
    const selectedBusiness = this.buildBusinessSummary({
      orders: orders.filter((order) => order.createdAt.getTime() >= selectedWindow.startsAt.getTime()),
      customers,
      boms,
      inventoryItems,
      priceEntries,
      products,
      windowLabel: selectedWindow.label,
      rangeStartsAt: selectedWindow.startsAt,
      asOf
    });

    return {
      asOf: asOf.toISOString(),
      identity: this.buildIdentitySummary(),
      integrations: this.buildIntegrationRails(),
      traffic,
      business,
      selectedPeriod: {
        key: selectedWindow.key,
        days: selectedWindow.days,
        label: selectedWindow.label,
        traffic: selectedTraffic,
        business: selectedBusiness
      }
    };
  }

  private buildTrafficSummary(events: LoadedAnalyticsEvent[], options?: { windowLabel?: string }) {
    const pageViews = events.filter((event) => event.eventType === 'PAGE_VIEW');
    const linkClicks = events.filter((event) => event.eventType === 'LINK_CLICK');
    const webVitals = events.filter((event) => event.eventType === 'WEB_VITAL' && typeof event.metricValue === 'number');
    const funnelEvents = events.filter((event) => event.eventType === 'FUNNEL');

    const firstPageViewBySession = new Map<string, LoadedAnalyticsEvent>();
    const pageViewsBySession = new Map<string, LoadedAnalyticsEvent[]>();
    for (const event of pageViews) {
      if (!firstPageViewBySession.has(event.sessionId)) {
        firstPageViewBySession.set(event.sessionId, event);
      }
      const current = pageViewsBySession.get(event.sessionId) || [];
      current.push(event);
      pageViewsBySession.set(event.sessionId, current);
    }

    const sessions = new Set(pageViews.map((event) => event.sessionId));
    const publicSessions = new Set(
      pageViews.filter((event) => isPublicPath(event.path)).map((event) => event.sessionId)
    );
    const internalSessions = new Set(
      pageViews.filter((event) => !isPublicPath(event.path)).map((event) => event.sessionId)
    );

    const pathStats = new Map<string, { views: number; sessions: Set<string> }>();
    for (const event of pageViews) {
      const path = event.path || '(sem rota)';
      const current = pathStats.get(path) || { views: 0, sessions: new Set<string>() };
      current.views += 1;
      current.sessions.add(event.sessionId);
      pathStats.set(path, current);
    }

    const topPaths = [...pathStats.entries()]
      .map(([path, stats]) => ({
        path,
        views: stats.views,
        sessions: stats.sessions.size,
        surface: isPublicPath(path) ? 'public' : 'internal'
      }))
      .sort((left, right) => right.views - left.views)
      .slice(0, 10);

    const sourceCounts = new Map<string, number>();
    const deviceCounts = new Map<string, number>();
    const browserCounts = new Map<string, number>();
    const osCounts = new Map<string, number>();
    const referrerCounts = new Map<string, number>();
    const bounceSessions = new Set<string>();

    for (const [sessionId, firstView] of firstPageViewBySession.entries()) {
      const pageCount = pageViewsBySession.get(sessionId)?.length || 0;
      if (pageCount <= 1) {
        bounceSessions.add(sessionId);
      }
      const sourceLabel = formatSourceLabel(firstView);
      sourceCounts.set(sourceLabel, (sourceCounts.get(sourceLabel) || 0) + 1);
      const device = firstView.deviceType || 'Desconhecido';
      const browser = firstView.browser || 'Desconhecido';
      const os = firstView.os || 'Desconhecido';
      const referrer = firstView.referrerHost || 'Direto';
      deviceCounts.set(device, (deviceCounts.get(device) || 0) + 1);
      browserCounts.set(browser, (browserCounts.get(browser) || 0) + 1);
      osCounts.set(os, (osCounts.get(os) || 0) + 1);
      referrerCounts.set(referrer, (referrerCounts.get(referrer) || 0) + 1);
    }

    const topLinks = [...linkClicks.reduce((map, event) => {
      const key = `${event.href || '(sem href)'}__${event.label || ''}`;
      map.set(key, {
        href: event.href || '(sem href)',
        label: event.label || 'Sem rótulo',
        clicks: (map.get(key)?.clicks || 0) + 1
      });
      return map;
    }, new Map<string, { href: string; label: string; clicks: number }>()).values()]
      .sort((left, right) => right.clicks - left.clicks)
      .slice(0, 10);

    const vitalStats = new Map<string, number[]>();
    const slowPathStats = new Map<string, number[]>();
    for (const event of webVitals) {
      const metricName = event.metricName || 'DESCONHECIDO';
      pushMapValue(vitalStats, metricName, event.metricValue || 0);
      if (event.path && ['LCP', 'FCP', 'TTFB', 'INP'].includes(metricName)) {
        pushMapValue(slowPathStats, `${event.path}__${metricName}`, event.metricValue || 0);
      }
    }

    const vitalBenchmarks = [...vitalStats.entries()]
      .map(([name, values]) => ({
        name,
        unit: name === 'CLS' ? 'score' : 'ms',
        median: median(values),
        p75: percentile(values, 75),
        sampleSize: values.length
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));

    const slowPages = [...slowPathStats.entries()]
      .map(([compoundKey, values]) => {
        const [path, metricName] = compoundKey.split('__');
        return {
          path,
          metricName,
          median: median(values),
          p75: percentile(values, 75),
          sampleSize: values.length
        };
      })
      .sort((left, right) => right.p75 - left.p75)
      .slice(0, 8);

    const dailyMap = new Map<
      string,
      {
        pageViews: number;
        publicPageViews: number;
        internalPageViews: number;
        sessions: Set<string>;
      }
    >();
    for (const event of pageViews) {
      const dateKey = toDayKey(event.createdAt);
      const current = dailyMap.get(dateKey) || {
        pageViews: 0,
        publicPageViews: 0,
        internalPageViews: 0,
        sessions: new Set<string>()
      };
      current.pageViews += 1;
      if (isPublicPath(event.path)) {
        current.publicPageViews += 1;
      } else {
        current.internalPageViews += 1;
      }
      current.sessions.add(event.sessionId);
      dailyMap.set(dateKey, current);
    }

    const dailySeries = [...dailyMap.entries()]
      .map(([date, stats]) => ({
        date,
        pageViews: stats.pageViews,
        publicPageViews: stats.publicPageViews,
        internalPageViews: stats.internalPageViews,
        sessions: stats.sessions.size
      }))
      .sort((left, right) => left.date.localeCompare(right.date, 'pt-BR'));

    const homeSessions = new Set(
      pageViews.filter((event) => event.path === '/').map((event) => event.sessionId)
    );
    const orderSessions = new Set(
      pageViews.filter((event) => event.path?.startsWith('/pedido')).map((event) => event.sessionId)
    );
    const quoteSuccessSessions = new Set(
      funnelEvents
        .filter((event) => event.label === 'public_order_quote_success')
        .map((event) => event.sessionId)
    );
    const submittedSessions = new Set(
      funnelEvents
        .filter((event) => event.label === 'public_order_submitted')
        .map((event) => event.sessionId)
    );

    return {
      windowLabel: options?.windowLabel || 'Base inteira',
      totals: {
        sessions: sessions.size,
        publicSessions: publicSessions.size,
        internalSessions: internalSessions.size,
        pageViews: pageViews.length,
        publicPageViews: pageViews.filter((event) => isPublicPath(event.path)).length,
        internalPageViews: pageViews.filter((event) => !isPublicPath(event.path)).length,
        avgPagesPerSession: round2(pageViews.length / Math.max(sessions.size, 1)),
        bounceRatePct: toPercent(bounceSessions.size, sessions.size)
      },
      topPaths,
      topSources: [...sourceCounts.entries()]
        .map(([label, sessionsCount]) => ({ label, sessions: sessionsCount }))
        .sort((left, right) => right.sessions - left.sessions)
        .slice(0, 8),
      topReferrers: [...referrerCounts.entries()]
        .map(([label, sessionsCount]) => ({ label, sessions: sessionsCount }))
        .sort((left, right) => right.sessions - left.sessions)
        .slice(0, 8),
      topLinks,
      deviceMix: [...deviceCounts.entries()]
        .map(([label, sessionsCount]) => ({ label, sessions: sessionsCount }))
        .sort((left, right) => right.sessions - left.sessions),
      browserMix: [...browserCounts.entries()]
        .map(([label, sessionsCount]) => ({ label, sessions: sessionsCount }))
        .sort((left, right) => right.sessions - left.sessions)
        .slice(0, 8),
      osMix: [...osCounts.entries()]
        .map(([label, sessionsCount]) => ({ label, sessions: sessionsCount }))
        .sort((left, right) => right.sessions - left.sessions)
        .slice(0, 8),
      vitalBenchmarks,
      slowPages,
      dailySeries,
      funnel: {
        homeSessions: homeSessions.size,
        orderSessions: orderSessions.size,
        quoteSuccessSessions: quoteSuccessSessions.size,
        submittedSessions: submittedSessions.size,
        orderPageConversionPct: toPercent(submittedSessions.size, orderSessions.size),
        quoteToSubmitPct: toPercent(submittedSessions.size, quoteSuccessSessions.size)
      }
    };
  }

  private buildBusinessSummary(params: {
    orders: LoadedOrder[];
    customers: Array<{
      id: number;
      name: string;
      createdAt: Date;
      deletedAt: Date | null;
    }>;
    boms: LoadedBom[];
    inventoryItems: LoadedInventoryItem[];
    priceEntries: LoadedInventoryPriceEntry[];
    products: LoadedProduct[];
    windowLabel?: string;
    rangeStartsAt?: Date;
    asOf?: Date;
  }) {
    const {
      orders,
      customers,
      boms,
      inventoryItems,
      priceEntries,
      products,
      windowLabel,
      rangeStartsAt,
      asOf
    } = params;
    const activeOrders = orders.filter((order) => order.status !== 'CANCELADO');
    const totalCogsBreakdown = this.buildOrderCogsBreakdown({
      rangeOrders: activeOrders,
      boms,
      inventoryItems,
      priceEntries,
      products
    });
    const orderCogsByOrderId = new Map(totalCogsBreakdown.orders.map((entry) => [entry.orderId, entry.cogs]));
    const todayKey = toDayKey(asOf || new Date());
    const activeCustomerIds = new Set<number>();

    const customerOrderCount = new Map<number, number>();
    for (const order of activeOrders) {
      activeCustomerIds.add(order.customerId);
      customerOrderCount.set(order.customerId, (customerOrderCount.get(order.customerId) || 0) + 1);
    }

    const statusMix = new Map<string, number>();
    const fulfillmentMix = new Map<string, number>();
    const quoteMix = new Map<string, number>();

    let paidRevenueTotal = 0;
    const paidRevenueByDay = new Map<string, number>();
    const pendingReceivables = [];

    for (const order of activeOrders) {
      statusMix.set(order.status, (statusMix.get(order.status) || 0) + 1);
      fulfillmentMix.set(order.fulfillmentMode, (fulfillmentMix.get(order.fulfillmentMode) || 0) + 1);
      if (order.fulfillmentMode === 'DELIVERY') {
        const label = order.deliveryQuoteStatus || 'NOT_REQUIRED';
        quoteMix.set(label, (quoteMix.get(label) || 0) + 1);
      }

      const paidAmount = sumBy(
        order.payments.filter((payment) => payment.status === 'PAGO' || Boolean(payment.paidAt)),
        (payment) => payment.amount || 0
      );
      const balanceDue = Math.max(round2(order.total || 0) - round2(paidAmount), 0);

      if (balanceDue > 0.009) {
        pendingReceivables.push({
          orderId: resolveDisplayNumber(order) ?? order.id,
          customerName:
            order.customer?.name ||
            `Cliente #${resolveDisplayNumber(order.customer) ?? order.customerId}`,
          amount: round2(balanceDue),
          status: order.status,
          dueDate:
            order.payments
              .map((payment) => payment.dueDate)
              .filter((value): value is Date => Boolean(value))
              .sort((left, right) => left.getTime() - right.getTime())[0]?.toISOString() || null
        });
      }

      for (const payment of order.payments) {
        const isPaid = payment.status === 'PAGO' || Boolean(payment.paidAt);
        if (!isPaid || !payment.paidAt) continue;
        paidRevenueTotal += payment.amount || 0;
        const dayKey = toDayKey(payment.paidAt);
        paidRevenueByDay.set(dayKey, round2((paidRevenueByDay.get(dayKey) || 0) + (payment.amount || 0)));
      }
    }

    const totalOrderCost = round2(sumBy(totalCogsBreakdown.orders, (order) => order.cogs));
    const grossRevenueTotal = sumBy(activeOrders, (order) => order.total || 0);
    const productNetRevenueTotal = sumBy(
      activeOrders,
      (order) => Math.max(round2(order.subtotal || 0) - round2(order.discount || 0), 0)
    );
    const deliveryRevenueTotal = sumBy(activeOrders, (order) => order.deliveryFee || 0);
    const discountTotal = sumBy(activeOrders, (order) => order.discount || 0);
    const marketingSamplesInvestmentTotal = sumBy(activeOrders, (order) =>
      parseMarketingSamplesDiscountPct(order.notes) != null ? order.discount || 0 : 0
    );
    const outstandingBalance = sumBy(pendingReceivables, (entry) => entry.amount);
    const grossProfitTotal = round2(productNetRevenueTotal - totalOrderCost);
    const contributionAfterFreightTotal = round2(grossRevenueTotal - totalOrderCost);
    const ordersToday = activeOrders.filter((order) => toDayKey(order.createdAt) === todayKey).length;
    const grossRevenueToday = round2(
      sumBy(
        activeOrders.filter((order) => toDayKey(order.createdAt) === todayKey),
        (order) => order.total || 0
      )
    );

    const dailySeriesMap = new Map<
      string,
      {
        orders: number;
        grossRevenue: number;
        paidRevenue: number;
        cogs: number;
        grossProfit: number;
      }
    >();

    for (const order of activeOrders) {
      const dayKey = toDayKey(order.createdAt);
      const current = dailySeriesMap.get(dayKey) || {
        orders: 0,
        grossRevenue: 0,
        paidRevenue: 0,
        cogs: 0,
        grossProfit: 0
      };
      const orderCost = round2(orderCogsByOrderId.get(order.id) || 0);
      const orderNetRevenue = Math.max(round2(order.subtotal || 0) - round2(order.discount || 0), 0);
      current.orders += 1;
      current.grossRevenue = round2(current.grossRevenue + (order.total || 0));
      current.cogs = round2(current.cogs + orderCost);
      current.grossProfit = round2(current.grossProfit + (orderNetRevenue - orderCost));
      dailySeriesMap.set(dayKey, current);
    }

    for (const [dayKey, paidRevenue] of paidRevenueByDay.entries()) {
      const current = dailySeriesMap.get(dayKey) || {
        orders: 0,
        grossRevenue: 0,
        paidRevenue: 0,
        cogs: 0,
        grossProfit: 0
      };
      current.paidRevenue = round2(current.paidRevenue + paidRevenue);
      dailySeriesMap.set(dayKey, current);
    }

    const dailySeries = [...dailySeriesMap.entries()]
      .map(([date, stats]) => ({
        date,
        orders: stats.orders,
        grossRevenue: stats.grossRevenue,
        paidRevenue: stats.paidRevenue,
        cogs: stats.cogs,
        grossProfit: stats.grossProfit
      }))
      .sort((left, right) => left.date.localeCompare(right.date, 'pt-BR'));

    const productMix = new Map<
      number,
      { productId: number; productName: string; units: number; revenue: number; cogs: number }
    >();
    for (const order of totalCogsBreakdown.orders) {
      for (const product of order.products) {
        const current = productMix.get(product.productId) || {
          productId: product.productId,
          productName: product.productName,
          units: 0,
          revenue: 0,
          cogs: 0
        };
        current.units += product.quantity;
        current.revenue = round2(current.revenue + product.revenue);
        current.cogs = round2(current.cogs + product.cogs);
        productMix.set(product.productId, current);
      }
    }

    const topProducts = [...productMix.values()]
      .map((entry) => ({
        ...entry,
        profit: round2(entry.revenue - entry.cogs),
        marginPct: toPercent(entry.revenue - entry.cogs, entry.revenue)
      }))
      .sort((left, right) => right.revenue - left.revenue)
      .slice(0, 8);

    const returningCustomersCount = customers.filter((customer) => (customerOrderCount.get(customer.id) || 0) >= 2).length;
    const newCustomersInRange = rangeStartsAt
      ? customers.filter((customer) => customer.createdAt.getTime() >= rangeStartsAt.getTime()).length
      : customers.length;
    const repeatRateBase = rangeStartsAt ? activeCustomerIds.size : customers.length;
    const auditRevenue = round2(sumBy(totalCogsBreakdown.orders, (entry) => entry.revenue));
    const cogsAudit: DashboardCogsAuditSummary = {
      windowLabel: windowLabel || 'Base inteira',
      ordersCount: totalCogsBreakdown.orders.length,
      ingredientsCount: totalCogsBreakdown.ingredients.length,
      warningsCount: totalCogsBreakdown.warnings.length,
      revenue: auditRevenue,
      cogs: totalOrderCost,
      grossProfit: round2(auditRevenue - totalOrderCost)
    };

    return {
      windowLabel: windowLabel || 'Base inteira',
      kpis: {
        totalCustomers: customers.length,
        ordersToday,
        ordersInRange: activeOrders.length,
        ordersAllTime: activeOrders.length,
        grossRevenueToday,
        grossRevenueInRange: round2(grossRevenueTotal),
        grossRevenueAllTime: round2(grossRevenueTotal),
        paidRevenueInRange: round2(paidRevenueTotal),
        outstandingBalance: round2(outstandingBalance),
        avgTicketInRange: round2(grossRevenueTotal / Math.max(activeOrders.length, 1)),
        discountsInRange: round2(discountTotal),
        marketingSamplesInvestmentInRange: round2(marketingSamplesInvestmentTotal),
        deliveryRevenueInRange: round2(deliveryRevenueTotal),
        productNetRevenueInRange: round2(productNetRevenueTotal),
        estimatedCogsInRange: round2(totalOrderCost),
        costedOrdersInRange: totalCogsBreakdown.orders.length,
        cogsWarningsInRange: totalCogsBreakdown.warnings.length,
        grossProfitInRange: round2(grossProfitTotal),
        grossMarginPctInRange: toPercent(grossProfitTotal, productNetRevenueTotal),
        contributionAfterFreightInRange: round2(contributionAfterFreightTotal)
      },
      cogsAudit,
      customerMetrics: {
        newCustomersInRange,
        returningCustomersInRange: returningCustomersCount,
        repeatRatePct: toPercent(returningCustomersCount, repeatRateBase)
      },
      statusMix: [...statusMix.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((left, right) => right.value - left.value),
      fulfillmentMix: [...fulfillmentMix.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((left, right) => right.value - left.value),
      quoteMix: [...quoteMix.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((left, right) => right.value - left.value),
      dailySeries,
      cogsByIngredient: totalCogsBreakdown.ingredients,
      cogsByOrder: totalCogsBreakdown.orders,
      cogsWarnings: totalCogsBreakdown.warnings,
      topProducts,
      recentReceivables: pendingReceivables
        .sort((left, right) => right.amount - left.amount)
        .slice(0, 10)
    };
  }
}
