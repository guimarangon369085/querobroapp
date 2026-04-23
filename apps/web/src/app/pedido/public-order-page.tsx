'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EXTERNAL_ORDER_DELIVERY_WINDOWS,
  buildCompanionProductMakerLine,
  resolveCompanionProductProfile,
  formatExternalOrderMinimumSchedule,
  mergeOrderItemsSummaryIntoNotes,
  resolveExternalOrderDeliveryWindowKeyForDate,
  resolveExternalOrderMinimumSchedule,
  stripCompanionProductProfileFromDrawerNote,
  type ExternalOrderDeliveryWindowKey,
  type ExternalOrderSubmission,
  type OrderItemsSummaryNoteEntry,
  type CouponResolveResponse,
  type Product
} from '@querobroapp/shared';
import { AppIcon } from '@/components/app-icons';
import { GoogleAddressAutocompleteInput } from '@/components/form/GoogleAddressAutocompleteInput';
import { FormField } from '@/components/form/FormField';
import { useFeedback } from '@/components/feedback-provider';
import { resolveAnalyticsSessionId, trackAnalyticsEvent } from '@/lib/analytics';
import { normalizePhone } from '@/lib/format';
import { useDialogA11y } from '@/lib/use-dialog-a11y';
import { OrderCardArtwork } from '@/features/orders/order-card-artwork';
import { extractStreetNumberFromAddressLine1 } from '@/lib/customer-autofill';
import {
  ORDER_BOX_PRICE_CUSTOM,
  ORDER_SABORES_REFERENCE_IMAGE,
  ORDER_BOX_UNITS,
  ORDER_CUSTOM_BOX_CATALOG_CODE,
  buildRuntimeOrderCatalog,
  calculateCouponEligibleSubtotalFromProductItems,
  calculateOrderSubtotalFromProductItems,
  formatOrderProductComposition,
  resolveOrderCardArt,
  resolveOrderSaboresCardArt,
  type OrderCardArt,
  type RuntimeOrderBoxEntry,
  parseMetaCheckoutProductsParam,
  resolveOrderCatalogPrefillCodeFromCatalogContentId,
  resolveRuntimeOrderBoxKey,
  resolveRuntimeOrderCompanionProductId,
  resolveRuntimeOrderFlavorProductId
} from '@/features/orders/order-box-catalog';
import {
  PUBLIC_ORDER_DRAFT_SESSION_STORAGE_KEY,
  PUBLIC_ORDER_LAST_ORDER_STORAGE_KEY,
  PUBLIC_ORDER_PICKUP_ADDRESS,
  PUBLIC_ORDER_PROFILE_STORAGE_KEY,
  readStoredPublicOrderProfile,
  type PublicOrderResult,
  type StoredPublicOrderProfile
} from './public-order-storage';
import { writeStoredOrderFinalized } from '@/lib/order-finalized-storage';

const GOOGLE_MAPS_API_KEY = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();
const DELIVERY_QUOTE_REQUEST_TIMEOUT_MS = 12_000;
const DELIVERY_QUOTE_CONFIRMATION_GUARD_MS = 1_200;
const ORDER_META_COMPANION_CONTENT_ID_PREFIX = 'QUEROBROA-AMIGA-';

type SelectedOrderSummary = {
  key: string;
  label: string;
  displayLabel?: string;
  quantity: number;
  quantityLabel: string;
  detail?: string | null;
  displayDetail?: string | null;
};
type CustomBoxDraft = {
  id: string;
  flavors: Record<string, number>;
};

function buildOrderItemsSummaryEntries(selectedProducts: SelectedOrderSummary[]): OrderItemsSummaryNoteEntry[] {
  return selectedProducts.flatMap((entry) => {
    const normalizedLabel = String(entry.displayLabel || entry.label || '').trim();
    const normalizedDetail = String(entry.detail || entry.displayDetail || '').trim();
    if (!normalizedLabel) return [];

    const looksLikeBox =
      normalizedLabel.toLowerCase().includes('caixa') || normalizedLabel.toLowerCase().includes('monte sua caixa');
    if (looksLikeBox) {
      return Array.from({ length: Math.max(Math.floor(entry.quantity || 0), 0) }, () => ({
        label: normalizedLabel,
        detail: normalizedDetail || null
      }));
    }

    const quantityLabel = String(entry.quantityLabel || '').trim();
    return [
      {
        label: quantityLabel ? `${normalizedLabel} (${quantityLabel})` : normalizedLabel,
        detail: normalizedDetail || null
      }
    ];
  });
}

type PublicOrderFormState = {
  name: string;
  phone: string;
  fulfillmentMode: 'DELIVERY' | 'PICKUP';
  address: string;
  addressLine1: string;
  addressLine2: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  placeId: string;
  lat: number | null;
  lng: number | null;
  date: string;
  timeWindow: ExternalOrderDeliveryWindowKey | '';
  notes: string;
  boxes: Record<string, string>;
  companions: Record<string, string>;
};

type StoredPublicOrderSnapshot = {
  version: 1 | 2 | 3;
  savedAt: string;
  boxes: Record<string, string>;
  companions: Record<string, string>;
  customBoxes: Array<Record<string, number>>;
  notes: string;
};

type DeliveryQuote = {
  provider: 'NONE' | 'LOCAL';
  fee: number;
  currencyCode: string;
  source: 'NONE' | 'MANUAL_FALLBACK';
  status: 'NOT_REQUIRED' | 'PENDING' | 'QUOTED' | 'FALLBACK' | 'EXPIRED' | 'FAILED';
  quoteToken: string | null;
  expiresAt: string | null;
  fallbackReason: string | null;
  breakdownLabel?: string | null;
};

type AppliedCoupon = CouponResolveResponse;

type PublicOrderPageProps = {
  initialCatalogProducts?: Product[];
  showCompanionProducts?: boolean;
};

type PublicOrderScheduleAvailability = {
  minimumAllowedAt: string;
  nextAvailableAt: string;
  requestedDate: string;
  requestedWindowKey: ExternalOrderDeliveryWindowKey | null;
  requestedWindowLabel: string | null;
  requestedWindowAvailable: boolean;
  requestedWindowReason: 'AVAILABLE' | 'BEFORE_MINIMUM' | 'SLOT_TAKEN' | 'DAY_FULL' | 'DAY_BLOCKED' | null;
  requestedWindowScheduledAt: string | null;
  requestedWindowNextAvailableAt: string | null;
  requestedAt: string | null;
  requestedAvailable: boolean;
  reason: 'AVAILABLE' | 'BEFORE_MINIMUM' | 'SLOT_TAKEN' | 'DAY_FULL' | 'DAY_BLOCKED';
  dailyLimit: number;
  requestedTotalBroas: number;
  requestedDurationMinutes: number;
  slotMinutes: number;
  dayOrderCount: number;
  slotTaken: boolean;
  windows: Array<{
    key: ExternalOrderDeliveryWindowKey;
    label: string;
    startLabel: string;
    endLabel: string;
    available: boolean;
    scheduledAt: string | null;
    reason: 'AVAILABLE' | 'BEFORE_MINIMUM' | 'SLOT_TAKEN' | 'DAY_FULL' | 'DAY_BLOCKED';
  }>;
};

const initialFormState: PublicOrderFormState = {
  name: '',
  phone: '',
  fulfillmentMode: 'DELIVERY',
  address: '',
  addressLine1: '',
  addressLine2: '',
  neighborhood: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  placeId: '',
  lat: null,
  lng: null,
  date: '',
  timeWindow: '',
  notes: '',
  boxes: {},
  companions: {}
};

function sanitizeStoredBoxCounts(value: unknown) {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const next: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(source)) {
    const quantity = parseCountValue(String(rawValue ?? ''));
    if (quantity > 0) {
      next[key] = String(quantity);
    }
  }
  return next;
}

function buildPrefilledBoxCountsFromSearchParams(source: { get(name: string): string | null }) {
  const next: Record<string, string> = {};
  let hasPrefill = false;
  let customBoxCount = 0;

  const catalogCode = resolveOrderCatalogPrefillCodeFromCatalogContentId(source.get('catalog'));
  if (catalogCode) {
    if (catalogCode === ORDER_CUSTOM_BOX_CATALOG_CODE) {
      customBoxCount += 1;
    } else {
      next[catalogCode] = String(parseCountValue(next[catalogCode]) + 1);
    }
    hasPrefill = true;
  }

  const metaCheckoutPrefill = parseMetaCheckoutProductsParam(source.get('products'));
  for (const [code, rawQuantity] of Object.entries(metaCheckoutPrefill.boxes)) {
    const quantity = Math.max(Math.floor(rawQuantity || 0), 0);
    if (quantity <= 0) continue;
    next[code] = String(quantity);
    hasPrefill = true;
  }
  customBoxCount += Math.max(Math.floor(metaCheckoutPrefill.customBoxCount || 0), 0);
  if (metaCheckoutPrefill.customBoxCount > 0) {
    hasPrefill = true;
  }

  const couponCode = String(source.get('coupon') || '').trim();
  if (!hasPrefill && !couponCode) return null;

  return {
    boxes: next,
    customBoxCount,
    couponCode: couponCode || null
  };
}

function resolvePrefilledCompanionProductIdFromSearchParams(source: { get(name: string): string | null }) {
  const rawValue = String(source.get('companion') || '').trim();
  if (!rawValue) return null;

  const normalizedValue = rawValue.toUpperCase();
  const candidate = normalizedValue.startsWith(ORDER_META_COMPANION_CONTENT_ID_PREFIX)
    ? normalizedValue.slice(ORDER_META_COMPANION_CONTENT_ID_PREFIX.length)
    : normalizedValue.startsWith('COMPANION:')
      ? normalizedValue.slice('COMPANION:'.length)
      : rawValue;

  const numericId = Number.parseInt(candidate, 10);
  return Number.isInteger(numericId) && numericId > 0 ? numericId : null;
}

function normalizeCouponCodeInput(value?: string | null) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function roundCurrency(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function sanitizeStoredCustomBox(value: unknown) {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, rawValue]) => [key, Math.max(Math.floor(Number(rawValue) || 0), 0)] as const)
      .filter(([, quantity]) => quantity > 0)
  );
}

function formatDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildPublicOrderScheduleErrorMessage(minimum: Date) {
  const windowKey = resolveExternalOrderDeliveryWindowKeyForDate(minimum);
  const windowLabel = EXTERNAL_ORDER_DELIVERY_WINDOWS.find((entry) => entry.key === windowKey)?.label;
  return windowLabel ? `Próxima faixa: ${windowLabel}.` : `Próxima faixa: ${formatExternalOrderMinimumSchedule(minimum)}.`;
}

function validateRecognizedDeliveryAddress(
  form: Pick<
    PublicOrderFormState,
    'fulfillmentMode' | 'address' | 'addressLine1' | 'addressLine2' | 'neighborhood' | 'placeId'
  >
) {
  if (form.fulfillmentMode !== 'DELIVERY') return null;
  if (!form.address.trim()) {
    return 'Informe o endereço para entrega.';
  }
  if (!form.placeId.trim()) {
    return 'Selecione um endereço reconhecido pelo Google Maps.';
  }
  if (!form.addressLine1.trim()) {
    return 'Selecione um endereço com rua e número.';
  }
  if (!extractStreetNumberFromAddressLine1(form.addressLine1)) {
    return 'O endereço precisa incluir o número da rua.';
  }
  if (!form.neighborhood.trim()) {
    return 'O endereço precisa incluir o bairro.';
  }
  if (!form.addressLine2.trim()) {
    return 'Informe o complemento do endereço.';
  }
  return null;
}

function extractErrorMessage(body: unknown) {
  if (typeof body === 'string') return body;
  if (!body || typeof body !== 'object') return 'Não foi possível enviar o pedido.';

  const record = body as Record<string, unknown>;
  const issues = record.issues && typeof record.issues === 'object' ? (record.issues as Record<string, unknown>) : null;
  if (issues) {
    const formErrors = Array.isArray(issues.formErrors)
      ? issues.formErrors.map((value) => String(value)).filter(Boolean)
      : [];
    const fieldErrors =
      issues.fieldErrors && typeof issues.fieldErrors === 'object'
        ? Object.values(issues.fieldErrors as Record<string, unknown>)
            .flatMap((value) =>
              Array.isArray(value) ? value.map((entry) => String(entry)) : [String(value)]
            )
            .filter(Boolean)
        : [];
    const merged = [...formErrors, ...fieldErrors];
    if (merged.length) return merged.join('; ');
  }

  if (typeof record.message === 'string') return record.message;
  if (Array.isArray(record.message)) return record.message.map((entry) => String(entry)).join('; ');
  return 'Não foi possível enviar o pedido.';
}

function isPublicOrderScheduleAvailability(value: unknown): value is PublicOrderScheduleAvailability {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.minimumAllowedAt === 'string' &&
    typeof record.nextAvailableAt === 'string' &&
    typeof record.requestedDate === 'string' &&
    Array.isArray(record.windows) &&
    (record.requestedAt == null || typeof record.requestedAt === 'string') &&
    typeof record.requestedAvailable === 'boolean' &&
    typeof record.reason === 'string'
  );
}

