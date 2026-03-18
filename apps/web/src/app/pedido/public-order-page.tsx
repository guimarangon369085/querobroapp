'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  formatExternalOrderMinimumSchedule,
  resolveDisplayNumber,
  resolveExternalOrderMinimumSchedule,
  type ExternalOrderSubmission,
  type OrderIntakeMeta,
  type PixCharge
} from '@querobroapp/shared';
import { FormField } from '@/components/form/FormField';
import { useFeedback } from '@/components/feedback-provider';
import { resolveAnalyticsSessionId, trackAnalyticsEvent } from '@/lib/analytics';
import {
  buildCustomerAddressAutofillFromGooglePlace,
  type GooglePlaceResultLike
} from '@/lib/customer-autofill';
import { loadGooglePlacesLibrary } from '@/lib/google-places';
import { OrderCardArtwork } from '@/features/orders/order-card-artwork';
import {
  ORDER_BOX_CATALOG,
  ORDER_BOX_UNITS,
  ORDER_FLAVOR_CODES,
  ORDER_SABORES_REFERENCE_IMAGE,
  type OrderBoxCode,
  type OrderFlavorCode,
  calculateOrderSubtotalFromFlavorSummary,
  deriveFlavorUnitsFromBoxCounts,
  formatOrderFlavorComposition,
  sumOrderFlavorCounts
} from '@/features/orders/order-box-catalog';

const boxCatalog = ORDER_BOX_CATALOG;
const FLAVOR_CODES = ORDER_FLAVOR_CODES;
const GOOGLE_MAPS_API_KEY = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();
const PUBLIC_ORDER_TIME_STEP_SECONDS = 15 * 60;
const PUBLIC_ORDER_DRAFT_SESSION_STORAGE_KEY = 'querobroapp:public-order-draft-session-id';
const PUBLIC_ORDER_PROFILE_STORAGE_KEY = 'querobroapp:public-order-profile';
const PUBLIC_ORDER_LAST_ORDER_STORAGE_KEY = 'querobroapp:public-order-last-order';
const PUBLIC_ORDER_PICKUP_ADDRESS = 'Alameda Jaú, 731';

type BoxCode = OrderBoxCode;
type FlavorCode = OrderFlavorCode;
type SelectedBoxSummary = {
  key: string;
  label: string;
  quantity: number;
  quantityLabel: string;
  detail?: string | null;
};
type CustomBoxDraft = {
  id: string;
  flavors: Record<FlavorCode, number>;
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
  boxes: Record<BoxCode, string>;
};

type PublicOrderResult = {
  order: {
    id: number;
    publicNumber?: number | null;
    total?: number;
    scheduledAt?: string | null;
  };
  intake: OrderIntakeMeta;
};

type StoredPublicOrderProfile = {
  version: 1;
  name: string;
  phone: string;
  fulfillmentMode: 'DELIVERY' | 'PICKUP';
  address: string;
  placeId: string;
  lat: number | null;
  lng: number | null;
  deliveryNotes: string;
};

type StoredPublicOrderSnapshot = {
  version: 1;
  savedAt: string;
  boxes: Record<BoxCode, string>;
  customBoxes: Array<Record<FlavorCode, number>>;
  notes: string;
};

type DeliveryQuote = {
  provider: 'NONE' | 'LOCAL' | 'UBER_DIRECT' | 'LOGGI';
  fee: number;
  currencyCode: string;
  source: 'NONE' | 'UBER_QUOTE' | 'LOGGI_QUOTE' | 'MANUAL_FALLBACK';
  status: 'NOT_REQUIRED' | 'PENDING' | 'QUOTED' | 'FALLBACK' | 'EXPIRED' | 'FAILED';
  quoteToken: string | null;
  expiresAt: string | null;
  fallbackReason: string | null;
  breakdownLabel?: string | null;
};

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
  boxes: {
    T: '',
    G: '',
    D: '',
    Q: '',
    R: '',
    MG: '',
    MD: '',
    MQ: '',
    MR: ''
  }
};

function sanitizeStoredBoxCounts(value: unknown) {
  const source = value && typeof value === 'object' ? (value as Partial<Record<BoxCode, unknown>>) : {};
  const next = { ...initialFormState.boxes };
  for (const code of Object.keys(initialFormState.boxes) as BoxCode[]) {
    const quantity = parseCountValue(String(source[code] ?? ''));
    next[code] = quantity > 0 ? String(quantity) : '';
  }
  return next;
}

function sanitizeStoredCustomBox(value: unknown) {
  const source = value && typeof value === 'object' ? (value as Partial<Record<FlavorCode, unknown>>) : {};
  return FLAVOR_CODES.reduce(
    (accumulator, code) => {
      accumulator[code] = Math.max(Math.floor(Number(source[code] ?? 0) || 0), 0);
      return accumulator;
    },
    { T: 0, G: 0, D: 0, Q: 0, R: 0 } as Record<FlavorCode, number>
  );
}

