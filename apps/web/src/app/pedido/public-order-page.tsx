'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  formatExternalOrderMinimumSchedule,
  resolveExternalOrderMinimumSchedule,
  type ExternalOrderSubmission,
  type CouponResolveResponse,
  type Product
} from '@querobroapp/shared';
import { GoogleAddressAutocompleteInput } from '@/components/form/GoogleAddressAutocompleteInput';
import { FormField } from '@/components/form/FormField';
import { useFeedback } from '@/components/feedback-provider';
import { resolveAnalyticsSessionId, trackAnalyticsEvent } from '@/lib/analytics';
import { apiFetch } from '@/lib/api';
import { normalizePhone } from '@/lib/format';
import { OrderCardArtwork } from '@/features/orders/order-card-artwork';
import {
  ORDER_BOX_UNITS,
  ORDER_CUSTOM_BOX_CATALOG_CODE,
  buildRuntimeOrderCatalog,
  calculateOrderSubtotalFromProductItems,
  formatOrderProductComposition,
  resolveOrderSaboresCardArt,
  type OrderCardArt,
  parseMetaCheckoutProductsParam,
  resolveOrderCatalogPrefillCodeFromCatalogContentId,
  resolveRuntimeOrderBoxKey,
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
const PUBLIC_ORDER_HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => `${index}`.padStart(2, '0'));
const PUBLIC_ORDER_MINUTE_OPTIONS = ['00', '15', '30', '45'] as const;

type SelectedBoxSummary = {
  key: string;
  label: string;
  quantity: number;
  quantityLabel: string;
  detail?: string | null;
};
type CustomBoxDraft = {
  id: string;
  flavors: Record<string, number>;
};

type PublicOrderFormState = {
  name: string;
  phone: string;
  fulfillmentMode: 'DELIVERY' | 'PICKUP';
  address: string;
  placeId: string;
  lat: number | null;
  lng: number | null;
  deliveryNotes: string;
  date: string;
  time: string;
  notes: string;
  boxes: Record<string, string>;
};