function parseCountValue(value: string) {
  const parsed = Number(String(value || '').replace(/[^\d-]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function formatCurrencyBRL(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'A confirmar';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
}

function createCustomBoxId() {
  return `custom-box-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createPublicOrderDraftSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `public-order-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function hashPublicOrderSubmission(value: unknown) {
  const raw = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function resolvePublicOrderDraftSessionId() {
  if (typeof window === 'undefined') {
    return createPublicOrderDraftSessionId();
  }
  const existing = window.sessionStorage.getItem(PUBLIC_ORDER_DRAFT_SESSION_STORAGE_KEY)?.trim();
  if (existing) return existing;
  const created = createPublicOrderDraftSessionId();
  window.sessionStorage.setItem(PUBLIC_ORDER_DRAFT_SESSION_STORAGE_KEY, created);
  return created;
}

function createEmptyCustomBoxDraft(): CustomBoxDraft {
  return {
    id: createCustomBoxId(),
    flavors: {}
  };
}

function pluralize(count: number, singular: string, plural: string) {
  return count === 1 ? singular : plural;
}

function extractCompanionProductMeasureLabel(
  product?: Pick<Product, 'measureLabel' | 'name' | 'unit'> | null,
) {
  const explicitMeasureLabel = String(product?.measureLabel || '').trim().toLowerCase();
  if (explicitMeasureLabel) return explicitMeasureLabel;

  const normalizedName = String(product?.name || '').trim();
  if (normalizedName) {
    const measureMatch =
      normalizedName.match(/\(([^()]*\d+(?:[.,]\d+)?\s?(?:g|kg|mg|ml|l))\)/i) ||
      normalizedName.match(/\b(\d+(?:[.,]\d+)?\s?(?:g|kg|mg|ml|l))\b/i);
    if (measureMatch) {
      return measureMatch[1].replace(/\s+/g, '').toLowerCase();
    }
  }

  const unitLabel = String(product?.unit || '').trim().toLowerCase();
  if (!unitLabel || unitLabel === 'un' || unitLabel === 'und' || unitLabel === 'unidade') {
    return null;
  }
  return unitLabel;
}

function formatCustomBoxParts(
  counts: Record<string, number>,
  flavorProducts: Array<{ id: number; label: string }>
) {
  return flavorProducts
    .map((product) => ({ product, quantity: counts[String(product.id)] || 0 }))
    .filter((entry) => entry.quantity > 0)
    .map((entry) => `${entry.quantity} ${entry.product.label}`)
    .join(' • ');
}

function resolveCompanionDrawerNote(product?: Pick<Product, 'drawerNote'> | null) {
  const customNote = stripCompanionProductProfileFromDrawerNote(product?.drawerNote) || '';
  return customNote.trim() || 'Toque fora da gaveta ou no botão fechar para voltar ao catálogo.';
}

function resolveCompanionProductPublicLines(
  product?: Pick<Product, 'name' | 'drawerNote' | 'measureLabel' | 'unit'> | null,
) {
  const profile = resolveCompanionProductProfile(product);
  const measureLabel = extractCompanionProductMeasureLabel(product);
  const subtitleLine = [profile?.flavor ?? null, measureLabel].filter(Boolean).join(' • ') || null;
  return {
    title: profile?.title || String(product?.name || '').trim(),
    subtitleLine,
    makerLine: buildCompanionProductMakerLine(profile),
    measureLabel
  };
}

function splitCompanionCardTitle(title: string) {
  const normalizedTitle = String(title || '').trim();
  const parentheticalMatch = normalizedTitle.match(/^(.*?)(\s*\([^()]+\))$/);
  if (!parentheticalMatch) {
    return {
      primary: normalizedTitle,
      secondary: null as string | null
    };
  }

  return {
    primary: parentheticalMatch[1].trim(),
    secondary: parentheticalMatch[2].trim()
  };
}

function PublicOrderSaboresCollage({ art }: { art: OrderCardArt }) {
  return (
    <div className="relative aspect-[16/10] overflow-hidden rounded-[18px] bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.92),transparent_34%),linear-gradient(155deg,rgba(248,239,230,0.98),rgba(238,222,202,0.92))] xl:aspect-[21/10]">
      <span className="sr-only">Composição da Monte Sua Caixa com os sabores ativos do catálogo.</span>
      <div className="absolute inset-[10px] sm:inset-4" aria-hidden="true">
        <OrderCardArtwork
          alt="Composicao da Monte Sua Caixa"
          art={art}
          className="rounded-[14px] border border-white/85 bg-white/92 shadow-[0_18px_36px_rgba(70,44,26,0.16)]"
          overlayClassName="absolute inset-0 bg-[linear-gradient(180deg,transparent_18%,rgba(46,29,20,0.14)_100%)]"
          sizes="(max-width: 768px) 70vw, 420px"
        />
      </div>
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.16),transparent_40%),linear-gradient(180deg,rgba(65,40,24,0.04)_0%,rgba(65,40,24,0.14)_100%)]"
        aria-hidden="true"
      />
    </div>
  );
}

function resolveMixedBoxesCollectionArt(
  mixedEntries: RuntimeOrderBoxEntry[],
  runtimeCatalog: ReturnType<typeof buildRuntimeOrderCatalog>
): OrderCardArt {
  const traditionalFlavor = runtimeCatalog.traditionalFlavor;
  if (!traditionalFlavor || mixedEntries.length === 0) {
    return {
      mode: 'single',
      src: ORDER_SABORES_REFERENCE_IMAGE,
      objectPosition: 'center center'
    };
  }

  const traditionalArt = resolveOrderCardArt(traditionalFlavor);
  const traditionalColumn =
    traditionalArt.mode === 'single'
      ? {
          src: traditionalArt.src,
          objectPosition: traditionalArt.objectPosition,
          span: mixedEntries.length
        }
      : {
          src: ORDER_SABORES_REFERENCE_IMAGE,
          span: mixedEntries.length
        };

  return {
    mode: 'weighted-columns',
    columns: [
      traditionalColumn,
      ...mixedEntries.map((entry) => {
        const pairedFlavor = runtimeCatalog.flavorProductById.get(entry.productId);
        const pairedArt = resolveOrderCardArt(pairedFlavor);
        return pairedArt.mode === 'single'
          ? {
              src: pairedArt.src,
              objectPosition: pairedArt.objectPosition,
              span: 1
            }
          : {
              src: ORDER_SABORES_REFERENCE_IMAGE,
              span: 1
            };
      })
    ]
  };
}

export function PublicOrderPage({
  initialCatalogProducts = [],
  showCompanionProducts = false
}: PublicOrderPageProps) {
  const router = useRouter();
  const { notifyError } = useFeedback();
  const [catalogProducts, setCatalogProducts] = useState<Product[]>(() =>
    Array.isArray(initialCatalogProducts) ? initialCatalogProducts : []
  );
  const [form, setForm] = useState<PublicOrderFormState>(initialFormState);
  const [customBoxes, setCustomBoxes] = useState<CustomBoxDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [deliveryQuoteFingerprint, setDeliveryQuoteFingerprint] = useState<string | null>(null);
  const [deliveryQuoteError, setDeliveryQuoteError] = useState<string | null>(null);
  const [isQuotingDelivery, setIsQuotingDelivery] = useState(false);
  const [isDeliveryQuoteConfirmationPending, setIsDeliveryQuoteConfirmationPending] = useState(false);
  const [expandedCompanionProductKey, setExpandedCompanionProductKey] = useState<string | null>(null);
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [isResolvingCoupon, setIsResolvingCoupon] = useState(false);
  const [pendingPrefilledCouponCode, setPendingPrefilledCouponCode] = useState<string | null>(null);
  const [isMixedBoxesDrawerOpen, setIsMixedBoxesDrawerOpen] = useState(false);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const orderFormRef = useRef<HTMLFormElement | null>(null);
  const urlPrefillSignatureRef = useRef<string | null>(null);
  const companionPrefillSignatureRef = useRef<string | null>(null);
  const deliveryAddressDraftRef = useRef<
    Pick<
      PublicOrderFormState,
      'address' | 'addressLine1' | 'neighborhood' | 'city' | 'state' | 'postalCode' | 'country' | 'placeId' | 'lat' | 'lng'
    >
  >({
    address: '',
    addressLine1: '',
    neighborhood: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
    placeId: '',
    lat: null,
    lng: null
  });
  const scheduleSyncRequestIdRef = useRef(0);
  const deliveryQuoteRequestIdRef = useRef(0);
  const deliveryQuoteAbortControllerRef = useRef<AbortController | null>(null);
  const deliveryQuoteConfirmationTimeoutRef = useRef<number | null>(null);
  const companionPreviewDialogRef = useRef<HTMLDivElement | null>(null);
  const companionPreviewCloseRef = useRef<HTMLButtonElement | null>(null);
  const mixedBoxesDrawerDialogRef = useRef<HTMLDivElement | null>(null);
  const mixedBoxesDrawerCloseRef = useRef<HTMLButtonElement | null>(null);
  const [minimumSchedule, setMinimumSchedule] = useState<Date | null>(null);
  const [scheduleAvailability, setScheduleAvailability] = useState<PublicOrderScheduleAvailability | null>(null);
  const [draftSessionId, setDraftSessionId] = useState(() => resolvePublicOrderDraftSessionId());
  const minimumDateValue = minimumSchedule ? formatDateInputValue(minimumSchedule) : '';
  const isPickupSelected = form.fulfillmentMode === 'PICKUP';
  const runtimeOrderCatalog = useMemo(() => buildRuntimeOrderCatalog(catalogProducts), [catalogProducts]);
  const runtimeBoxEntries = runtimeOrderCatalog.boxEntries;
  const singleBoxEntries = useMemo(
    () => runtimeBoxEntries.filter((entry) => entry.kind === 'SINGLE'),
    [runtimeBoxEntries]
  );
  const mixedBoxEntries = useMemo(
    () => runtimeBoxEntries.filter((entry) => entry.kind === 'MIXED'),
    [runtimeBoxEntries]
  );
  const flavorProducts = runtimeOrderCatalog.flavorProducts;
  const companionProducts = useMemo(
    () => (showCompanionProducts ? runtimeOrderCatalog.companionProducts : []),
    [runtimeOrderCatalog.companionProducts, showCompanionProducts]
  );
  const expandedCompanionProduct = useMemo(
    () => companionProducts.find((product) => product.key === expandedCompanionProductKey) ?? null,
    [companionProducts, expandedCompanionProductKey]
  );
  const expandedCompanionProductLines = useMemo(
    () => resolveCompanionProductPublicLines(expandedCompanionProduct),
    [expandedCompanionProduct]
  );
  const productMapById = useMemo(
    () =>
      new Map(
        catalogProducts
          .filter((product): product is Product & { id: number } => typeof product.id === 'number')
          .map((product) => [product.id, product] as const)
      ),
    [catalogProducts]
  );
  const saboresCardArt = useMemo(() => resolveOrderSaboresCardArt(catalogProducts), [catalogProducts]);
  const mixedBoxesCardArt = useMemo(
    () => resolveMixedBoxesCollectionArt(mixedBoxEntries, runtimeOrderCatalog),
    [mixedBoxEntries, runtimeOrderCatalog]
  );
  const mixedBoxStartingPrice = useMemo(
    () =>
      mixedBoxEntries.reduce<number | null>((lowest, entry) => {
        if (!Number.isFinite(entry.priceEstimate)) return lowest;
        if (lowest == null) return entry.priceEstimate;
        return Math.min(lowest, entry.priceEstimate);
      }, null),
    [mixedBoxEntries]
  );
  const cancelPendingDeliveryQuote = useCallback(() => {
    deliveryQuoteRequestIdRef.current += 1;
    deliveryQuoteAbortControllerRef.current?.abort();
    deliveryQuoteAbortControllerRef.current = null;
  }, []);
  const clearDeliveryQuoteConfirmationGuard = useCallback(() => {
    if (deliveryQuoteConfirmationTimeoutRef.current != null) {
      window.clearTimeout(deliveryQuoteConfirmationTimeoutRef.current);
      deliveryQuoteConfirmationTimeoutRef.current = null;
    }
    setIsDeliveryQuoteConfirmationPending(false);
  }, []);
  const armDeliveryQuoteConfirmationGuard = useCallback(() => {
    clearDeliveryQuoteConfirmationGuard();
    setIsDeliveryQuoteConfirmationPending(true);
    deliveryQuoteConfirmationTimeoutRef.current = window.setTimeout(() => {
      deliveryQuoteConfirmationTimeoutRef.current = null;
      setIsDeliveryQuoteConfirmationPending(false);
    }, DELIVERY_QUOTE_CONFIRMATION_GUARD_MS);
  }, [clearDeliveryQuoteConfirmationGuard]);
  const closeCompanionPreview = useCallback(() => {
    setExpandedCompanionProductKey(null);
  }, []);
  const closeMixedBoxesDrawer = useCallback(() => {
    setIsMixedBoxesDrawerOpen(false);
  }, []);

  useDialogA11y({
    isOpen: Boolean(expandedCompanionProduct),
    dialogRef: companionPreviewDialogRef,
    onClose: closeCompanionPreview,
    initialFocusRef: companionPreviewCloseRef
  });
  useDialogA11y({
    isOpen: isMixedBoxesDrawerOpen,
    dialogRef: mixedBoxesDrawerDialogRef,
    onClose: closeMixedBoxesDrawer,
    initialFocusRef: mixedBoxesDrawerCloseRef
  });

  useEffect(() => {
    let cancelled = false;

    void fetch('/api/order-catalog', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Falha ao carregar o catálogo público (${response.status}).`);
        }
        return response.json() as Promise<Product[]>;
      })
      .then((products) => {
        if (!cancelled) {
          setCatalogProducts(Array.isArray(products) ? products : []);
        }
      })
      .catch(() => {
        // Preserva o catálogo já resolvido no SSR quando o refresh do cliente falha.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(PUBLIC_ORDER_DRAFT_SESSION_STORAGE_KEY, draftSessionId);
  }, [draftSessionId]);

  useEffect(() => {
    if (!expandedCompanionProductKey) return;
    if (companionProducts.some((product) => product.key === expandedCompanionProductKey)) return;
    setExpandedCompanionProductKey(null);
  }, [companionProducts, expandedCompanionProductKey]);

  useEffect(() => {
    if (!isMixedBoxesDrawerOpen) return;
    if (mixedBoxEntries.length > 0) return;
    setIsMixedBoxesDrawerOpen(false);
  }, [isMixedBoxesDrawerOpen, mixedBoxEntries.length]);

  useEffect(() => {
    const storedProfile = readStoredPublicOrderProfile();
    if (storedProfile) {
      deliveryAddressDraftRef.current = {
        address: storedProfile.fulfillmentMode === 'DELIVERY' ? storedProfile.address : '',
        addressLine1: storedProfile.fulfillmentMode === 'DELIVERY' ? storedProfile.addressLine1 : '',
        neighborhood: storedProfile.fulfillmentMode === 'DELIVERY' ? storedProfile.neighborhood : '',
        city: storedProfile.fulfillmentMode === 'DELIVERY' ? storedProfile.city : '',
        state: storedProfile.fulfillmentMode === 'DELIVERY' ? storedProfile.state : '',
        postalCode: storedProfile.fulfillmentMode === 'DELIVERY' ? storedProfile.postalCode : '',
        country: storedProfile.fulfillmentMode === 'DELIVERY' ? storedProfile.country : '',
        placeId: storedProfile.fulfillmentMode === 'DELIVERY' ? storedProfile.placeId : '',
        lat: storedProfile.fulfillmentMode === 'DELIVERY' ? storedProfile.lat : null,
        lng: storedProfile.fulfillmentMode === 'DELIVERY' ? storedProfile.lng : null
      };
      setForm((current) => ({
        ...current,
        name: storedProfile.name || current.name,
        phone: storedProfile.phone || current.phone,
        fulfillmentMode: storedProfile.fulfillmentMode,
        address: storedProfile.address || current.address,
        addressLine1: storedProfile.addressLine1 || current.addressLine1,
        addressLine2: storedProfile.addressLine2 || current.addressLine2,
        neighborhood: storedProfile.neighborhood || current.neighborhood,
        city: storedProfile.city || current.city,
        state: storedProfile.state || current.state,
        postalCode: storedProfile.postalCode || current.postalCode,
        country: storedProfile.country || current.country,
        placeId: storedProfile.placeId,
        lat: storedProfile.lat,
        lng: storedProfile.lng
      }));
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const searchParams = new URLSearchParams(window.location.search);
    const prefill = buildPrefilledBoxCountsFromSearchParams(searchParams);
    const signature = searchParams.toString();
    if (!prefill || urlPrefillSignatureRef.current === signature) return;

    urlPrefillSignatureRef.current = signature;
    setDraftSessionId(createPublicOrderDraftSessionId());
    setCustomBoxes(Array.from({ length: prefill.customBoxCount }, () => createEmptyCustomBoxDraft()));
    setError(null);
    setDeliveryQuote(null);
    setDeliveryQuoteFingerprint(null);
    setDeliveryQuoteError(null);
    setCouponError(null);
    setAppliedCoupon(null);
    setCouponInput(prefill.couponCode || '');
    setPendingPrefilledCouponCode(prefill.couponCode || null);
    setForm((current) => ({
      ...current,
      boxes: prefill.boxes,
      companions: {}
    }));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const searchParams = new URLSearchParams(window.location.search);
    const rawCompanionValue = String(searchParams.get('companion') || '').trim();
    const companionProductId = resolvePrefilledCompanionProductIdFromSearchParams(searchParams);
    if (!rawCompanionValue || companionProductId == null) return;

    const matchedCompanionProduct =
      companionProducts.find((product) => product.id === companionProductId) ?? null;
    if (!matchedCompanionProduct) return;

    const signature = `companion=${rawCompanionValue}`;
    if (companionPrefillSignatureRef.current === signature) return;

    companionPrefillSignatureRef.current = signature;
    setExpandedCompanionProductKey(matchedCompanionProduct.key);
  }, [companionProducts]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const normalizedProfile: StoredPublicOrderProfile = {
      version: 3,
      name: form.name.trim(),
      phone: form.phone.trim(),
      fulfillmentMode: form.fulfillmentMode,
      address: form.fulfillmentMode === 'PICKUP' ? PUBLIC_ORDER_PICKUP_ADDRESS : form.address.trim(),
      addressLine1: form.fulfillmentMode === 'DELIVERY' ? form.addressLine1.trim() : '',
      addressLine2: form.fulfillmentMode === 'DELIVERY' ? form.addressLine2.trim() : '',
      neighborhood: form.fulfillmentMode === 'DELIVERY' ? form.neighborhood.trim() : '',
      city: form.fulfillmentMode === 'DELIVERY' ? form.city.trim() : '',
      state: form.fulfillmentMode === 'DELIVERY' ? form.state.trim() : '',
      postalCode: form.fulfillmentMode === 'DELIVERY' ? form.postalCode.trim() : '',
      country: form.fulfillmentMode === 'DELIVERY' ? form.country.trim() : '',
      placeId: form.fulfillmentMode === 'DELIVERY' ? form.placeId.trim() : '',
      lat: form.fulfillmentMode === 'DELIVERY' && typeof form.lat === 'number' ? form.lat : null,
      lng: form.fulfillmentMode === 'DELIVERY' && typeof form.lng === 'number' ? form.lng : null
    };
    const hasMeaningfulProfile =
      normalizedProfile.name ||
      normalizedProfile.phone ||
      normalizedProfile.address ||
      normalizedProfile.addressLine2;
    if (!hasMeaningfulProfile) {
      window.localStorage.removeItem(PUBLIC_ORDER_PROFILE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(PUBLIC_ORDER_PROFILE_STORAGE_KEY, JSON.stringify(normalizedProfile));
  }, [
    form.address,
    form.addressLine1,
    form.addressLine2,
    form.fulfillmentMode,
    form.lat,
    form.lng,
    form.name,
    form.neighborhood,
    form.phone,
    form.city,
    form.state,
    form.postalCode,
    form.country,
    form.placeId
  ]);

  const rememberDeliveryLocation = useCallback(
    (
      patch: Partial<
        Pick<
          PublicOrderFormState,
          'address' | 'addressLine1' | 'neighborhood' | 'city' | 'state' | 'postalCode' | 'country' | 'placeId' | 'lat' | 'lng'
        >
      >
    ) => {
      deliveryAddressDraftRef.current = {
        address: patch.address ?? deliveryAddressDraftRef.current.address,
        addressLine1: patch.addressLine1 ?? deliveryAddressDraftRef.current.addressLine1,
        neighborhood: patch.neighborhood ?? deliveryAddressDraftRef.current.neighborhood,
        city: patch.city ?? deliveryAddressDraftRef.current.city,
        state: patch.state ?? deliveryAddressDraftRef.current.state,
        postalCode: patch.postalCode ?? deliveryAddressDraftRef.current.postalCode,
        country: patch.country ?? deliveryAddressDraftRef.current.country,
        placeId: patch.placeId ?? deliveryAddressDraftRef.current.placeId,
        lat: Object.prototype.hasOwnProperty.call(patch, 'lat') ? patch.lat ?? null : deliveryAddressDraftRef.current.lat,
        lng: Object.prototype.hasOwnProperty.call(patch, 'lng') ? patch.lng ?? null : deliveryAddressDraftRef.current.lng
      };
    },
    []
  );

  const handleFulfillmentModeChange = useCallback((nextMode: 'DELIVERY' | 'PICKUP') => {
    setForm((current) => {
      if (current.fulfillmentMode === nextMode) return current;

      if (nextMode === 'PICKUP') {
        if (current.fulfillmentMode === 'DELIVERY') {
          deliveryAddressDraftRef.current = {
            address: current.address,
            addressLine1: current.addressLine1,
            neighborhood: current.neighborhood,
            city: current.city,
            state: current.state,
            postalCode: current.postalCode,
            country: current.country,
            placeId: current.placeId,
            lat: current.lat,
            lng: current.lng
          };
        }

        return {
          ...current,
          fulfillmentMode: 'PICKUP',
          address: PUBLIC_ORDER_PICKUP_ADDRESS,
          addressLine1: '',
          placeId: '',
          neighborhood: '',
          city: '',
          state: '',
          postalCode: '',
          country: '',
          lat: null,
          lng: null
        };
      }

      return {
        ...current,
        fulfillmentMode: 'DELIVERY',
        address: deliveryAddressDraftRef.current.address,
        addressLine1: deliveryAddressDraftRef.current.addressLine1,
        neighborhood: deliveryAddressDraftRef.current.neighborhood,
        city: deliveryAddressDraftRef.current.city,
        state: deliveryAddressDraftRef.current.state,
        postalCode: deliveryAddressDraftRef.current.postalCode,
        country: deliveryAddressDraftRef.current.country,
        placeId: deliveryAddressDraftRef.current.placeId,
        lat: deliveryAddressDraftRef.current.lat,
        lng: deliveryAddressDraftRef.current.lng
      };
    });
  }, []);

  const parsedBoxCounts = useMemo(() => {
    const normalized = Object.fromEntries(
      runtimeBoxEntries.map((entry) => [entry.key, 0] as const)
    ) as Record<string, number>;

    for (const [rawKey, rawValue] of Object.entries(form.boxes)) {
      const resolvedKey = resolveRuntimeOrderBoxKey(rawKey, runtimeOrderCatalog);
      if (!resolvedKey) continue;
      const quantity = parseCountValue(String(rawValue));
      if (quantity <= 0) continue;
      normalized[resolvedKey] = (normalized[resolvedKey] || 0) + quantity;
    }

    return normalized;
  }, [form.boxes, runtimeBoxEntries, runtimeOrderCatalog]);
  const parsedCompanionCounts = useMemo(() => {
    const normalized = Object.fromEntries(
      companionProducts.map((product) => [product.key, 0] as const)
    ) as Record<string, number>;

    for (const [rawKey, rawValue] of Object.entries(form.companions)) {
      const productId = resolveRuntimeOrderCompanionProductId(rawKey, runtimeOrderCatalog);
      if (!productId) continue;
      const product = runtimeOrderCatalog.companionProductById.get(productId);
      if (!product) continue;
      const quantity = parseCountValue(String(rawValue));
      if (quantity <= 0) continue;
      normalized[product.key] = (normalized[product.key] || 0) + quantity;
    }

    return normalized;
  }, [companionProducts, form.companions, runtimeOrderCatalog]);
  const expandedCompanionQuantity = expandedCompanionProduct
    ? parsedCompanionCounts[expandedCompanionProduct.key] || 0
    : 0;

  const officialBoxCount = useMemo(
    () => Object.values(parsedBoxCounts).reduce((sum, quantity) => sum + quantity, 0),
    [parsedBoxCounts]
  );
  const totalCompanionItems = useMemo(
    () => Object.values(parsedCompanionCounts).reduce((sum, quantity) => sum + quantity, 0),
    [parsedCompanionCounts]
  );
  const activeMixedBoxSelections = useMemo(
    () =>
      mixedBoxEntries
        .map((entry) => ({
          entry,
          quantity: parsedBoxCounts[entry.key] || 0
        }))
        .filter((entry) => entry.quantity > 0),
    [mixedBoxEntries, parsedBoxCounts]
  );
  const totalMixedBoxes = useMemo(
    () => activeMixedBoxSelections.reduce((sum, entry) => sum + entry.quantity, 0),
    [activeMixedBoxSelections]
  );

  const customBoxSummaries = useMemo(
    () =>
      customBoxes.map((box, index) => {
        const flavors: Record<string, number> = {};

        for (const [rawKey, rawValue] of Object.entries(box.flavors)) {
          const productId = resolveRuntimeOrderFlavorProductId(rawKey, runtimeOrderCatalog);
          const quantity = Math.max(Math.floor(rawValue || 0), 0);
          if (!productId || quantity <= 0) continue;
          const productKey = String(productId);
          flavors[productKey] = (flavors[productKey] || 0) + quantity;
        }

        const totalUnits = Object.values(flavors).reduce((sum, quantity) => sum + quantity, 0);
        return {
          id: box.id,
          index,
          flavors,
          totalUnits,
          isComplete: totalUnits === ORDER_BOX_UNITS,
          isActive: totalUnits > 0,
          remainingUnits: Math.max(ORDER_BOX_UNITS - totalUnits, 0)
        };
      }),
    [customBoxes, runtimeOrderCatalog]
  );
  const activeCustomBoxes = useMemo(
    () => customBoxSummaries.filter((entry) => entry.isActive),
    [customBoxSummaries]
  );
  const incompleteCustomBoxes = useMemo(
    () => customBoxSummaries.filter((entry) => entry.totalUnits > 0 && !entry.isComplete),
    [customBoxSummaries]
  );
  const totalBoxes = useMemo(
    () => officialBoxCount + activeCustomBoxes.length,
    [activeCustomBoxes.length, officialBoxCount]
  );
  const broaOrderItems = useMemo(() => {
    const quantityByProductId = new Map<number, number>();

    for (const [boxKey, boxCount] of Object.entries(parsedBoxCounts)) {
      const normalizedBoxCount = Math.max(Math.floor(boxCount || 0), 0);
      if (normalizedBoxCount <= 0) continue;
      const boxEntry = runtimeOrderCatalog.boxEntryByKey.get(boxKey);
      if (!boxEntry) continue;

      for (const [productIdKey, unitsPerBox] of Object.entries(boxEntry.unitsByProductId)) {
        const productId = Number(productIdKey);
        const nextQuantity = normalizedBoxCount * Math.max(Math.floor(unitsPerBox || 0), 0);
        if (!Number.isFinite(productId) || productId <= 0 || nextQuantity <= 0) continue;
        quantityByProductId.set(productId, (quantityByProductId.get(productId) || 0) + nextQuantity);
      }
    }

    for (const box of activeCustomBoxes) {
      for (const [productIdKey, quantity] of Object.entries(box.flavors)) {
        const productId = Number(productIdKey);
        const normalizedQuantity = Math.max(Math.floor(quantity || 0), 0);
        if (!Number.isFinite(productId) || productId <= 0 || normalizedQuantity <= 0) continue;
        quantityByProductId.set(productId, (quantityByProductId.get(productId) || 0) + normalizedQuantity);
      }
    }

    return Array.from(quantityByProductId.entries()).map(([productId, quantity]) => ({
      productId,
      quantity
    }));
  }, [activeCustomBoxes, parsedBoxCounts, runtimeOrderCatalog.boxEntryByKey]);
  const companionOrderItems = useMemo(
    () =>
      companionProducts
        .map((product) => ({
          productId: product.id,
          quantity: parsedCompanionCounts[product.key] || 0
        }))
        .filter((item) => item.quantity > 0),
    [companionProducts, parsedCompanionCounts]
  );
  const computedOrderItems = useMemo(() => {
    const quantityByProductId = new Map<number, number>();

    for (const item of [...broaOrderItems, ...companionOrderItems]) {
      const quantity = Math.max(Math.floor(item.quantity || 0), 0);
      if (quantity <= 0) continue;
      quantityByProductId.set(item.productId, (quantityByProductId.get(item.productId) || 0) + quantity);
    }

    return Array.from(quantityByProductId.entries()).map(([productId, quantity]) => ({
      productId,
      quantity
    }));
  }, [broaOrderItems, companionOrderItems]);
  const totalBroas = useMemo(
    () => broaOrderItems.reduce((sum, item) => sum + item.quantity, 0),
    [broaOrderItems]
  );
  const totalSelectedItems = useMemo(
    () => computedOrderItems.reduce((sum, item) => sum + item.quantity, 0),
    [computedOrderItems]
  );
  const estimatedTotal = useMemo(
    () => calculateOrderSubtotalFromProductItems(computedOrderItems, productMapById),
    [computedOrderItems, productMapById]
  );
  const couponEligibleSubtotal = useMemo(
    () => calculateCouponEligibleSubtotalFromProductItems(computedOrderItems, productMapById),
    [computedOrderItems, productMapById]
  );
  const normalizedCouponInput = useMemo(() => normalizeCouponCodeInput(couponInput), [couponInput]);
  const isCouponApplied = useMemo(
    () => Boolean(appliedCoupon?.code && appliedCoupon.code === normalizedCouponInput),
    [appliedCoupon?.code, normalizedCouponInput]
  );
  const couponDiscountAmount = useMemo(() => {
    if (!isCouponApplied || !appliedCoupon) return 0;
    return roundCurrency((couponEligibleSubtotal * appliedCoupon.discountPct) / 100);
  }, [appliedCoupon, couponEligibleSubtotal, isCouponApplied]);
  const discountedSubtotal = useMemo(
    () => roundCurrency(Math.max(estimatedTotal - couponDiscountAmount, 0)),
    [couponDiscountAmount, estimatedTotal]
  );
  const selectedProducts = useMemo<SelectedOrderSummary[]>(
    () => [
      ...runtimeBoxEntries
        .map((entry) => ({ entry, quantity: parsedBoxCounts[entry.key] || 0 }))
        .filter((entry) => entry.quantity > 0)
        .map((entry) => ({
          key: entry.entry.key,
          label: entry.entry.label,
          quantity: entry.quantity,
          quantityLabel: `${entry.quantity} cx`,
          detail: entry.entry.detail
        })),
      ...activeCustomBoxes.map((box) => ({
        key: box.id,
        label: `Monte Sua Caixa #${box.index + 1}`,
        quantity: 1,
        quantityLabel: box.isComplete ? '1 cx' : `${box.totalUnits}/7`,
        detail: formatCustomBoxParts(box.flavors, flavorProducts)
      })),
      ...companionProducts
        .map((product) => ({
          product,
          quantity: parsedCompanionCounts[product.key] || 0,
          lines: resolveCompanionProductPublicLines(product)
        }))
        .filter((entry) => entry.quantity > 0)
        .map((entry) => ({
          key: entry.product.key,
          label: entry.product.label,
          displayLabel: entry.lines.title,
          quantity: entry.quantity,
          quantityLabel: `${entry.quantity} ${pluralize(entry.quantity, 'item', 'itens')}`,
          detail: [entry.lines.subtitleLine, entry.lines.makerLine].filter(Boolean).join(' • ') || null,
          displayDetail: entry.lines.subtitleLine || entry.lines.makerLine
        }))
    ],
    [activeCustomBoxes, companionProducts, flavorProducts, parsedBoxCounts, parsedCompanionCounts, runtimeBoxEntries]
  );
  const orderItemsSummaryEntries = useMemo(
    () => buildOrderItemsSummaryEntries(selectedProducts),
    [selectedProducts]
  );
  const deliveryManifestItems = useMemo(
    () =>
      computedOrderItems
        .map((item) => ({
          productId: item.productId,
          name: productMapById.get(item.productId)?.name || 'Produto',
          quantity: item.quantity
        }))
        .filter((entry) => entry.quantity > 0),
    [computedOrderItems, productMapById]
  );
  const legacyFlavorCounts = useMemo(
    () => ({
      T: broaOrderItems.find((item) => item.productId === runtimeOrderCatalog.flavorProductByLegacyCode.T?.id)?.quantity || 0,
      G: broaOrderItems.find((item) => item.productId === runtimeOrderCatalog.flavorProductByLegacyCode.G?.id)?.quantity || 0,
      D: broaOrderItems.find((item) => item.productId === runtimeOrderCatalog.flavorProductByLegacyCode.D?.id)?.quantity || 0,
      Q: broaOrderItems.find((item) => item.productId === runtimeOrderCatalog.flavorProductByLegacyCode.Q?.id)?.quantity || 0,
      R: broaOrderItems.find((item) => item.productId === runtimeOrderCatalog.flavorProductByLegacyCode.R?.id)?.quantity || 0,
      RJ: broaOrderItems.find((item) => item.productId === runtimeOrderCatalog.flavorProductByLegacyCode.RJ?.id)?.quantity || 0
    }),
    [broaOrderItems, runtimeOrderCatalog.flavorProductByLegacyCode]
  );
  const selectedWindowAvailability = useMemo(
    () => scheduleAvailability?.windows.find((window) => window.key === form.timeWindow) ?? null,
    [form.timeWindow, scheduleAvailability]
  );
  const deliveryAddressValidationError = useMemo(
    () =>
      validateRecognizedDeliveryAddress({
        fulfillmentMode: form.fulfillmentMode,
        address: form.address,
        addressLine1: form.addressLine1,
        addressLine2: form.addressLine2,
        neighborhood: form.neighborhood,
        placeId: form.placeId
      }),
    [
      form.address,
      form.addressLine1,
      form.addressLine2,
      form.fulfillmentMode,
      form.neighborhood,
      form.placeId
    ]
  );
  const selectedTimeWindowLabel = selectedWindowAvailability?.label ?? null;
  const scheduledAtIso = selectedWindowAvailability?.scheduledAt ?? null;
  const parsedScheduledAt = useMemo(() => {
    if (!scheduledAtIso) return null;
    const parsed = new Date(scheduledAtIso);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }, [scheduledAtIso]);
  const isScheduleBelowMinimum = useMemo(() => {
    if (!minimumSchedule || !parsedScheduledAt) return false;
    return parsedScheduledAt.getTime() < minimumSchedule.getTime();
  }, [minimumSchedule, parsedScheduledAt]);
  const deliveryQuoteRequestFingerprint = useMemo(() => {
    if (form.fulfillmentMode !== 'DELIVERY') return null;

    return hashPublicOrderSubmission({
      fulfillmentMode: form.fulfillmentMode,
      scheduledAt: scheduledAtIso,
      customer: {
        address: form.address.trim() || null,
        addressLine1: form.addressLine1.trim() || null,
        addressLine2: form.addressLine2.trim() || null,
        neighborhood: form.neighborhood.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        postalCode: form.postalCode.trim() || null,
        country: form.country.trim() || null,
        placeId: form.placeId.trim() || null,
        lat: typeof form.lat === 'number' ? Number(form.lat.toFixed(6)) : null,
        lng: typeof form.lng === 'number' ? Number(form.lng.toFixed(6)) : null
      },
      manifest: {
        items: deliveryManifestItems,
        subtotal: discountedSubtotal,
        totalUnits: totalSelectedItems
      }
    });
  }, [
    deliveryManifestItems,
    discountedSubtotal,
    form.address,
    form.addressLine1,
    form.addressLine2,
    form.city,
    form.country,
    form.fulfillmentMode,
    form.lat,
    form.lng,
    form.neighborhood,
    form.postalCode,
    form.placeId,
    form.state,
    scheduledAtIso,
    totalSelectedItems
  ]);
  const activeDeliveryQuote =
    form.fulfillmentMode !== 'DELIVERY'
      ? deliveryQuote
      : deliveryQuoteFingerprint && deliveryQuoteFingerprint === deliveryQuoteRequestFingerprint
        ? deliveryQuote
        : null;
  const hasActiveDeliveryQuoteToken = Boolean(activeDeliveryQuote?.quoteToken);
  const deliveryFee = activeDeliveryQuote?.fee ?? 0;
  const displayTotal = discountedSubtotal + deliveryFee;

  const fetchPublicScheduleAvailability = useCallback(async (options?: {
    requestedDate?: string | null;
    requestedWindowKey?: ExternalOrderDeliveryWindowKey | '' | null;
    requestedTotalBroas?: number;
  }) => {
    const params = new URLSearchParams();
    if (options?.requestedDate) {
      params.set('date', options.requestedDate);
    }
    if (options?.requestedWindowKey) {
      params.set('timeWindow', options.requestedWindowKey);
    }
    if (
      typeof options?.requestedTotalBroas === 'number' &&
      Number.isFinite(options.requestedTotalBroas) &&
      options.requestedTotalBroas > 0
    ) {
      params.set('totalBroas', String(Math.max(Math.floor(options.requestedTotalBroas), 0)));
    }
    const query = params.size > 0 ? `?${params.toString()}` : '';
    const response = await fetch(`/api/order-schedule${query}`, {
      method: 'GET',
      cache: 'no-store'
    });
    const raw = await response.text();
    const data = raw ? JSON.parse(raw) : null;
    if (!response.ok) {
      throw new Error(extractErrorMessage(data));
    }
    if (!isPublicOrderScheduleAvailability(data)) {
      throw new Error('Resposta inválida da agenda pública.');
    }
    return data;
  }, []);

  const syncScheduleAvailability = useCallback(async (options?: {
    requestedDate?: string | null;
    requestedWindowKey?: ExternalOrderDeliveryWindowKey | '' | null;
  }) => {
    const requestId = scheduleSyncRequestIdRef.current + 1;
    scheduleSyncRequestIdRef.current = requestId;

    try {
      const availability = await fetchPublicScheduleAvailability({
        requestedDate: options?.requestedDate,
        requestedWindowKey: options?.requestedWindowKey,
        requestedTotalBroas: Math.max(totalBroas, ORDER_BOX_UNITS)
      });
      if (scheduleSyncRequestIdRef.current !== requestId) {
        return;
      }
      setScheduleAvailability(availability);
      const nextMinimum = new Date(availability.nextAvailableAt);
      if (Number.isNaN(nextMinimum.getTime())) {
        throw new Error('Agenda pública inválida.');
      }
      setMinimumSchedule(new Date(availability.minimumAllowedAt));

      const nextAvailableDate = formatDateInputValue(nextMinimum);
      const nextAvailableWindowKey = resolveExternalOrderDeliveryWindowKeyForDate(nextMinimum) ?? '';
      const firstAvailableWindowKey = availability.windows.find((window) => window.available)?.key ?? '';

      setForm((current) => {
        const requestedDate = options?.requestedDate ?? current.date;
        const requestedWindowKey = options?.requestedWindowKey ?? current.timeWindow;
        const keepRequestedDate = Boolean(requestedDate) && availability.requestedDate === requestedDate && availability.windows.some((window) => window.available);
        const nextDate = keepRequestedDate ? availability.requestedDate : nextAvailableDate;
        const preferredWindowKey =
          availability.windows.find((window) => window.key === requestedWindowKey && window.available)?.key ??
          firstAvailableWindowKey ??
          nextAvailableWindowKey;
        const nextTimeWindow = keepRequestedDate ? preferredWindowKey : nextAvailableWindowKey || preferredWindowKey;

        if (current.date === nextDate && current.timeWindow === nextTimeWindow) {
          return current;
        }

        return {
          ...current,
          date: nextDate,
          timeWindow: nextTimeWindow
        };
      });
    } catch {
      if (scheduleSyncRequestIdRef.current !== requestId) {
        return;
      }
      const fallbackMinimum = resolveExternalOrderMinimumSchedule();
      setScheduleAvailability(null);
      setMinimumSchedule(fallbackMinimum);
      setForm((current) => ({
        ...current,
        date: formatDateInputValue(fallbackMinimum),
        timeWindow: resolveExternalOrderDeliveryWindowKeyForDate(fallbackMinimum) ?? 'MORNING'
      }));
    }
  }, [fetchPublicScheduleAvailability, totalBroas]);

  useEffect(() => {
    const syncCurrentSelection = () =>
      void syncScheduleAvailability({
        requestedDate: form.date || null,
        requestedWindowKey: form.timeWindow || null
      });

    syncCurrentSelection();
    const timer = window.setInterval(() => {
      syncCurrentSelection();
    }, 60_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncCurrentSelection();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [form.date, form.timeWindow, syncScheduleAvailability]);

  const applyCoupon = useCallback(
    async (forcedCode?: string | null) => {
      const code = normalizeCouponCodeInput(forcedCode ?? couponInput);
      if (!code) {
        setAppliedCoupon(null);
        setCouponError(null);
        return null;
      }

      if (estimatedTotal <= 0) {
        setAppliedCoupon(null);
      setCouponError('Escolha ao menos 1 item antes de aplicar o cupom.');
        return null;
      }

      setIsResolvingCoupon(true);
      setCouponError(null);

      try {
        const response = await fetch('/api/customer-form/coupon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            subtotal: couponEligibleSubtotal,
            customerPhone: normalizePhone(form.phone || ''),
            customerName: form.name.trim() || null
          })
        });
        const raw = await response.text();
        const data = raw ? (JSON.parse(raw) as AppliedCoupon | { message?: string }) : null;
        if (!response.ok || !data || !('code' in data)) {
          throw new Error(extractErrorMessage(data));
        }
        setCouponInput(data.code);
        setAppliedCoupon(data);
        setCouponError(null);
        setPendingPrefilledCouponCode(null);
        return data;
      } catch (couponLoadError) {
        const message =
          couponLoadError instanceof Error ? couponLoadError.message : 'Não foi possível validar o cupom.';
        setAppliedCoupon(null);
        setCouponError(message);
        return null;
      } finally {
        setIsResolvingCoupon(false);
      }
    },
    [couponEligibleSubtotal, couponInput, estimatedTotal, form.name, form.phone]
  );

  useEffect(() => {
    if (!pendingPrefilledCouponCode) return;
    if (estimatedTotal <= 0) return;
    if (appliedCoupon?.code === pendingPrefilledCouponCode) {
      setPendingPrefilledCouponCode(null);
      return;
    }
    void applyCoupon(pendingPrefilledCouponCode);
  }, [appliedCoupon?.code, applyCoupon, estimatedTotal, pendingPrefilledCouponCode]);

  const clearCoupon = useCallback(() => {
    setCouponInput('');
    setAppliedCoupon(null);
    setCouponError(null);
    setPendingPrefilledCouponCode(null);
  }, []);

  const setBoxQuantity = (code: string, nextValue: number | string) => {
    const normalized = typeof nextValue === 'number' ? String(Math.max(Math.floor(nextValue), 0)) : nextValue;
    setForm((current) => ({
      ...current,
      boxes: {
        ...current.boxes,
        [code]: normalized === '0' ? '' : normalized
      }
    }));
  };

  const setCompanionQuantity = (code: string, nextValue: number | string) => {
    const normalized = typeof nextValue === 'number' ? String(Math.max(Math.floor(nextValue), 0)) : nextValue;
    setForm((current) => ({
      ...current,
      companions: {
        ...current.companions,
        [code]: normalized === '0' ? '' : normalized
      }
    }));
  };

  const setMixedBoxQuantity = useCallback((boxKey: string, nextValue: number) => {
    setBoxQuantity(boxKey, Math.max(Math.floor(nextValue || 0), 0));
  }, []);

  const addCustomBox = () => {
    setCustomBoxes((current) => [...current, createEmptyCustomBoxDraft()]);
  };

  const removeCustomBox = (boxId: string) => {
    setCustomBoxes((current) => current.filter((entry) => entry.id !== boxId));
  };

  const adjustCustomBoxFlavor = (boxId: string, flavorKey: string, delta: number) => {
    setCustomBoxes((current) =>
      current.map((entry) => {
        if (entry.id !== boxId) return entry;
        const currentValue = Math.max(Math.floor(entry.flavors[flavorKey] || 0), 0);
        if (delta < 0) {
          return {
            ...entry,
            flavors: {
              ...entry.flavors,
              [flavorKey]: Math.max(currentValue + delta, 0)
            }
          };
        }

        const totalUnits = Object.values(entry.flavors).reduce(
          (sum, quantity) => sum + Math.max(Math.floor(quantity || 0), 0),
          0
        );
        if (totalUnits >= ORDER_BOX_UNITS) return entry;
        return {
          ...entry,
          flavors: {
            ...entry.flavors,
            [flavorKey]: currentValue + delta
          }
        };
      })
    );
  };

  useEffect(() => {
    if (form.fulfillmentMode !== 'DELIVERY') {
      cancelPendingDeliveryQuote();
      setDeliveryQuote({
        provider: 'NONE',
        fee: 0,
        currencyCode: 'BRL',
        source: 'NONE',
        status: 'NOT_REQUIRED',
        quoteToken: null,
        expiresAt: null,
        fallbackReason: null,
        breakdownLabel: 'Sem frete'
      });
      setDeliveryQuoteFingerprint(null);
      setDeliveryQuoteError(null);
      setIsQuotingDelivery(false);
      return;
    }

    if (deliveryAddressValidationError) {
      cancelPendingDeliveryQuote();
      setDeliveryQuote(null);
      setDeliveryQuoteFingerprint(null);
      setDeliveryQuoteError(null);
      setIsQuotingDelivery(false);
      return;
    }

    if (isScheduleBelowMinimum) {
      cancelPendingDeliveryQuote();
      setDeliveryQuote(null);
      setDeliveryQuoteFingerprint(null);
      setDeliveryQuoteError(null);
      setIsQuotingDelivery(false);
      return;
    }

    if (!form.address.trim() || !scheduledAtIso || totalSelectedItems <= 0 || incompleteCustomBoxes.length > 0) {
      cancelPendingDeliveryQuote();
      setDeliveryQuote(null);
      setDeliveryQuoteFingerprint(null);
      setDeliveryQuoteError(null);
      setIsQuotingDelivery(false);
      return;
    }

    if (deliveryQuoteFingerprint && deliveryQuoteFingerprint !== deliveryQuoteRequestFingerprint) {
      cancelPendingDeliveryQuote();
      setDeliveryQuote(null);
      setDeliveryQuoteFingerprint(null);
      setDeliveryQuoteError(null);
      setIsQuotingDelivery(false);
    }
  }, [
    deliveryQuoteFingerprint,
    deliveryQuoteRequestFingerprint,
    form.address,
    form.fulfillmentMode,
    scheduledAtIso,
    totalSelectedItems,
    incompleteCustomBoxes.length,
    deliveryAddressValidationError,
    isScheduleBelowMinimum,
    cancelPendingDeliveryQuote
  ]);

  useEffect(() => {
    if (form.fulfillmentMode === 'DELIVERY' && hasActiveDeliveryQuoteToken) return;
    clearDeliveryQuoteConfirmationGuard();
  }, [clearDeliveryQuoteConfirmationGuard, form.fulfillmentMode, hasActiveDeliveryQuoteToken]);

  useEffect(() => () => {
    cancelPendingDeliveryQuote();
    clearDeliveryQuoteConfirmationGuard();
  }, [cancelPendingDeliveryQuote, clearDeliveryQuoteConfirmationGuard]);

  useEffect(() => {
    if (form.fulfillmentMode !== 'PICKUP') return;
    if (
      form.address === PUBLIC_ORDER_PICKUP_ADDRESS &&
      !form.placeId &&
      form.lat == null &&
      form.lng == null
    ) {
      return;
    }
      setForm((current) =>
      current.fulfillmentMode !== 'PICKUP'
        ? current
        : {
            ...current,
            address: PUBLIC_ORDER_PICKUP_ADDRESS,
            addressLine1: '',
            placeId: '',
            neighborhood: '',
            city: '',
            state: '',
            postalCode: '',
            country: '',
            lat: null,
            lng: null
          }
    );
  }, [form.address, form.fulfillmentMode, form.lat, form.lng, form.placeId]);

  const requestDeliveryQuote = useCallback(async () => {
    if (form.fulfillmentMode !== 'DELIVERY') {
      setDeliveryQuote({
        provider: 'NONE',
        fee: 0,
        currencyCode: 'BRL',
        source: 'NONE',
        status: 'NOT_REQUIRED',
        quoteToken: null,
        expiresAt: null,
        fallbackReason: null,
        breakdownLabel: 'Sem frete'
      });
      setDeliveryQuoteFingerprint(null);
      setDeliveryQuoteError(null);
      return null;
    }

    if (deliveryAddressValidationError) {
      setDeliveryQuote(null);
      setDeliveryQuoteError(deliveryAddressValidationError);
      return null;
    }

    if (!form.timeWindow || !selectedWindowAvailability?.available || !scheduledAtIso) {
      setDeliveryQuote(null);
      setDeliveryQuoteError('Escolha uma faixa de horario disponivel para calcular o frete.');
      return null;
    }

    if (totalSelectedItems <= 0) {
      setDeliveryQuote(null);
      setDeliveryQuoteError('Escolha ao menos 1 item antes de calcular o frete.');
      return null;
    }

    if (incompleteCustomBoxes.length > 0) {
      setDeliveryQuote(null);
      setDeliveryQuoteError('Complete todas as caixas Sabores antes de calcular o frete.');
      return null;
    }

    if (normalizedCouponInput && !isCouponApplied) {
      setDeliveryQuote(null);
      setDeliveryQuoteError('Aplique o cupom antes de calcular o frete.');
      return null;
    }

    if (minimumSchedule && parsedScheduledAt && parsedScheduledAt.getTime() < minimumSchedule.getTime()) {
      setDeliveryQuote(null);
      setDeliveryQuoteFingerprint(null);
      setDeliveryQuoteError(buildPublicOrderScheduleErrorMessage(minimumSchedule));
      return null;
    }

    setIsQuotingDelivery(true);
    setDeliveryQuoteError(null);
    deliveryQuoteAbortControllerRef.current?.abort();
    const requestId = ++deliveryQuoteRequestIdRef.current;
    const requestFingerprint = deliveryQuoteRequestFingerprint;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), DELIVERY_QUOTE_REQUEST_TIMEOUT_MS);
    deliveryQuoteAbortControllerRef.current = controller;
    const analyticsSessionId = resolveAnalyticsSessionId();
    trackAnalyticsEvent({
      sessionId: analyticsSessionId,
      eventType: 'FUNNEL',
      path: '/pedido',
        label: 'public_order_quote_requested',
        meta: {
          fulfillmentMode: form.fulfillmentMode,
          totalBroas,
          estimatedTotal,
          discountedSubtotal,
          orderDraftSessionId: draftSessionId
        }
      });

    try {
      const response = await fetch('/api/delivery-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          mode: form.fulfillmentMode,
          scheduledAt: scheduledAtIso,
          customer: {
            address: form.address.trim() || null,
            addressLine1: form.addressLine1.trim() || null,
            addressLine2: form.addressLine2.trim() || null,
            neighborhood: form.neighborhood.trim() || null,
            city: form.city.trim() || null,
            state: form.state.trim() || null,
            postalCode: form.postalCode.trim() || null,
            country: form.country.trim() || null,
            placeId: form.placeId.trim() || null,
            lat: typeof form.lat === 'number' ? form.lat : null,
            lng: typeof form.lng === 'number' ? form.lng : null
          },
          manifest: {
            items: deliveryManifestItems,
            subtotal: discountedSubtotal,
            totalUnits: totalSelectedItems
          }
        })
      });

      const raw = await response.text();
      const data = raw ? (JSON.parse(raw) as DeliveryQuote) : null;
      if (!response.ok || !data) {
        throw new Error(extractErrorMessage(data));
      }
      if (requestId !== deliveryQuoteRequestIdRef.current) {
        return data;
      }

      setDeliveryQuote(data);
      setDeliveryQuoteFingerprint(requestFingerprint);
      setDeliveryQuoteError(null);
      armDeliveryQuoteConfirmationGuard();
      trackAnalyticsEvent({
        sessionId: analyticsSessionId,
        eventType: 'FUNNEL',
        path: '/pedido',
        label: 'public_order_quote_success',
        meta: {
          provider: data.provider,
          fee: data.fee,
          source: data.source,
          orderDraftSessionId: draftSessionId
        }
      });
      return data;
    } catch (quoteError) {
      if (requestId !== deliveryQuoteRequestIdRef.current) {
        return null;
      }
      const message =
        quoteError instanceof Error && quoteError.name === 'AbortError'
          ? 'A cotação do frete demorou mais que o esperado. Tente novamente.'
          : quoteError instanceof Error
            ? quoteError.message
            : 'Não foi possível calcular o frete agora.';
      setDeliveryQuote(null);
      setDeliveryQuoteFingerprint(null);
      setDeliveryQuoteError(message);
      trackAnalyticsEvent({
        sessionId: analyticsSessionId,
        eventType: 'FUNNEL',
        path: '/pedido',
        label: 'public_order_quote_failed',
        meta: {
          message,
          orderDraftSessionId: draftSessionId
        }
      });
      return null;
    } finally {
      window.clearTimeout(timeoutId);
      if (requestId === deliveryQuoteRequestIdRef.current) {
        deliveryQuoteAbortControllerRef.current = null;
        setIsQuotingDelivery(false);
      }
    }
  }, [
    armDeliveryQuoteConfirmationGuard,
    draftSessionId,
    discountedSubtotal,
    estimatedTotal,
    form.address,
    form.addressLine1,
    form.addressLine2,
    form.city,
    form.country,
    form.fulfillmentMode,
    form.lat,
    form.lng,
    form.neighborhood,
    form.postalCode,
    form.placeId,
    form.state,
    form.timeWindow,
    incompleteCustomBoxes.length,
    isCouponApplied,
    minimumSchedule,
    normalizedCouponInput,
    parsedScheduledAt,
    selectedWindowAvailability?.available,
    scheduledAtIso,
    deliveryManifestItems,
    deliveryQuoteRequestFingerprint,
    totalBroas,
    totalSelectedItems,
    deliveryAddressValidationError
  ]);

  const hasDeliveryQuoteReady =
    form.fulfillmentMode !== 'DELIVERY' || hasActiveDeliveryQuoteToken;
  const primaryActionLabel = isSubmitting
    ? 'FINALIZANDO...'
    : isResolvingCoupon
      ? 'VALIDANDO CUPOM...'
    : form.fulfillmentMode === 'DELIVERY' && !hasDeliveryQuoteReady
      ? isQuotingDelivery
        ? 'CALCULANDO FRETE...'
        : 'CALCULAR FRETE'
      : 'FINALIZAR PEDIDO';

  const handlePrimaryAction = async () => {
    if (isSubmitting) return;
    if (form.fulfillmentMode === 'DELIVERY' && isDeliveryQuoteConfirmationPending) {
      setError('Frete calculado. Confira o total e toque em Finalizar Pedido.');
      return;
    }
    if (form.fulfillmentMode === 'DELIVERY' && !hasDeliveryQuoteReady) {
      await requestDeliveryQuote();
      return;
    }
    orderFormRef.current?.requestSubmit();
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const scheduledAt = scheduledAtIso;
    const currentMinimumSchedule = minimumSchedule ?? resolveExternalOrderMinimumSchedule();
    if (!form.name.trim()) {
      setError('Informe o nome completo.');
      return;
    }
    if (!form.phone.trim()) {
      setError('Informe o telefone.');
      return;
    }
    const deliveryAddressError = validateRecognizedDeliveryAddress(form);
    if (deliveryAddressError) {
      setError(deliveryAddressError);
      return;
    }
    if (!form.date) {
      setError('Informe a data do pedido.');
      return;
    }
    if (!form.timeWindow || !selectedWindowAvailability?.available || !scheduledAt) {
      setError('Escolha uma faixa de horario disponivel.');
      return;
    }
    if (!parsedScheduledAt || parsedScheduledAt.getTime() < currentMinimumSchedule.getTime()) {
      const suggestedWindowKey = resolveExternalOrderDeliveryWindowKeyForDate(currentMinimumSchedule) ?? 'MORNING';
      setForm((current) => ({
        ...current,
        date: formatDateInputValue(currentMinimumSchedule),
        timeWindow: suggestedWindowKey
      }));
      setMinimumSchedule(currentMinimumSchedule);
      setError(buildPublicOrderScheduleErrorMessage(currentMinimumSchedule));
      return;
    }
    if (totalSelectedItems <= 0) {
      setError('Escolha ao menos 1 item.');
      return;
    }
    if (incompleteCustomBoxes.length > 0) {
      const firstOpenBox = incompleteCustomBoxes[0];
      setError(
        `Complete a Monte Sua Caixa #${firstOpenBox.index + 1}. Faltam ${firstOpenBox.remainingUnits} broa(s) para fechar 7.`
      );
      return;
    }
    if (normalizedCouponInput && !isCouponApplied) {
      setError('Aplique o cupom antes de finalizar o pedido.');
      return;
    }
    if (form.fulfillmentMode === 'DELIVERY') {
      if (isQuotingDelivery) {
        setError('Aguarde o frete terminar de calcular.');
        return;
      }
      if (isDeliveryQuoteConfirmationPending) {
        setError('Frete calculado. Confira o total e toque em Finalizar Pedido.');
        return;
      }
      if (!activeDeliveryQuote?.quoteToken) {
        setError(deliveryQuoteError || 'Calcule o frete antes de finalizar o pedido.');
        return;
      }
    }

    const payloadBase = {
      version: 1,
      customer: {
        name: form.name.trim(),
        phone: form.phone.trim(),
        address: form.fulfillmentMode === 'DELIVERY' ? form.address.trim() : null,
        addressLine1: form.fulfillmentMode === 'DELIVERY' ? form.addressLine1.trim() || null : null,
        addressLine2: form.fulfillmentMode === 'DELIVERY' ? form.addressLine2.trim() || null : null,
        neighborhood: form.fulfillmentMode === 'DELIVERY' ? form.neighborhood.trim() || null : null,
        city: form.fulfillmentMode === 'DELIVERY' ? form.city.trim() || null : null,
        state: form.fulfillmentMode === 'DELIVERY' ? form.state.trim() || null : null,
        postalCode: form.fulfillmentMode === 'DELIVERY' ? form.postalCode.trim() || null : null,
        country: form.fulfillmentMode === 'DELIVERY' ? form.country.trim() || null : null,
        placeId: form.fulfillmentMode === 'DELIVERY' ? form.placeId.trim() || null : null,
        lat: form.fulfillmentMode === 'DELIVERY' && typeof form.lat === 'number' ? form.lat : null,
        lng: form.fulfillmentMode === 'DELIVERY' && typeof form.lng === 'number' ? form.lng : null,
        deliveryNotes: null
      },
      fulfillment: {
        mode: form.fulfillmentMode,
        scheduledAt,
        date: form.date,
        timeWindow: form.timeWindow
      },
      delivery:
        form.fulfillmentMode === 'DELIVERY' && activeDeliveryQuote
          ? ({
              quoteToken: activeDeliveryQuote.quoteToken,
              fee: activeDeliveryQuote.fee,
              provider: activeDeliveryQuote.provider,
              source: activeDeliveryQuote.source,
              status: activeDeliveryQuote.status,
              expiresAt: activeDeliveryQuote.expiresAt
            } as ExternalOrderSubmission['delivery'])
          : undefined,
      flavors: legacyFlavorCounts,
      items: computedOrderItems,
      couponCode: isCouponApplied ? appliedCoupon?.code ?? null : null,
      notes: mergeOrderItemsSummaryIntoNotes(form.notes.trim() || null, orderItemsSummaryEntries),
      source: {
        channel: 'PUBLIC_FORM',
        originLabel: 'public-order-page',
        externalId: draftSessionId,
        idempotencyKey: null
      }
    } satisfies ExternalOrderSubmission & {
      items: Array<{ productId: number; quantity: number }>;
    };

    const submissionFingerprint = hashPublicOrderSubmission({
      version: payloadBase.version,
      customer: payloadBase.customer,
      fulfillment: payloadBase.fulfillment,
      delivery: payloadBase.delivery,
      items: payloadBase.items,
      couponCode: payloadBase.couponCode,
      notes: payloadBase.notes
    });
    const payload = {
      ...payloadBase,
      source: {
        ...payloadBase.source,
        idempotencyKey: `public-form:${draftSessionId}:${submissionFingerprint}`
      }
    };

    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/customer-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const raw = await response.text();
      const data = raw ? JSON.parse(raw) : null;
      if (!response.ok) {
        const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
        if (record?.code === 'DELIVERY_QUOTE_REFRESH_REQUIRED' && record.delivery && typeof record.delivery === 'object') {
          setDeliveryQuote(record.delivery as DeliveryQuote);
          setDeliveryQuoteFingerprint(deliveryQuoteRequestFingerprint);
          setDeliveryQuoteError('O frete foi atualizado. Confira o novo total e envie novamente.');
          armDeliveryQuoteConfirmationGuard();
        }
        if (typeof record?.nextAvailableAt === 'string') {
          const suggestedSchedule = new Date(record.nextAvailableAt);
          if (!Number.isNaN(suggestedSchedule.getTime())) {
            setForm((current) => ({
              ...current,
              date: formatDateInputValue(suggestedSchedule),
              timeWindow: resolveExternalOrderDeliveryWindowKeyForDate(suggestedSchedule) ?? current.timeWindow
            }));
            setMinimumSchedule(suggestedSchedule);
          }
        }
        throw new Error(extractErrorMessage(data));
      }
      const storedOrderSnapshot: StoredPublicOrderSnapshot = {
        version: 3,
        savedAt: new Date().toISOString(),
        boxes: sanitizeStoredBoxCounts(form.boxes),
        companions: sanitizeStoredBoxCounts(form.companions),
        customBoxes: customBoxes.map((entry) => sanitizeStoredCustomBox(entry.flavors)),
        notes: form.notes.trim()
      };
      window.localStorage.setItem(PUBLIC_ORDER_LAST_ORDER_STORAGE_KEY, JSON.stringify(storedOrderSnapshot));
      const result = data as PublicOrderResult;
      writeStoredOrderFinalized({
        version: 1,
        origin: 'PUBLIC_FORM',
        savedAt: new Date().toISOString(),
        returnPath: '/pedido',
        returnLabel: 'Fazer novo pedido',
        productSubtotal: discountedSubtotal,
        order: {
          total: result.order.total ?? null,
          scheduledAt: result.order.scheduledAt ?? null,
          deliveryWindowLabel: selectedTimeWindowLabel
        },
        intake: {
          stage: result.intake.stage,
          deliveryFee: result.intake.deliveryFee,
          pixCharge: result.intake.pixCharge
        }
      });
      trackAnalyticsEvent({
        sessionId: resolveAnalyticsSessionId(),
        eventType: 'FUNNEL',
        path: '/pedido',
        label: 'public_order_submitted',
        meta: {
          total: result.order.total ?? displayTotal,
          fulfillmentMode: form.fulfillmentMode,
          orderDraftSessionId: draftSessionId
        }
      });
      router.push('/pedidofinalizado');
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Não foi possível enviar o pedido.';
      setError(message);
      trackAnalyticsEvent({
        sessionId: resolveAnalyticsSessionId(),
        eventType: 'FUNNEL',
        path: '/pedido',
        label: 'public_order_submit_failed',
        meta: {
          message,
          orderDraftSessionId: draftSessionId
        }
      });
      notifyError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    const nextMinimum = minimumSchedule ?? resolveExternalOrderMinimumSchedule();
    deliveryAddressDraftRef.current = {
      address: '',
      addressLine1: '',
      neighborhood: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
      placeId: '',
      lat: null,
      lng: null
    };
    setDraftSessionId(createPublicOrderDraftSessionId());
    setMinimumSchedule(nextMinimum);
    setForm({
      ...initialFormState,
      date: formatDateInputValue(nextMinimum),
      timeWindow: resolveExternalOrderDeliveryWindowKeyForDate(nextMinimum) ?? 'MORNING'
    });
    setCustomBoxes([]);
    setError(null);
    setDeliveryQuote(null);
    setDeliveryQuoteFingerprint(null);
    setDeliveryQuoteError(null);
    clearDeliveryQuoteConfirmationGuard();
    setCouponInput('');
    setAppliedCoupon(null);
    setCouponError(null);
    setPendingPrefilledCouponCode(null);
    void syncScheduleAvailability();
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(234,223,200,0.5),transparent_34%),radial-gradient(circle_at_top_right,rgba(210,228,219,0.54),transparent_30%),linear-gradient(180deg,#fbf4ea_0%,#f7efe3_100%)]">
      <div className="mx-auto w-full max-w-[1720px] px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-8 xl:px-10 2xl:px-12">
        <section className="public-order-layout">
          <form
            autoComplete="on"
            className="grid gap-4 rounded-[26px] border border-[rgba(126,79,45,0.1)] bg-[rgb(255,253,250)] p-4 shadow-[0_22px_60px_rgba(70,44,26,0.1)] sm:gap-5 sm:rounded-[32px] sm:p-6 sm:shadow-[0_26px_90px_rgba(70,44,26,0.1)] xl:rounded-none xl:border-0 xl:bg-transparent xl:p-0 xl:shadow-none"
            onSubmit={onSubmit}
            ref={orderFormRef}
          >
            <div className="public-order-intake-grid">
              <section
                className="rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-white p-4 sm:rounded-[28px] sm:p-6 xl:h-full xl:p-7"
                data-order-boxes-section
              >
                <div className="mb-4 flex items-center justify-between gap-4 sm:mb-5">
                  <div>
                    <h2 className="text-[1.35rem] font-semibold text-[color:var(--ink-strong)] sm:text-2xl">Dados</h2>
                  </div>
                </div>
                <div className="grid gap-4 xl:grid-cols-1">
                  <FormField label="Nome completo">
                    <input
                      autoFocus
                      className="app-input xl:h-14 xl:text-[1.02rem]"
                      name="name"
                      value={form.name}
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Nome e sobrenome"
                      autoCapitalize="words"
                      autoComplete="name"
                    />
                  </FormField>
                  <FormField label="Telefone">
                    <input
                      className="app-input xl:h-14 xl:text-[1.02rem]"
                      type="tel"
                      name="tel"
                      value={form.phone}
                      onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                      placeholder="(31) 99999-9999"
                      autoComplete="tel"
                      inputMode="tel"
                    />
                  </FormField>
                </div>
              </section>

              <section className="public-order-fulfillment-section rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-white p-4 sm:rounded-[28px] sm:p-6 xl:p-7">
                <div className="mb-4 sm:mb-5">
                  <h2 className="text-[1.35rem] font-semibold text-[color:var(--ink-strong)] sm:text-2xl">
                    Entrega ou retirada
                  </h2>
                </div>

                <div className="public-order-mode-grid">
                  {[
                    {
                      value: 'DELIVERY' as const,
                      title: 'Entrega',
                      description: 'Receber no endereço.'
                    },
                    {
                      value: 'PICKUP' as const,
                      title: 'Retirada',
                      description: 'Buscar no local combinado.'
                    }
                  ].map((option) => {
                    const active = form.fulfillmentMode === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleFulfillmentModeChange(option.value)}
                        className={`public-order-mode-card rounded-[24px] border px-4 py-4 text-left xl:min-h-[112px] xl:px-5 ${
                          active
                            ? 'border-[rgba(181,68,57,0.32)] bg-[rgb(255,245,241)] shadow-[0_16px_34px_rgba(181,68,57,0.12)]'
                            : 'border-[rgba(126,79,45,0.08)] bg-[rgb(250,245,239)] hover:border-[rgba(126,79,45,0.18)] hover:bg-[rgb(255,252,248)]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="public-order-mode-card__title text-base font-semibold text-[color:var(--ink-strong)] xl:text-[1.05rem]">
                              {option.title}
                            </p>
                            <p className="public-order-mode-card__description mt-1 text-sm text-[color:var(--ink-muted)] xl:text-[0.95rem]">
                              {option.description}
                            </p>
                          </div>
                          <span
                            className={`grid h-6 w-6 place-items-center rounded-full border text-xs ${
                              active
                                ? 'border-[rgba(181,68,57,0.3)] bg-[rgb(255,234,228)] text-[rgb(160,20,26)]'
                                : 'border-[rgba(126,79,45,0.14)] bg-white text-[color:var(--ink-muted)]'
                            }`}
                          >
                            {active ? '✓' : ''}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="public-order-schedule-grid mt-5">
                  <div className="public-order-schedule-grid__address">
                    <FormField
                      label={form.fulfillmentMode === 'DELIVERY' ? 'Endereço para entrega' : 'Ponto de retirada'}
                    >
                      <GoogleAddressAutocompleteInput
                        className="app-input xl:h-14 xl:text-[1.02rem]"
                        dropdownVariant="plain"
                        inputRef={addressInputRef}
                        name="street-address"
                        value={form.address}
                        onValueChange={(nextValue) =>
                          setForm((current) => {
                            if (current.fulfillmentMode !== 'DELIVERY') return current;
                            rememberDeliveryLocation({
                              address: nextValue,
                              addressLine1: '',
                              neighborhood: '',
                              city: '',
                              state: '',
                              postalCode: '',
                              country: '',
                              placeId: '',
                              lat: null,
                              lng: null
                            });
                            return {
                              ...current,
                              address: nextValue,
                              addressLine1: '',
                              neighborhood: '',
                              city: '',
                              state: '',
                              postalCode: '',
                              country: '',
                              placeId: '',
                              lat: null,
                              lng: null
                            };
                          })
                        }
                        onGooglePlacePick={(patch) => {
                          const nextAddress = `${patch.address || ''}`.trim();
                          if (!nextAddress) return;
                          rememberDeliveryLocation({
                            address: nextAddress,
                            addressLine1: `${patch.addressLine1 || ''}`.trim(),
                            neighborhood: `${patch.neighborhood || ''}`.trim(),
                            city: `${patch.city || ''}`.trim(),
                            state: `${patch.state || ''}`.trim(),
                            postalCode: `${patch.postalCode || ''}`.trim(),
                            country: `${patch.country || ''}`.trim(),
                            placeId: `${patch.placeId || ''}`,
                            lat: typeof patch.lat === 'number' ? patch.lat : null,
                            lng: typeof patch.lng === 'number' ? patch.lng : null
                          });

                          setForm((current) => {
                            if (current.fulfillmentMode !== 'DELIVERY') return current;
                            return {
                              ...current,
                              address: nextAddress,
                              addressLine1: `${patch.addressLine1 || ''}`.trim(),
                              addressLine2: current.addressLine2 || `${patch.addressLine2 || ''}`.trim(),
                              neighborhood: `${patch.neighborhood || ''}`.trim(),
                              city: `${patch.city || ''}`.trim(),
                              state: `${patch.state || ''}`.trim(),
                              postalCode: `${patch.postalCode || ''}`.trim(),
                              country: `${patch.country || ''}`.trim(),
                              placeId: `${patch.placeId || ''}`,
                              lat: typeof patch.lat === 'number' ? patch.lat : null,
                              lng: typeof patch.lng === 'number' ? patch.lng : null
                            };
                          });
                        }}
                        placeholder={
                          form.fulfillmentMode === 'DELIVERY'
                            ? 'Rua, numero e bairro'
                            : PUBLIC_ORDER_PICKUP_ADDRESS
                        }
                        autoCapitalize="words"
                        autoComplete={form.fulfillmentMode === 'DELIVERY' ? 'street-address' : 'off'}
                        googleApiKey={GOOGLE_MAPS_API_KEY}
                        googleEnabled={form.fulfillmentMode === 'DELIVERY' && !isPickupSelected}
                        readOnly={isPickupSelected}
                        aria-readonly={isPickupSelected}
                        spellCheck={false}
                      />
                    </FormField>
                  </div>
                  <div className="public-order-schedule-grid__complement">
                    <FormField label="Complemento">
                      <input
                        className="app-input xl:h-14 xl:text-[1.02rem]"
                        name="address-line2"
                        value={form.addressLine2}
                        onChange={(event) => setForm((current) => ({ ...current, addressLine2: event.target.value }))}
                        placeholder="Apto, Bloco, Casa"
                        autoComplete={form.fulfillmentMode === 'DELIVERY' ? 'address-line2' : 'off'}
                        autoCapitalize="sentences"
                      />
                    </FormField>
                  </div>
                  <FormField label="Data">
                    <input
                      className="app-input xl:h-14 xl:text-[1.02rem]"
                      type="date"
                      min={minimumDateValue || undefined}
                      value={form.date}
                      onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                    />
                  </FormField>
                  <FormField label="Faixa de horario">
                    <div className="grid gap-2.5">
                      {(scheduleAvailability?.windows ?? EXTERNAL_ORDER_DELIVERY_WINDOWS.map((window) => ({
                        key: window.key,
                        label: window.label,
                        startLabel: `${window.startHour}h`,
                        endLabel: `${window.endHour}h`,
                        available: false,
                        scheduledAt: null,
                        reason: 'SLOT_TAKEN' as const
                      }))).map((window) => {
                        const active = form.timeWindow === window.key;
                        return (
                          <button
                            key={window.key}
                            type="button"
                            onClick={() =>
                              window.available &&
                              setForm((current) => ({
                                ...current,
                                timeWindow: window.key
                              }))
                            }
                            disabled={!window.available}
                            className={`rounded-[18px] border px-4 py-3 text-left transition ${
                              active && window.available
                                ? 'border-[rgba(181,68,57,0.28)] bg-[rgb(255,245,241)] shadow-[0_14px_28px_rgba(181,68,57,0.12)]'
                                : window.available
                                  ? 'border-[rgba(126,79,45,0.12)] bg-[rgb(252,248,242)] hover:border-[rgba(126,79,45,0.22)]'
                                  : 'cursor-not-allowed border-[rgba(126,79,45,0.08)] bg-[rgb(246,241,235)] opacity-60'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-[color:var(--ink-strong)] xl:text-[1rem]">
                                  {window.label}
                                </p>
                                <p className="mt-1 text-xs text-[color:var(--ink-muted)] xl:text-[0.9rem]">
                                  {window.available ? 'Disponivel' : 'Indisponivel'}
                                </p>
                              </div>
                              {active && window.available ? (
                                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[rgb(255,234,228)] text-[rgb(160,20,26)]">
                                  ✓
                                </span>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </FormField>
                </div>

              </section>
            </div>

            <section
              id="caixas"
              className="rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-white p-4 scroll-mt-6 sm:rounded-[28px] sm:p-6 xl:p-7"
            >
              <div className="mb-4 flex flex-col gap-2 sm:mb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                <div>
                  <h2 className="text-[1.35rem] font-semibold text-[color:var(--ink-strong)] sm:text-2xl">Caixas</h2>
                </div>
              </div>

              <div className="public-order-box-grid">
                {singleBoxEntries.map((entry) => {
                  const quantity = parsedBoxCounts[entry.key] || 0;
                  const active = quantity > 0;
                  return (
                      <article
                        key={entry.key}
                        className={`public-order-box-card group grid gap-3 overflow-hidden rounded-[22px] border p-3 shadow-[0_14px_28px_rgba(74,47,31,0.08)] transition-transform duration-300 hover:-translate-y-1 sm:gap-4 sm:rounded-[26px] sm:p-4 sm:shadow-[0_16px_38px_rgba(74,47,31,0.08)] xl:gap-4 xl:p-5 ${entry.accentClassName} ${
                          active ? 'ring-1 ring-[rgba(181,68,57,0.16)]' : ''
                        }`}
                      >
                      <div className="public-order-box-card__hero">
                        <div className="public-order-box-card__media relative shrink-0">
                          <div className="relative h-full w-full overflow-hidden rounded-[18px] border border-white/80 bg-white shadow-[0_12px_24px_rgba(74,47,31,0.12)] transition-transform duration-300 group-hover:translate-y-[-2px] sm:rounded-[22px] sm:shadow-[0_14px_28px_rgba(74,47,31,0.12)] xl:rounded-[24px]">
                            <OrderCardArtwork
                              alt={entry.label}
                              art={entry.art}
                              sizes="(max-width: 640px) 96px, (max-width: 1279px) 118px, (max-width: 1535px) 42vw, 22vw"
                            />
                          </div>
                        </div>
                        <div className="public-order-box-card__body">
                          <h3 className="public-order-box-card__title text-[0.96rem] font-semibold leading-tight tracking-[-0.02em] text-[color:var(--ink-strong)] sm:text-lg xl:text-[1.08rem]">
                            {entry.label}
                          </h3>
                          <p className="public-order-box-card__detail mt-2 text-[0.76rem] leading-[1.35] text-[color:var(--ink-muted)] sm:text-sm sm:leading-6 xl:text-[0.84rem] xl:leading-6">
                            {entry.detail}
                          </p>
                          <p className="public-order-box-card__price mt-1 text-sm font-semibold text-[color:var(--ink-strong)] xl:pt-3 xl:text-[1rem]">
                            {formatCurrencyBRL(entry.priceEstimate)}
                          </p>
                        </div>
                      </div>

                      <div className="public-order-box-card__controls">
                        <button
                          type="button"
                          onClick={() => setBoxQuantity(entry.key, Math.max(quantity - 1, 0))}
                          className="public-order-box-card__stepper rounded-[16px] border border-white/85 bg-white font-semibold text-[color:var(--ink-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] transition hover:bg-white sm:rounded-[18px]"
                          aria-label={`Diminuir ${entry.label}`}
                        >
                          −
                        </button>
                        <div className="public-order-box-card__summary">
                          <input
                            className="app-input public-order-box-card__field text-center font-semibold"
                            inputMode="numeric"
                            value={quantity > 0 ? String(quantity) : ''}
                            onChange={(event) => setBoxQuantity(entry.key, event.target.value)}
                            placeholder="0"
                            aria-label={entry.label}
                          />
                          <div className="public-order-box-card__pill rounded-[16px] border border-white/80 bg-white sm:rounded-[18px]">
                            <span className="public-order-box-card__pill-count">{quantity}</span>
                            <span className="public-order-box-card__pill-label">
                              {pluralize(quantity, 'caixa', 'caixas')}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setBoxQuantity(entry.key, quantity + 1)}
                          className="public-order-box-card__stepper rounded-[16px] border border-white/85 bg-white font-semibold text-[color:var(--ink-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] transition hover:bg-white sm:rounded-[18px]"
                          aria-label={`Aumentar ${entry.label}`}
                        >
                          +
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              {mixedBoxEntries.length ? (
                <div
                  id="caixas-mistas"
                  className="mt-4 rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-[rgb(247,239,230)] p-4 scroll-mt-6 sm:mt-5 sm:rounded-[26px] sm:p-5 xl:p-6"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between xl:items-center">
                    <div>
                      <h3 className="text-[1.1rem] font-semibold text-[color:var(--ink-strong)] sm:text-[1.35rem]">
                        Caixas Mistas
                      </h3>
                      <p className="mt-1 text-[0.82rem] leading-5 text-[color:var(--ink-muted)] sm:text-sm">
                        1 caixa = 4 tradicionais + 3 broas de um sabor
                      </p>
                      {mixedBoxStartingPrice != null ? (
                        <p className="mt-1 text-sm font-semibold text-[color:var(--ink-strong)]">
                          A partir de {formatCurrencyBRL(mixedBoxStartingPrice)}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="app-button app-button-ghost w-full sm:w-auto"
                      onClick={() => setIsMixedBoxesDrawerOpen(true)}
                    >
                      Escolher sabor
                    </button>
                  </div>

                  {activeMixedBoxSelections.length ? (
                    <div className="public-order-custom-grid mt-4">
                      {activeMixedBoxSelections.map(({ entry, quantity }) => (
                        <article
                          key={entry.key}
                          className="public-order-custom-card rounded-[20px] border border-[color:var(--tone-roast-line)] bg-white p-4 xl:p-5"
                        >
                          <div className="public-order-custom-card__header">
                            <div>
                              <p className="text-sm font-semibold text-[color:var(--ink-strong)]">
                                {entry.label}
                              </p>
                              <p className="mt-1 text-[0.82rem] leading-5 text-[color:var(--ink-muted)]">
                                {entry.detail}
                              </p>
                              <p className="mt-2 text-sm font-semibold text-[color:var(--ink-strong)]">
                                {formatCurrencyBRL(entry.priceEstimate)}
                              </p>
                            </div>
                            <div className="public-order-custom-card__meta">
                              <span className="rounded-full border border-white/80 bg-white px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)] sm:text-xs">
                                {quantity} {pluralize(quantity, 'caixa', 'caixas')}
                              </span>
                              <button
                                type="button"
                                className="app-button app-button-ghost px-3 py-2 text-xs"
                                onClick={() => setIsMixedBoxesDrawerOpen(true)}
                              >
                                Editar
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="mt-4 block w-full rounded-[20px] border border-transparent text-left transition hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(126,79,45,0.24)]"
                      onClick={() => setIsMixedBoxesDrawerOpen(true)}
                      aria-label="Escolher sabores das caixas mistas"
                    >
                      <PublicOrderSaboresCollage art={mixedBoxesCardArt} />
                    </button>
                  )}
                </div>
              ) : null}

              <div
                id="monte-sua-caixa"
                className="mt-4 rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-[rgb(247,239,230)] p-4 scroll-mt-6 sm:mt-5 sm:rounded-[26px] sm:p-5 xl:p-6"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between xl:items-center">
                  <div>
                    <h3 className="text-[1.1rem] font-semibold text-[color:var(--ink-strong)] sm:text-[1.35rem]">Monte Sua Caixa</h3>
                    <p className="mt-1 text-[0.82rem] leading-5 text-[color:var(--ink-muted)] sm:text-sm">
                      Monte sua caixa com 7 broas como quiser!
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[color:var(--ink-strong)]">
                      {formatCurrencyBRL(ORDER_BOX_PRICE_CUSTOM)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="app-button app-button-ghost w-full sm:w-auto"
                    onClick={addCustomBox}
                  >
                    Adicionar caixa
                  </button>
                </div>

                {customBoxSummaries.length > 0 ? (
                  <div className="public-order-custom-grid mt-4">
                    {customBoxSummaries.map((box) => (
                      <article
                        key={box.id}
                        className={`public-order-custom-card rounded-[20px] border p-4 xl:p-5 ${
                          box.isComplete
                            ? 'border-[color:var(--tone-sage-line)] bg-[color:var(--tone-sage-surface)]'
                            : box.isActive
                              ? 'border-[color:var(--tone-gold-line)] bg-[color:var(--tone-gold-surface)]'
                              : 'border-white/80 bg-white'
                        }`}
                      >
                        <div className="public-order-custom-card__header">
                          <div>
                            <p className="text-sm font-semibold text-[color:var(--ink-strong)]">
                              Monte Sua Caixa #{box.index + 1}
                            </p>
                            <p className="mt-1 text-[0.82rem] leading-5 text-[color:var(--ink-muted)]">
                              {box.totalUnits === 0
                                ? 'Monte sua caixa com 7 broas.'
                                : box.isComplete
                                  ? 'Fechada.'
                                  : `Faltam ${box.remainingUnits}.`}
                            </p>
                          </div>
                          <div className="public-order-custom-card__meta">
                            <span className="rounded-full border border-white/80 bg-white px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)] sm:text-xs">
                              {box.totalUnits}/7
                            </span>
                            <button
                              type="button"
                              className="app-button app-button-ghost px-3 py-2 text-xs"
                              onClick={() => removeCustomBox(box.id)}
                            >
                              Remover
                            </button>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-2">
                          {flavorProducts.map((product) => {
                            const quantity = box.flavors[String(product.id)] || 0;
                            const productArt = resolveOrderCardArt(product);
                            return (
                              <div
                                key={`${box.id}-${product.id}`}
                                className="public-order-custom-row rounded-[16px] border border-white/80 bg-white px-3 py-2.5"
                              >
                                <div className="public-order-custom-row__info">
                                  <div className="relative h-10 w-10 shrink-0">
                                    <div className="relative h-full w-full overflow-hidden rounded-xl border border-white/80 bg-white shadow-[0_8px_18px_rgba(70,44,26,0.08)]">
                                      <OrderCardArtwork
                                        alt={product.label}
                                        art={productArt}
                                        sizes="40px"
                                      />
                                    </div>
                                  </div>
                                  <p className="public-order-custom-row__label text-[0.82rem] font-semibold text-[color:var(--ink-strong)] sm:text-sm">
                                    {product.label}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  className="public-order-custom-row__button h-10 rounded-[14px] border border-white/85 bg-white text-[1.15rem] font-semibold text-[color:var(--ink-strong)] transition hover:bg-white sm:text-xl"
                                  onClick={() => adjustCustomBoxFlavor(box.id, String(product.id), -1)}
                                  disabled={quantity <= 0}
                                  aria-label={`Diminuir ${product.label} na Monte Sua Caixa #${box.index + 1}`}
                                >
                                  −
                                </button>
                                <div className="public-order-custom-row__qty text-center text-[0.82rem] font-semibold text-[color:var(--ink-strong)] sm:text-sm">
                                  {quantity}
                                </div>
                                <button
                                  type="button"
                                  className="public-order-custom-row__button h-10 rounded-[14px] border border-white/85 bg-white text-[1.15rem] font-semibold text-[color:var(--ink-strong)] transition hover:bg-white sm:text-xl"
                                  onClick={() => adjustCustomBoxFlavor(box.id, String(product.id), 1)}
                                  disabled={box.totalUnits >= ORDER_BOX_UNITS}
                                  aria-label={`Aumentar ${product.label} na Monte Sua Caixa #${box.index + 1}`}
                                >
                                  +
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        {box.isActive ? (
                          <p className="mt-3 text-[0.82rem] leading-5 text-[color:var(--ink-muted)]">
                            {formatCustomBoxParts(box.flavors, flavorProducts)}
                          </p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-[20px] border border-white/80 bg-white p-3">
                    <PublicOrderSaboresCollage art={saboresCardArt} />
                  </div>
                )}
              </div>
            </section>

            <section
              id="amigas-da-broa"
              className="rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-white p-4 scroll-mt-6 sm:rounded-[28px] sm:p-6 xl:p-7"
            >
              <div className="public-order-companion-header mb-4 flex flex-col gap-2 sm:mb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                <div className="public-order-companion-header__copy">
                  <h2 className="text-[1.35rem] font-semibold text-[color:var(--ink-strong)] sm:text-2xl">
                    AMIGAS DA BROA
                  </h2>
                  <p className="public-order-companion-header__note mt-1 text-[0.82rem] leading-5 text-[color:var(--ink-muted)] sm:text-sm">
                    <span className="block">Clique no produto para mais detalhes.</span>
                    <span className="block">Arraste para o lado para mais produtos!</span>
                  </p>
                </div>
              </div>

              {companionProducts.length ? (
                <div className="public-order-box-rail-shell public-order-box-rail-shell--companion">
                  <div className="public-order-box-rail public-order-box-rail--companion">
                    {companionProducts.map((product) => {
                      const quantity = parsedCompanionCounts[product.key] || 0;
                      const active = quantity > 0;
                      const companionLines = resolveCompanionProductPublicLines(product);
                      const companionTitle = splitCompanionCardTitle(companionLines.title);
                      return (
                        <article
                          key={product.key}
                          className={`public-order-box-card public-order-box-card--rail public-order-box-card--companion group grid gap-3 overflow-hidden rounded-[22px] border p-3 shadow-[0_14px_28px_rgba(74,47,31,0.08)] sm:gap-4 sm:rounded-[26px] sm:p-4 sm:shadow-[0_16px_38px_rgba(74,47,31,0.08)] xl:gap-4 xl:p-5 border-[color:var(--tone-sage-line)] bg-[linear-gradient(165deg,var(--tone-sage-surface),rgba(251,253,252,0.98))] ${
                            active ? 'ring-1 ring-[rgba(84,116,91,0.18)]' : ''
                          }`}
                        >
                          <button
                            type="button"
                            className="public-order-box-card__hero public-order-box-card__hero--companion public-order-box-card__hero-button"
                            onClick={() => setExpandedCompanionProductKey(product.key)}
                            aria-label={`Abrir detalhes de ${product.label}`}
                          >
                            <div className="public-order-box-card__media public-order-box-card__media--companion relative shrink-0">
                              <div className="public-order-box-card__art-surface relative h-full w-full overflow-hidden rounded-[18px] bg-white sm:rounded-[22px] xl:rounded-[24px]">
                                <OrderCardArtwork
                                  alt={product.label}
                                  art={resolveOrderCardArt(product)}
                                  className="bg-white"
                                  imageClassName="h-full w-full object-contain"
                                  overlayClassName="absolute inset-0 bg-transparent"
                                  managedUploadFit="contain-tight"
                                  sizes="(max-width: 640px) 100px, (max-width: 1279px) 132px, (max-width: 1535px) 42vw, 22vw"
                                />
                              </div>
                            </div>
                            <div className="public-order-box-card__body public-order-box-card__body--companion">
                              <h3 className="public-order-box-card__title public-order-box-card__title--companion text-[0.96rem] font-semibold leading-tight tracking-[-0.02em] text-[color:var(--ink-strong)] sm:text-lg xl:text-[1.08rem]">
                                <span>{companionTitle.primary}</span>
                                {companionTitle.secondary ? <span>{companionTitle.secondary}</span> : null}
                              </h3>
                              <div className="public-order-box-card__detail public-order-box-card__detail--companion mt-2 grid gap-0.5 text-[0.76rem] leading-[1.35] text-[color:var(--ink-muted)] sm:text-sm sm:leading-6 xl:text-[0.84rem] xl:leading-6">
                                {companionLines.subtitleLine ? <p>{companionLines.subtitleLine}</p> : null}
                                {companionLines.makerLine ? <p>{companionLines.makerLine}</p> : null}
                              </div>
                              <p className="public-order-box-card__price public-order-box-card__price--companion mt-1 text-sm font-semibold text-[color:var(--ink-strong)] xl:pt-3 xl:text-[1rem]">
                                {formatCurrencyBRL(product.price)}
                              </p>
                            </div>
                          </button>

                          <div className="public-order-box-card__controls public-order-box-card__controls--companion">
                            <button
                              type="button"
                              onClick={() => setCompanionQuantity(product.key, Math.max(quantity - 1, 0))}
                              className="public-order-box-card__stepper public-order-box-card__stepper--companion rounded-[16px] border border-white/85 bg-white font-semibold text-[color:var(--ink-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] transition hover:bg-white sm:rounded-[18px]"
                              aria-label={`Diminuir ${product.label}`}
                            >
                              −
                            </button>
                            <div className="public-order-box-card__summary public-order-box-card__summary--companion">
                              <div className="public-order-box-card__pill public-order-box-card__pill--companion rounded-[16px] border border-white/80 bg-white sm:rounded-[18px]">
                                <span className="public-order-box-card__pill-count public-order-box-card__pill-count--companion">
                                  {quantity}
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setCompanionQuantity(product.key, quantity + 1)}
                              className="public-order-box-card__stepper public-order-box-card__stepper--companion rounded-[16px] border border-white/85 bg-white font-semibold text-[color:var(--ink-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] transition hover:bg-white sm:rounded-[18px]"
                              aria-label={`Aumentar ${product.label}`}
                            >
                              +
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-[22px] border border-dashed border-[color:var(--tone-sage-line)] bg-[color:var(--tone-sage-surface)] px-4 py-5 text-sm leading-6 text-[color:var(--ink-muted)] sm:px-5">
                  EM BREVE MAIS PRODUTOS :)
                </div>
              )}
            </section>

            <section className="rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-white p-4 sm:rounded-[28px] sm:p-6 xl:p-7">
              <div className="mb-4">
                <h2 className="text-[1.35rem] font-semibold text-[color:var(--ink-strong)] sm:text-2xl">Observacoes</h2>
              </div>
              <FormField label="Observacoes do pedido">
                <textarea
                  className="app-textarea min-h-[120px]"
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Ex.: tocar o interfone, confirmar retirada antes, evitar atraso."
                />
              </FormField>
            </section>

            <section className="rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-white p-4 sm:rounded-[28px] sm:p-6 xl:p-7">
              <div className="mb-4">
                <h2 className="text-[1.35rem] font-semibold text-[color:var(--ink-strong)] sm:text-2xl">Cupom</h2>
                <p className="mt-2 text-sm leading-6 text-[color:var(--ink-muted)]">
                  Se tiver um código de desconto, aplique antes de calcular o frete. O desconto será aplicado sobre o total das broas.
                </p>
              </div>
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto_auto] xl:items-end">
                <FormField label="Código do cupom">
                  <input
                    className="app-input xl:h-14 xl:text-[1.02rem]"
                    value={couponInput}
                    onChange={(event) => {
                      const nextValue = normalizeCouponCodeInput(event.target.value);
                      setCouponInput(nextValue);
                      setCouponError(null);
                      setPendingPrefilledCouponCode(null);
                      if (appliedCoupon?.code && appliedCoupon.code !== nextValue) {
                        setAppliedCoupon(null);
                      }
                    }}
                    autoCapitalize="characters"
                    spellCheck={false}
                  />
                </FormField>
                <button
                  type="button"
                  className="app-button app-button-primary"
                  disabled={isResolvingCoupon}
                  onClick={() => {
                    void applyCoupon();
                  }}
                >
                  {isResolvingCoupon ? 'Aplicando...' : isCouponApplied ? 'Reaplicar' : 'Aplicar'}
                </button>
                <button
                  type="button"
                  className="app-button app-button-ghost"
                  disabled={isResolvingCoupon || (!couponInput && !appliedCoupon)}
                  onClick={clearCoupon}
                >
                  Limpar
                </button>
              </div>
              {couponError ? (
                <div className="app-inline-notice app-inline-notice--warning mt-3 rounded-[20px] px-4 py-3">
                  {couponError}
                </div>
              ) : isCouponApplied && appliedCoupon ? (
                <div className="app-inline-notice app-inline-notice--success mt-3 rounded-[20px] px-4 py-3 text-sm leading-6 text-[color:var(--ink-strong)]">
                  Cupom <strong>{appliedCoupon.code}</strong> aplicado com{' '}
                  <strong>
                    {Number(appliedCoupon.discountPct).toLocaleString('pt-BR', {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2
                    })}
                    %
                  </strong>{' '}
                  de desconto.
                </div>
              ) : null}
            </section>

            {error ? (
              <div className="app-inline-notice app-inline-notice--error rounded-[24px] px-5 py-4 shadow-[0_14px_32px_rgba(157,31,44,0.08)]">
                {error}
              </div>
            ) : null}

            <div className="app-form-actions rounded-[20px] border border-[rgba(126,79,45,0.1)] bg-[rgb(255,252,248)] p-3 shadow-[0_18px_32px_rgba(70,44,26,0.08)] xl:hidden">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">
                  Total
                </span>
                <strong className="text-base text-[color:var(--ink-strong)]">{formatCurrencyBRL(displayTotal)}</strong>
              </div>
              <button
                className="app-button app-button-primary"
                disabled={isSubmitting || isQuotingDelivery || isResolvingCoupon || isDeliveryQuoteConfirmationPending}
                onClick={() => {
                  void handlePrimaryAction();
                }}
                type="button"
              >
                {primaryActionLabel}
              </button>
            </div>

          </form>

          <aside className="grid gap-4 self-start sm:gap-5 xl:sticky xl:top-6">
            <section className="order-1 overflow-hidden rounded-[24px] border border-[rgba(126,79,45,0.1)] bg-[linear-gradient(165deg,#fffcf8,#f3e7d8)] p-4 shadow-[0_18px_40px_rgba(70,44,26,0.1)] sm:rounded-[30px] sm:p-5 sm:shadow-[0_26px_80px_rgba(70,44,26,0.12)] xl:max-h-[calc(var(--app-vh,1vh)*100-3rem)] xl:overflow-y-auto xl:p-4 2xl:p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[1.35rem] font-semibold text-[color:var(--ink-strong)] sm:text-2xl">Pedido</h2>
                </div>
                <div className="rounded-full bg-white px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)] sm:text-xs">
                  {form.fulfillmentMode === 'DELIVERY' ? 'Entrega' : 'Retirada'}
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:mt-5">
                <div className="grid gap-3 rounded-[20px] bg-white p-4 sm:rounded-[24px]">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-[18px] border border-[rgba(126,79,45,0.08)] bg-white px-3 py-3">
                      <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                        Caixas
                      </span>
                      <strong className="mt-1 block text-[1.35rem] text-[color:var(--ink-strong)]">{totalBoxes}</strong>
                    </div>
                    <div className="rounded-[18px] border border-[rgba(126,79,45,0.08)] bg-white px-3 py-3">
                      <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                        Broas
                      </span>
                      <strong className="mt-1 block text-[1.35rem] text-[color:var(--ink-strong)]">{totalBroas}</strong>
                    </div>
                    {companionProducts.length ? (
                      <div className="rounded-[18px] border border-[rgba(126,79,45,0.08)] bg-white px-3 py-3">
                        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                          Amigas
                        </span>
                        <strong className="mt-1 block text-[1.35rem] text-[color:var(--ink-strong)]">
                          {totalCompanionItems}
                        </strong>
                      </div>
                    ) : null}
                    <div className="rounded-[18px] border border-[rgba(126,79,45,0.08)] bg-white px-3 py-3">
                      <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                        Subtotal
                      </span>
                      <strong className="mt-1 block text-base text-[color:var(--ink-strong)]">
                        {formatCurrencyBRL(estimatedTotal)}
                      </strong>
                    </div>
                    <div className="rounded-[18px] border border-[rgba(126,79,45,0.08)] bg-white px-3 py-3">
                      <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                        Desconto
                      </span>
                      <strong className="mt-1 block text-base text-[color:var(--ink-strong)]">
                        -{formatCurrencyBRL(couponDiscountAmount)}
                      </strong>
                      {isCouponApplied && appliedCoupon ? (
                        <span className="mt-1 block text-[0.72rem] leading-5 text-[color:var(--ink-muted)]">
                          {appliedCoupon.code}
                        </span>
                      ) : null}
                    </div>
                    <div className="rounded-[18px] border border-[rgba(126,79,45,0.08)] bg-white px-3 py-3">
                      <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                        {form.fulfillmentMode === 'DELIVERY' ? 'Frete' : 'Sem frete'}
                      </span>
                      <strong className="mt-1 block text-base text-[color:var(--ink-strong)]">
                        {form.fulfillmentMode === 'DELIVERY'
                          ? isQuotingDelivery
                            ? 'Calculando...'
                            : formatCurrencyBRL(deliveryFee)
                          : formatCurrencyBRL(0)}
                      </strong>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-[rgba(126,79,45,0.08)] pt-3">
                    <span className="text-sm font-semibold text-[color:var(--ink-strong)]">Total</span>
                    <strong className="text-[1.3rem] text-[color:var(--ink-strong)]">{formatCurrencyBRL(displayTotal)}</strong>
                  </div>
                </div>

                {form.fulfillmentMode === 'DELIVERY' && deliveryQuoteError ? (
                  <div className="app-inline-notice app-inline-notice--warning rounded-[20px] px-4 py-3 sm:rounded-[24px]">
                    {deliveryQuoteError}
                  </div>
                ) : null}

                {form.fulfillmentMode === 'DELIVERY' &&
                !deliveryQuoteError &&
                isDeliveryQuoteConfirmationPending &&
                activeDeliveryQuote?.quoteToken ? (
                  <div className="app-inline-notice app-inline-notice--success rounded-[20px] px-4 py-3 sm:rounded-[24px]">
                    Frete calculado. Confira o total e toque em Finalizar Pedido.
                  </div>
                ) : null}

                {form.fulfillmentMode === 'DELIVERY' && !deliveryQuoteError && isScheduleBelowMinimum && minimumSchedule ? (
                  <div className="app-inline-notice app-inline-notice--warning rounded-[20px] px-4 py-3 sm:rounded-[24px]">
                    {buildPublicOrderScheduleErrorMessage(minimumSchedule)}
                  </div>
                ) : null}

                {incompleteCustomBoxes.length > 0 ? (
                  <div className="app-inline-notice app-inline-notice--warning rounded-[20px] px-4 py-3 sm:rounded-[24px]">
                    {incompleteCustomBoxes.length === 1
                      ? 'Falta completar 1 Monte Sua Caixa.'
                      : `Faltam completar ${incompleteCustomBoxes.length} caixas Monte Sua Caixa.`}
                  </div>
                ) : null}

                <div className="rounded-[20px] bg-white p-4 sm:rounded-[24px]">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)] sm:text-xs">
                    Data e faixa
                  </p>
                  <p className="mt-2 text-base font-semibold text-[color:var(--ink-strong)] sm:text-lg">
                    {form.date && selectedTimeWindowLabel
                      ? `${form.date} • ${selectedTimeWindowLabel}`
                      : 'Escolha data e faixa de horario'}
                  </p>
                </div>

                <div className="rounded-[20px] bg-white p-4 sm:rounded-[24px]">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)] sm:text-xs">
                    Itens escolhidos
                  </p>
                  {selectedProducts.length ? (
                    <ul className="mt-3 grid max-h-[260px] gap-2 overflow-y-auto pr-1">
                      {selectedProducts.map((entry) => (
                        <li
                          key={entry.key}
                          className="rounded-2xl border border-[rgba(126,79,45,0.08)] bg-white px-3 py-2 text-sm text-[color:var(--ink-muted)]"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span>{entry.displayLabel ?? entry.label}</span>
                            <strong className="text-[color:var(--ink-strong)]">{entry.quantityLabel}</strong>
                          </div>
                          {entry.displayDetail || entry.detail ? (
                            <p className="mt-1 text-[0.78rem] leading-5 text-[color:var(--ink-muted)]">
                              {entry.displayDetail ?? entry.detail}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm leading-6 text-[color:var(--ink-muted)]">
                      Nenhum item ainda.
                    </p>
                  )}
                </div>

                <div className="rounded-[20px] bg-white p-4 sm:rounded-[24px]">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)] sm:text-xs">
                    Composicao
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[color:var(--ink-strong)]">
                    {formatOrderProductComposition(computedOrderItems, productMapById)}
                  </p>
                </div>

                <div className="grid gap-2 rounded-[20px] border border-[rgba(126,79,45,0.1)] bg-[linear-gradient(160deg,#fff8f1,#f4e7d8)] p-4 shadow-[0_18px_34px_rgba(70,44,26,0.08)] sm:rounded-[24px]">
                  <button
                    className="app-button app-button-primary w-full"
                    disabled={isSubmitting || isQuotingDelivery || isResolvingCoupon || isDeliveryQuoteConfirmationPending}
                    onClick={() => {
                      void handlePrimaryAction();
                    }}
                    type="button"
                  >
                    {primaryActionLabel}
                  </button>
                  <button className="app-button app-button-ghost w-full" onClick={resetForm} type="button">
                    Limpar
                  </button>
                </div>
              </div>
            </section>
          </aside>
        </section>
      </div>
      {expandedCompanionProduct ? (
        <div className="order-detail-modal" role="presentation" onClick={closeCompanionPreview}>
          <div
            className="order-detail-modal__dialog order-detail-modal__dialog--companion-preview"
            ref={companionPreviewDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="public-order-companion-preview-title"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="public-order-companion-preview-title" className="sr-only">
              Imagem ampliada de {expandedCompanionProduct.label}
            </h2>
            <button
              ref={companionPreviewCloseRef}
              type="button"
              className="order-detail-modal__close"
              onClick={closeCompanionPreview}
            >
              <AppIcon name="close" className="h-4 w-4" />
              Fechar
            </button>
            <div className="app-panel order-detail-modal__panel public-order-image-drawer">
              <div className="public-order-image-drawer__header">
                <div className="grid gap-2">
                  <p className="public-order-image-drawer__eyebrow">Amigas da Broa</p>
                  <div className="grid gap-1">
                    <h3 className="text-[1.22rem] font-semibold tracking-[-0.04em] text-[color:var(--ink-strong)] sm:text-[1.55rem]">
                      {expandedCompanionProductLines.title}
                    </h3>
                    <div className="grid gap-0.5 text-sm leading-6 text-[color:var(--ink-muted)] sm:text-[0.96rem]">
                      {expandedCompanionProductLines.subtitleLine ? (
                        <p>{expandedCompanionProductLines.subtitleLine}</p>
                      ) : null}
                      {expandedCompanionProductLines.makerLine ? (
                        <p>{expandedCompanionProductLines.makerLine}</p>
                      ) : null}
                    </div>
                  </div>
                </div>
                <span className="public-order-image-drawer__price">
                  {formatCurrencyBRL(expandedCompanionProduct.price)}
                </span>
              </div>

              <div className="public-order-image-drawer__media public-order-image-drawer__media--companion">
                <OrderCardArtwork
                  alt={expandedCompanionProduct.label}
                  art={resolveOrderCardArt(expandedCompanionProduct)}
                  className="rounded-[24px] bg-white"
                  imageClassName="h-full w-full object-contain"
                  managedUploadFit="contain-tight"
                  overlayClassName="absolute inset-0 bg-transparent"
                  sizes="(max-width: 768px) 92vw, (max-width: 1280px) 72vw, 760px"
                />
              </div>

              <p className="whitespace-pre-line text-sm leading-6 text-[color:var(--ink-muted)]">
                {resolveCompanionDrawerNote(expandedCompanionProduct)}
              </p>

              <div className="public-order-image-drawer__actions">
                <button
                  type="button"
                  className="app-button app-button-ghost"
                  onClick={() =>
                    expandedCompanionProduct
                      ? setCompanionQuantity(
                          expandedCompanionProduct.key,
                          Math.max(expandedCompanionQuantity - 1, 0)
                        )
                      : undefined
                  }
                  disabled={!expandedCompanionProduct || expandedCompanionQuantity <= 0}
                >
                  −
                </button>
                <div className="public-order-image-drawer__qty">
                  <strong>{expandedCompanionQuantity}</strong>
                  <span>{pluralize(expandedCompanionQuantity, 'item', 'itens')}</span>
                </div>
                <button
                  type="button"
                  className="app-button app-button-primary"
                  onClick={() =>
                    expandedCompanionProduct
                      ? setCompanionQuantity(expandedCompanionProduct.key, expandedCompanionQuantity + 1)
                      : undefined
                  }
                  disabled={!expandedCompanionProduct}
                >
                  Adicionar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {isMixedBoxesDrawerOpen && mixedBoxEntries.length ? (
        <div className="order-detail-modal" role="presentation" onClick={closeMixedBoxesDrawer}>
          <div
            className="order-detail-modal__dialog order-detail-modal__dialog--quick-create order-detail-modal__dialog--mixed-boxes"
            ref={mixedBoxesDrawerDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="public-order-mixed-boxes-title"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="public-order-mixed-boxes-title" className="sr-only">
              Selecionar sabores das caixas mistas
            </h2>
            <button
              ref={mixedBoxesDrawerCloseRef}
              type="button"
              className="order-detail-modal__close"
              onClick={closeMixedBoxesDrawer}
            >
              <AppIcon name="close" className="h-4 w-4" />
              Fechar
            </button>
            <div className="app-panel order-detail-modal__panel order-detail-modal__panel--mixed-boxes">
              <div className="grid gap-4 p-4 sm:p-5 xl:p-6">
                <div className="grid gap-2">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                        Caixas Mistas
                      </p>
                      <h3 className="text-[1.18rem] font-semibold tracking-[-0.03em] text-[color:var(--ink-strong)] sm:text-[1.4rem]">
                        Escolha os sabores
                      </h3>
                    </div>
                    <span className="rounded-full border border-[rgba(126,79,45,0.12)] bg-white px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                      {totalMixedBoxes} {pluralize(totalMixedBoxes, 'caixa', 'caixas')}
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-[color:var(--ink-muted)]">
                    1 caixa = 4 tradicionais + 3 broas de um sabor
                  </p>
                </div>

                <div className="grid gap-3">
                  {mixedBoxEntries.map((entry) => {
                    const quantity = parsedBoxCounts[entry.key] || 0;
                    return (
                      <article
                        key={entry.key}
                        className={`public-order-mixed-drawer-row rounded-[20px] border p-3 sm:p-4 ${
                          quantity > 0
                            ? 'border-[color:var(--tone-roast-line)] bg-[color:var(--tone-roast-surface)]'
                            : 'border-[rgba(126,79,45,0.08)] bg-white'
                        }`}
                      >
                        <div className="public-order-mixed-drawer-row__info">
                          <div className="public-order-mixed-drawer-row__media">
                            <div className="relative h-full w-full overflow-hidden rounded-[18px] border border-white/80 bg-white shadow-[0_12px_24px_rgba(74,47,31,0.1)]">
                              <OrderCardArtwork
                                alt={entry.label}
                                art={entry.drawerArt ?? entry.art}
                                sizes="88px"
                              />
                            </div>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[color:var(--ink-strong)] sm:text-[1rem]">
                              {entry.label}
                            </p>
                            <p className="mt-1 text-[0.82rem] leading-5 text-[color:var(--ink-muted)] sm:text-sm">
                              {entry.detail}
                            </p>
                            <p className="mt-2 text-sm font-semibold text-[color:var(--ink-strong)]">
                              {formatCurrencyBRL(entry.priceEstimate)}
                            </p>
                          </div>
                        </div>

                        <div className="public-order-mixed-drawer-row__controls">
                          <button
                            type="button"
                            className="public-order-custom-row__button h-11 rounded-[14px] border border-white/85 bg-white text-[1.15rem] font-semibold text-[color:var(--ink-strong)] transition hover:bg-white sm:text-xl"
                            onClick={() => setMixedBoxQuantity(entry.key, quantity - 1)}
                            disabled={quantity <= 0}
                            aria-label={`Diminuir ${entry.label}`}
                          >
                            −
                          </button>
                          <div className="public-order-mixed-drawer-row__qty">
                            <strong>{quantity}</strong>
                            <span>{pluralize(quantity, 'caixa', 'caixas')}</span>
                          </div>
                          <button
                            type="button"
                            className="public-order-custom-row__button h-11 rounded-[14px] border border-white/85 bg-white text-[1.15rem] font-semibold text-[color:var(--ink-strong)] transition hover:bg-white sm:text-xl"
                            onClick={() => setMixedBoxQuantity(entry.key, quantity + 1)}
                            aria-label={`Aumentar ${entry.label}`}
                          >
                            +
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