function readStoredPublicOrderProfile(): StoredPublicOrderProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PUBLIC_ORDER_PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPublicOrderProfile> | null;
    if (!parsed || parsed.version !== 1) return null;
    const fulfillmentMode = parsed.fulfillmentMode === 'PICKUP' ? 'PICKUP' : 'DELIVERY';
    return {
      version: 1 as const,
      name: String(parsed.name || '').trim(),
      phone: String(parsed.phone || '').trim(),
      fulfillmentMode,
      address:
        fulfillmentMode === 'PICKUP'
          ? PUBLIC_ORDER_PICKUP_ADDRESS
          : String(parsed.address || '').trim(),
      placeId: fulfillmentMode === 'DELIVERY' ? String(parsed.placeId || '').trim() : '',
      lat: typeof parsed.lat === 'number' && Number.isFinite(parsed.lat) ? parsed.lat : null,
      lng: typeof parsed.lng === 'number' && Number.isFinite(parsed.lng) ? parsed.lng : null,
      deliveryNotes: String(parsed.deliveryNotes || '').trim()
    };
  } catch {
    return null;
  }
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

function parseLocalDateTime(date: string, time: string) {
  if (!date || !time) return null;
  const [year, month, day] = date.split('-').map((entry) => Number(entry));
  const [hour, minute] = time.split(':').map((entry) => Number(entry));
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildPublicOrderScheduleErrorMessage(minimum: Date) {
  return `Pedidos novos nao entram para hoje. O primeiro horario disponivel agora e ${formatExternalOrderMinimumSchedule(minimum)}.`;
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

function formatScheduledAt(value?: string | null) {
  if (!value) return 'Data a confirmar';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Data a confirmar';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(parsed);
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
    flavors: { T: 0, G: 0, D: 0, Q: 0, R: 0 }
  };
}

function pluralize(count: number, singular: string, plural: string) {
  return count === 1 ? singular : plural;
}

function formatCustomBoxParts(counts: Record<FlavorCode, number>) {
  return FLAVOR_CODES.map((code) => ({ code, quantity: counts[code] || 0 }))
    .filter((entry) => entry.quantity > 0)
    .map((entry) => `${entry.quantity} ${boxCatalog[entry.code].label}`)
    .join(' • ');
}

export function PublicOrderPage() {
  const { notifyError, notifyInfo, presentSuccess } = useFeedback();
  const [form, setForm] = useState<PublicOrderFormState>(initialFormState);
  const [customBoxes, setCustomBoxes] = useState<CustomBoxDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<PublicOrderResult | null>(null);
  const [isCopyingPix, setIsCopyingPix] = useState(false);
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [deliveryQuoteError, setDeliveryQuoteError] = useState<string | null>(null);
  const [isQuotingDelivery, setIsQuotingDelivery] = useState(false);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const orderFormRef = useRef<HTMLFormElement | null>(null);
  const pageTopRef = useRef<HTMLDivElement | null>(null);
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
    return Object.fromEntries(
      (Object.keys(boxCatalog) as BoxCode[]).map((code) => [code, parseCountValue(form.boxes[code])])
    ) as Record<BoxCode, number>;
  }, [form.boxes]);

  const officialBoxCount = useMemo(
    () => Object.values(parsedBoxCounts).reduce((sum, quantity) => sum + quantity, 0),
    [parsedBoxCounts]
  );

  const officialUnits = useMemo(() => deriveFlavorUnitsFromBoxCounts(parsedBoxCounts), [parsedBoxCounts]);
  const customBoxSummaries = useMemo(
    () =>
      customBoxes.map((box, index) => {
        const flavors = {
          T: Math.max(Math.floor(box.flavors.T || 0), 0),
          G: Math.max(Math.floor(box.flavors.G || 0), 0),
          D: Math.max(Math.floor(box.flavors.D || 0), 0),
          Q: Math.max(Math.floor(box.flavors.Q || 0), 0),
          R: Math.max(Math.floor(box.flavors.R || 0), 0)
        } satisfies Record<FlavorCode, number>;
        const totalUnits = sumOrderFlavorCounts(flavors);
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
    [customBoxes]
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
  const computedUnits = useMemo(() => {
    const combined = { ...officialUnits };
    for (const box of activeCustomBoxes) {
      for (const code of FLAVOR_CODES) {
        combined[code] += box.flavors[code];
      }
    }
    return combined;
  }, [activeCustomBoxes, officialUnits]);
  const totalBroas = useMemo(
    () => Object.values(computedUnits).reduce((sum, quantity) => sum + quantity, 0),
    [computedUnits]
  );
  const estimatedTotal = useMemo(
    () =>
      calculateOrderSubtotalFromFlavorSummary({
        totalUnits: totalBroas,
        flavorCounts: computedUnits
      }),
    [computedUnits, totalBroas]
  );
  const scheduledAtIso = useMemo(() => toLocalIso(form.date, form.time), [form.date, form.time]);
  const selectedBoxes = useMemo<SelectedBoxSummary[]>(
    () => [
      ...(Object.keys(parsedBoxCounts) as BoxCode[])
        .map((code) => ({ code, quantity: parsedBoxCounts[code], meta: boxCatalog[code] }))
        .filter((entry) => entry.quantity > 0)
        .map((entry) => ({
          key: entry.code,
          label: entry.meta.label,
          quantity: entry.quantity,
          quantityLabel: `${entry.quantity} cx`,
          detail: entry.meta.detail
        })),
      ...activeCustomBoxes.map((box) => ({
        key: box.id,
        label: `Caixa Sabores #${box.index + 1}`,
        quantity: 1,
        quantityLabel: box.isComplete ? '1 cx' : `${box.totalUnits}/7`,
        detail: formatCustomBoxParts(box.flavors)
      }))
    ],
    [activeCustomBoxes, parsedBoxCounts]
  );
  const flavorManifestItems = useMemo(
    () =>
      FLAVOR_CODES.map((code) => ({
        name: boxCatalog[code].label,
        quantity: computedUnits[code]
      })).filter((entry) => entry.quantity > 0),
    [computedUnits]
  );
  const pixCharge: PixCharge | null = result?.intake.pixCharge ?? null;
  const deliveryFee = deliveryQuote?.fee ?? 0;
  const displayTotal = estimatedTotal + deliveryFee;
  const parsedScheduledAt = useMemo(() => parseLocalDateTime(form.date, form.time), [form.date, form.time]);
  const minimumScheduleLabel = useMemo(
    () => (minimumSchedule ? formatExternalOrderMinimumSchedule(minimumSchedule) : null),
    [minimumSchedule]
  );
  const isScheduleBelowMinimum = useMemo(() => {
    if (!minimumSchedule || !parsedScheduledAt) return false;
    return parsedScheduledAt.getTime() < minimumSchedule.getTime();
  }, [minimumSchedule, parsedScheduledAt]);

  const syncMinimumSchedule = useCallback(() => {
    const nextMinimum = resolveExternalOrderMinimumSchedule();
    setMinimumSchedule(nextMinimum);
    setForm((current) => {
      const currentScheduledAt = parseLocalDateTime(current.date, current.time);
      if (currentScheduledAt && currentScheduledAt.getTime() >= nextMinimum.getTime()) {
        return current;
      }
      return {
        ...current,
        date: formatDateInputValue(nextMinimum),
        time: formatTimeInputValue(nextMinimum)
      };
    });
  }, []);

  useEffect(() => {
    syncMinimumSchedule();
    const timer = window.setInterval(() => {
      syncMinimumSchedule();
    }, 60_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncMinimumSchedule();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [syncMinimumSchedule]);

  const setBoxQuantity = (code: BoxCode, nextValue: number | string) => {
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

  const adjustCustomBoxFlavor = (boxId: string, code: FlavorCode, delta: number) => {
    setCustomBoxes((current) =>
      current.map((entry) => {
        if (entry.id !== boxId) return entry;
        const currentValue = Math.max(Math.floor(entry.flavors[code] || 0), 0);
        if (delta < 0) {
          return {
            ...entry,
            flavors: {
              ...entry.flavors,
              [code]: Math.max(currentValue + delta, 0)
            }
          };
        }

        const totalUnits = sumOrderFlavorCounts(entry.flavors);
        if (totalUnits >= ORDER_BOX_UNITS) return entry;
        return {
          ...entry,
          flavors: {
            ...entry.flavors,
            [code]: currentValue + delta
          }
        };
      })
    );
  };

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY || form.fulfillmentMode !== 'DELIVERY') return;

    const input = addressInputRef.current;
    if (!input) return;

    let disposed = false;
    let listener: { remove?: () => void } | null = null;

    void loadGooglePlacesLibrary({ apiKey: GOOGLE_MAPS_API_KEY })
      .then((google) => {
        if (disposed) return;

        const mapsApi = (google as { maps?: { places?: { Autocomplete?: unknown } } }).maps;
        const placesApi = mapsApi?.places as
          | {
              Autocomplete?: new (
                input: HTMLInputElement,
                options?: Record<string, unknown>
              ) => {
                addListener: (
                  eventName: string,
                  handler: () => void
                ) => {
                  remove?: () => void;
                };
                getPlace?: () => unknown;
              };
            }
          | undefined;

        if (!placesApi?.Autocomplete) return;

        const autocomplete = new placesApi.Autocomplete(input, {
          fields: ['address_components', 'formatted_address', 'geometry', 'place_id'],
          componentRestrictions: { country: 'br' },
          types: ['address']
        });

        listener = autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace?.();
          const patch = buildCustomerAddressAutofillFromGooglePlace(place as GooglePlaceResultLike);
          const nextAddress = `${patch.address || ''}`.trim();
          if (!nextAddress) return;
          rememberDeliveryLocation({
            address: nextAddress,
            placeId: `${patch.placeId || ''}`,
            lat: typeof patch.lat === 'number' ? patch.lat : null,
            lng: typeof patch.lng === 'number' ? patch.lng : null
          });

          setForm((current) => ({
            ...current,
            address: nextAddress,
            placeId: `${patch.placeId || ''}`,
            lat: typeof patch.lat === 'number' ? patch.lat : null,
            lng: typeof patch.lng === 'number' ? patch.lng : null
          }));
        });
      })
      .catch((error) => {
        console.warn(error instanceof Error ? error.message : 'Google Places indisponivel no momento.');
      });

    return () => {
      disposed = true;
      if (listener?.remove) listener.remove();
    };
  }, [form.fulfillmentMode, rememberDeliveryLocation]);

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
    estimatedTotal,
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
            subtotal: estimatedTotal,
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
    estimatedTotal,
    form.address,
    form.fulfillmentMode,
    form.lat,
    form.lng,
    form.placeId,
    incompleteCustomBoxes.length,
    minimumSchedule,
    parsedScheduledAt,
    scheduledAtIso,
    flavorManifestItems,
    totalBroas
  ]);

  const hasDeliveryQuoteReady =
    form.fulfillmentMode !== 'DELIVERY' || Boolean(deliveryQuote?.quoteToken);
  const primaryActionLabel = isSubmitting
    ? 'FINALIZANDO...'
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

  const scrollToTop = useCallback(() => {
    if (pageTopRef.current) {
      pageTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const scheduledAt = scheduledAtIso;
    const currentMinimumSchedule = resolveExternalOrderMinimumSchedule();
    if (!form.name.trim()) {
      setError('Informe o nome completo.');
      return;
    }
    if (!form.phone.trim()) {
      setError('Informe o telefone com WhatsApp.');
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

    const payloadBase: ExternalOrderSubmission = {
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
      flavors: computedUnits,
      notes: form.notes.trim() || null,
      source: {
        channel: 'PUBLIC_FORM',
        originLabel: 'public-order-page',
        externalId: draftSessionId,
        idempotencyKey: null
      }
    };

    const submissionFingerprint = hashPublicOrderSubmission({
      version: payloadBase.version,
      customer: payloadBase.customer,
      fulfillment: payloadBase.fulfillment,
      delivery: payloadBase.delivery,
      flavors: payloadBase.flavors,
      notes: payloadBase.notes
    });
    const payload: ExternalOrderSubmission = {
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
      setResult(data as PublicOrderResult);
      trackAnalyticsEvent({
        sessionId: resolveAnalyticsSessionId(),
        eventType: 'FUNNEL',
        path: '/pedido',
        label: 'public_order_submitted',
        meta: {
          orderId: (data as PublicOrderResult).order.id,
          total: (data as PublicOrderResult).order.total ?? estimatedTotal,
          fulfillmentMode: form.fulfillmentMode,
          orderDraftSessionId: draftSessionId
        }
      });
      presentSuccess(
        'Seu pedido foi recebido. Confira o resumo e o PIX para concluir.',
        `Pedido #${resolveDisplayNumber((data as PublicOrderResult).order) ?? (data as PublicOrderResult).order.id}`
      );
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

  const copyPixCode = async () => {
    if (!pixCharge?.copyPasteCode) return;
    try {
      setIsCopyingPix(true);
      await navigator.clipboard.writeText(pixCharge.copyPasteCode);
      notifyInfo('Codigo PIX copiado.');
    } catch {
      notifyError('Nao foi possivel copiar o codigo PIX.');
    } finally {
      setIsCopyingPix(false);
    }
  };

  const resetForm = () => {
    const nextMinimum = resolveExternalOrderMinimumSchedule();
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
    setResult(null);
    setDeliveryQuote(null);
    setDeliveryQuoteError(null);
  };

  const startAnotherOrder = () => {
    const nextMinimum = resolveExternalOrderMinimumSchedule();
    const preservedScheduledAt = parseLocalDateTime(form.date, form.time);
    const nextScheduledAt =
      preservedScheduledAt && preservedScheduledAt.getTime() >= nextMinimum.getTime()
        ? preservedScheduledAt
        : nextMinimum;

    setDraftSessionId(createPublicOrderDraftSessionId());
    setMinimumSchedule(nextMinimum);
    setForm((current) => ({
      ...current,
      date: formatDateInputValue(nextScheduledAt),
      time: formatTimeInputValue(nextScheduledAt),
      notes: '',
      boxes: {
        ...initialFormState.boxes
      }
    }));
    setCustomBoxes([]);
    setError(null);
    setResult(null);
    setDeliveryQuote(null);
    setDeliveryQuoteError(null);
    scrollToTop();
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(255,240,220,0.95),transparent_32%),radial-gradient(circle_at_top_right,rgba(219,234,222,0.9),transparent_28%),linear-gradient(180deg,#f8efe5_0%,#f4eadc_100%)]">
      <div
        className="mx-auto w-full max-w-[1720px] px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-8 xl:px-10 2xl:px-12"
        ref={pageTopRef}
      >
        <section className="public-order-layout">
          <form
            autoComplete="on"
            className="grid gap-4 rounded-[26px] border border-[rgba(126,79,45,0.1)] bg-[rgba(255,252,248,0.88)] p-4 shadow-[0_22px_60px_rgba(70,44,26,0.12)] sm:gap-5 sm:rounded-[32px] sm:p-6 sm:shadow-[0_26px_90px_rgba(70,44,26,0.12)] xl:rounded-none xl:border-0 xl:bg-transparent xl:p-0 xl:shadow-none"
            onSubmit={onSubmit}
            ref={orderFormRef}
          >
            <div className="public-order-intake-grid">
              <section
                className="rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-white/78 p-4 sm:rounded-[28px] sm:p-6 xl:h-full xl:p-7"
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
                  <FormField label="Telefone com WhatsApp">
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

              <section className="rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-white/78 p-4 sm:rounded-[28px] sm:p-6 xl:p-7">
                <div className="mb-4 sm:mb-5">
                  <h2 className="text-[1.35rem] font-semibold text-[color:var(--ink-strong)] sm:text-2xl">
                    Entrega ou retirada
                  </h2>
                  {minimumScheduleLabel ? (
                    <p className="mt-2 max-w-[44rem] text-sm leading-6 text-[color:var(--ink-muted)]">
                      Pedidos novos nao entram para hoje. O formulario ja abre no primeiro horario disponivel:
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
                            ? 'border-[rgba(181,68,57,0.32)] bg-[linear-gradient(160deg,rgba(255,245,241,0.98),rgba(251,232,225,0.94))] shadow-[0_16px_34px_rgba(181,68,57,0.12)]'
                            : 'border-[rgba(126,79,45,0.08)] bg-[rgba(250,245,239,0.86)] hover:border-[rgba(126,79,45,0.18)] hover:bg-white/88'
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
                                ? 'border-[rgba(181,68,57,0.3)] bg-[rgba(181,68,57,0.12)] text-[rgb(160,20,26)]'
                                : 'border-[rgba(126,79,45,0.14)] bg-white/85 text-[color:var(--ink-muted)]'
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
                      <input
                        className="app-input xl:h-14 xl:text-[1.02rem]"
                        ref={addressInputRef}
                        name="street-address"
                        value={form.address}
                        onChange={(event) =>
                          setForm((current) => {
                            if (current.fulfillmentMode !== 'DELIVERY') return current;
                            rememberDeliveryLocation({
                              address: event.target.value,
                              placeId: '',
                              lat: null,
                              lng: null
                            });
                            return {
                              ...current,
                              address: event.target.value,
                              placeId: '',
                              lat: null,
                              lng: null
                            };
                          })
                        }
                        placeholder={
                          form.fulfillmentMode === 'DELIVERY'
                            ? 'Rua, numero e bairro'
                            : PUBLIC_ORDER_PICKUP_ADDRESS
                        }
                        autoCapitalize="words"
                        autoComplete={form.fulfillmentMode === 'DELIVERY' ? 'street-address' : 'off'}
                        readOnly={isPickupSelected}
                        aria-readonly={isPickupSelected}
                        spellCheck={false}
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
                    <input
                      className="app-input xl:h-14 xl:text-[1.02rem]"
                      type="time"
                      min={form.date === minimumDateValue ? minimumTimeValue || undefined : undefined}
                      step={PUBLIC_ORDER_TIME_STEP_SECONDS}
                      value={form.time}
                      onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))}
                    />
                  </FormField>
                </div>

                {minimumScheduleLabel ? (
                  <div className="mt-3 rounded-[18px] border border-[rgba(181,68,57,0.16)] bg-[rgba(255,244,240,0.82)] px-4 py-3 text-sm leading-6 text-[color:var(--ink-muted)]">
                    <strong className="block text-[color:var(--ink-strong)]">Janela minima para pedido novo</strong>
                    <span className="block mt-1">
                      Hoje fica indisponivel para novos pedidos. Escolha a partir de <strong>{minimumScheduleLabel}</strong>.
                    </span>
                  </div>
                ) : null}

                <div className="mt-4">
                  <FormField label="Complemento">
                    <input
                      className="app-input xl:h-14 xl:text-[1.02rem]"
                      name="address-line2"
                      value={form.deliveryNotes}
                      onChange={(event) => setForm((current) => ({ ...current, deliveryNotes: event.target.value }))}
                      placeholder="Portao azul, interfone, bloco"
                      autoComplete={form.fulfillmentMode === 'DELIVERY' ? 'address-line2' : 'off'}
                      autoCapitalize="sentences"
                    />
                  </FormField>
                </div>
              </section>
            </div>

            <section className="rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-white/78 p-4 sm:rounded-[28px] sm:p-6 xl:p-7">
              <div className="mb-4 flex flex-col gap-2 sm:mb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                <div>
                  <h2 className="text-[1.35rem] font-semibold text-[color:var(--ink-strong)] sm:text-2xl">Caixas</h2>
                </div>
              </div>

              <div className="public-order-box-grid">
                {(Object.keys(boxCatalog) as BoxCode[]).map((code) => {
                  const meta = boxCatalog[code];
                  const quantity = parsedBoxCounts[code];
                  const active = quantity > 0;
                  return (
                      <article
                        key={code}
                        className={`public-order-box-card group grid gap-3 overflow-hidden rounded-[22px] border p-3 shadow-[0_14px_28px_rgba(74,47,31,0.08)] transition-transform duration-300 hover:-translate-y-1 sm:gap-4 sm:rounded-[26px] sm:p-4 sm:shadow-[0_16px_38px_rgba(74,47,31,0.08)] xl:gap-4 xl:p-5 ${meta.accentClassName} ${
                          active ? 'ring-1 ring-[rgba(181,68,57,0.16)]' : ''
                        }`}
                      >
                      <div className="public-order-box-card__hero">
                        <div className="public-order-box-card__media relative shrink-0">
                          <div className="relative h-full w-full overflow-hidden rounded-[18px] border border-white/80 bg-white/70 shadow-[0_12px_24px_rgba(74,47,31,0.12)] transition-transform duration-300 group-hover:translate-y-[-2px] sm:rounded-[22px] sm:shadow-[0_14px_28px_rgba(74,47,31,0.12)] xl:rounded-[24px]">
                            <OrderCardArtwork
                              alt={meta.label}
                              art={meta.art}
                              sizes="(max-width: 640px) 96px, (max-width: 1279px) 118px, (max-width: 1535px) 42vw, 22vw"
                            />
                          </div>
                        </div>
                        <div className="public-order-box-card__body">
                          <h3 className="public-order-box-card__title text-[0.96rem] font-semibold leading-tight tracking-[-0.02em] text-[color:var(--ink-strong)] sm:text-lg xl:text-[1.08rem]">
                            {meta.label}
                          </h3>
                          <p className="public-order-box-card__detail mt-2 text-[0.76rem] leading-[1.35] text-[color:var(--ink-muted)] sm:text-sm sm:leading-6 xl:text-[0.84rem] xl:leading-6">
                            {meta.detail}
                          </p>
                          <p className="public-order-box-card__price mt-1 text-sm font-semibold text-[color:var(--ink-strong)] xl:pt-3 xl:text-[1rem]">
                            {formatCurrencyBRL(meta.priceEstimate)}
                          </p>
                        </div>
                      </div>

                      <div className="public-order-box-card__controls">
                        <button
                          type="button"
                          onClick={() => setBoxQuantity(code, Math.max(quantity - 1, 0))}
                          className="h-12 rounded-[16px] border border-white/85 bg-white/86 text-2xl font-semibold text-[color:var(--ink-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] transition hover:bg-white sm:h-14 sm:rounded-[18px] xl:h-16 xl:text-[2rem]"
                          aria-label={`Diminuir ${meta.label}`}
                        >
                          −
                        </button>
                        <div className="public-order-box-card__summary">
                          <input
                            className="app-input h-12 text-center text-base font-semibold sm:h-14 sm:text-lg xl:h-16 xl:text-xl"
                            inputMode="numeric"
                            value={form.boxes[code]}
                            onChange={(event) => setBoxQuantity(code, event.target.value)}
                            placeholder="0"
                            aria-label={meta.label}
                          />
                          <div className="public-order-box-card__pill rounded-[16px] border border-white/80 bg-white/80 px-3 py-2.5 text-center text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[color:var(--ink-muted)] sm:rounded-[18px] sm:py-3 sm:text-xs xl:min-h-[64px] xl:content-center">
                            {quantity} {pluralize(quantity, 'caixa', 'caixas')}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setBoxQuantity(code, quantity + 1)}
                          className="h-12 rounded-[16px] border border-white/85 bg-white/86 text-2xl font-semibold text-[color:var(--ink-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] transition hover:bg-white sm:h-14 sm:rounded-[18px] xl:h-16 xl:text-[2rem]"
                          aria-label={`Aumentar ${meta.label}`}
                        >
                          +
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="mt-4 rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-[rgba(247,239,230,0.62)] p-4 sm:mt-5 sm:rounded-[26px] sm:p-5 xl:p-6">
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
                            ? 'border-emerald-200 bg-emerald-50/80'
                            : box.isActive
                              ? 'border-amber-200 bg-amber-50/80'
                              : 'border-white/80 bg-white/80'
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
                            <span className="rounded-full border border-white/80 bg-white/86 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)] sm:text-xs">
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
                          {FLAVOR_CODES.map((code) => {
                            const meta = boxCatalog[code];
                            const quantity = box.flavors[code];
                            return (
                              <div
                                key={`${box.id}-${code}`}
                                className="public-order-custom-row rounded-[16px] border border-white/80 bg-white/82 px-3 py-2.5"
                              >
                                <div className="public-order-custom-row__info">
                                  <div className="relative h-10 w-10 shrink-0">
                                    <div className="relative h-full w-full overflow-hidden rounded-xl border border-white/80 bg-white shadow-[0_8px_18px_rgba(70,44,26,0.08)]">
                                      <OrderCardArtwork alt={meta.label} art={meta.art} sizes="40px" />
                                    </div>
                                  </div>
                                  <p className="public-order-custom-row__label text-[0.82rem] font-semibold text-[color:var(--ink-strong)] sm:text-sm">
                                    {meta.label}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  className="public-order-custom-row__button h-10 rounded-[14px] border border-white/85 bg-white text-[1.15rem] font-semibold text-[color:var(--ink-strong)] transition hover:bg-white sm:text-xl"
                                  onClick={() => adjustCustomBoxFlavor(box.id, code, -1)}
                                  disabled={quantity <= 0}
                                  aria-label={`Diminuir ${meta.label} na Caixa Sabores #${box.index + 1}`}
                                >
                                  −
                                </button>
                                <div className="public-order-custom-row__qty text-center text-[0.82rem] font-semibold text-[color:var(--ink-strong)] sm:text-sm">
                                  {quantity}
                                </div>
                                <button
                                  type="button"
                                  className="public-order-custom-row__button h-10 rounded-[14px] border border-white/85 bg-white text-[1.15rem] font-semibold text-[color:var(--ink-strong)] transition hover:bg-white sm:text-xl"
                                  onClick={() => adjustCustomBoxFlavor(box.id, code, 1)}
                                  disabled={box.totalUnits >= ORDER_BOX_UNITS}
                                  aria-label={`Aumentar ${meta.label} na Caixa Sabores #${box.index + 1}`}
                                >
                                  +
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        {box.isActive ? (
                          <p className="mt-3 text-[0.82rem] leading-5 text-[color:var(--ink-muted)]">
                            {formatCustomBoxParts(box.flavors)}
                          </p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-[20px] border border-white/80 bg-white/80 p-3">
                    <div className="relative aspect-[16/10] overflow-hidden rounded-[18px] xl:aspect-[21/10]">
                      <Image
                        alt="Caixa Sabores com 7 broas variadas"
                        className="h-full w-full object-cover"
                        fill
                        sizes="(max-width: 768px) 70vw, 420px"
                        src={ORDER_SABORES_REFERENCE_IMAGE}
                      />
                      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_24%,rgba(46,29,20,0.12)_100%)]" />
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-white/78 p-4 sm:rounded-[28px] sm:p-6 xl:p-7">
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

            {error ? (
              <div className="app-inline-notice app-inline-notice--error rounded-[24px] px-5 py-4 shadow-[0_14px_32px_rgba(157,31,44,0.08)]">
                {error}
              </div>
            ) : null}

            {!result ? (
              <div className="app-form-actions app-form-actions--mobile-sticky xl:hidden">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">
                    Total
                  </span>
                  <strong className="text-base text-[color:var(--ink-strong)]">{formatCurrencyBRL(displayTotal)}</strong>
                </div>
                <button
                  className="app-button app-button-primary"
                  disabled={isSubmitting || isQuotingDelivery}
                  onClick={() => {
                    void handlePrimaryAction();
                  }}
                  type="button"
                >
                  {primaryActionLabel}
                </button>
              </div>
            ) : null}

          </form>

          <aside className="grid gap-4 self-start sm:gap-5 xl:sticky xl:top-6">
            <section className="order-1 overflow-hidden rounded-[24px] border border-[rgba(126,79,45,0.1)] bg-[linear-gradient(165deg,rgba(255,252,248,0.96),rgba(243,231,216,0.9))] p-4 shadow-[0_18px_40px_rgba(70,44,26,0.1)] sm:rounded-[30px] sm:p-5 sm:shadow-[0_26px_80px_rgba(70,44,26,0.12)] xl:max-h-[calc(var(--app-vh,1vh)*100-3rem)] xl:overflow-y-auto xl:p-4 2xl:p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[1.35rem] font-semibold text-[color:var(--ink-strong)] sm:text-2xl">Pedido</h2>
                </div>
                <div className="rounded-full bg-white/80 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)] sm:text-xs">
                  {form.fulfillmentMode === 'DELIVERY' ? 'Entrega' : 'Retirada'}
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:mt-5">
                <div className="grid gap-3 rounded-[20px] bg-white/78 p-4 sm:rounded-[24px]">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-[18px] border border-[rgba(126,79,45,0.08)] bg-white/88 px-3 py-3">
                      <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                        Caixas
                      </span>
                      <strong className="mt-1 block text-[1.35rem] text-[color:var(--ink-strong)]">{totalBoxes}</strong>
                    </div>
                    <div className="rounded-[18px] border border-[rgba(126,79,45,0.08)] bg-white/88 px-3 py-3">
                      <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                        Broas
                      </span>
                      <strong className="mt-1 block text-[1.35rem] text-[color:var(--ink-strong)]">{totalBroas}</strong>
                    </div>
                    <div className="rounded-[18px] border border-[rgba(126,79,45,0.08)] bg-white/88 px-3 py-3">
                      <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                        Produtos
                      </span>
                      <strong className="mt-1 block text-base text-[color:var(--ink-strong)]">
                        {formatCurrencyBRL(estimatedTotal)}
                      </strong>
                    </div>
                    <div className="rounded-[18px] border border-[rgba(126,79,45,0.08)] bg-white/88 px-3 py-3">
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

                <div className="rounded-[20px] bg-white/78 p-4 sm:rounded-[24px]">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)] sm:text-xs">
                    Data e hora
                  </p>
                  <p className="mt-2 text-base font-semibold text-[color:var(--ink-strong)] sm:text-lg">
                    {form.date && form.time ? `${form.date} às ${form.time}` : 'Escolha data e hora'}
                  </p>
                  {minimumScheduleLabel ? (
                    <p className="mt-2 text-sm leading-6 text-[color:var(--ink-muted)]">
                      Pedido novo liberado a partir de <strong className="text-[color:var(--ink-strong)]">{minimumScheduleLabel}</strong>.
                    </p>
                  ) : null}
                </div>

                <div className="rounded-[20px] bg-white/78 p-4 sm:rounded-[24px]">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)] sm:text-xs">
                    Caixas escolhidas
                  </p>
                  {selectedBoxes.length ? (
                    <ul className="mt-3 grid max-h-[260px] gap-2 overflow-y-auto pr-1">
                      {selectedBoxes.map((entry) => (
                        <li
                          key={entry.key}
                          className="rounded-2xl border border-[rgba(126,79,45,0.08)] bg-white/86 px-3 py-2 text-sm text-[color:var(--ink-muted)]"
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

                <div className="rounded-[20px] bg-white/78 p-4 sm:rounded-[24px]">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)] sm:text-xs">
                    Composicao
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[color:var(--ink-strong)]">
                    {formatOrderFlavorComposition(computedUnits)}
                  </p>
                </div>

                {!result ? (
                  <div className="grid gap-2 rounded-[20px] border border-[rgba(126,79,45,0.1)] bg-[linear-gradient(160deg,rgba(255,248,241,0.94),rgba(244,231,216,0.88))] p-4 shadow-[0_18px_34px_rgba(70,44,26,0.08)] sm:rounded-[24px]">
                    <button
                      className="app-button app-button-primary w-full"
                      disabled={isSubmitting || isQuotingDelivery}
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
                ) : null}
              </div>
            </section>

            {result ? (
              <section className="order-2 overflow-hidden rounded-[24px] border border-emerald-200 bg-[linear-gradient(165deg,rgba(239,250,244,0.98),rgba(228,244,233,0.92))] p-4 shadow-[0_18px_40px_rgba(43,92,61,0.12)] sm:rounded-[30px] sm:p-6 sm:shadow-[0_26px_80px_rgba(43,92,61,0.12)]">
                <div>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.26em] text-emerald-700">
                    Pedido recebido
                  </p>
                  <h2 className="mt-1.5 text-[1.55rem] font-semibold text-[color:var(--ink-strong)] sm:mt-2 sm:text-3xl">
                    Pedido #{resolveDisplayNumber(result.order) ?? result.order.id}
                  </h2>
                  <p className="mt-2 text-[0.88rem] leading-6 text-[color:var(--ink-muted)] sm:text-sm">
                    Programado para {formatScheduledAt(result.order.scheduledAt)}.
                  </p>
                </div>

                <div className="mt-5 grid gap-3 text-sm text-[color:var(--ink-muted)]">
                  <div className="flex items-center justify-between gap-3 rounded-[24px] bg-white/78 px-4 py-3">
                    <span>Produtos</span>
                    <strong className="text-lg text-[color:var(--ink-strong)]">{formatCurrencyBRL(estimatedTotal)}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-[24px] bg-white/78 px-4 py-3">
                    <span>Frete</span>
                    <strong className="text-lg text-[color:var(--ink-strong)]">
                      {formatCurrencyBRL(result.intake.deliveryFee)}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-[24px] bg-white/78 px-4 py-3">
                    <span>Total</span>
                    <strong className="text-lg text-[color:var(--ink-strong)]">{formatCurrencyBRL(result.order.total)}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-[24px] bg-white/78 px-4 py-3">
                    <span>Status</span>
                    <strong className="text-[color:var(--ink-strong)]">
                      {result.intake.stage === 'PIX_PENDING' ? 'PIX pendente' : result.intake.stage}
                    </strong>
                  </div>
                </div>

                {pixCharge?.copyPasteCode ? (
                  <div className="mt-5 grid gap-4">
                    <div>
                      <p className="text-sm font-semibold text-[color:var(--ink-strong)]">PIX copia e cola</p>
                    </div>
                    <textarea
                      className="app-textarea min-h-[170px] border-emerald-200 bg-white/84 font-mono text-[11px] leading-5 sm:text-xs"
                      readOnly
                      value={pixCharge.copyPasteCode}
                    />
                    <div className="app-form-actions">
                      <button
                        className="app-button app-button-primary"
                        disabled={isCopyingPix}
                        onClick={copyPixCode}
                        type="button"
                      >
                        {isCopyingPix ? 'Copiando...' : 'Copiar codigo PIX'}
                      </button>
                      <button className="app-button app-button-ghost" onClick={startAnotherOrder} type="button">
                        Fazer outro pedido
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-5 rounded-[24px] bg-white/78 px-4 py-3 text-sm text-[color:var(--ink-muted)]">
                    Pedido enviado. O PIX sera confirmado no atendimento.
                  </p>
                )}
              </section>
            ) : null}
          </aside>
        </section>
      </div>
    </div>
  );
}