type StoredPublicOrderSnapshot = {
  version: 1 | 2;
  savedAt: string;
  boxes: Record<string, string>;
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

type PublicOrderScheduleAvailability = {
  minimumAllowedAt: string;
  nextAvailableAt: string;
  requestedAt: string | null;
  requestedAvailable: boolean;
  reason: 'AVAILABLE' | 'BEFORE_MINIMUM' | 'SLOT_TAKEN' | 'DAY_FULL';
  dailyLimit: number;
  requestedTotalBroas: number;
  requestedDurationMinutes: number;
  slotMinutes: number;
  dayOrderCount: number;
  slotTaken: boolean;
};

type PublicOrderMinuteOption = (typeof PUBLIC_ORDER_MINUTE_OPTIONS)[number];

const initialFormState: PublicOrderFormState = {
  name: '',
  phone: '',
  fulfillmentMode: 'DELIVERY',
  address: '',
  placeId: '',
  lat: null,
  lng: null,
  deliveryNotes: '',
  date: '',
  time: '',
  notes: '',
  boxes: {}
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

function formatTimeInputValue(date: Date) {
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
}

function parseTimeValueParts(value?: string | null) {
  const [hour = '', minute = ''] = String(value || '').split(':');
  if (!/^\d{2}$/.test(hour) || !/^\d{2}$/.test(minute)) return null;
  return { hour, minute };
}

function buildTimeValue(hour: string, minute: string) {
  if (!/^\d{2}$/.test(hour) || !/^\d{2}$/.test(minute)) return '';
  return `${hour}:${minute}`;
}

function parseLocalDateTime(date: string, time: string) {
  if (!date || !time) return null;
  const [year, month, day] = date.split('-').map((entry) => Number(entry));
  const [hour, minute] = time.split(':').map((entry) => Number(entry));
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildPublicOrderScheduleErrorMessage(minimum: Date) {
  return `Próximo horário: ${formatExternalOrderMinimumSchedule(minimum)}.`;
}

function extractErrorMessage(body: unknown) {
  if (typeof body === 'string') return body;
  if (!body || typeof body !== 'object') return 'Nao foi possivel enviar o pedido.';

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
  return 'Nao foi possivel enviar o pedido.';
}

function isPublicOrderScheduleAvailability(value: unknown): value is PublicOrderScheduleAvailability {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.minimumAllowedAt === 'string' &&
    typeof record.nextAvailableAt === 'string' &&
    (record.requestedAt == null || typeof record.requestedAt === 'string') &&
    typeof record.requestedAvailable === 'boolean' &&
    typeof record.reason === 'string'
  );
}

function parseCountValue(value: string) {
  const parsed = Number(String(value || '').replace(/[^\d-]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function toLocalIso(date: string, time: string) {
  const parsed = parseLocalDateTime(date, time);
  return parsed ? parsed.toISOString() : null;
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

function PublicOrderSaboresCollage({ art }: { art: OrderCardArt }) {
  return (
    <div className="relative aspect-[16/10] overflow-hidden rounded-[18px] bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.92),transparent_34%),linear-gradient(155deg,rgba(248,239,230,0.98),rgba(238,222,202,0.92))] xl:aspect-[21/10]">
      <span className="sr-only">Composicao da Caixa Sabores com os sabores ativos do catalogo.</span>
      <div className="absolute inset-[10px] sm:inset-4" aria-hidden="true">
        <OrderCardArtwork
          alt="Composicao da Caixa Sabores"
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

export function PublicOrderPage() {
  const router = useRouter();
  const { notifyError } = useFeedback();
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<PublicOrderFormState>(initialFormState);
  const [customBoxes, setCustomBoxes] = useState<CustomBoxDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [deliveryQuoteError, setDeliveryQuoteError] = useState<string | null>(null);
  const [isQuotingDelivery, setIsQuotingDelivery] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [isResolvingCoupon, setIsResolvingCoupon] = useState(false);
  const [pendingPrefilledCouponCode, setPendingPrefilledCouponCode] = useState<string | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const orderFormRef = useRef<HTMLFormElement | null>(null);
  const urlPrefillSignatureRef = useRef<string | null>(null);
  const deliveryAddressDraftRef = useRef<Pick<PublicOrderFormState, 'address' | 'placeId' | 'lat' | 'lng'>>({
    address: '',
    placeId: '',
    lat: null,
    lng: null
  });
  const [minimumSchedule, setMinimumSchedule] = useState<Date | null>(null);
  const [draftSessionId, setDraftSessionId] = useState(() => resolvePublicOrderDraftSessionId());
  const minimumDateValue = minimumSchedule ? formatDateInputValue(minimumSchedule) : '';
  const minimumTimeValue = minimumSchedule ? formatTimeInputValue(minimumSchedule) : '';
  const isPickupSelected = form.fulfillmentMode === 'PICKUP';
  const selectedTimeParts = useMemo(() => parseTimeValueParts(form.time), [form.time]);
  const minimumTimeParts = useMemo(() => parseTimeValueParts(minimumTimeValue), [minimumTimeValue]);
  const selectedHourValue = selectedTimeParts?.hour ?? '';
  const selectedMinuteValue = selectedTimeParts?.minute ?? '';
  const runtimeOrderCatalog = useMemo(() => buildRuntimeOrderCatalog(catalogProducts), [catalogProducts]);
  const runtimeBoxEntries = runtimeOrderCatalog.boxEntries;
  const flavorProducts = runtimeOrderCatalog.flavorProducts;
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
  const availableMinuteOptions = useMemo(() => {
    if (
      form.date === minimumDateValue &&
      minimumTimeParts &&
      selectedHourValue === minimumTimeParts.hour
    ) {
      return PUBLIC_ORDER_MINUTE_OPTIONS.filter((option) => option >= minimumTimeParts.minute);
    }
    return PUBLIC_ORDER_MINUTE_OPTIONS;
  }, [form.date, minimumDateValue, minimumTimeParts, selectedHourValue]);

  const handleHourChange = useCallback(
    (nextHour: string) => {
      setForm((current) => {
        if (!nextHour) {
          return { ...current, time: '' };
        }

        const currentParts = parseTimeValueParts(current.time);
        const currentMinimumParts =
          current.date === minimumDateValue ? parseTimeValueParts(minimumTimeValue) : null;
        const allowedMinuteOptions =
          currentMinimumParts && nextHour === currentMinimumParts.hour
            ? PUBLIC_ORDER_MINUTE_OPTIONS.filter((option) => option >= currentMinimumParts.minute)
            : PUBLIC_ORDER_MINUTE_OPTIONS;
        const nextMinute =
          currentParts && allowedMinuteOptions.includes(currentParts.minute as PublicOrderMinuteOption)
            ? currentParts.minute
            : (allowedMinuteOptions[0] ?? PUBLIC_ORDER_MINUTE_OPTIONS[0]);

        return {
          ...current,
          time: buildTimeValue(nextHour, nextMinute)
        };
      });
    },
    [minimumDateValue, minimumTimeValue]
  );

  const handleMinuteChange = useCallback((nextMinute: string) => {
    setForm((current) => {
      const currentParts = parseTimeValueParts(current.time);
      const nextHour = currentParts?.hour ?? '';
      if (!nextHour || !nextMinute) return current;
      return {
        ...current,
        time: buildTimeValue(nextHour, nextMinute)
      };
    });
  }, []);

  useEffect(() => {
    if (!selectedHourValue || !selectedMinuteValue) return;
    if (availableMinuteOptions.includes(selectedMinuteValue as PublicOrderMinuteOption)) return;
    const nextMinute = availableMinuteOptions[0] ?? PUBLIC_ORDER_MINUTE_OPTIONS[0];
    setForm((current) => ({
      ...current,
      time: buildTimeValue(selectedHourValue, nextMinute)
    }));
  }, [availableMinuteOptions, selectedHourValue, selectedMinuteValue]);

  useEffect(() => {
    let cancelled = false;

    void apiFetch<Product[]>('/inventory-products')
      .then((products) => {
        if (!cancelled) {
          setCatalogProducts(Array.isArray(products) ? products : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCatalogProducts([]);
        }
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
    const storedProfile = readStoredPublicOrderProfile();
    if (storedProfile) {
      deliveryAddressDraftRef.current = {
        address: storedProfile.fulfillmentMode === 'DELIVERY' ? storedProfile.address : '',
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
        placeId: storedProfile.placeId,
        lat: storedProfile.lat,
        lng: storedProfile.lng,
        deliveryNotes: storedProfile.deliveryNotes || current.deliveryNotes
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
    setDeliveryQuoteError(null);
    setCouponError(null);
    setAppliedCoupon(null);
    setCouponInput(prefill.couponCode || '');
    setPendingPrefilledCouponCode(prefill.couponCode || null);
    setForm((current) => ({
      ...current,
      boxes: prefill.boxes
    }));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const normalizedProfile: StoredPublicOrderProfile = {
      version: 1,
      name: form.name.trim(),
      phone: form.phone.trim(),
      fulfillmentMode: form.fulfillmentMode,
      address: form.fulfillmentMode === 'PICKUP' ? PUBLIC_ORDER_PICKUP_ADDRESS : form.address.trim(),
      placeId: form.fulfillmentMode === 'DELIVERY' ? form.placeId.trim() : '',
      lat: form.fulfillmentMode === 'DELIVERY' && typeof form.lat === 'number' ? form.lat : null,
      lng: form.fulfillmentMode === 'DELIVERY' && typeof form.lng === 'number' ? form.lng : null,
      deliveryNotes: form.deliveryNotes.trim()
    };
    const hasMeaningfulProfile =
      normalizedProfile.name ||
      normalizedProfile.phone ||
      normalizedProfile.address ||
      normalizedProfile.deliveryNotes;
    if (!hasMeaningfulProfile) {
      window.localStorage.removeItem(PUBLIC_ORDER_PROFILE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(PUBLIC_ORDER_PROFILE_STORAGE_KEY, JSON.stringify(normalizedProfile));
  }, [
    form.address,
    form.deliveryNotes,
    form.fulfillmentMode,
    form.lat,
    form.lng,
    form.name,
    form.phone,
    form.placeId
  ]);

  const rememberDeliveryLocation = useCallback(
    (patch: Partial<Pick<PublicOrderFormState, 'address' | 'placeId' | 'lat' | 'lng'>>) => {
      deliveryAddressDraftRef.current = {
        address: patch.address ?? deliveryAddressDraftRef.current.address,
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
            placeId: current.placeId,
            lat: current.lat,
            lng: current.lng
          };
        }

        return {
          ...current,
          fulfillmentMode: 'PICKUP',
          address: PUBLIC_ORDER_PICKUP_ADDRESS,
          placeId: '',
          lat: null,
          lng: null
        };
      }

      return {
        ...current,
        fulfillmentMode: 'DELIVERY',
        address: deliveryAddressDraftRef.current.address,
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

  const officialBoxCount = useMemo(
    () => Object.values(parsedBoxCounts).reduce((sum, quantity) => sum + quantity, 0),
    [parsedBoxCounts]
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
  const computedOrderItems = useMemo(() => {
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
  const totalBroas = useMemo(
    () => computedOrderItems.reduce((sum, item) => sum + item.quantity, 0),
    [computedOrderItems]
  );
  const estimatedTotal = useMemo(
    () => calculateOrderSubtotalFromProductItems(computedOrderItems, productMapById),
    [computedOrderItems, productMapById]
  );
  const normalizedCouponInput = useMemo(() => normalizeCouponCodeInput(couponInput), [couponInput]);
  const isCouponApplied = useMemo(
    () => Boolean(appliedCoupon?.code && appliedCoupon.code === normalizedCouponInput),
    [appliedCoupon?.code, normalizedCouponInput]
  );
  const couponDiscountAmount = useMemo(() => {
    if (!isCouponApplied || !appliedCoupon) return 0;
    return roundCurrency((estimatedTotal * appliedCoupon.discountPct) / 100);
  }, [appliedCoupon, estimatedTotal, isCouponApplied]);
  const discountedSubtotal = useMemo(
    () => roundCurrency(Math.max(estimatedTotal - couponDiscountAmount, 0)),
    [couponDiscountAmount, estimatedTotal]
  );
  const scheduledAtIso = useMemo(() => toLocalIso(form.date, form.time), [form.date, form.time]);
  const selectedBoxes = useMemo<SelectedBoxSummary[]>(
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
        label: `Caixa Sabores #${box.index + 1}`,
        quantity: 1,
        quantityLabel: box.isComplete ? '1 cx' : `${box.totalUnits}/7`,
        detail: formatCustomBoxParts(box.flavors, flavorProducts)
      }))
    ],
    [activeCustomBoxes, flavorProducts, parsedBoxCounts, runtimeBoxEntries]
  );
  const flavorManifestItems = useMemo(
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
      T: computedOrderItems.find((item) => item.productId === runtimeOrderCatalog.flavorProductByLegacyCode.T?.id)?.quantity || 0,
      G: computedOrderItems.find((item) => item.productId === runtimeOrderCatalog.flavorProductByLegacyCode.G?.id)?.quantity || 0,
      D: computedOrderItems.find((item) => item.productId === runtimeOrderCatalog.flavorProductByLegacyCode.D?.id)?.quantity || 0,
      Q: computedOrderItems.find((item) => item.productId === runtimeOrderCatalog.flavorProductByLegacyCode.Q?.id)?.quantity || 0,
      R: computedOrderItems.find((item) => item.productId === runtimeOrderCatalog.flavorProductByLegacyCode.R?.id)?.quantity || 0,
      RJ: computedOrderItems.find((item) => item.productId === runtimeOrderCatalog.flavorProductByLegacyCode.RJ?.id)?.quantity || 0
    }),
    [computedOrderItems, runtimeOrderCatalog.flavorProductByLegacyCode]
  );
  const deliveryFee = deliveryQuote?.fee ?? 0;
  const displayTotal = discountedSubtotal + deliveryFee;
  const parsedScheduledAt = useMemo(() => parseLocalDateTime(form.date, form.time), [form.date, form.time]);
  const minimumScheduleLabel = useMemo(
    () => (minimumSchedule ? formatExternalOrderMinimumSchedule(minimumSchedule) : null),
    [minimumSchedule]
  );
  const isScheduleBelowMinimum = useMemo(() => {
    if (!minimumSchedule || !parsedScheduledAt) return false;
    return parsedScheduledAt.getTime() < minimumSchedule.getTime();
  }, [minimumSchedule, parsedScheduledAt]);

  const applyScheduleToForm = useCallback((nextSchedule: Date) => {
    setMinimumSchedule(nextSchedule);
    setForm((current) => {
      const currentScheduledAt = parseLocalDateTime(current.date, current.time);
      if (currentScheduledAt && currentScheduledAt.getTime() >= nextSchedule.getTime()) {
        return current;
      }
      return {
        ...current,
        date: formatDateInputValue(nextSchedule),
        time: formatTimeInputValue(nextSchedule)
      };
    });
  }, []);

  const fetchPublicScheduleAvailability = useCallback(async (requestedAt?: string | null, requestedTotalBroas?: number) => {
    const params = new URLSearchParams();
    if (requestedAt) {
      params.set('scheduledAt', requestedAt);
    }
    if (typeof requestedTotalBroas === 'number' && Number.isFinite(requestedTotalBroas) && requestedTotalBroas > 0) {
      params.set('totalBroas', String(Math.max(Math.floor(requestedTotalBroas), 0)));
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
      throw new Error('Resposta invalida da agenda publica.');
    }
    return data;
  }, []);

  const syncMinimumSchedule = useCallback(async (requestedAt?: string | null) => {
    try {
      const availability = await fetchPublicScheduleAvailability(
        requestedAt,
        Math.max(totalBroas, ORDER_BOX_UNITS)
      );
      const nextMinimum = new Date(availability.nextAvailableAt);
      if (Number.isNaN(nextMinimum.getTime())) {
        throw new Error('Horario publico invalido.');
      }
      applyScheduleToForm(nextMinimum);
    } catch {
      applyScheduleToForm(resolveExternalOrderMinimumSchedule());
    }
  }, [applyScheduleToForm, fetchPublicScheduleAvailability, totalBroas]);

  useEffect(() => {
    void syncMinimumSchedule();
    const timer = window.setInterval(() => {
      void syncMinimumSchedule();
    }, 60_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void syncMinimumSchedule();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [syncMinimumSchedule]);

  useEffect(() => {
    if (!scheduledAtIso) return;
    void syncMinimumSchedule(scheduledAtIso);
  }, [scheduledAtIso, syncMinimumSchedule, totalBroas]);

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
        setCouponError('Escolha ao menos 1 caixa antes de aplicar o cupom.');
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
            subtotal: estimatedTotal,
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
          couponLoadError instanceof Error ? couponLoadError.message : 'Nao foi possivel validar o cupom.';
        setAppliedCoupon(null);
        setCouponError(message);
        return null;
      } finally {
        setIsResolvingCoupon(false);
      }
    },
    [couponInput, estimatedTotal, form.name, form.phone]
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
      setDeliveryQuoteError(null);
      setIsQuotingDelivery(false);
      return;
    }

    if (minimumSchedule && parsedScheduledAt && parsedScheduledAt.getTime() < minimumSchedule.getTime()) {
      setDeliveryQuote(null);
      setIsQuotingDelivery(false);
      return;
    }

    if (!form.address.trim() || !scheduledAtIso || totalBroas <= 0 || incompleteCustomBoxes.length > 0) {
      setDeliveryQuote(null);
      setDeliveryQuoteError(null);
      setIsQuotingDelivery(false);
      return;
    }
    setDeliveryQuote(null);
    setDeliveryQuoteError(null);
    setIsQuotingDelivery(false);
  }, [
    draftSessionId,
    discountedSubtotal,
    form.address,
    form.fulfillmentMode,
    form.lat,
    form.lng,
    form.placeId,
    minimumSchedule,
    parsedScheduledAt,
    scheduledAtIso,
    selectedBoxes,
    totalBroas,
    incompleteCustomBoxes.length
  ]);

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
            placeId: '',
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
      setDeliveryQuoteError(null);
      return null;
    }

    if (!form.address.trim()) {
      setDeliveryQuote(null);
      setDeliveryQuoteError('Informe o endereco para calcular o frete.');
      return null;
    }

    if (!scheduledAtIso) {
      setDeliveryQuote(null);
      setDeliveryQuoteError('Escolha data e horario validos para calcular o frete.');
      return null;
    }

    if (totalBroas <= 0) {
      setDeliveryQuote(null);
      setDeliveryQuoteError('Escolha ao menos 1 caixa antes de calcular o frete.');
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
      setDeliveryQuoteError(buildPublicOrderScheduleErrorMessage(minimumSchedule));
      return null;
    }

    setIsQuotingDelivery(true);
    setDeliveryQuoteError(null);
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
        body: JSON.stringify({
          mode: form.fulfillmentMode,
          scheduledAt: scheduledAtIso,
          customer: {
            address: form.address.trim() || null,
            placeId: form.placeId.trim() || null,
            lat: typeof form.lat === 'number' ? form.lat : null,
            lng: typeof form.lng === 'number' ? form.lng : null
          },
          manifest: {
            items: flavorManifestItems,
            subtotal: discountedSubtotal,
            totalUnits: totalBroas
          }
        })
      });

      const raw = await response.text();
      const data = raw ? (JSON.parse(raw) as DeliveryQuote) : null;
      if (!response.ok || !data) {
        throw new Error(extractErrorMessage(data));
      }

      setDeliveryQuote(data);
      setDeliveryQuoteError(null);
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
      const message =
        quoteError instanceof Error ? quoteError.message : 'Nao foi possivel calcular o frete agora.';
      setDeliveryQuote(null);
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
      setIsQuotingDelivery(false);
    }
  }, [
    draftSessionId,
    discountedSubtotal,
    estimatedTotal,
    form.address,
    form.fulfillmentMode,
    form.lat,
    form.lng,
    form.placeId,
    incompleteCustomBoxes.length,
    isCouponApplied,
    minimumSchedule,
    normalizedCouponInput,
    parsedScheduledAt,
    scheduledAtIso,
    flavorManifestItems,
    totalBroas
  ]);

  const hasDeliveryQuoteReady =
    form.fulfillmentMode !== 'DELIVERY' || Boolean(deliveryQuote?.quoteToken);
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
    if (form.fulfillmentMode === 'DELIVERY' && !form.address.trim()) {
      setError('Informe o endereco para entrega.');
      return;
    }
    if (!scheduledAt) {
      setError('Informe data e horario validos.');
      return;
    }
    const parsedScheduledAt = parseLocalDateTime(form.date, form.time);
    if (!parsedScheduledAt || parsedScheduledAt.getTime() < currentMinimumSchedule.getTime()) {
      setForm((current) => ({
        ...current,
        date: formatDateInputValue(currentMinimumSchedule),
        time: formatTimeInputValue(currentMinimumSchedule)
      }));
      setMinimumSchedule(currentMinimumSchedule);
      setError(buildPublicOrderScheduleErrorMessage(currentMinimumSchedule));
      return;
    }
    if (totalBroas <= 0) {
      setError('Escolha ao menos 1 caixa.');
      return;
    }
    if (incompleteCustomBoxes.length > 0) {
      const firstOpenBox = incompleteCustomBoxes[0];
      setError(
        `Complete a Caixa Sabores #${firstOpenBox.index + 1}. Faltam ${firstOpenBox.remainingUnits} broa(s) para fechar 7.`
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
      if (!deliveryQuote) {
        setError(deliveryQuoteError || 'Nao foi possivel calcular o frete agora.');
        return;
      }
    }

    const payloadBase = {
      version: 1,
      customer: {
        name: form.name.trim(),
        phone: form.phone.trim(),
        address: form.fulfillmentMode === 'DELIVERY' ? form.address.trim() : null,
        placeId: form.fulfillmentMode === 'DELIVERY' ? form.placeId.trim() || null : null,
        lat: form.fulfillmentMode === 'DELIVERY' && typeof form.lat === 'number' ? form.lat : null,
        lng: form.fulfillmentMode === 'DELIVERY' && typeof form.lng === 'number' ? form.lng : null,
        deliveryNotes: form.deliveryNotes.trim() || null
      },
      fulfillment: {
        mode: form.fulfillmentMode,
        scheduledAt
      },
      delivery:
        form.fulfillmentMode === 'DELIVERY' && deliveryQuote
          ? ({
              quoteToken: deliveryQuote.quoteToken,
              fee: deliveryQuote.fee,
              provider: deliveryQuote.provider,
              source: deliveryQuote.source,
              status: deliveryQuote.status,
              expiresAt: deliveryQuote.expiresAt
            } as ExternalOrderSubmission['delivery'])
          : undefined,
      flavors: legacyFlavorCounts,
      items: computedOrderItems,
      couponCode: isCouponApplied ? appliedCoupon?.code ?? null : null,
      notes: form.notes.trim() || null,
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
          setDeliveryQuoteError('O frete foi atualizado. Confira o novo total e envie novamente.');
        }
        if (typeof record?.nextAvailableAt === 'string') {
          const suggestedSchedule = new Date(record.nextAvailableAt);
          if (!Number.isNaN(suggestedSchedule.getTime())) {
            applyScheduleToForm(suggestedSchedule);
          }
        }
        throw new Error(extractErrorMessage(data));
      }
      const storedOrderSnapshot: StoredPublicOrderSnapshot = {
        version: 1,
        savedAt: new Date().toISOString(),
        boxes: sanitizeStoredBoxCounts(form.boxes),
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
        order: result.order,
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
          orderId: result.order.id,
          total: result.order.total ?? displayTotal,
          fulfillmentMode: form.fulfillmentMode,
          orderDraftSessionId: draftSessionId
        }
      });
      router.push('/pedidofinalizado');
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Nao foi possivel enviar o pedido.';
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
      placeId: '',
      lat: null,
      lng: null
    };
    setDraftSessionId(createPublicOrderDraftSessionId());
    setMinimumSchedule(nextMinimum);
    setForm({
      ...initialFormState,
      date: formatDateInputValue(nextMinimum),
      time: formatTimeInputValue(nextMinimum)
    });
    setCustomBoxes([]);
    setError(null);
    setDeliveryQuote(null);
    setDeliveryQuoteError(null);
    setCouponInput('');
    setAppliedCoupon(null);
    setCouponError(null);
    setPendingPrefilledCouponCode(null);
    void syncMinimumSchedule();
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
                  {minimumScheduleLabel ? (
                    <p className="mt-2 max-w-[44rem] text-sm leading-6 text-[color:var(--ink-muted)]">
                      Próximo horário:
                      <strong className="ml-1 text-[color:var(--ink-strong)]">{minimumScheduleLabel}</strong>.
                    </p>
                  ) : null}
                </div>

                <div className="public-order-mode-grid">
                  {[
                    {
                      value: 'DELIVERY' as const,
                      title: 'Entrega',
                      description: 'Receber no endereco.'
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
                      label={form.fulfillmentMode === 'DELIVERY' ? 'Endereco para entrega' : 'Ponto de retirada'}
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
                              placeId: '',
                              lat: null,
                              lng: null
                            });
                            return {
                              ...current,
                              address: nextValue,
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
                            placeId: `${patch.placeId || ''}`,
                            lat: typeof patch.lat === 'number' ? patch.lat : null,
                            lng: typeof patch.lng === 'number' ? patch.lng : null
                          });

                          setForm((current) => {
                            if (current.fulfillmentMode !== 'DELIVERY') return current;
                            return {
                              ...current,
                              address: nextAddress,
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
                        value={form.deliveryNotes}
                        onChange={(event) => setForm((current) => ({ ...current, deliveryNotes: event.target.value }))}
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
                  <FormField label="Horario">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                      <select
                        className="app-select xl:h-14 xl:text-[1.02rem]"
                        value={selectedHourValue}
                        onChange={(event) => handleHourChange(event.target.value)}
                      >
                        <option value="">Hora</option>
                        {PUBLIC_ORDER_HOUR_OPTIONS.map((hour) => {
                          const isDisabled =
                            form.date === minimumDateValue &&
                            Boolean(minimumTimeParts) &&
                            hour < (minimumTimeParts?.hour || '');
                          return (
                            <option key={hour} value={hour} disabled={isDisabled}>
                              {hour}
                            </option>
                          );
                        })}
                      </select>
                      <span className="text-base font-semibold text-[color:var(--ink-muted)]">:</span>
                      <select
                        className="app-select xl:h-14 xl:text-[1.02rem]"
                        value={selectedMinuteValue}
                        onChange={(event) => handleMinuteChange(event.target.value)}
                        disabled={!selectedHourValue}
                      >
                        <option value="">Min</option>
                        {availableMinuteOptions.map((minute) => (
                          <option key={minute} value={minute}>
                            {minute}
                          </option>
                        ))}
                      </select>
                    </div>
                  </FormField>
                </div>

                {minimumScheduleLabel ? (
                  <div className="mt-3 rounded-[18px] border border-[rgba(181,68,57,0.16)] bg-[rgb(255,244,240)] px-4 py-3 text-sm leading-6 text-[color:var(--ink-muted)]">
                    <span className="block">
                      Próximo horário: <strong>{minimumScheduleLabel}</strong>.
                    </span>
                  </div>
                ) : null}
              </section>
            </div>

            <section className="rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-white p-4 sm:rounded-[28px] sm:p-6 xl:p-7">
              <div className="mb-4 flex flex-col gap-2 sm:mb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                <div>
                  <h2 className="text-[1.35rem] font-semibold text-[color:var(--ink-strong)] sm:text-2xl">Caixas</h2>
                </div>
              </div>

              <div className="public-order-box-grid">
                {runtimeBoxEntries.map((entry) => {
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
                          className="h-12 rounded-[16px] border border-white/85 bg-white text-2xl font-semibold text-[color:var(--ink-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] transition hover:bg-white sm:h-14 sm:rounded-[18px] xl:h-16 xl:text-[2rem]"
                          aria-label={`Diminuir ${entry.label}`}
                        >
                          −
                        </button>
                        <div className="public-order-box-card__summary">
                          <input
                            className="app-input h-12 text-center text-base font-semibold sm:h-14 sm:text-lg xl:h-16 xl:text-xl"
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
                          className="h-12 rounded-[16px] border border-white/85 bg-white text-2xl font-semibold text-[color:var(--ink-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] transition hover:bg-white sm:h-14 sm:rounded-[18px] xl:h-16 xl:text-[2rem]"
                          aria-label={`Aumentar ${entry.label}`}
                        >
                          +
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="mt-4 rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-[rgb(247,239,230)] p-4 sm:mt-5 sm:rounded-[26px] sm:p-5 xl:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between xl:items-center">
                  <div>
                    <h3 className="text-[1.1rem] font-semibold text-[color:var(--ink-strong)] sm:text-[1.35rem]">
                      Caixa Sabores
                    </h3>
                    <p className="mt-1 text-[0.82rem] leading-5 text-[color:var(--ink-muted)] sm:text-sm">
                      Monte 7 broas.
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
                              Caixa Sabores #{box.index + 1}
                            </p>
                            <p className="mt-1 text-[0.82rem] leading-5 text-[color:var(--ink-muted)]">
                              {box.totalUnits === 0
                                ? 'Monte 7 broas.'
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
                            const productArt = {
                              mode: 'single',
                              src: product.imageUrl || '',
                              objectPosition: 'center center'
                            } as const;
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
                                        art={product.imageUrl ? productArt : saboresCardArt}
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
                                  aria-label={`Diminuir ${product.label} na Caixa Sabores #${box.index + 1}`}
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
                                  aria-label={`Aumentar ${product.label} na Caixa Sabores #${box.index + 1}`}
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
                  Se tiver um codigo de desconto, aplique antes de calcular o frete.
                </p>
              </div>
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto_auto] xl:items-end">
                <FormField label="Codigo do cupom">
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
                    placeholder="Ex.: BROA10"
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
              ) : (
                <p className="mt-3 text-sm leading-6 text-[color:var(--ink-muted)]">
                  O desconto entra no total do pedido e tambem no calculo do frete.
                </p>
              )}
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
                disabled={isSubmitting || isQuotingDelivery || isResolvingCoupon}
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
                    <div className="rounded-[18px] border border-[rgba(126,79,45,0.08)] bg-white px-3 py-3">
                      <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                        Produtos
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

                {form.fulfillmentMode === 'DELIVERY' && !deliveryQuoteError && isScheduleBelowMinimum && minimumSchedule ? (
                  <div className="app-inline-notice app-inline-notice--warning rounded-[20px] px-4 py-3 sm:rounded-[24px]">
                    {buildPublicOrderScheduleErrorMessage(minimumSchedule)}
                  </div>
                ) : null}

                {incompleteCustomBoxes.length > 0 ? (
                  <div className="app-inline-notice app-inline-notice--warning rounded-[20px] px-4 py-3 sm:rounded-[24px]">
                    {incompleteCustomBoxes.length === 1
                      ? 'Falta completar 1 Caixa Sabores.'
                      : `Faltam completar ${incompleteCustomBoxes.length} caixas Sabores.`}
                  </div>
                ) : null}

                <div className="rounded-[20px] bg-white p-4 sm:rounded-[24px]">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)] sm:text-xs">
                    Data e hora
                  </p>
                  <p className="mt-2 text-base font-semibold text-[color:var(--ink-strong)] sm:text-lg">
                    {form.date && form.time ? `${form.date} às ${form.time}` : 'Escolha data e hora'}
                  </p>
                  {minimumScheduleLabel ? (
                    <p className="mt-2 text-sm leading-6 text-[color:var(--ink-muted)]">
                      Próximo horário: <strong className="text-[color:var(--ink-strong)]">{minimumScheduleLabel}</strong>.
                    </p>
                  ) : null}
                </div>

                <div className="rounded-[20px] bg-white p-4 sm:rounded-[24px]">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)] sm:text-xs">
                    Caixas escolhidas
                  </p>
                  {selectedBoxes.length ? (
                    <ul className="mt-3 grid max-h-[260px] gap-2 overflow-y-auto pr-1">
                      {selectedBoxes.map((entry) => (
                        <li
                          key={entry.key}
                          className="rounded-2xl border border-[rgba(126,79,45,0.08)] bg-white px-3 py-2 text-sm text-[color:var(--ink-muted)]"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span>{entry.label}</span>
                            <strong className="text-[color:var(--ink-strong)]">{entry.quantityLabel}</strong>
                          </div>
                          {entry.detail ? (
                            <p className="mt-1 text-[0.78rem] leading-5 text-[color:var(--ink-muted)]">{entry.detail}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm leading-6 text-[color:var(--ink-muted)]">
                      Nenhuma caixa ainda.
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
                    disabled={isSubmitting || isQuotingDelivery || isResolvingCoupon}
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
    </div>
  );
}
