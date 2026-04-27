'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  Suspense,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent
} from 'react';
import {
  IconMotorbike,
  IconReceipt2,
  IconShoppingBag
} from '@tabler/icons-react';
import {
  computeSumUpCardPayableTotal,
  EXTERNAL_ORDER_DELIVERY_WINDOWS,
  normalizeOrderStatus,
  parseAppliedCouponFromNotes,
  resolveExternalOrderDeliveryWindowKeyForDate,
  resolveExternalOrderDeliveryWindowLabel,
  resolveExternalOrderProductionDurationMinutes,
  resolveDisplayNumber,
  roundMoney,
  stripOrderNoteMetadata,
  type ExternalOrderDeliveryWindowKey,
  type Customer,
  type OrderIntake,
  type OrderCustomerSnapshot,
  type Product
} from '@querobroapp/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import {
  buildCustomerAddressAutofill,
  buildCustomerAddressSummary,
  lookupPostalCodeAutofill
} from '@/lib/customer-autofill';
import { writeStoredOrderFinalized } from '@/lib/order-finalized-storage';
import { useDialogA11y } from '@/lib/use-dialog-a11y';
import {
  compactWhitespace,
  formatDecimalInputBR,
  formatCurrencyBR,
  formatPhoneBR,
  parseLocaleNumber
} from '@/lib/format';
import { consumeFocusQueryParam, scrollToLayoutSlot } from '@/lib/layout-scroll';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { AppIcon } from '@/components/app-icons';
import { useFeedback } from '@/components/feedback-provider';
import { BuilderLayoutItemSlot, BuilderLayoutProvider } from '@/components/builder-layout';
import { OrdersBoard } from './orders-board';
import { OrderQuickCreate } from './order-quick-create';
import {
  ORDER_BOX_UNITS,
  buildRuntimeOrderCatalog,
  calculateOrderSubtotalFromProductItems,
  compactOrderProductName,
  isRuntimeOrderCompanionTemporarilyOutOfStock,
  resolveRuntimeOrderItemGroup,
  resolveOrderVirtualBoxLabel
} from './order-box-catalog';
import { type DeliveryQuote, type OrderView, type ScheduleDayAvailability } from './orders-model';
import {
  fetchInternalDeliveryQuote,
  fetchOrdersWorkspace,
  fetchScheduleDayAvailability,
  submitOrderIntake,
  updateScheduleDayAvailability
} from './orders-api';

const TEST_DATA_TAG = '[TESTE_E2E]';
const TUTORIAL_QUERY_VALUE = 'primeira_vez';
const MONTH_WIDGET_MAX_DOTS = 8;
const WEEK_TIMELINE_MAX_VISIBLE_EVENTS = 5;
const SELECTED_ORDER_NEW_BOX_KEY = 'box-new';

type OrderVirtualBoxPart = {
  productId: number;
  productName: string;
  units: number;
};
type OrderVirtualEditableBox = {
  key: string;
  label: string;
  officialName: string;
  parts: OrderVirtualBoxPart[];
  targetUnits: number;
  tone: 'CLOSED' | 'OPEN';
};
type CustomerOption = {
  id: number;
  label: string;
};

type CustomerAddressLike = {
  name?: string | null;
  phone?: string | null;
  address?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  placeId?: string | null;
  lat?: number | null;
  lng?: number | null;
  deliveryNotes?: string | null;
  deletedAt?: string | null | Date;
};

type EditableOrderCustomerDraft = {
  name: string;
  phone: string;
  address: string;
  addressLine2: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  placeId: string;
  lat: number | null;
  lng: number | null;
  deliveryNotes: string;
};

type CustomerAddressOption = {
  key: string;
  label: string;
  value: CustomerAddressLike;
  isPrimary: boolean;
};

const EMPTY_EDITABLE_ORDER_CUSTOMER_DRAFT: EditableOrderCustomerDraft = {
  name: '',
  phone: '',
  address: '',
  addressLine2: '',
  neighborhood: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'Brasil',
  placeId: '',
  lat: null,
  lng: null,
  deliveryNotes: ''
};

function hasCustomerAddressData(value?: CustomerAddressLike | null) {
  if (!value) return false;
  return Boolean(
    compactWhitespace(value.address || '') ||
      compactWhitespace(value.addressLine1 || '') ||
      compactWhitespace(value.addressLine2 || '') ||
      compactWhitespace(value.neighborhood || '') ||
      compactWhitespace(value.city || '') ||
      compactWhitespace(value.state || '') ||
      compactWhitespace(value.postalCode || '')
  );
}

function mergeCustomerProfile(
  fallback?: CustomerAddressLike | null,
  override?: CustomerAddressLike | null
): CustomerAddressLike {
  return {
    name: compactWhitespace(override?.name || '') || compactWhitespace(fallback?.name || '') || null,
    phone: compactWhitespace(override?.phone || '') || compactWhitespace(fallback?.phone || '') || null,
    address: compactWhitespace(override?.address || '') || compactWhitespace(fallback?.address || '') || null,
    addressLine1:
      compactWhitespace(override?.addressLine1 || '') || compactWhitespace(fallback?.addressLine1 || '') || null,
    addressLine2:
      compactWhitespace(override?.addressLine2 || '') || compactWhitespace(fallback?.addressLine2 || '') || null,
    neighborhood:
      compactWhitespace(override?.neighborhood || '') || compactWhitespace(fallback?.neighborhood || '') || null,
    city: compactWhitespace(override?.city || '') || compactWhitespace(fallback?.city || '') || null,
    state: compactWhitespace(override?.state || '') || compactWhitespace(fallback?.state || '') || null,
    postalCode:
      compactWhitespace(override?.postalCode || '') || compactWhitespace(fallback?.postalCode || '') || null,
    country: compactWhitespace(override?.country || '') || compactWhitespace(fallback?.country || '') || null,
    placeId: compactWhitespace(override?.placeId || '') || compactWhitespace(fallback?.placeId || '') || null,
    lat: typeof override?.lat === 'number' ? override.lat : typeof fallback?.lat === 'number' ? fallback.lat : null,
    lng: typeof override?.lng === 'number' ? override.lng : typeof fallback?.lng === 'number' ? fallback.lng : null,
    deliveryNotes:
      compactWhitespace(override?.deliveryNotes || '') ||
      compactWhitespace(fallback?.deliveryNotes || '') ||
      null,
    deletedAt: fallback?.deletedAt ?? null
  };
}

function formatCustomerFullAddress(customer?: CustomerAddressLike | null) {
  if (!customer) return '';
  const normalizedAddress = stripPostalCodeFromAddressLabel(customer.address);
  const inferred = buildCustomerAddressAutofill(normalizedAddress);
  const addressLine1 = compactWhitespace(customer.addressLine1 || inferred.addressLine1 || '');
  const neighborhoodSource = compactWhitespace(customer.neighborhood || inferred.neighborhood || '');
  const neighborhood = /\d/.test(neighborhoodSource) ? '' : neighborhoodSource;
  const addressLine2 = compactWhitespace(customer.addressLine2 || '');
  const parts = [addressLine1, neighborhood, addressLine2].filter(Boolean);
  if (parts.length > 0) return parts.join(', ');

  const fallbackParts = normalizedAddress
    .split(',')
    .map((part) => compactWhitespace(part))
    .filter(Boolean)
    .slice(0, 2);
  return fallbackParts.join(', ');
}

function buildEditableOrderCustomerDraft(source?: CustomerAddressLike | null): EditableOrderCustomerDraft {
  const inferred = buildCustomerAddressAutofill(source?.address || '');
  const structuredAddress =
    buildCustomerAddressSummary({
      addressLine1: source?.addressLine1 || inferred.addressLine1 || '',
      addressLine2: source?.addressLine2 || '',
      neighborhood: source?.neighborhood || inferred.neighborhood || '',
      city: source?.city || inferred.city || '',
      state: source?.state || inferred.state || '',
      postalCode: source?.postalCode || inferred.postalCode || ''
    }) || '';

  return {
    name: source?.name || '',
    phone: source?.phone || '',
    address: source?.address || structuredAddress,
    addressLine2: source?.addressLine2 || '',
    neighborhood: source?.neighborhood || inferred.neighborhood || '',
    city: source?.city || inferred.city || '',
    state: source?.state || inferred.state || '',
    postalCode: source?.postalCode || inferred.postalCode || '',
    country: source?.country || 'Brasil',
    placeId: source?.placeId || '',
    lat: typeof source?.lat === 'number' ? source.lat : null,
    lng: typeof source?.lng === 'number' ? source.lng : null,
    deliveryNotes: source?.deliveryNotes || ''
  };
}

function draftToOrderCustomerSnapshot(draft: EditableOrderCustomerDraft): OrderCustomerSnapshot {
  const name = compactWhitespace(draft.name);
  const address = compactWhitespace(draft.address);
  const state = compactWhitespace(draft.state).toUpperCase();
  const country = compactWhitespace(draft.country);
  return {
    name,
    phone: compactWhitespace(draft.phone) || null,
    address: address || null,
    addressLine1: buildCustomerAddressAutofill(address).addressLine1 || null,
    addressLine2: compactWhitespace(draft.addressLine2) || null,
    neighborhood: compactWhitespace(draft.neighborhood) || null,
    city: compactWhitespace(draft.city) || null,
    state: state || null,
    postalCode: compactWhitespace(draft.postalCode) || null,
    country: country || null,
    placeId: compactWhitespace(draft.placeId) || null,
    lat: typeof draft.lat === 'number' ? draft.lat : null,
    lng: typeof draft.lng === 'number' ? draft.lng : null,
    deliveryNotes: compactWhitespace(draft.deliveryNotes) || null
  };
}

const EMPTY_ORDER_CUSTOMER_SNAPSHOT = draftToOrderCustomerSnapshot(buildEditableOrderCustomerDraft());
const EMPTY_CUSTOMER_OPTIONS: CustomerOption[] = [];

function buildCustomerAddressOptions(customer?: Customer | null): CustomerAddressOption[] {
  if (!customer) return [];

  const options: CustomerAddressOption[] = [];
  const seen = new Set<string>();
  const pushOption = (key: string, value: CustomerAddressLike, isPrimary: boolean, prefix: string) => {
    if (!hasCustomerAddressData(value)) return;
    const identity = [
      compactWhitespace(value.placeId || '').toLowerCase(),
      compactWhitespace(value.address || value.addressLine1 || '').toLowerCase(),
      compactWhitespace(value.addressLine2 || '').toLowerCase(),
      compactWhitespace(value.neighborhood || '').toLowerCase(),
      compactWhitespace(value.city || '').toLowerCase(),
      compactWhitespace(value.state || '').toLowerCase(),
      compactWhitespace(value.postalCode || '').toLowerCase()
    ].join('|');
    if (seen.has(identity)) return;
    seen.add(identity);
    options.push({
      key,
      label: `${prefix} • ${formatCustomerFullAddress(value) || 'Endereço sem resumo'}`,
      value,
      isPrimary
    });
  };

  pushOption(
    'primary',
    {
      address: customer.address,
      addressLine1: customer.addressLine1,
      addressLine2: customer.addressLine2,
      neighborhood: customer.neighborhood,
      city: customer.city,
      state: customer.state,
      postalCode: customer.postalCode,
      country: customer.country,
      placeId: customer.placeId,
      lat: customer.lat,
      lng: customer.lng,
      deliveryNotes: customer.deliveryNotes
    },
    true,
    'Principal'
  );

  for (const address of customer.addresses || []) {
    pushOption(
      `saved-${address.id ?? options.length + 1}`,
      address,
      Boolean(address.isPrimary),
      address.isPrimary ? 'Principal' : 'Salvo'
    );
  }

  return options;
}

function unitsToCloseOrderBox(quantity: number) {
  const normalized = Math.max(Math.floor(quantity), 0);
  if (normalized <= 0) return ORDER_BOX_UNITS;
  const remainder = normalized % ORDER_BOX_UNITS;
  return remainder === 0 ? 0 : ORDER_BOX_UNITS - remainder;
}

function formatOrderUnitsLabel(quantity: number) {
  const normalized = Math.max(Math.floor(quantity), 0);
  if (normalized <= 0) return '0 un';

  const fullBoxes = Math.floor(normalized / ORDER_BOX_UNITS);
  const remainder = normalized % ORDER_BOX_UNITS;

  if (fullBoxes <= 0) return `${normalized} un`;
  if (remainder === 0) return `${normalized} un • ${fullBoxes} cx`;
  return `${normalized} un • ${fullBoxes} cx + ${remainder} un`;
}

function calculateOrderSubtotalFromItems(
  items: Array<{ productId: number; quantity: number }>,
  productMap: Map<number, Product>
) {
  return calculateOrderSubtotalFromProductItems(items, productMap);
}

function buildOrderVirtualBoxPartitions(
  items: Array<{ productId: number; quantity: number }>,
  productMap: Map<number, Product>
) {
  const boxes: OrderVirtualBoxPart[][] = [];
  let currentBox: OrderVirtualBoxPart[] = [];
  let currentBoxUnits = 0;

  const appendPart = (parts: OrderVirtualBoxPart[], nextPart: OrderVirtualBoxPart) => {
    const last = parts[parts.length - 1];
    if (last && last.productId === nextPart.productId) {
      last.units += nextPart.units;
      return;
    }
    parts.push(nextPart);
  };

  for (const item of items) {
    let remainingUnits = Math.max(Math.floor(item.quantity || 0), 0);
    if (remainingUnits <= 0) continue;

    const productName = compactOrderProductName(
      productMap.get(item.productId)?.name ?? `Produto ${item.productId}`
    );

    while (remainingUnits > 0) {
      const unitsToTake = Math.min(remainingUnits, ORDER_BOX_UNITS - currentBoxUnits);
      appendPart(currentBox, {
        productId: item.productId,
        productName,
        units: unitsToTake
      });
      currentBoxUnits += unitsToTake;
      remainingUnits -= unitsToTake;

      if (currentBoxUnits === ORDER_BOX_UNITS) {
        boxes.push(currentBox);
        currentBox = [];
        currentBoxUnits = 0;
      }
    }
  }

  return {
    boxes,
    openBox: currentBox,
    openBoxUnits: currentBoxUnits
  };
}

function formatOrderVirtualBoxParts(parts: OrderVirtualBoxPart[]) {
  return parts.map((part) => `${part.units} ${part.productName}`).join(' + ');
}

function resolveOrderVirtualBoxOfficialName(parts: OrderVirtualBoxPart[]) {
  return resolveOrderVirtualBoxLabel(parts);
}

function mapOrderVirtualBoxPartsToItems(boxes: OrderVirtualBoxPart[][]) {
  const quantityByProductId = new Map<number, number>();
  for (const box of boxes) {
    for (const part of box) {
      const units = Math.max(Math.floor(part.units || 0), 0);
      if (units <= 0) continue;
      const current = quantityByProductId.get(part.productId) || 0;
      quantityByProductId.set(part.productId, current + units);
    }
  }
  return Array.from(quantityByProductId.entries())
    .map(([productId, quantity]) => ({
      productId,
      quantity
    }))
    .filter((item) => item.quantity > 0);
}

function formatDateTimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function formatDateOnlyInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDateTimeLocalToAllowedQuarter(value: string) {
  const parsed = parseDateTimeLocalInput(value);
  if (!parsed) return value;
  const normalized = new Date(parsed);
  const minutes = normalized.getMinutes();
  if (minutes === 0 || minutes === 15 || minutes === 30) {
    normalized.setSeconds(0, 0);
    return formatDateTimeLocalValue(normalized);
  }
  if (minutes < 8) {
    normalized.setMinutes(0, 0, 0);
  } else if (minutes < 23) {
    normalized.setMinutes(15, 0, 0);
  } else if (minutes < 38) {
    normalized.setMinutes(30, 0, 0);
  } else {
    normalized.setHours(normalized.getHours() + 1, 0, 0, 0);
  }
  return formatDateTimeLocalValue(normalized);
}

function splitDateTimeLocalPickerParts(value: string) {
  const parsed = parseDateTimeLocalInput(normalizeDateTimeLocalToAllowedQuarter(value));
  const fallback = new Date();
  const source = parsed || fallback;
  return {
    date: formatDateOnlyInputValue(source),
    hour: `${source.getHours()}`.padStart(2, '0'),
    minute: source.getMinutes() >= 30 ? '30' : source.getMinutes() >= 15 ? '15' : '00'
  };
}

function mergeDateTimeLocalPickerParts(parts: { date: string; hour: string; minute: string }) {
  if (!parts.date) return '';
  return `${parts.date}T${parts.hour}:${parts.minute}`;
}

function applyDateTimeLocalPickerWindow(value: string, windowKey: ExternalOrderDeliveryWindowKey) {
  const parts = splitDateTimeLocalPickerParts(value || defaultOrderDateTimeInput());
  const targetWindow = EXTERNAL_ORDER_DELIVERY_WINDOWS.find((window) => window.key === windowKey);
  if (!targetWindow) {
    return normalizeDateTimeLocalToAllowedQuarter(mergeDateTimeLocalPickerParts(parts));
  }

  return normalizeDateTimeLocalToAllowedQuarter(
    mergeDateTimeLocalPickerParts({
      date: parts.date,
      hour: `${targetWindow.startHour}`.padStart(2, '0'),
      minute: `${targetWindow.startMinute}`.padStart(2, '0')
    })
  );
}

function parseDateTimeLocalInput(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hours, minutes] = match;
  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    0,
    0
  );
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function defaultOrderDateTimeInput() {
  return normalizeDateTimeLocalToAllowedQuarter(formatDateTimeLocalValue(new Date()));
}

function resolveOrderDate(order?: Pick<OrderView, 'scheduledAt' | 'createdAt'> | null) {
  if (!order) return null;
  return safeDateFromIso(order.scheduledAt ?? order.createdAt ?? null);
}

function formatOrderDateTimeLabel(date?: Date | null) {
  if (!date) return '';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatPublicScheduleWindowLabel(date?: Date | null) {
  const windowKey = resolveExternalOrderDeliveryWindowKeyForDate(date ?? null);
  return resolveExternalOrderDeliveryWindowLabel(windowKey);
}

function formatDeletionTimestampLabel(date?: string | null) {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function compactCustomerLabelForCalendar(value?: string | null) {
  const normalized = (value || '').replace(/\s+\(excluído\)$/i, '').trim();
  if (!normalized) return 'Cliente';
  const [firstName] = normalized.split(/\s+/);
  const compact = (firstName || normalized).trim();
  if (compact.length <= 14) return compact;
  return `${compact.slice(0, 14)}…`;
}

function toMoney(value: number) {
  return roundMoney(value);
}

function formatOrderNoteLabel(value?: string | null) {
  const normalized = compactWhitespace(stripOrderNoteMetadata(value) || '');
  return normalized ? `Obs: ${normalized}` : '';
}

function deriveDiscountPctFromOrder(order?: Pick<OrderView, 'subtotal' | 'discount'> | null) {
  const subtotal = Math.max(Number(order?.subtotal || 0), 0);
  const discount = Math.max(Number(order?.discount || 0), 0);
  if (subtotal <= 0 || discount <= 0) return 0;
  return roundMoney((discount / subtotal) * 100);
}

function normalizeDiscountPctInput(value: string | number | null | undefined) {
  const parsed = parseLocaleNumber(value);
  const clamped = parsed == null ? 0 : Math.min(Math.max(roundMoney(parsed), 0), 100);
  return (
    formatDecimalInputBR(clamped, {
      minFractionDigits: 0,
      maxFractionDigits: 2
    }) || '0'
  );
}

function containsTestDataTag(value?: string | null) {
  return (value || '').toLowerCase().includes(TEST_DATA_TAG.toLowerCase());
}

function withTestDataTag(value?: string | null, fallback = '') {
  const normalized = (value || '').trim();
  const baseValue = normalized || fallback;
  if (!baseValue) return TEST_DATA_TAG;
  if (containsTestDataTag(baseValue)) return baseValue;
  return `${baseValue} ${TEST_DATA_TAG}`.trim();
}

type OrderToneName = 'cream' | 'gold' | 'sage' | 'olive' | 'blush' | 'roast' | 'pix' | 'danger';

const ORDER_TONE_META: Record<
  OrderToneName,
  {
    badgeClassName: string;
    dotClassName: string;
    lineClassName: string;
    ringClassName: string;
    surfaceStyle: CSSProperties;
  }
> = {
  cream: {
    badgeClassName:
      'border-[color:var(--tone-cream-line)] bg-[color:var(--tone-cream-surface)] text-[color:var(--tone-cream-ink)]',
    dotClassName: 'bg-[color:var(--tone-cream-ink)]',
    lineClassName: 'bg-[color:var(--tone-cream-line)]',
    ringClassName: 'ring-[color:var(--tone-cream-line)]',
    surfaceStyle: {
      borderColor: 'var(--tone-cream-line)',
      backgroundColor: 'var(--tone-cream-surface)'
    }
  },
  gold: {
    badgeClassName:
      'border-[color:var(--tone-gold-line)] bg-[color:var(--tone-gold-surface)] text-[color:var(--tone-gold-ink)]',
    dotClassName: 'bg-[color:var(--tone-gold-ink)]',
    lineClassName: 'bg-[color:var(--tone-gold-line)]',
    ringClassName: 'ring-[color:var(--tone-gold-line)]',
    surfaceStyle: {
      borderColor: 'var(--tone-gold-line)',
      backgroundColor: 'var(--tone-gold-surface)'
    }
  },
  sage: {
    badgeClassName:
      'border-[color:var(--tone-sage-line)] bg-[color:var(--tone-sage-surface)] text-[color:var(--tone-sage-ink)]',
    dotClassName: 'bg-[color:var(--tone-sage-ink)]',
    lineClassName: 'bg-[color:var(--tone-sage-line)]',
    ringClassName: 'ring-[color:var(--tone-sage-line)]',
    surfaceStyle: {
      borderColor: 'var(--tone-sage-line)',
      backgroundColor: 'var(--tone-sage-surface)'
    }
  },
  olive: {
    badgeClassName:
      'border-[color:var(--tone-olive-line)] bg-[color:var(--tone-olive-surface)] text-[color:var(--tone-olive-ink)]',
    dotClassName: 'bg-[color:var(--tone-olive-ink)]',
    lineClassName: 'bg-[color:var(--tone-olive-line)]',
    ringClassName: 'ring-[color:var(--tone-olive-line)]',
    surfaceStyle: {
      borderColor: 'var(--tone-olive-line)',
      backgroundColor: 'var(--tone-olive-surface)'
    }
  },
  blush: {
    badgeClassName:
      'border-[color:var(--tone-blush-line)] bg-[color:var(--tone-blush-surface)] text-[color:var(--tone-blush-ink)]',
    dotClassName: 'bg-[color:var(--tone-blush-ink)]',
    lineClassName: 'bg-[color:var(--tone-blush-line)]',
    ringClassName: 'ring-[color:var(--tone-blush-line)]',
    surfaceStyle: {
      borderColor: 'var(--tone-blush-line)',
      backgroundColor: 'var(--tone-blush-surface)'
    }
  },
  roast: {
    badgeClassName:
      'border-[color:var(--tone-roast-line)] bg-[color:var(--tone-roast-surface)] text-[color:var(--tone-roast-ink)]',
    dotClassName: 'bg-[color:var(--tone-roast-ink)]',
    lineClassName: 'bg-[color:var(--tone-roast-line)]',
    ringClassName: 'ring-[color:var(--tone-roast-line)]',
    surfaceStyle: {
      borderColor: 'var(--tone-roast-line)',
      backgroundColor: 'var(--tone-roast-surface)'
    }
  },
  pix: {
    badgeClassName:
      'border-[color:var(--tone-pix-line)] bg-[color:var(--tone-pix-surface)] text-[color:var(--tone-pix-ink)]',
    dotClassName: 'bg-[color:var(--tone-pix-ink)]',
    lineClassName: 'bg-[color:var(--tone-pix-line)]',
    ringClassName: 'ring-[color:var(--tone-pix-line)]',
    surfaceStyle: {
      borderColor: 'var(--tone-pix-line)',
      backgroundColor: 'var(--tone-pix-surface)'
    }
  },
  danger: {
    badgeClassName:
      'border-[color:var(--tone-danger-line)] bg-[color:var(--tone-danger-surface)] text-[color:var(--tone-danger-ink)]',
    dotClassName: 'bg-[color:var(--tone-danger-ink)]',
    lineClassName: 'bg-[color:var(--tone-danger-line)]',
    ringClassName: 'ring-[color:var(--tone-danger-line)]',
    surfaceStyle: {
      borderColor: 'var(--tone-danger-line)',
      backgroundColor: 'var(--tone-danger-surface)'
    }
  }
};

function orderStatusTone(status?: string | null): OrderToneName {
  const normalizedStatus = normalizeOrderStatus(status) || status;
  if (normalizedStatus === 'ENTREGUE') return 'sage';
  if (normalizedStatus === 'CANCELADO') return 'danger';
  if (normalizedStatus === 'PRONTO') return 'olive';
  return 'cream';
}

function orderPaymentTone(status?: string | null): OrderToneName {
  if (status === 'PAGO') return 'pix';
  if (status === 'PARCIAL') return 'gold';
  return 'cream';
}

function calendarStatusTone(status?: string | null): OrderToneName {
  const normalizedStatus = normalizeOrderStatus(status);
  if (status === 'PRONTA' || normalizedStatus === 'PRONTO') return 'olive';
  if (status === 'INGREDIENTES') return 'blush';
  if (normalizedStatus === 'ENTREGUE') return 'sage';
  if (normalizedStatus === 'CANCELADO') return 'danger';
  return 'cream';
}

function orderStatusBadgeClass(status: string) {
  return ORDER_TONE_META[orderStatusTone(status)].badgeClassName;
}

function orderPaymentBadgeClass(status?: string | null) {
  return ORDER_TONE_META[orderPaymentTone(status)].badgeClassName;
}

function formatDisplayedOrderStatus(status?: string | null) {
  if (!status) return '';
  return normalizeOrderStatus(status) || status;
}

function formatDisplayedPaymentStatus(status?: string | null) {
  if (!status) return 'PENDENTE';
  if (status === 'PARCIAL') return 'PARCIAL';
  if (status === 'PAGO') return 'PAGO';
  return 'PENDENTE';
}

function formatWorkflowPaymentToggleLabel(_status?: string | null) {
  return 'PAGO';
}

function displayOrderNumber(order?: { id?: number | null; publicNumber?: number | null } | null) {
  return resolveDisplayNumber(order) ?? order?.id ?? '-';
}

function stripPostalCodeFromAddressLabel(value?: string | null) {
  return compactWhitespace(value || '')
    .replace(/\bCEP[:\s-]*\d{5}-?\d{3}\b/gi, '')
    .replace(/\b\d{5}-?\d{3}\b/g, '')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/\s+-\s+,/g, ', ')
    .replace(/(?:\s*,\s*)+$/g, '')
    .replace(/(?:\s+-\s*)+$/g, '')
    .trim();
}

function normalizeOrderProductionDescriptor(value?: string | null) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function resolveCalendarOrderTotalBroas(order: OrderView, productMap: Map<number, Product>) {
  return (order.items || []).reduce((sum, item) => {
    const quantity = Math.max(Math.floor(item.quantity || 0), 0);
    if (quantity <= 0) return sum;

    const product = productMap.get(item.productId);
    const group = resolveRuntimeOrderItemGroup(product);
    if (group === 'COMPANION' || group === 'OTHER') return sum;
    const productName = normalizeOrderProductionDescriptor(product?.name);
    const productUnit = normalizeOrderProductionDescriptor(product?.unit);
    const looksLikeOfficialBroa =
      productName.includes('tradicional') ||
      productName.includes('goiabada') ||
      productName.includes('doce') ||
      productName.includes('romeu') ||
      productName.includes('julieta') ||
      productName.includes('queijo') ||
      productName.includes('requeij');
    const looksLikeBox =
      productUnit === 'cx' ||
      productUnit === 'caixa' ||
      productUnit === 'caixas' ||
      productName.includes('caixa');

    return sum + quantity * (looksLikeOfficialBroa ? 1 : looksLikeBox ? ORDER_BOX_UNITS : 1);
  }, 0);
}

function normalizeTextForSort(value?: string | null) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function quickCreateProductRank(product: Product) {
  const itemGroup = resolveRuntimeOrderItemGroup(product);
  if (itemGroup === 'COMPANION') return 10;
  if (itemGroup === 'OTHER') return 20;
  const normalizedName = normalizeTextForSort(product.name);
  if (normalizedName.includes('tradicional')) return 0;
  if (normalizedName.includes('goiabada')) return 1;
  return 2;
}

function sortQuickCreateProducts(products: Product[]) {
  return [...products].sort((left, right) => {
    const leftRank = quickCreateProductRank(left);
    const rightRank = quickCreateProductRank(right);
    if (leftRank !== rightRank) return leftRank - rightRank;
    return (left.name || '').localeCompare(right.name || '', 'pt-BR');
  });
}

type OrderWorkflowIllustrationName =
  | 'phone-check'
  | 'bag-check'
  | 'scooter'
  | 'pix';

function OrderWorkflowIllustration({
  name,
  className
}: {
  name: OrderWorkflowIllustrationName;
  className?: string;
}) {
  const iconClassName = className || 'h-8 w-8';
  const iconProps = {
    className: `${iconClassName} text-[#181411]`,
    stroke: 1.55
  };

  if (name === 'phone-check') {
    return <IconReceipt2 aria-hidden="true" {...iconProps} />;
  }

  if (name === 'bag-check') {
    return <IconShoppingBag aria-hidden="true" {...iconProps} />;
  }

  if (name === 'scooter') {
    return <IconMotorbike aria-hidden="true" {...iconProps} />;
  }

  if (name === 'pix') {
    return (
      <span className={`inline-flex items-center justify-center ${iconClassName}`}>
        <Image
          aria-hidden="true"
          alt=""
          src="/brand/pix-logo.svg"
          width={32}
          height={32}
          className="h-full w-full object-contain"
        />
      </span>
    );
  }

  return <IconMotorbike aria-hidden="true" {...iconProps} />;
}

type OrderWorkflowStatus = 'ABERTO' | 'PRONTO' | 'ENTREGUE';
type OrderWorkflowStage = OrderWorkflowStatus | 'PAGO';

const ORDER_WORKFLOW_STATUSES: OrderWorkflowStatus[] = ['ABERTO', 'PRONTO', 'ENTREGUE'];
const ORDER_WORKFLOW_STAGES: OrderWorkflowStage[] = [...ORDER_WORKFLOW_STATUSES, 'PAGO'];

const orderWorkflowStatusMeta: Record<
  OrderWorkflowStage,
  {
    label: string;
    illustration: OrderWorkflowIllustrationName;
    activeClassName: string;
    passedDotClassName: string;
    activeLineClassName: string;
  }
> = {
  ABERTO: {
    label: 'Pedido',
    illustration: 'phone-check',
    activeClassName: ORDER_TONE_META.cream.badgeClassName,
    passedDotClassName: ORDER_TONE_META.cream.dotClassName,
    activeLineClassName: ORDER_TONE_META.cream.lineClassName
  },
  PRONTO: {
    label: 'Pronto',
    illustration: 'bag-check',
    activeClassName: ORDER_TONE_META.olive.badgeClassName,
    passedDotClassName: ORDER_TONE_META.olive.dotClassName,
    activeLineClassName: ORDER_TONE_META.olive.lineClassName
  },
  ENTREGUE: {
    label: 'Entregue',
    illustration: 'scooter',
    activeClassName: ORDER_TONE_META.sage.badgeClassName,
    passedDotClassName: ORDER_TONE_META.sage.dotClassName,
    activeLineClassName: ORDER_TONE_META.sage.lineClassName
  },
  PAGO: {
    label: 'Pago',
    illustration: 'pix',
    activeClassName: ORDER_TONE_META.pix.badgeClassName,
    passedDotClassName: ORDER_TONE_META.pix.dotClassName,
    activeLineClassName: ORDER_TONE_META.pix.lineClassName
  }
};

function toOrderWorkflowStatus(status?: string | null): OrderWorkflowStatus | null {
  const normalizedStatus = normalizeOrderStatus(status);
  return normalizedStatus && ORDER_WORKFLOW_STATUSES.includes(normalizedStatus as OrderWorkflowStatus)
    ? (normalizedStatus as OrderWorkflowStatus)
    : null;
}

type CalendarViewMode = 'DAY' | 'WEEK' | 'MONTH';

const calendarViewLabels: Record<CalendarViewMode, string> = {
  DAY: 'Dia',
  WEEK: 'Semana',
  MONTH: 'Mes'
};

type CalendarOrderEntry = {
  order: OrderView;
  createdAt: Date;
  productionStartAt: Date;
  durationMinutes: number;
  totalBroas: number;
  dateKey: string;
};

type TimelineLayoutInput<TEntry> = {
  entry: TEntry;
  startMinutes: number;
  endMinutes: number;
  top: number;
  height: number;
};

type TimelineLayoutItem<TEntry> = TimelineLayoutInput<TEntry> & {
  lane: number;
  laneCount: number;
};

function buildTimelineLaneLayout<TEntry>(items: TimelineLayoutInput<TEntry>[]) {
  if (items.length === 0) return [] as TimelineLayoutItem<TEntry>[];

  const laneEndMinutes: number[] = [];
  const positioned = items.map<TimelineLayoutItem<TEntry>>((item) => {
    let lane = laneEndMinutes.findIndex((value) => item.startMinutes >= value);
    if (lane === -1) {
      lane = laneEndMinutes.length;
      laneEndMinutes.push(item.endMinutes);
    } else {
      laneEndMinutes[lane] = item.endMinutes;
    }

    return {
      ...item,
      lane,
      laneCount: 1
    };
  });

  let clusterStartIndex = 0;
  let clusterEndMinutes = positioned[0]?.endMinutes ?? 0;

  for (let index = 0; index < positioned.length; index += 1) {
    clusterEndMinutes =
      index === clusterStartIndex
        ? positioned[index].endMinutes
        : Math.max(clusterEndMinutes, positioned[index].endMinutes);

    const nextStartMinutes = positioned[index + 1]?.startMinutes ?? Number.POSITIVE_INFINITY;
    if (nextStartMinutes < clusterEndMinutes) continue;

    const laneCount = Math.max(
      positioned
        .slice(clusterStartIndex, index + 1)
        .reduce((max, item) => Math.max(max, item.lane + 1), 0),
      1
    );

    for (let clusterIndex = clusterStartIndex; clusterIndex <= index; clusterIndex += 1) {
      positioned[clusterIndex] = {
        ...positioned[clusterIndex],
        laneCount
      };
    }

    clusterStartIndex = index + 1;
    clusterEndMinutes = positioned[clusterStartIndex]?.endMinutes ?? 0;
  }

  return positioned;
}

function isMatchingOrderEntry(entry: CalendarOrderEntry, orderId?: number | null) {
  return typeof orderId === 'number' && entry.order.id === orderId;
}

function buildWeekTimelineMetrics(
  entries: CalendarOrderEntry[],
  options: {
    weekGridHeight: number;
    dayGridDurationMinutes: number;
    dayGridEndMinutes: number;
    dayGridSnapMinutes: number;
    dayGridStartMinutes: number;
    weekGridMinEventHeight: number;
    forcedOrderId?: number | null;
  }
) {
  const {
    weekGridHeight,
    dayGridDurationMinutes,
    dayGridEndMinutes,
    dayGridSnapMinutes,
    dayGridStartMinutes,
    weekGridMinEventHeight,
    forcedOrderId
  } = options;
  const pixelsPerMinute = weekGridHeight / dayGridDurationMinutes;

  const entriesInsideGrid = entries
    .filter((entry) => {
      const startMinutes = minutesIntoDay(entry.productionStartAt);
      const endMinutes = startMinutes + entry.durationMinutes;
      return endMinutes > dayGridStartMinutes && startMinutes < dayGridEndMinutes;
    })
    .sort((left, right) => left.productionStartAt.getTime() - right.productionStartAt.getTime());

  let timelineSourceEntries = entriesInsideGrid.slice(0, WEEK_TIMELINE_MAX_VISIBLE_EVENTS);
  if (typeof forcedOrderId === 'number' && forcedOrderId > 0) {
    const alreadyVisible = timelineSourceEntries.some((entry) => isMatchingOrderEntry(entry, forcedOrderId));
    if (!alreadyVisible) {
      const forcedEntry = entriesInsideGrid.find((entry) => isMatchingOrderEntry(entry, forcedOrderId));
      if (forcedEntry) {
        timelineSourceEntries = [
          ...timelineSourceEntries.filter((entry) => !isMatchingOrderEntry(entry, forcedOrderId)).slice(0, Math.max(WEEK_TIMELINE_MAX_VISIBLE_EVENTS - 1, 0)),
          forcedEntry
        ].sort((left, right) => left.productionStartAt.getTime() - right.productionStartAt.getTime());
      }
    }
  }

  const timelineEvents = buildTimelineLaneLayout(
    timelineSourceEntries.map((entry) => {
      const rawStartMinutes = minutesIntoDay(entry.productionStartAt);
      const rawEndMinutes = rawStartMinutes + entry.durationMinutes;
      const startMinutes = clampNumber(rawStartMinutes, dayGridStartMinutes, dayGridEndMinutes - dayGridSnapMinutes);
      const endMinutes = clampNumber(
        rawEndMinutes,
        startMinutes + dayGridSnapMinutes,
        dayGridEndMinutes
      );
      const durationMinutes = Math.max(endMinutes - startMinutes, dayGridSnapMinutes);

      return {
        entry,
        startMinutes,
        endMinutes,
        top: Math.round((startMinutes - dayGridStartMinutes) * pixelsPerMinute),
        height: Math.max(Math.round(durationMinutes * pixelsPerMinute), weekGridMinEventHeight)
      };
    })
  );

  return {
    overflowCount: Math.max(entries.length - timelineSourceEntries.length, 0),
    timelineLaneCount: Math.max(
      timelineEvents.reduce((max, item) => Math.max(max, item.laneCount), 0),
      1
    ),
    timelineEvents
  };
}

function safeDateFromIso(iso?: string | null) {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDeliveryEstimateCaption(order?: OrderView | null) {
  if (!order || order.fulfillmentMode !== 'DELIVERY') return '';

  const quoteStatus = order.deliveryQuoteStatus ?? 'NOT_REQUIRED';
  const deliveryFee = toMoney(order.deliveryFee ?? 0);
  const quoteExpiry = formatOrderDateTimeLabel(safeDateFromIso(order.deliveryQuoteExpiresAt ?? null));

  if (quoteStatus === 'FAILED') {
    return 'Cotação do frete indisponível. Revise os dados do cliente e atualize o frete.';
  }

  if (quoteStatus === 'EXPIRED') {
    return quoteExpiry
      ? `Estimativa expirada em ${quoteExpiry}. Atualize o frete.`
      : 'Estimativa expirada. Atualize o frete.';
  }

  if (quoteStatus === 'FALLBACK' || order.deliveryFeeSource === 'MANUAL_FALLBACK' || order.deliveryProvider === 'LOCAL') {
    return 'Frete calculado para este pedido.';
  }

  if (deliveryFee <= 0) {
    return 'Frete ainda não cotado.';
  }

  return quoteExpiry ? `Frete calculado ate ${quoteExpiry}.` : 'Frete calculado para este pedido.';
}

function startOfLocalDay(date: Date) {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function dateKeyFromDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromDateKey(key: string) {
  const [yearRaw, monthRaw, dayRaw] = key.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return startOfLocalDay(new Date());
  }
  return new Date(year, month - 1, day);
}

function addDaysLocal(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return startOfLocalDay(next);
}

function addMonthsLocal(date: Date, amount: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount, 1);
  return startOfLocalDay(next);
}

function startOfWeekMonday(date: Date) {
  const normalized = startOfLocalDay(date);
  const weekday = normalized.getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return addDaysLocal(normalized, mondayOffset);
}

function shiftDateByCalendarView(date: Date, view: CalendarViewMode, direction: number) {
  if (view === 'MONTH') return addMonthsLocal(date, direction);
  if (view === 'WEEK') return addDaysLocal(date, direction * 7);
  return addDaysLocal(date, direction);
}

function monthGridDates(reference: Date) {
  const firstDay = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const gridStart = startOfWeekMonday(firstDay);
  return Array.from({ length: 42 }, (_, index) => addDaysLocal(gridStart, index));
}

function weekGridDates(reference: Date) {
  const weekStart = startOfWeekMonday(reference);
  return Array.from({ length: 7 }, (_, index) => addDaysLocal(weekStart, index));
}

function formatCalendarRangeLabel(reference: Date, view: CalendarViewMode) {
  if (view === 'MONTH') {
    return reference.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }
  if (view === 'WEEK') {
    const weekStart = startOfWeekMonday(reference);
    const weekEnd = addDaysLocal(weekStart, 6);
    return `${weekStart.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short'
    })} - ${weekEnd.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}`;
  }
  return reference.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

function formatCalendarWeekdayLabel(date: Date) {
  return date
    .toLocaleDateString('pt-BR', { weekday: 'short' })
    .replace('.', '')
    .trim();
}

function calendarStatusDotClass(status: string) {
  return ORDER_TONE_META[calendarStatusTone(status)].dotClassName;
}

function calendarStatusEventSurfaceStyle(status: string): CSSProperties {
  return ORDER_TONE_META[calendarStatusTone(status)].surfaceStyle;
}

function calendarStatusRingClass(status: string) {
  return ORDER_TONE_META[calendarStatusTone(status)].ringClassName;
}

function minutesIntoDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function dateWithMinutes(date: Date, minutes: number) {
  const normalized = startOfLocalDay(date);
  normalized.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return normalized;
}

function resolveCalendarEntryTimeRange(entry: CalendarOrderEntry, readyMinutes?: number | null) {
  const readyAt =
    typeof readyMinutes === 'number' ? dateWithMinutes(entry.createdAt, readyMinutes) : entry.createdAt;
  return {
    startAt: new Date(readyAt.getTime() - entry.durationMinutes * 60_000),
    endAt: readyAt
  };
}

function formatCalendarEntryTimeRangeLabel(entry: CalendarOrderEntry, readyMinutes?: number | null) {
  const range = resolveCalendarEntryTimeRange(entry, readyMinutes);
  const formatOptions = {
    hour: '2-digit',
    minute: '2-digit'
  } as const;
  return `${range.startAt.toLocaleTimeString('pt-BR', formatOptions)}-${range.endAt.toLocaleTimeString(
    'pt-BR',
    formatOptions
  )}`;
}

function calendarEntryBaseKey(entry: CalendarOrderEntry) {
  return `order-${entry.order.id ?? '-'}-${entry.createdAt.getTime()}`;
}

function OrdersPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tutorialMode, isSpotlightSlot } = useTutorialSpotlight(searchParams, TUTORIAL_QUERY_VALUE);
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderView | null>(null);
  const [isOrderDetailModalOpen, setIsOrderDetailModalOpen] = useState(false);
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
  const [newOrderCustomerId, setNewOrderCustomerId] = useState<number | ''>('');
  const [newOrderSelectedAddressKey, setNewOrderSelectedAddressKey] = useState<string>('primary');
  const [newOrderFulfillmentMode, setNewOrderFulfillmentMode] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY');
  const [customerSearch, setCustomerSearch] = useState('');
  const [newOrderItems, setNewOrderItems] = useState<Array<{ productId: number; quantity: number }>>([]);
  const [newOrderDiscountPct, setNewOrderDiscountPct] = useState<string>('0');
  const [newOrderNotes, setNewOrderNotes] = useState<string>('');
  const [newOrderScheduledAt, setNewOrderScheduledAt] = useState<string>(() => defaultOrderDateTimeInput());
  const [newOrderDeliveryQuote, setNewOrderDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [newOrderDeliveryQuoteError, setNewOrderDeliveryQuoteError] = useState<string | null>(null);
  const [isQuotingNewOrderDelivery, setIsQuotingNewOrderDelivery] = useState(false);
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [calendarView, setCalendarView] = useState<CalendarViewMode>('DAY');
  const [calendarAnchorDate, setCalendarAnchorDate] = useState<Date>(() => startOfLocalDay(new Date()));
  const [selectedCalendarDateKey, setSelectedCalendarDateKey] = useState(() => dateKeyFromDate(new Date()));
  const [calendarNow, setCalendarNow] = useState(() => new Date());
  const [scheduleDayAvailabilityByDayKey, setScheduleDayAvailabilityByDayKey] = useState<
    Record<string, ScheduleDayAvailability>
  >({});
  const [isSavingSelectedScheduleDay, setIsSavingSelectedScheduleDay] = useState(false);
  const isOperationMode = true;
  const [isDeliveredListExpanded, setIsDeliveredListExpanded] = useState(false);
  const [isStatusUpdatePending, setIsStatusUpdatePending] = useState(false);
  const [selectedOrderEditScheduledAt, setSelectedOrderEditScheduledAt] = useState<string>('');
  const [selectedOrderEditDiscountPct, setSelectedOrderEditDiscountPct] = useState<string>('0');
  const [selectedOrderEditNotes, setSelectedOrderEditNotes] = useState<string>('');
  const [selectedOrderEditCustomerDraft, setSelectedOrderEditCustomerDraft] = useState<EditableOrderCustomerDraft>(
    EMPTY_EDITABLE_ORDER_CUSTOMER_DRAFT
  );
  const [selectedOrderSavedAddressKey, setSelectedOrderSavedAddressKey] = useState<string>('primary');
  const [isSelectedOrderAddressEditing, setIsSelectedOrderAddressEditing] = useState(false);
  const [selectedOrderEditError, setSelectedOrderEditError] = useState<string | null>(null);
  const [isSavingSelectedOrderEdit, setIsSavingSelectedOrderEdit] = useState(false);
  const [isSavingSelectedOrderCustomerAddress, setIsSavingSelectedOrderCustomerAddress] = useState(false);
  const [selectedOrderEditingBoxKey, setSelectedOrderEditingBoxKey] = useState<string | null>(null);
  const [selectedOrderEditingBoxDraftByProductId, setSelectedOrderEditingBoxDraftByProductId] = useState<
    Record<number, number>
  >({});
  const [selectedOrderEditingBoxError, setSelectedOrderEditingBoxError] = useState<string | null>(null);
  const [isSavingSelectedOrderEditingBox, setIsSavingSelectedOrderEditingBox] = useState(false);
  const [isDeletingSelectedOrderEditingBox, setIsDeletingSelectedOrderEditingBox] = useState(false);
  const [selectedOrderCompanionDraftByProductId, setSelectedOrderCompanionDraftByProductId] = useState<
    Record<number, number>
  >({});
  const [selectedOrderCompanionEditError, setSelectedOrderCompanionEditError] = useState<string | null>(null);
  const [isSavingSelectedOrderCompanions, setIsSavingSelectedOrderCompanions] = useState(false);
  const newOrderQuoteRequestIdRef = useRef(0);
  const newOrderDialogRef = useRef<HTMLDivElement | null>(null);
  const orderDetailDialogRef = useRef<HTMLDivElement | null>(null);
  const selectedOrderId = selectedOrder?.id ?? null;
  const selectedOrderIdRef = useRef<number | null>(null);
  const scheduleDayAvailabilityLoadedKeysRef = useRef(new Set<string>());
  const newOrderTitleId = useId();
  const orderDetailTitleId = useId();
  const { confirm, notifyError, notifySuccess, presentSuccess } = useFeedback();
  const deferredOrders = useDeferredValue(orders);
  const deferredCustomers = useDeferredValue(customers);
  const deferredProducts = useDeferredValue(products);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { orders: ordersData, customers: customersData, products: productsData } = await fetchOrdersWorkspace();
      const currentSelectedOrderId = selectedOrderIdRef.current;
      startTransition(() => {
        setOrders(ordersData);
        setCustomers(customersData);
        setProducts(productsData);
        if (currentSelectedOrderId) {
          const fresh = ordersData.find((o) => o.id === currentSelectedOrderId) || null;
          setSelectedOrder((current) => (current?.id === currentSelectedOrderId ? fresh : current));
          if (!fresh) {
            setIsOrderDetailModalOpen(false);
          }
        }
      });
      return ordersData;
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Falha ao carregar dados de pedidos.');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const syncOrderInWorkspace = useCallback((nextOrder: OrderView | null) => {
    if (!nextOrder?.id) return;
    startTransition(() => {
      setOrders((current) => {
        const hasExisting = current.some((entry) => entry.id === nextOrder.id);
        if (!hasExisting) return current;
        return current.map((entry) => (entry.id === nextOrder.id ? nextOrder : entry));
      });
      setSelectedOrder((current) => (current?.id === nextOrder.id ? nextOrder : current));
    });
  }, []);

  const removeOrderFromWorkspace = useCallback((orderId: number) => {
    startTransition(() => {
      setOrders((current) => current.filter((entry) => entry.id !== orderId));
      setSelectedOrder((current) => (current?.id === orderId ? null : current));
    });
    if (selectedOrderIdRef.current === orderId) {
      selectedOrderIdRef.current = null;
      setIsOrderDetailModalOpen(false);
    }
  }, []);

  const openOrderDetail = useCallback((order: OrderView) => {
    setSelectedOrder(order);
    setIsOrderDetailModalOpen(true);
  }, []);

  const closeOrderDetail = useCallback(() => {
    setIsOrderDetailModalOpen(false);
    setSelectedOrder(null);
  }, []);

  const openNewOrderModal = useCallback(() => {
    setIsOrderDetailModalOpen(false);
    setOrderError(null);
    setIsNewOrderModalOpen(true);
  }, []);

  const closeNewOrderModal = useCallback(() => {
    setIsNewOrderModalOpen(false);
    setOrderError(null);
  }, []);

  useDialogA11y({
    isOpen: isNewOrderModalOpen,
    dialogRef: newOrderDialogRef,
    onClose: closeNewOrderModal
  });

  useDialogA11y({
    isOpen: Boolean(selectedOrder && isOrderDetailModalOpen),
    dialogRef: orderDetailDialogRef,
    onClose: closeOrderDetail
  });
  const shouldDeriveNewOrderContext = isNewOrderModalOpen;
  const shouldDeriveSelectedOrderDetail = Boolean(selectedOrder && isOrderDetailModalOpen);
  const openCalendarEntry = useCallback((entry: CalendarOrderEntry) => {
    openOrderDetail(entry.order);
  }, [openOrderDetail]);

  useEffect(() => {
    selectedOrderIdRef.current = selectedOrderId;
  }, [selectedOrderId]);

  useEffect(() => {
    loadAll().catch(() => {
      // erro tratado em loadError
    });
  }, [loadAll]);

  useEffect(() => {
    const focus = consumeFocusQueryParam(searchParams);
    if (!focus) return;

    if (focus === 'new_order') {
      openNewOrderModal();
      return;
    }

    if (focus === 'detail') {
      if (selectedOrder) {
        setIsOrderDetailModalOpen(true);
      }
      return;
    }

    const allowed = new Set(['header', 'load_error', 'list']);
    if (!allowed.has(focus)) return;

    scrollToLayoutSlot(focus, {
      focus: false,
      focusSelector: 'input, select, textarea, button'
    });
  }, [openNewOrderModal, searchParams, selectedOrder]);

  useEffect(() => {
    const orderDate = resolveOrderDate(selectedOrder);
    if (!orderDate) return;
    const normalized = startOfLocalDay(orderDate);
    setCalendarAnchorDate(normalized);
    setSelectedCalendarDateKey(dateKeyFromDate(normalized));
  }, [selectedOrder]);

  useEffect(() => {
    if (!selectedOrder || !isOrderDetailModalOpen) return;
    const referenceDate = resolveOrderDate(selectedOrder) || new Date();
    setSelectedOrderEditScheduledAt(
      normalizeDateTimeLocalToAllowedQuarter(formatDateTimeLocalValue(referenceDate))
    );
    setSelectedOrderEditDiscountPct(normalizeDiscountPctInput(deriveDiscountPctFromOrder(selectedOrder)));
    setSelectedOrderEditNotes(stripOrderNoteMetadata(selectedOrder.notes) || '');
    setSelectedOrderEditError(null);
  }, [isOrderDetailModalOpen, selectedOrder]);

  useEffect(() => {
    setNewOrderSelectedAddressKey('primary');
  }, [newOrderCustomerId]);

  useEffect(() => {
    if (!tutorialMode) return;
    setNewOrderNotes((prev) => withTestDataTag(prev, 'Pedido do momento'));
  }, [tutorialMode]);

  const setDraftItemQuantity = (
    productId: number,
    quantityOrUpdater: number | ((currentQuantity: number) => number)
  ) => {
    setNewOrderItems((prev) => {
      const currentQuantity = prev.find((item) => item.productId === productId)?.quantity || 0;
      const nextQuantityRaw =
        typeof quantityOrUpdater === 'function'
          ? quantityOrUpdater(currentQuantity)
          : quantityOrUpdater;
      const normalizedQuantity = Math.max(Math.floor(nextQuantityRaw), 0);
      const next = prev.filter((item) => item.productId !== productId);
      if (normalizedQuantity <= 0) {
        return next;
      }

      const insertionIndex = products.findIndex((product) => product.id === productId);
      const nextItem = { productId, quantity: normalizedQuantity };
      if (insertionIndex < 0) {
        return [...next, nextItem];
      }

      const nextWithInsert = [...next];
      const targetIndex = nextWithInsert.findIndex((item) => {
        const itemIndex = products.findIndex((product) => product.id === item.productId);
        return itemIndex > insertionIndex;
      });
      if (targetIndex === -1) {
        nextWithInsert.push(nextItem);
      } else {
        nextWithInsert.splice(targetIndex, 0, nextItem);
      }
      return nextWithInsert;
    });
  };

  const addDraftItemUnits = (productId: number, units: number) => {
    const normalizedUnits = Math.max(Math.floor(units), 0);
    if (normalizedUnits <= 0) return;
    setDraftItemQuantity(productId, (currentQty) => currentQty + normalizedUnits);
  };

  const decrementDraftItem = (productId: number) => {
    setDraftItemQuantity(productId, (currentQty) => currentQty - 1);
  };

  const clearDraft = () => {
    newOrderQuoteRequestIdRef.current += 1;
    setNewOrderCustomerId('');
    setNewOrderSelectedAddressKey('primary');
    setNewOrderFulfillmentMode('DELIVERY');
    setCustomerSearch('');
    setNewOrderItems([]);
    setNewOrderDiscountPct('0');
    setNewOrderNotes(tutorialMode ? withTestDataTag('', 'Pedido do momento') : '');
    setNewOrderScheduledAt(defaultOrderDateTimeInput());
    setNewOrderDeliveryQuote(null);
    setNewOrderDeliveryQuoteError(null);
    setOrderError(null);
  };

  const createOrder = async () => {
    if (isCreatingOrder) return;
    if (!newOrderCustomerId || newOrderItems.length === 0) {
      setOrderError('Selecione cliente e ao menos um item.');
      return;
    }
    if (!newOrderScheduledAtDate) {
      setOrderError('Informe data e hora.');
      return;
    }
    if (draftDiscount < 0) {
      setOrderError('Desconto não pode ser negativo.');
      return;
    }
    if (isQuotingNewOrderDelivery) {
      setOrderError('Aguarde a cotação do frete terminar.');
      return;
    }
    if (newOrderFulfillmentMode === 'DELIVERY' && !newOrderDeliveryQuote) {
      setOrderError(newOrderDeliveryQuoteError || 'A estimativa de frete e obrigatoria para criar.');
      return;
    }
    setOrderError(null);
    setIsCreatingOrder(true);
    try {
      const nextOrderCustomerPayload: OrderIntake['customer'] = {
        customerId: Number(newOrderCustomerId),
        ...(selectedNewOrderCustomerSnapshot.address ||
        selectedNewOrderCustomerSnapshot.addressLine1 ||
        selectedNewOrderCustomerSnapshot.addressLine2 ||
        selectedNewOrderCustomerSnapshot.neighborhood ||
        selectedNewOrderCustomerSnapshot.city ||
        selectedNewOrderCustomerSnapshot.state ||
        selectedNewOrderCustomerSnapshot.postalCode ||
        selectedNewOrderCustomerSnapshot.country ||
        selectedNewOrderCustomerSnapshot.placeId ||
        typeof selectedNewOrderCustomerSnapshot.lat === 'number' ||
        typeof selectedNewOrderCustomerSnapshot.lng === 'number' ||
        selectedNewOrderCustomerSnapshot.deliveryNotes
          ? {
              address: (selectedNewOrderCustomerSnapshot.address ?? newOrderCustomerAddress) || null,
              addressLine1: selectedNewOrderCustomerSnapshot.addressLine1 ?? null,
              addressLine2: selectedNewOrderCustomerSnapshot.addressLine2 ?? null,
              neighborhood: selectedNewOrderCustomerSnapshot.neighborhood ?? null,
              city: selectedNewOrderCustomerSnapshot.city ?? null,
              state: selectedNewOrderCustomerSnapshot.state ?? null,
              postalCode: selectedNewOrderCustomerSnapshot.postalCode ?? null,
              country: selectedNewOrderCustomerSnapshot.country ?? null,
              placeId: selectedNewOrderCustomerSnapshot.placeId ?? null,
              lat: selectedNewOrderCustomerSnapshot.lat ?? null,
              lng: selectedNewOrderCustomerSnapshot.lng ?? null,
              deliveryNotes: selectedNewOrderCustomerSnapshot.deliveryNotes ?? null
            }
          : {})
      };
      const payload: OrderIntake = {
        version: 1,
        intent: 'CONFIRMED',
        customer: nextOrderCustomerPayload,
        fulfillment: {
          mode: newOrderFulfillmentMode,
          scheduledAt: newOrderScheduledAtDate.toISOString()
        },
        ...(newOrderFulfillmentMode === 'DELIVERY' && newOrderDeliveryQuote
          ? {
              delivery: {
                quoteToken: newOrderDeliveryQuote.quoteToken,
                fee: newOrderDeliveryQuote.fee,
                provider: newOrderDeliveryQuote.provider as NonNullable<OrderIntake['delivery']>['provider'],
                source: newOrderDeliveryQuote.source as NonNullable<OrderIntake['delivery']>['source'],
                status: newOrderDeliveryQuote.status,
                expiresAt: newOrderDeliveryQuote.expiresAt
              }
            }
          : {}),
        order: {
          items: newOrderItems,
          discountPct: draftDiscountPct,
          notes: tutorialMode
            ? withTestDataTag(newOrderNotes, 'Pedido do momento')
            : newOrderNotes || undefined
        },
        payment: {
          method: 'pix',
          status: 'PENDENTE',
          dueAt: newOrderScheduledAtDate.toISOString()
        },
        source: {
          channel: 'INTERNAL_DASHBOARD'
        }
      };
      const created = await submitOrderIntake(payload);
      const createdOrder = created.order;
      if (typeof createdOrder.id !== 'number') {
        throw new Error('Pedido criado sem identificador válido.');
      }
      setNewOrderCustomerId('');
      setNewOrderSelectedAddressKey('primary');
      setNewOrderFulfillmentMode('DELIVERY');
      setCustomerSearch('');
      setNewOrderItems([]);
      setNewOrderDiscountPct('0');
      setNewOrderNotes(tutorialMode ? withTestDataTag('', 'Pedido do momento') : '');
      setNewOrderScheduledAt(defaultOrderDateTimeInput());
      setNewOrderDeliveryQuote(null);
      setNewOrderDeliveryQuoteError(null);
      setIsNewOrderModalOpen(false);
      writeStoredOrderFinalized({
        version: 2,
        origin: 'INTERNAL_DASHBOARD',
        savedAt: new Date().toISOString(),
        returnPath: '/pedidos',
        returnLabel: 'Voltar para pedidos',
        productSubtotal: Math.max(roundMoney((createdOrder.total || 0) - (created.intake.deliveryFee || 0)), 0),
        order: {
          total:
            created.intake.paymentMethod === 'card'
              ? computeSumUpCardPayableTotal(createdOrder.total ?? 0)
              : createdOrder.total ?? null,
          scheduledAt: createdOrder.scheduledAt ?? null
        },
        intake: {
          stage: created.intake.stage,
          deliveryFee: created.intake.deliveryFee,
          paymentMethod: created.intake.paymentMethod,
          pixCharge: created.intake.pixCharge,
          cardCheckout: created.intake.cardCheckout
        }
      });
      startTransition(() => {
        setOrders((current) => [createdOrder, ...current.filter((entry) => entry.id !== createdOrder.id)]);
      });
      router.push('/pedidofinalizado');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível criar.';
      setOrderError(message);
      notifyError(message);
    } finally {
      setIsCreatingOrder(false);
    }
  };

  const removeOrder = async (orderId: number) => {
    const accepted = await confirm({
      title: 'Excluir pedido?',
      description: 'O pedido sai da fila.',
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
      danger: true
    });
    if (!accepted) return;
    try {
      await apiFetch(`/orders/${orderId}`, { method: 'DELETE' });
      removeOrderFromWorkspace(orderId);
      notifySuccess('Pedido excluído.');
      scrollToLayoutSlot('list');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Não foi possível excluir.');
    }
  };

  const updateStatus = async (orderId: number, status: string) => {
    if (isStatusUpdatePending) return;
    setIsStatusUpdatePending(true);
    try {
      const currentOrder = orders.find((entry) => entry.id === orderId) ?? selectedOrder;
      const updatedOrder = await apiFetch<OrderView>(`/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      syncOrderInWorkspace(updatedOrder);
      if (status === 'ENTREGUE') {
        presentSuccess('Pedido finalizado e movido para entregue.', `Pedido #${displayOrderNumber(currentOrder)}`);
      } else {
        notifySuccess(`Status atualizado para ${formatDisplayedOrderStatus(status)}.`);
      }
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Não foi possível atualizar o status.');
    } finally {
      setIsStatusUpdatePending(false);
    }
  };

  const markOrderPaid = async (orderId: number, options?: { paid?: boolean; paidAt?: string | null }) => {
    if (isStatusUpdatePending) return;
    setIsStatusUpdatePending(true);
    try {
      const currentOrder = orders.find((entry) => entry.id === orderId) ?? selectedOrder;
      const shouldMarkPaid = options?.paid ?? true;
      const body = {
        ...(typeof options?.paid === 'boolean' ? { paid: options.paid } : {}),
        ...(options?.paidAt ? { paidAt: options.paidAt } : {})
      };
      const updatedOrder = await apiFetch<OrderView>(`/orders/${orderId}/mark-paid`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      syncOrderInWorkspace(updatedOrder);
      notifySuccess(
        shouldMarkPaid
          ? `Pagamento confirmado para o pedido #${displayOrderNumber(currentOrder)}.`
          : `Pedido #${displayOrderNumber(currentOrder)} marcado como não pago.`
      );
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Não foi possível atualizar o pagamento.');
    } finally {
      setIsStatusUpdatePending(false);
    }
  };

  const productMap = useMemo(() => {
    return new Map(deferredProducts.map((p) => [p.id!, p]));
  }, [deferredProducts]);
  const orderableProducts = useMemo(() => {
    const canonical = deferredProducts.filter((product) => {
      const itemGroup = resolveRuntimeOrderItemGroup(product);
      return (
        (product.active !== false || isRuntimeOrderCompanionTemporarilyOutOfStock(product)) &&
        (itemGroup === 'FLAVOR' || itemGroup === 'COMPANION')
      );
    });

    if (canonical.length > 0) {
      return sortQuickCreateProducts(canonical);
    }

    return sortQuickCreateProducts(deferredProducts.filter((product) => product.active !== false));
  }, [deferredProducts]);
  const runtimeOrderCatalog = useMemo(
    () => buildRuntimeOrderCatalog(orderableProducts.length > 0 ? orderableProducts : deferredProducts),
    [deferredProducts, orderableProducts]
  );
  const selectedOrderEditableFlavorEntries = useMemo(() => {
    return runtimeOrderCatalog.flavorProducts.map((product) => ({
      productId: product.id,
      productName: compactOrderProductName(productMap.get(product.id)?.name ?? product.name)
    }));
  }, [productMap, runtimeOrderCatalog.flavorProducts]);
  const selectedOrderEditableFlavorByProductId = useMemo(
    () =>
      new Map(
        selectedOrderEditableFlavorEntries.map((entry) => [entry.productId, entry] as const)
      ),
    [selectedOrderEditableFlavorEntries]
  );
  const buildSelectedOrderCompanionDraft = useCallback(
    (items: Array<{ productId: number; quantity: number }> | undefined | null) => {
      const byProductId: Record<number, number> = {};
      for (const product of runtimeOrderCatalog.companionProducts) {
        byProductId[product.id] = 0;
      }
      for (const item of items || []) {
        if (resolveRuntimeOrderItemGroup(productMap.get(item.productId)) !== 'COMPANION') continue;
        byProductId[item.productId] = (byProductId[item.productId] || 0) + Math.max(Math.floor(item.quantity || 0), 0);
      }
      return byProductId;
    },
    [productMap, runtimeOrderCatalog.companionProducts]
  );
  const selectedOrderPersistedCompanionDraftByProductId = useMemo(
    () =>
      shouldDeriveSelectedOrderDetail ? buildSelectedOrderCompanionDraft(selectedOrder?.items || []) : {},
    [buildSelectedOrderCompanionDraft, selectedOrder, shouldDeriveSelectedOrderDetail]
  );
  const selectedOrderEditableCompanionRows = useMemo(() => {
    if (!shouldDeriveSelectedOrderDetail) {
      return [];
    }

    const knownRows = runtimeOrderCatalog.companionProducts.map((product) => ({
      productId: product.id,
      productName: product.displayTitle || compactOrderProductName(product.name),
      productMeta: [product.displayFlavor, product.measureLabel, product.displayMakerLine].filter(Boolean).join(' • '),
      price: Number(product.price || 0),
      temporarilyOutOfStock: product.temporarilyOutOfStock
    }));
    const knownProductIds = new Set(knownRows.map((row) => row.productId));
    const extraRows = Object.entries(selectedOrderCompanionDraftByProductId)
      .map(([rawProductId, quantity]) => ({
        productId: Number(rawProductId),
        quantity: Math.max(Math.floor(quantity || 0), 0)
      }))
      .filter((entry) => entry.quantity > 0 && !knownProductIds.has(entry.productId))
      .map((entry) => {
        const fallbackProduct = productMap.get(entry.productId);
        return {
          productId: entry.productId,
          productName: compactOrderProductName(fallbackProduct?.name ?? `Produto ${entry.productId}`),
          productMeta: fallbackProduct?.category || '',
          price: Number(fallbackProduct?.price || 0),
          temporarilyOutOfStock: false
        };
      });

    return [...knownRows, ...extraRows];
  }, [
    productMap,
    runtimeOrderCatalog.companionProducts,
    selectedOrderCompanionDraftByProductId,
    shouldDeriveSelectedOrderDetail
  ]);
  const selectedOrderCompanionDraftDirty = useMemo(() => {
    const productIds = new Set([
      ...Object.keys(selectedOrderPersistedCompanionDraftByProductId),
      ...Object.keys(selectedOrderCompanionDraftByProductId)
    ]);

    for (const rawProductId of productIds) {
      const productId = Number(rawProductId);
      const persistedQuantity = Math.max(
        Math.floor(selectedOrderPersistedCompanionDraftByProductId[productId] || 0),
        0
      );
      const draftQuantity = Math.max(Math.floor(selectedOrderCompanionDraftByProductId[productId] || 0), 0);
      if (persistedQuantity !== draftQuantity) {
        return true;
      }
    }

    return false;
  }, [selectedOrderCompanionDraftByProductId, selectedOrderPersistedCompanionDraftByProductId]);

  const customerOptions = useMemo(
    () =>
      shouldDeriveNewOrderContext
        ? deferredCustomers
            .filter((customer) => !customer.deletedAt)
            .map((c) => ({ id: c.id!, label: `${c.name} (#${c.id})` }))
        : EMPTY_CUSTOMER_OPTIONS,
    [deferredCustomers, shouldDeriveNewOrderContext]
  );

  const parseIdFromLabel = (
    value: string,
    options: Array<{
      id: number;
      label: string;
    }>
  ) => {
    const raw = value.trim();
    if (!raw) return NaN;

    const byHash = raw.match(/#(\d+)\)?$/);
    if (byHash) return Number(byHash[1]);

    if (/^\d+$/.test(raw)) return Number(raw);

    const normalized = raw.toLowerCase();
    const matches = options.filter((option) => {
      const full = option.label.toLowerCase();
      const withoutId = option.label.replace(/\s*\(#\d+\)\s*$/, '').trim().toLowerCase();
      return full === normalized || withoutId === normalized;
    });
    if (matches.length === 1) return matches[0].id;

    return NaN;
  };
  const customerMap = useMemo(() => {
    const map = new Map<number, Customer>();
    for (const customer of deferredCustomers) {
      if (customer.id) {
        map.set(customer.id, customer);
      }
    }
    for (const order of deferredOrders) {
      const customer = order.customer;
      if (customer?.id && !map.has(customer.id)) {
        map.set(customer.id, customer);
      }
    }
    return map;
  }, [deferredCustomers, deferredOrders]);

  const resolveOrderCustomerProfile = useCallback(
    (order?: OrderView | null) => {
      if (!order) return mergeCustomerProfile(null, null);
      const fallbackCustomer = customerMap.get(order.customerId) ?? order.customer ?? null;
      return mergeCustomerProfile(fallbackCustomer, order.customerSnapshot ?? null);
    },
    [customerMap]
  );

  const resolveCustomerName = useCallback(
    (order: OrderView) => {
      const candidate = resolveOrderCustomerProfile(order);
      const fallbackCustomer = customerMap.get(order.customerId) ?? order.customer ?? null;
      if (!candidate.name) return 'Sem cliente';
      return fallbackCustomer?.deletedAt ? `${candidate.name} (excluído)` : candidate.name;
    },
    [customerMap, resolveOrderCustomerProfile]
  );

  useEffect(() => {
    if (!selectedOrder || !isOrderDetailModalOpen) return;
    setSelectedOrderEditCustomerDraft(buildEditableOrderCustomerDraft(resolveOrderCustomerProfile(selectedOrder)));
    setSelectedOrderSavedAddressKey('primary');
    setIsSelectedOrderAddressEditing(false);
  }, [isOrderDetailModalOpen, resolveOrderCustomerProfile, selectedOrder]);

  useEffect(() => {
    if (!selectedOrder || !isOrderDetailModalOpen) return;
    setSelectedOrderCompanionDraftByProductId(buildSelectedOrderCompanionDraft(selectedOrder.items || []));
    setSelectedOrderCompanionEditError(null);
  }, [buildSelectedOrderCompanionDraft, isOrderDetailModalOpen, selectedOrder]);

  const resolveCalendarEntryCompactName = useCallback(
    (entry: CalendarOrderEntry) => compactCustomerLabelForCalendar(resolveCustomerName(entry.order)),
    [resolveCustomerName]
  );
  const resolveCalendarEntryCustomerName = useCallback(
    (entry: CalendarOrderEntry) => resolveCustomerName(entry.order),
    [resolveCustomerName]
  );
  const resolveCalendarEntryGridLabel = useCallback(
    (entry: CalendarOrderEntry) => {
      const customer = resolveOrderCustomerProfile(entry.order);
      const customerName = resolveCustomerName(entry.order);
      const customerAddress = formatCustomerFullAddress(customer) || 'Endereço não informado';

      return `${customerName} • ${customerAddress}`;
    },
    [resolveCustomerName, resolveOrderCustomerProfile]
  );

  const resolveCalendarEntryStatus = useCallback((entry: CalendarOrderEntry) => entry.order.status || '', []);

  const visibleOrders = useMemo(() => {
    if (!isOperationMode) return deferredOrders;
    return deferredOrders.filter((order) => order.status !== 'CANCELADO');
  }, [deferredOrders, isOperationMode]);

  const openVisibleOrderList = useMemo(() => {
    return visibleOrders
      .filter((order) => order.status !== 'ENTREGUE')
      .sort((a, b) => {
        const aDeliveryAt = resolveOrderDate(a) ?? safeDateFromIso(a.createdAt ?? null) ?? new Date(0);
        const bDeliveryAt = resolveOrderDate(b) ?? safeDateFromIso(b.createdAt ?? null) ?? new Date(0);
        const deliveryDiff = aDeliveryAt.getTime() - bDeliveryAt.getTime();
        if (deliveryDiff !== 0) return deliveryDiff;

        const aCreatedAt = safeDateFromIso(a.createdAt ?? null) ?? new Date(0);
        const bCreatedAt = safeDateFromIso(b.createdAt ?? null) ?? new Date(0);
        const createdDiff = aCreatedAt.getTime() - bCreatedAt.getTime();
        if (createdDiff !== 0) return createdDiff;

        return (a.id ?? 0) - (b.id ?? 0);
      });
  }, [visibleOrders]);

  const deliveredVisibleOrderList = useMemo(() => {
    return visibleOrders
      .filter((order) => order.status === 'ENTREGUE')
      .sort((a, b) => {
        const aUpdatedAt =
          safeDateFromIso(a.updatedAt ?? null) ??
          resolveOrderDate(a) ??
          safeDateFromIso(a.createdAt ?? null) ??
          new Date(0);
        const bUpdatedAt =
          safeDateFromIso(b.updatedAt ?? null) ??
          resolveOrderDate(b) ??
          safeDateFromIso(b.createdAt ?? null) ??
          new Date(0);
        const updatedDiff = bUpdatedAt.getTime() - aUpdatedAt.getTime();
        if (updatedDiff !== 0) return updatedDiff;

        return (b.id ?? 0) - (a.id ?? 0);
      });
  }, [visibleOrders]);

  const calendarEntries = useMemo<CalendarOrderEntry[]>(() => {
    return visibleOrders
      .map((order) => {
        const createdAt = resolveOrderDate(order) || new Date();
        const totalBroas = resolveCalendarOrderTotalBroas(order, productMap);
        const durationMinutes = Math.max(resolveExternalOrderProductionDurationMinutes(totalBroas), 30);
        return {
          order,
          createdAt,
          productionStartAt: new Date(createdAt.getTime() - durationMinutes * 60_000),
          durationMinutes,
          totalBroas,
          dateKey: dateKeyFromDate(startOfLocalDay(createdAt))
        };
      })
      .sort((a, b) => a.productionStartAt.getTime() - b.productionStartAt.getTime());
  }, [productMap, visibleOrders]);

  const calendarOrdersByDate = useMemo(() => {
    const grouped = new Map<string, CalendarOrderEntry[]>();
    for (const entry of calendarEntries) {
      const bucket = grouped.get(entry.dateKey) || [];
      bucket.push(entry);
      grouped.set(entry.dateKey, bucket);
    }
    return grouped;
  }, [calendarEntries]);

  useEffect(() => {
    let intervalId: number | null = null;
    let timeoutId: number | null = null;

    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      setCalendarNow(new Date());
    };
    const armInterval = () => {
      tick();
      intervalId = window.setInterval(tick, 60_000);
    };

    const now = new Date();
    const msUntilNextMinute = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
    timeoutId = window.setTimeout(armInterval, msUntilNextMinute);

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, []);

  const todayDateKey = dateKeyFromDate(calendarNow);
  const isDayCalendarView = calendarView === 'DAY';
  const isWeekCalendarView = calendarView === 'WEEK';
  const isMonthCalendarView = calendarView === 'MONTH';
  const selectedCalendarDate = useMemo(
    () => startOfLocalDay(dateFromDateKey(selectedCalendarDateKey)),
    [selectedCalendarDateKey]
  );
  const selectedCalendarDateTitle = useMemo(
    () =>
      selectedCalendarDate
        .toLocaleDateString('pt-BR', {
          weekday: 'short',
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        })
        .replace('.', '')
        .trim(),
    [selectedCalendarDate]
  );
  const selectedScheduleDayAvailability = scheduleDayAvailabilityByDayKey[selectedCalendarDateKey] ?? null;
  const selectedScheduleDayWindows = useMemo(
    () =>
      selectedScheduleDayAvailability?.windows ?? EXTERNAL_ORDER_DELIVERY_WINDOWS.map((window) => ({
        key: window.key,
        label: window.label,
        startLabel: `${window.startHour}h`,
        endLabel: `${window.endHour}h`,
        isOpen: true
      })),
    [selectedScheduleDayAvailability?.windows]
  );
  const selectedScheduleDayUpdatedLabel = useMemo(() => {
    if (!selectedScheduleDayAvailability?.updatedAt) return null;
    const parsed = new Date(selectedScheduleDayAvailability.updatedAt);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [selectedScheduleDayAvailability?.updatedAt]);
  const selectedScheduleDayBlockedCount = selectedScheduleDayAvailability?.blockedWindows.length ?? 0;

  const loadSelectedScheduleDayAvailability = useCallback(async (dayKey: string, force = false) => {
    if (!force && scheduleDayAvailabilityLoadedKeysRef.current.has(dayKey)) {
      return;
    }
    try {
      const availability = await fetchScheduleDayAvailability(dayKey);
      scheduleDayAvailabilityLoadedKeysRef.current.add(dayKey);
      setScheduleDayAvailabilityByDayKey((current) => ({
        ...current,
        [dayKey]: availability
      }));
    } catch (availabilityError) {
      notifyError(
        availabilityError instanceof Error
          ? availabilityError.message
          : 'Não foi possível carregar a disponibilidade do dia.',
      );
    }
  }, [notifyError]);

  useEffect(() => {
    if (!isDayCalendarView) {
      return;
    }
    void loadSelectedScheduleDayAvailability(selectedCalendarDateKey);
  }, [isDayCalendarView, loadSelectedScheduleDayAvailability, selectedCalendarDateKey]);

  const selectedDateEntries = useMemo(() => {
    if (!isDayCalendarView) return [];
    const entries = calendarOrdersByDate.get(selectedCalendarDateKey) || [];
    return [...entries].sort((a, b) => a.productionStartAt.getTime() - b.productionStartAt.getTime());
  }, [calendarOrdersByDate, isDayCalendarView, selectedCalendarDateKey]);

  const monthCells = useMemo(() => {
    if (!isMonthCalendarView) return [];
    const currentMonth = calendarAnchorDate.getMonth();
    return monthGridDates(calendarAnchorDate).map((date) => {
      const key = dateKeyFromDate(date);
      const entries = calendarOrdersByDate.get(key) || [];
      const dayRevenue = entries.reduce((sum, entry) => sum + (entry.order.total ?? 0), 0);
      return {
        date,
        key,
        entries,
        dayRevenue,
        inCurrentMonth: date.getMonth() === currentMonth,
        isToday: key === todayDateKey,
        isSelected: key === selectedCalendarDateKey
      };
    });
  }, [calendarAnchorDate, calendarOrdersByDate, isMonthCalendarView, selectedCalendarDateKey, todayDateKey]);

  const weekCells = useMemo(() => {
    if (!isWeekCalendarView) return [];
    return weekGridDates(calendarAnchorDate).map((date) => {
      const key = dateKeyFromDate(date);
      const entries = calendarOrdersByDate.get(key) || [];
      const dayRevenue = entries.reduce((sum, entry) => sum + (entry.order.total ?? 0), 0);
      return {
        date,
        key,
        entries,
        dayRevenue,
        inCurrentMonth: true,
        isToday: key === todayDateKey,
        isSelected: key === selectedCalendarDateKey
      };
    });
  }, [calendarAnchorDate, calendarOrdersByDate, isWeekCalendarView, selectedCalendarDateKey, todayDateKey]);
  const dayHourSlots = useMemo(() => Array.from({ length: 18 }, (_, index) => index + 6), []);
  const dayGridStartMinutes = (dayHourSlots[0] ?? 0) * 60;
  const dayGridEndMinutes = ((dayHourSlots[dayHourSlots.length - 1] ?? 23) + 1) * 60;
  const dayGridDurationMinutes = Math.max(dayGridEndMinutes - dayGridStartMinutes, 60);
  const dayGridPixelsPerHour = 40;
  const dayGridSnapMinutes = 30;
  const dayGridHeight = Math.round((dayGridDurationMinutes / 60) * dayGridPixelsPerHour);
  const dayGridLineSlots = useMemo(
    () => {
      if (!isDayCalendarView && !isWeekCalendarView) return [];
      return (
      Array.from(
        { length: Math.floor(dayGridDurationMinutes / dayGridSnapMinutes) },
        (_, index) => dayGridStartMinutes + index * dayGridSnapMinutes
      )
      );
    },
    [dayGridDurationMinutes, dayGridSnapMinutes, dayGridStartMinutes, isDayCalendarView, isWeekCalendarView]
  );
  const selectedDateEntriesInsideGrid = useMemo(() => {
    if (!isDayCalendarView) return [];
    return selectedDateEntries.filter((entry) => {
      const startMinutes = minutesIntoDay(entry.productionStartAt);
      const endMinutes = startMinutes + entry.durationMinutes;
      return endMinutes > dayGridStartMinutes && startMinutes < dayGridEndMinutes;
    });
  }, [dayGridEndMinutes, dayGridStartMinutes, isDayCalendarView, selectedDateEntries]);
  const selectedDateTimelineEvents = useMemo(() => {
    if (!isDayCalendarView) return [];
    const pixelsPerMinute = dayGridHeight / dayGridDurationMinutes;
    const minCardHeight = Math.max(Math.round(dayGridSnapMinutes * pixelsPerMinute), 42);

    const timelineItems = selectedDateEntriesInsideGrid.map((entry) => {
      const rawStartMinutes = minutesIntoDay(entry.productionStartAt);
      const rawEndMinutes = rawStartMinutes + entry.durationMinutes;
      const startMinutes = clampNumber(rawStartMinutes, dayGridStartMinutes, dayGridEndMinutes - dayGridSnapMinutes);
      const endMinutes = clampNumber(
        rawEndMinutes,
        startMinutes + dayGridSnapMinutes,
        dayGridEndMinutes
      );
      const durationMinutes = Math.max(endMinutes - startMinutes, dayGridSnapMinutes);

      return {
        entry,
        startMinutes,
        endMinutes,
        top: Math.round((startMinutes - dayGridStartMinutes) * pixelsPerMinute),
        height: Math.max(Math.round(durationMinutes * pixelsPerMinute), minCardHeight)
      };
    });

    return buildTimelineLaneLayout(timelineItems);
  }, [
    dayGridDurationMinutes,
    dayGridEndMinutes,
    dayGridHeight,
    dayGridSnapMinutes,
    dayGridStartMinutes,
    isDayCalendarView,
    selectedDateEntriesInsideGrid
  ]);
  const selectedDateBlockedWindowEvents = useMemo(() => {
    if (!isDayCalendarView) return [];

    return selectedScheduleDayWindows
      .filter((window) => !window.isOpen)
      .map((window) => {
        const definition = EXTERNAL_ORDER_DELIVERY_WINDOWS.find((entry) => entry.key === window.key);
        if (!definition) return null;
        const startMinutes = definition.startHour * 60 + definition.startMinute;
        const endMinutes = definition.endHour * 60 + definition.endMinute;
        const clampedStartMinutes = clampNumber(startMinutes, dayGridStartMinutes, dayGridEndMinutes);
        const clampedEndMinutes = clampNumber(endMinutes, clampedStartMinutes + dayGridSnapMinutes, dayGridEndMinutes);
        const durationMinutes = Math.max(clampedEndMinutes - clampedStartMinutes, dayGridSnapMinutes);
        const top = Math.round(((clampedStartMinutes - dayGridStartMinutes) / dayGridDurationMinutes) * dayGridHeight);
        const height = Math.max(Math.round((durationMinutes / dayGridDurationMinutes) * dayGridHeight), 44);

        return {
          key: window.key,
          label: 'INDISPONÍVEL',
          timeLabel: `${window.startLabel}-${window.endLabel}`,
          top,
          height
        };
      })
      .filter((entry): entry is { key: ExternalOrderDeliveryWindowKey; label: string; timeLabel: string; top: number; height: number } => Boolean(entry));
  }, [
    dayGridDurationMinutes,
    dayGridEndMinutes,
    dayGridHeight,
    dayGridSnapMinutes,
    dayGridStartMinutes,
    isDayCalendarView,
    selectedScheduleDayWindows
  ]);
  const dayTimelineLaneCount = useMemo(
    () =>
      !isDayCalendarView
        ? 1
        :
      Math.max(
        selectedDateTimelineEvents.reduce((max, item) => Math.max(max, item.laneCount), 0),
        1
      ),
    [isDayCalendarView, selectedDateTimelineEvents]
  );
  const weekGridHeight = Math.max(Math.round(dayGridHeight * 0.58), 320);
  const weekGridMinEventHeight = 30;
  const weekGridLineOffsets = useMemo(
    () => {
      if (!isWeekCalendarView) return [];
      return (
      dayGridLineSlots.map((minutes) =>
        Math.round(((minutes - dayGridStartMinutes) / dayGridDurationMinutes) * weekGridHeight)
      )
      );
    },
    [dayGridDurationMinutes, dayGridLineSlots, dayGridStartMinutes, isWeekCalendarView, weekGridHeight]
  );
  const currentTimeMarkerTop = useMemo(() => {
    if (!isDayCalendarView) return null;
    const currentMinutes =
      calendarNow.getHours() * 60 + calendarNow.getMinutes() + calendarNow.getSeconds() / 60;
    if (currentMinutes < dayGridStartMinutes || currentMinutes > dayGridEndMinutes) return null;
    return ((currentMinutes - dayGridStartMinutes) / dayGridDurationMinutes) * dayGridHeight;
  }, [calendarNow, dayGridDurationMinutes, dayGridEndMinutes, dayGridHeight, dayGridStartMinutes, isDayCalendarView]);
  const selectedDateCurrentTimeMarkerTop =
    isDayCalendarView && selectedCalendarDateKey === todayDateKey ? currentTimeMarkerTop : null;
  const weekTimelineCells = useMemo(() => {
    if (!isWeekCalendarView) return [];
    return weekCells.map((cell) => {
      const { overflowCount, timelineLaneCount, timelineEvents } = buildWeekTimelineMetrics(
        cell.entries,
        {
          weekGridHeight,
          dayGridDurationMinutes,
          dayGridEndMinutes,
          dayGridSnapMinutes,
          dayGridStartMinutes,
          weekGridMinEventHeight
        }
      );

      return {
        ...cell,
        overflowCount,
        timelineLaneCount,
        timelineEvents
      };
    });
  }, [
    dayGridDurationMinutes,
    dayGridEndMinutes,
    dayGridSnapMinutes,
    dayGridStartMinutes,
    isWeekCalendarView,
    weekCells,
    weekGridHeight,
    weekGridMinEventHeight
  ]);

  const visibleMonthCells = useMemo(
    () => monthCells.filter((cell) => cell.inCurrentMonth),
    [monthCells]
  );
  const monthGridRows = useMemo(
    () => Math.max(1, Math.ceil(visibleMonthCells.length / 7)),
    [visibleMonthCells.length]
  );
  const calendarRangeLabel = useMemo(
    () => formatCalendarRangeLabel(calendarAnchorDate, calendarView),
    [calendarAnchorDate, calendarView]
  );

  const shiftCalendar = (direction: -1 | 1) => {
    setCalendarAnchorDate((previous) => shiftDateByCalendarView(previous, calendarView, direction));
    setSelectedCalendarDateKey((previous) => {
      const shifted = shiftDateByCalendarView(dateFromDateKey(previous), calendarView, direction);
      return dateKeyFromDate(shifted);
    });
  };

  const jumpCalendarToToday = () => {
    const today = startOfLocalDay(new Date());
    setCalendarAnchorDate(today);
    setSelectedCalendarDateKey(dateKeyFromDate(today));
  };

  const handleToggleSelectedScheduleWindow = useCallback(async (windowKey: ExternalOrderDeliveryWindowKey) => {
    const nextBlockedWindows = selectedScheduleDayWindows
      .filter((window) => {
        if (window.key === windowKey) {
          return window.isOpen;
        }
        return !window.isOpen;
      })
      .map((window) => window.key);
    const windowLabel = selectedScheduleDayWindows.find((window) => window.key === windowKey)?.label ?? windowKey;
    const previousAvailability = selectedScheduleDayAvailability;
    const optimisticAvailability: ScheduleDayAvailability = {
      dayKey: selectedCalendarDateKey,
      blockedWindows: nextBlockedWindows,
      windows: selectedScheduleDayWindows.map((window) => ({
        ...window,
        isOpen: !nextBlockedWindows.includes(window.key)
      })),
      updatedAt: previousAvailability?.updatedAt ?? new Date().toISOString()
    };

    try {
      setIsSavingSelectedScheduleDay(true);
      scheduleDayAvailabilityLoadedKeysRef.current.add(selectedCalendarDateKey);
      setScheduleDayAvailabilityByDayKey((current) => ({
        ...current,
        [selectedCalendarDateKey]: optimisticAvailability
      }));
      const updated = await updateScheduleDayAvailability(selectedCalendarDateKey, nextBlockedWindows);
      scheduleDayAvailabilityLoadedKeysRef.current.add(selectedCalendarDateKey);
      setScheduleDayAvailabilityByDayKey((current) => ({
        ...current,
        [selectedCalendarDateKey]: updated
      }));
      notifySuccess(
        nextBlockedWindows.includes(windowKey)
          ? `Faixa ${windowLabel} marcada como indisponível.`
          : `Faixa ${windowLabel} reaberta para agendamentos.`,
      );
    } catch (availabilityError) {
      notifyError(
        availabilityError instanceof Error
          ? availabilityError.message
          : 'Não foi possível atualizar a disponibilidade do dia.',
      );
      setScheduleDayAvailabilityByDayKey((current) => {
        if (!previousAvailability) {
          const next = { ...current };
          delete next[selectedCalendarDateKey];
          return next;
        }
        return {
          ...current,
          [selectedCalendarDateKey]: previousAvailability
        };
      });
      if (!previousAvailability) {
        scheduleDayAvailabilityLoadedKeysRef.current.delete(selectedCalendarDateKey);
      }
    } finally {
      setIsSavingSelectedScheduleDay(false);
    }
  }, [
    notifyError,
    notifySuccess,
    selectedCalendarDateKey,
    selectedScheduleDayAvailability,
    selectedScheduleDayWindows
  ]);

  const selectCalendarDate = (date: Date) => {
    const normalized = startOfLocalDay(date);
    const nextDateKey = dateKeyFromDate(normalized);
    setSelectedCalendarDateKey(nextDateKey);
    setCalendarAnchorDate(normalized);
    setCalendarView('DAY');
    if (selectedOrder) {
      const selectedOrderDateKey = dateKeyFromDate(startOfLocalDay(resolveOrderDate(selectedOrder) || new Date()));
      if (selectedOrderDateKey !== nextDateKey) {
        setSelectedOrder(null);
        setIsOrderDetailModalOpen(false);
      }
    }
  };

  const handleDayGridEventClick = (entry: CalendarOrderEntry) => {
    openCalendarEntry(entry);
  };

  const handleWeekGridEventClick = (entry: CalendarOrderEntry) => {
    openCalendarEntry(entry);
  };

  const handleCalendarChipClick = (
    event: MouseEvent<HTMLButtonElement>,
    entry: CalendarOrderEntry
  ) => {
    event.stopPropagation();
    openCalendarEntry(entry);
  };

  const draftTotalUnits = useMemo(
    () =>
      newOrderItems.reduce((sum, item) => {
        if (resolveRuntimeOrderItemGroup(productMap.get(item.productId)) !== 'FLAVOR') return sum;
        return sum + Math.max(item.quantity || 0, 0);
      }, 0),
    [newOrderItems, productMap]
  );
  const draftTotalSelectedUnits = useMemo(
    () => newOrderItems.reduce((sum, item) => sum + Math.max(item.quantity || 0, 0), 0),
    [newOrderItems]
  );

  const draftSubtotal = useMemo(() => {
    return calculateOrderSubtotalFromItems(newOrderItems, productMap);
  }, [newOrderItems, productMap]);

  const draftDiscountPct = useMemo(() => {
    const parsed = parseLocaleNumber(newOrderDiscountPct);
    if (parsed == null) return 0;
    return Math.min(Math.max(roundMoney(parsed), 0), 100);
  }, [newOrderDiscountPct]);
  const draftDiscount = useMemo(
    () => roundMoney((draftSubtotal * draftDiscountPct) / 100),
    [draftDiscountPct, draftSubtotal]
  );
  const draftTotal = Math.max(draftSubtotal - draftDiscount, 0);
  const selectedNewOrderCustomer = useMemo(
    () =>
      shouldDeriveNewOrderContext && typeof newOrderCustomerId === 'number'
        ? customers.find((customer) => customer.id === newOrderCustomerId) || null
        : null,
    [customers, newOrderCustomerId, shouldDeriveNewOrderContext]
  );
  const newOrderCustomerAddressOptions = useMemo(
    () => (shouldDeriveNewOrderContext ? buildCustomerAddressOptions(selectedNewOrderCustomer) : []),
    [selectedNewOrderCustomer, shouldDeriveNewOrderContext]
  );
  const selectedNewOrderAddressOption = useMemo(
    () =>
      newOrderCustomerAddressOptions.find((option) => option.key === newOrderSelectedAddressKey) ||
      newOrderCustomerAddressOptions[0] ||
      null,
    [newOrderCustomerAddressOptions, newOrderSelectedAddressKey]
  );
  const selectedNewOrderCustomerProfile = useMemo(
    () =>
      shouldDeriveNewOrderContext
        ? mergeCustomerProfile(selectedNewOrderCustomer, selectedNewOrderAddressOption?.value ?? null)
        : null,
    [selectedNewOrderAddressOption?.value, selectedNewOrderCustomer, shouldDeriveNewOrderContext]
  );
  const selectedNewOrderCustomerSnapshot = useMemo(
    () =>
      shouldDeriveNewOrderContext
        ? draftToOrderCustomerSnapshot(buildEditableOrderCustomerDraft(selectedNewOrderCustomerProfile))
        : EMPTY_ORDER_CUSTOMER_SNAPSHOT,
    [selectedNewOrderCustomerProfile, shouldDeriveNewOrderContext]
  );
  const newOrderCustomerAddress = useMemo(
    () => formatCustomerFullAddress(selectedNewOrderCustomerProfile),
    [selectedNewOrderCustomerProfile]
  );
  const newOrderScheduledAtDate = useMemo(
    () => parseDateTimeLocalInput(newOrderScheduledAt),
    [newOrderScheduledAt]
  );
  const newOrderScheduledAtIso = useMemo(
    () => newOrderScheduledAtDate?.toISOString() ?? null,
    [newOrderScheduledAtDate]
  );
  const newOrderQuoteManifestItems = useMemo(
    () =>
      shouldDeriveNewOrderContext
        ? newOrderItems
            .filter((item) => Math.max(Math.floor(item.quantity || 0), 0) > 0)
            .map((item) => ({
              name: productMap.get(item.productId)?.name ?? `Produto ${item.productId}`,
              quantity: Math.max(Math.floor(item.quantity || 0), 0)
            }))
        : [],
    [newOrderItems, productMap, shouldDeriveNewOrderContext]
  );
  const requiresNewOrderDeliveryQuote = newOrderFulfillmentMode === 'DELIVERY';
  const canCreateOrder =
    Boolean(newOrderCustomerId) &&
    newOrderItems.length > 0 &&
    (!requiresNewOrderDeliveryQuote || Boolean(newOrderDeliveryQuote?.quoteToken)) &&
    !(requiresNewOrderDeliveryQuote && isQuotingNewOrderDelivery);
  const draftVirtualBoxRemainingUnits =
    draftTotalUnits > 0 ? unitsToCloseOrderBox(draftTotalUnits) : 0;

  const selectedOrderVirtualBoxPartitions = useMemo(
    () =>
      shouldDeriveSelectedOrderDetail
        ? buildOrderVirtualBoxPartitions(
            (selectedOrder?.items || []).filter(
              (item) => resolveRuntimeOrderItemGroup(productMap.get(item.productId)) === 'FLAVOR'
            ),
            productMap
          )
        : { boxes: [], openBox: [], openBoxUnits: 0 },
    [productMap, selectedOrder, shouldDeriveSelectedOrderDetail]
  );
  const selectedOrderEditableBoxes = useMemo<OrderVirtualEditableBox[]>(() => {
    if (!shouldDeriveSelectedOrderDetail) {
      return [];
    }
    const closedBoxes = selectedOrderVirtualBoxPartitions.boxes.map((box, index) => ({
      key: `box-${index + 1}`,
      label: `#${index + 1}`,
      officialName: resolveOrderVirtualBoxOfficialName(box),
      parts: box,
      targetUnits: ORDER_BOX_UNITS,
      tone: 'CLOSED' as const
    }));
    if (selectedOrderVirtualBoxPartitions.openBox.length <= 0 || selectedOrderVirtualBoxPartitions.openBoxUnits <= 0) {
      return closedBoxes;
    }
    return [
      ...closedBoxes,
      {
        key: 'box-open',
        label: 'Aberta',
        officialName: 'Caixa Aberta',
        parts: selectedOrderVirtualBoxPartitions.openBox,
        targetUnits: selectedOrderVirtualBoxPartitions.openBoxUnits,
        tone: 'OPEN' as const
      }
    ];
  }, [selectedOrderVirtualBoxPartitions, shouldDeriveSelectedOrderDetail]);
  const selectedOrderNewEditableBox = useMemo<OrderVirtualEditableBox>(
    () => ({
      key: SELECTED_ORDER_NEW_BOX_KEY,
      label: 'Nova',
      officialName: 'Nova Caixa',
      parts: [],
      targetUnits: ORDER_BOX_UNITS,
      tone: 'OPEN'
    }),
    []
  );
  const selectedOrderRenderedBoxes = useMemo(() => {
    if (!shouldDeriveSelectedOrderDetail) {
      return [];
    }
    if (selectedOrderEditingBoxKey !== SELECTED_ORDER_NEW_BOX_KEY) {
      return selectedOrderEditableBoxes;
    }
    return [...selectedOrderEditableBoxes, selectedOrderNewEditableBox];
  }, [selectedOrderEditableBoxes, selectedOrderEditingBoxKey, selectedOrderNewEditableBox, shouldDeriveSelectedOrderDetail]);
  const selectedOrderEditableBoxByKey = useMemo(() => {
    return new Map(selectedOrderRenderedBoxes.map((box) => [box.key, box]));
  }, [selectedOrderRenderedBoxes]);
  const selectedOrderEditingBox = selectedOrderEditingBoxKey
    ? selectedOrderEditableBoxByKey.get(selectedOrderEditingBoxKey) || null
    : null;
  const selectedOrderEditingBoxDraftTotalUnits = useMemo(() => {
    if (!shouldDeriveSelectedOrderDetail) {
      return 0;
    }
    return Object.values(selectedOrderEditingBoxDraftByProductId).reduce(
      (sum, quantity) => sum + Math.max(Math.floor(quantity || 0), 0),
      0
    );
  }, [selectedOrderEditingBoxDraftByProductId, shouldDeriveSelectedOrderDetail]);
  const selectedOrderEditPickerParts = useMemo(
    () =>
      splitDateTimeLocalPickerParts(
        selectedOrderEditScheduledAt || normalizeDateTimeLocalToAllowedQuarter(formatDateTimeLocalValue(new Date()))
      ),
    [selectedOrderEditScheduledAt]
  );
  const selectedOrderEditScheduledAtDate = useMemo(
    () => parseDateTimeLocalInput(selectedOrderEditScheduledAt),
    [selectedOrderEditScheduledAt]
  );
  const selectedOrderEditScheduledWindowKey = useMemo(
    () => resolveExternalOrderDeliveryWindowKeyForDate(selectedOrderEditScheduledAtDate ?? null),
    [selectedOrderEditScheduledAtDate]
  );
  const selectedOrderEditScheduledWindowLabel = useMemo(
    () => resolveExternalOrderDeliveryWindowLabel(selectedOrderEditScheduledWindowKey),
    [selectedOrderEditScheduledWindowKey]
  );
  const selectedOrderEditDiscountPctNumber = useMemo(() => {
    const parsed = parseLocaleNumber(selectedOrderEditDiscountPct);
    return parsed == null ? 0 : Math.min(Math.max(roundMoney(parsed), 0), 100);
  }, [selectedOrderEditDiscountPct]);
  const selectedOrderAppliedCoupon = useMemo(() => {
    if (!selectedOrder) return null;
    const persistedCode = String(selectedOrder.couponCode || '').trim();
    const noteCoupon = parseAppliedCouponFromNotes(selectedOrder.notes ?? null);
    if (persistedCode) {
      return {
        code: persistedCode,
        discountPct: noteCoupon?.discountPct ?? null
      };
    }
    return noteCoupon;
  }, [selectedOrder]);
  const selectedCustomer =
    shouldDeriveSelectedOrderDetail && selectedOrder
      ? selectedOrder.customer || customers.find((customer) => customer.id === selectedOrder.customerId) || null
      : null;
  const selectedCustomerAddressOptions = useMemo(
    () => buildCustomerAddressOptions(selectedCustomer),
    [selectedCustomer]
  );
  const selectedOrderCustomerProfile = useMemo(
    () =>
      shouldDeriveSelectedOrderDetail ? resolveOrderCustomerProfile(selectedOrder) : mergeCustomerProfile(null, null),
    [resolveOrderCustomerProfile, selectedOrder, shouldDeriveSelectedOrderDetail]
  );
  const selectedCustomerNameLabel = selectedOrder ? resolveCustomerName(selectedOrder) : 'Sem cliente';
  const selectedCustomerAddressLabel =
    formatCustomerFullAddress(selectedOrderCustomerProfile) || 'Endereço não informado';
  const selectedCustomerPhoneLabel =
    formatPhoneBR(selectedOrderCustomerProfile.phone) ||
    (selectedOrderCustomerProfile.phone || '').trim() ||
    'Telefone não informado';
  const selectedOrderScheduledWindowLabel = useMemo(
    () => formatPublicScheduleWindowLabel(resolveOrderDate(selectedOrder)),
    [selectedOrder]
  );
  const selectedOrderDeliveryFee = toMoney(Math.max(selectedOrder?.deliveryFee ?? 0, 0));
  const selectedOrderProductSubtotal = toMoney(
    Math.max(roundMoney((selectedOrder?.total ?? 0) - selectedOrderDeliveryFee), 0)
  );
  const selectedOrderGrandTotal = toMoney(selectedOrder?.total ?? 0);
  const selectedOrderDeliveryFeeLabel =
    selectedOrder?.fulfillmentMode === 'DELIVERY'
      ? selectedOrderDeliveryFee > 0
        ? formatCurrencyBR(selectedOrderDeliveryFee)
        : 'A confirmar'
      : 'Retirada';
  const selectedCustomerDeletedAtLabel = selectedCustomer?.deletedAt
    ? formatDeletionTimestampLabel(selectedCustomer.deletedAt)
    : null;
  const selectedOrderIsCancelled = selectedOrder?.status === 'CANCELADO';
  const selectedOrderAllowsBoxEdit =
    selectedOrder?.status !== 'CANCELADO' && selectedOrder?.status !== 'ENTREGUE';
  const resetNewOrderDraftDetails = useCallback(() => {
    setNewOrderItems([]);
    setNewOrderDiscountPct('0');
    setNewOrderNotes(tutorialMode ? withTestDataTag('', 'Pedido do momento') : '');
    setOrderError(null);
  }, [tutorialMode]);
  const syncNewOrderCustomerSelection = useCallback(
    (value: string, options: Array<{ id: number; label: string }>) => {
      const parsedId = parseIdFromLabel(value, options);
      const nextCustomerId = Number.isFinite(parsedId) ? parsedId : '';
      if (newOrderCustomerId !== nextCustomerId) {
        resetNewOrderDraftDetails();
      }
      setNewOrderCustomerId((current) => (current === nextCustomerId ? current : nextCustomerId));
    },
    [newOrderCustomerId, resetNewOrderDraftDetails]
  );
  useEffect(() => {
    if (!isNewOrderModalOpen) return;
    if (!customerSearch.trim()) {
      if (newOrderCustomerId) {
        syncNewOrderCustomerSelection('', customerOptions);
      }
      return;
    }
    syncNewOrderCustomerSelection(customerSearch, customerOptions);
  }, [customerOptions, customerSearch, isNewOrderModalOpen, newOrderCustomerId, syncNewOrderCustomerSelection]);

  const refreshNewOrderDeliveryQuote = useCallback(
    async (options?: { silent?: boolean }) => {
      if (newOrderFulfillmentMode !== 'DELIVERY') {
        newOrderQuoteRequestIdRef.current += 1;
        setNewOrderDeliveryQuote(null);
        setNewOrderDeliveryQuoteError(null);
        setIsQuotingNewOrderDelivery(false);
        return null;
      }

      if (!selectedNewOrderCustomer || !newOrderScheduledAtIso || newOrderQuoteManifestItems.length === 0 || draftSubtotal <= 0) {
        setNewOrderDeliveryQuote(null);
        setNewOrderDeliveryQuoteError(null);
        setIsQuotingNewOrderDelivery(false);
        return null;
      }

      if (!newOrderCustomerAddress.trim()) {
        setNewOrderDeliveryQuote(null);
        setNewOrderDeliveryQuoteError('Cliente sem endereço completo para cotação do frete.');
        setIsQuotingNewOrderDelivery(false);
        return null;
      }

      setIsQuotingNewOrderDelivery(true);
      if (!options?.silent) {
        setNewOrderDeliveryQuoteError(null);
      }
      const requestId = ++newOrderQuoteRequestIdRef.current;

      try {
        const quote = await fetchInternalDeliveryQuote({
          mode: 'DELIVERY',
          scheduledAt: newOrderScheduledAtIso,
          customer: {
            name: selectedNewOrderCustomerSnapshot.name,
            phone: selectedNewOrderCustomerSnapshot.phone ?? null,
            address: selectedNewOrderCustomerSnapshot.address ?? newOrderCustomerAddress,
            addressLine1: selectedNewOrderCustomerSnapshot.addressLine1 ?? null,
            addressLine2: selectedNewOrderCustomerSnapshot.addressLine2 ?? null,
            neighborhood: selectedNewOrderCustomerSnapshot.neighborhood ?? null,
            city: selectedNewOrderCustomerSnapshot.city ?? null,
            state: selectedNewOrderCustomerSnapshot.state ?? null,
            postalCode: selectedNewOrderCustomerSnapshot.postalCode ?? null,
            country: selectedNewOrderCustomerSnapshot.country ?? null,
            placeId: selectedNewOrderCustomerSnapshot.placeId ?? null,
            lat: typeof selectedNewOrderCustomerSnapshot.lat === 'number' ? selectedNewOrderCustomerSnapshot.lat : null,
            lng: typeof selectedNewOrderCustomerSnapshot.lng === 'number' ? selectedNewOrderCustomerSnapshot.lng : null,
            deliveryNotes: selectedNewOrderCustomerSnapshot.deliveryNotes ?? null
          },
          manifest: {
            items: newOrderQuoteManifestItems,
            subtotal: draftTotal,
            totalUnits: draftTotalSelectedUnits
          }
        });
        if (requestId !== newOrderQuoteRequestIdRef.current) {
          return quote;
        }
        setNewOrderDeliveryQuote(quote);
        setNewOrderDeliveryQuoteError(null);
        return quote;
      } catch (error) {
        if (requestId !== newOrderQuoteRequestIdRef.current) {
          return null;
        }
        const message = error instanceof Error ? error.message : 'Não foi possível calcular o frete agora.';
        setNewOrderDeliveryQuote(null);
        setNewOrderDeliveryQuoteError(message);
        return null;
      } finally {
        if (requestId === newOrderQuoteRequestIdRef.current) {
          setIsQuotingNewOrderDelivery(false);
        }
      }
    },
    [
      draftSubtotal,
      draftTotalSelectedUnits,
      newOrderCustomerAddress,
      newOrderFulfillmentMode,
      newOrderQuoteManifestItems,
      newOrderScheduledAtIso,
      newOrderQuoteRequestIdRef,
      selectedNewOrderCustomer,
      selectedNewOrderCustomerSnapshot
    ]
  );

  useEffect(() => {
    if (!isNewOrderModalOpen) return;
    if (newOrderFulfillmentMode !== 'DELIVERY') {
      newOrderQuoteRequestIdRef.current += 1;
      setNewOrderDeliveryQuote(null);
      setNewOrderDeliveryQuoteError(null);
      setIsQuotingNewOrderDelivery(false);
      return;
    }

    if (!selectedNewOrderCustomer || !newOrderCustomerId) {
      newOrderQuoteRequestIdRef.current += 1;
      setNewOrderDeliveryQuote(null);
      setNewOrderDeliveryQuoteError(null);
      setIsQuotingNewOrderDelivery(false);
      return;
    }

    if (!newOrderScheduledAtIso || newOrderQuoteManifestItems.length === 0 || draftSubtotal <= 0) {
      newOrderQuoteRequestIdRef.current += 1;
      setNewOrderDeliveryQuote(null);
      setNewOrderDeliveryQuoteError(null);
      setIsQuotingNewOrderDelivery(false);
      return;
    }

    if (!newOrderCustomerAddress.trim()) {
      newOrderQuoteRequestIdRef.current += 1;
      setNewOrderDeliveryQuote(null);
      setNewOrderDeliveryQuoteError('Cliente sem endereço completo para cotação do frete.');
      setIsQuotingNewOrderDelivery(false);
      return;
    }

    newOrderQuoteRequestIdRef.current += 1;
    setNewOrderDeliveryQuote(null);
    setNewOrderDeliveryQuoteError(null);
    setIsQuotingNewOrderDelivery(false);
  }, [
    draftSubtotal,
    isNewOrderModalOpen,
    newOrderFulfillmentMode,
    newOrderCustomerAddress,
    newOrderCustomerId,
    newOrderQuoteManifestItems,
    newOrderScheduledAtIso,
    selectedNewOrderCustomer
  ]);
  const selectedOrderWorkflowStatus = toOrderWorkflowStatus(selectedOrder?.status);
  const selectedOrderWorkflowIndex = selectedOrderWorkflowStatus
    ? ORDER_WORKFLOW_STATUSES.indexOf(selectedOrderWorkflowStatus)
    : -1;
  const selectedOrderPaymentStatus = selectedOrder?.paymentStatus || 'PENDENTE';

  const selectOrderWorkflowStatus = async (targetStatus: OrderWorkflowStage) => {
    if (!selectedOrder?.id || selectedOrderIsCancelled) return;
    if (targetStatus === 'PAGO') {
      await markOrderPaid(selectedOrder.id, {
        paid: selectedOrderPaymentStatus !== 'PAGO'
      });
      return;
    }
    if (selectedOrderWorkflowStatus === targetStatus) return;
    await updateStatus(selectedOrder.id, targetStatus);
  };

  const updateSelectedOrderCustomerDraft = useCallback(
    (patch: Partial<EditableOrderCustomerDraft>, options?: { clearGeocode?: boolean }) => {
      setSelectedOrderEditCustomerDraft((current) => ({
        ...current,
        ...patch,
        ...(options?.clearGeocode ? { placeId: '', lat: null, lng: null } : {})
      }));
    },
    []
  );

  const applySelectedOrderSavedAddress = useCallback(
    (addressKey: string) => {
      setSelectedOrderSavedAddressKey(addressKey);
      const selectedOption =
        selectedCustomerAddressOptions.find((option) => option.key === addressKey) ||
        selectedCustomerAddressOptions[0] ||
        null;
      if (!selectedOption) return;
      const merged = mergeCustomerProfile(selectedCustomer, selectedOption.value);
      setSelectedOrderEditCustomerDraft((current) => ({
        ...current,
        address: merged.address || buildCustomerAddressSummary(merged) || '',
        addressLine2: merged.addressLine2 || '',
        neighborhood: merged.neighborhood || '',
        city: merged.city || '',
        state: merged.state || '',
        postalCode: merged.postalCode || '',
        country: merged.country || current.country || 'Brasil',
        placeId: merged.placeId || '',
        lat: typeof merged.lat === 'number' ? merged.lat : null,
        lng: typeof merged.lng === 'number' ? merged.lng : null,
        deliveryNotes: merged.deliveryNotes || current.deliveryNotes
      }));
    },
    [selectedCustomer, selectedCustomerAddressOptions]
  );

  const handleSelectedOrderAddressBlur = useCallback(() => {
    setSelectedOrderEditCustomerDraft((current) => {
      const inferred = buildCustomerAddressAutofill(current.address);
      return {
        ...current,
        neighborhood: current.neighborhood || inferred.neighborhood || '',
        city: current.city || inferred.city || '',
        state: current.state || inferred.state || '',
        postalCode: current.postalCode || inferred.postalCode || ''
      };
    });
  }, []);

  const handleSelectedOrderPostalCodeBlur = useCallback(async () => {
    if (!selectedOrderEditCustomerDraft.postalCode.trim()) return;
    try {
      const patch = await lookupPostalCodeAutofill(selectedOrderEditCustomerDraft.postalCode);
      if (!patch) return;
      setSelectedOrderEditCustomerDraft((current) => ({
        ...current,
        address: current.address || patch.address || '',
        neighborhood: current.neighborhood || patch.neighborhood || '',
        city: current.city || patch.city || '',
        state: current.state || patch.state || '',
        postalCode: current.postalCode || patch.postalCode || ''
      }));
    } catch {
      // falha silenciosa de apoio; o usuario pode seguir editando manualmente
    }
  }, [selectedOrderEditCustomerDraft.postalCode]);

  const saveSelectedOrderCustomerAddress = async () => {
    if (!selectedCustomer?.id) {
      setSelectedOrderEditError('Pedido sem cliente vinculado para salvar endereço.');
      return;
    }

    const snapshot = draftToOrderCustomerSnapshot(selectedOrderEditCustomerDraft);
    if (!snapshot.address) {
      setSelectedOrderEditError('Informe o endereço antes de salvar no cliente.');
      return;
    }

    setSelectedOrderEditError(null);
    setIsSavingSelectedOrderCustomerAddress(true);
    try {
      const updatedCustomer = await apiFetch<Customer>(`/customers/${selectedCustomer.id}/addresses`, {
        method: 'POST',
        body: JSON.stringify({
          address: snapshot.address,
          addressLine1: snapshot.addressLine1,
          addressLine2: snapshot.addressLine2,
          neighborhood: snapshot.neighborhood,
          city: snapshot.city,
          state: snapshot.state,
          postalCode: snapshot.postalCode,
          country: snapshot.country,
          placeId: snapshot.placeId,
          lat: snapshot.lat,
          lng: snapshot.lng,
          deliveryNotes: snapshot.deliveryNotes
        })
      });
      startTransition(() => {
        setCustomers((current) =>
          current.map((entry) => (entry.id === updatedCustomer.id ? { ...entry, ...updatedCustomer } : entry))
        );
        setSelectedOrder((current) =>
          current && current.customerId === updatedCustomer.id
            ? { ...current, customer: updatedCustomer }
            : current
        );
      });
      notifySuccess('Endereço salvo no cliente.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível salvar o endereço no cliente.';
      setSelectedOrderEditError(message);
      notifyError(message);
    } finally {
      setIsSavingSelectedOrderCustomerAddress(false);
    }
  };

  const saveSelectedOrderEdit = async () => {
    if (!selectedOrder?.id) return;
    const parsedScheduledAt = parseDateTimeLocalInput(selectedOrderEditScheduledAt);
    if (!parsedScheduledAt) {
      setSelectedOrderEditError('Informe data e hora.');
      return;
    }
    const customerSnapshot = draftToOrderCustomerSnapshot(selectedOrderEditCustomerDraft);
    if (!customerSnapshot.name) {
      setSelectedOrderEditError('Informe o nome do cliente.');
      return;
    }
    if (selectedOrder.fulfillmentMode === 'DELIVERY' && !customerSnapshot.address) {
      setSelectedOrderEditError('Informe o endereço deste pedido.');
      return;
    }

    setSelectedOrderEditError(null);
    setIsSavingSelectedOrderEdit(true);
    try {
      const updatedOrder = await apiFetch<OrderView>(`/orders/${selectedOrder.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          scheduledAt: parsedScheduledAt.toISOString(),
          discountPct: selectedOrderEditDiscountPctNumber,
          notes: selectedOrderEditNotes.trim() ? selectedOrderEditNotes.trim() : null,
          customerSnapshot
        })
      });
      syncOrderInWorkspace(updatedOrder);
      notifySuccess('Pedido salvo.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível salvar o pedido.';
      setSelectedOrderEditError(message);
      notifyError(message);
    } finally {
      setIsSavingSelectedOrderEdit(false);
    }
  };

  const buildSelectedOrderBoxDraft = useCallback(
    (box: OrderVirtualEditableBox) => {
      const byProductId: Record<number, number> = {};
      for (const flavor of selectedOrderEditableFlavorEntries) {
        byProductId[flavor.productId] = 0;
      }
      for (const part of box.parts) {
        const units = Math.max(Math.floor(part.units || 0), 0);
        byProductId[part.productId] = (byProductId[part.productId] || 0) + units;
      }
      return byProductId;
    },
    [selectedOrderEditableFlavorEntries]
  );
  const buildSelectedOrderItemsPayload = useCallback(
    (
      boxes: OrderVirtualBoxPart[][],
      companionDraftByProductId: Record<number, number> = selectedOrderCompanionDraftByProductId
    ) => {
      const boxItems = mapOrderVirtualBoxPartsToItems(boxes);
      const companionItems = Object.entries(companionDraftByProductId)
        .map(([rawProductId, quantity]) => ({
          productId: Number(rawProductId),
          quantity: Math.max(Math.floor(quantity || 0), 0)
        }))
        .filter((item) => item.quantity > 0);
      return [...boxItems, ...companionItems];
    },
    [selectedOrderCompanionDraftByProductId]
  );

  const openSelectedOrderBoxEditor = useCallback(
    (box: OrderVirtualEditableBox) => {
      if (selectedOrderEditingBoxKey === box.key) {
        setSelectedOrderEditingBoxKey(null);
        setSelectedOrderEditingBoxDraftByProductId({});
        setSelectedOrderEditingBoxError(null);
        return;
      }
      setSelectedOrderEditingBoxKey(box.key);
      setSelectedOrderEditingBoxDraftByProductId(buildSelectedOrderBoxDraft(box));
      setSelectedOrderEditingBoxError(null);
    },
    [buildSelectedOrderBoxDraft, selectedOrderEditingBoxKey]
  );
  const updateSelectedOrderCompanionQuantity = useCallback((productId: number, nextValue: number) => {
    setSelectedOrderCompanionDraftByProductId((current) => ({
      ...current,
      [productId]: Math.max(Math.floor(nextValue), 0)
    }));
    setSelectedOrderCompanionEditError(null);
  }, []);

  const decrementSelectedOrderCompanionQuantity = useCallback(
    (productId: number) => {
      const currentQuantity = selectedOrderCompanionDraftByProductId[productId] || 0;
      if (currentQuantity <= 0) return;
      updateSelectedOrderCompanionQuantity(productId, currentQuantity - 1);
    },
    [selectedOrderCompanionDraftByProductId, updateSelectedOrderCompanionQuantity]
  );

  const addSelectedOrderCompanionQuantity = useCallback(
    (productId: number, units: number) => {
      if (!selectedOrderAllowsBoxEdit || selectedOrderEditingBoxKey) return;
      const normalizedUnits = Math.max(Math.floor(units), 0);
      if (normalizedUnits <= 0) return;
      const currentQuantity = selectedOrderCompanionDraftByProductId[productId] || 0;
      updateSelectedOrderCompanionQuantity(productId, currentQuantity + normalizedUnits);
    },
    [
      selectedOrderAllowsBoxEdit,
      selectedOrderCompanionDraftByProductId,
      selectedOrderEditingBoxKey,
      updateSelectedOrderCompanionQuantity
    ]
  );

  const selectedOrderEditingBoxRows = useMemo(() => {
    if (!shouldDeriveSelectedOrderDetail) {
      return [];
    }
    const knownRows = selectedOrderEditableFlavorEntries.map((entry) => ({
      productId: entry.productId,
      productName: entry.productName
    }));
    const knownProductIds = new Set(knownRows.map((row) => row.productId));

    const extraRows = Object.entries(selectedOrderEditingBoxDraftByProductId)
      .map(([rawProductId, quantity]) => ({
        productId: Number(rawProductId),
        quantity: Math.max(Math.floor(quantity || 0), 0)
      }))
      .filter((entry) => entry.quantity > 0 && !knownProductIds.has(entry.productId))
      .map((entry) => ({
        productId: entry.productId,
        productName: compactOrderProductName(productMap.get(entry.productId)?.name ?? `Produto ${entry.productId}`)
      }));

    return [...knownRows, ...extraRows];
  }, [productMap, selectedOrderEditableFlavorEntries, selectedOrderEditingBoxDraftByProductId, shouldDeriveSelectedOrderDetail]);

  const updateSelectedOrderEditingBoxQuantity = useCallback((productId: number, nextValue: number) => {
    setSelectedOrderEditingBoxDraftByProductId((current) => ({
      ...current,
      [productId]: Math.max(Math.floor(nextValue), 0)
    }));
    setSelectedOrderEditingBoxError(null);
  }, []);

  const decrementSelectedOrderEditingBoxQuantity = useCallback(
    (productId: number) => {
      const currentQuantity = selectedOrderEditingBoxDraftByProductId[productId] || 0;
      if (currentQuantity <= 0) return;
      updateSelectedOrderEditingBoxQuantity(productId, currentQuantity - 1);
    },
    [selectedOrderEditingBoxDraftByProductId, updateSelectedOrderEditingBoxQuantity]
  );

  const addSelectedOrderEditingBoxQuantity = useCallback(
    (productId: number, units: number) => {
      if (!selectedOrderEditingBox || !selectedOrderAllowsBoxEdit) return;
      const normalizedUnits = Math.max(Math.floor(units), 0);
      if (normalizedUnits <= 0) return;

      const remainingUnits = Math.max(
        selectedOrderEditingBox.targetUnits - selectedOrderEditingBoxDraftTotalUnits,
        0
      );
      if (normalizedUnits > remainingUnits) {
        setSelectedOrderEditingBoxError(
          `Cabem mais ${remainingUnits} un. nesta caixa.`
        );
        return;
      }

      const currentQuantity = selectedOrderEditingBoxDraftByProductId[productId] || 0;
      updateSelectedOrderEditingBoxQuantity(productId, currentQuantity + normalizedUnits);
    },
    [
      selectedOrderEditingBox,
      selectedOrderEditingBoxDraftByProductId,
      selectedOrderEditingBoxDraftTotalUnits,
      selectedOrderAllowsBoxEdit,
      updateSelectedOrderEditingBoxQuantity
    ]
  );

  const applySelectedOrderEditingBoxMistaShortcut = useCallback(
    (pairedFlavorProductId: number) => {
      if (!selectedOrderEditingBox || !selectedOrderAllowsBoxEdit) return;

      const traditionalFlavor = runtimeOrderCatalog.traditionalFlavor
        ? selectedOrderEditableFlavorByProductId.get(runtimeOrderCatalog.traditionalFlavor.id)
        : null;
      const pairedFlavor = selectedOrderEditableFlavorByProductId.get(pairedFlavorProductId);
      if (!traditionalFlavor || !pairedFlavor) {
        setSelectedOrderEditingBoxError('Falta sabor para essa mista.');
        return;
      }

      const remainingUnits = Math.max(
        selectedOrderEditingBox.targetUnits - selectedOrderEditingBoxDraftTotalUnits,
        0
      );
      if (remainingUnits < ORDER_BOX_UNITS) {
        setSelectedOrderEditingBoxError('Esvazie a caixa para montar uma mista.');
        return;
      }

      setSelectedOrderEditingBoxDraftByProductId((current) => ({
        ...current,
        [traditionalFlavor.productId]:
          Math.max(Math.floor(current[traditionalFlavor.productId] || 0), 0) + 4,
        [pairedFlavor.productId]:
          Math.max(Math.floor(current[pairedFlavor.productId] || 0), 0) + 3
      }));
      setSelectedOrderEditingBoxError(null);
    },
    [
      runtimeOrderCatalog.traditionalFlavor,
      selectedOrderEditableFlavorByProductId,
      selectedOrderEditingBox,
      selectedOrderEditingBoxDraftTotalUnits,
      selectedOrderAllowsBoxEdit
    ]
  );

  useEffect(() => {
    if (isOrderDetailModalOpen) return;
    setSelectedOrderEditingBoxKey(null);
    setSelectedOrderEditingBoxDraftByProductId({});
    setSelectedOrderEditingBoxError(null);
    setIsSavingSelectedOrderEditingBox(false);
    setIsDeletingSelectedOrderEditingBox(false);
    setSelectedOrderCompanionDraftByProductId({});
    setSelectedOrderCompanionEditError(null);
    setIsSavingSelectedOrderCompanions(false);
  }, [isOrderDetailModalOpen]);

  useEffect(() => {
    if (!selectedOrderEditingBoxKey) return;
    const activeBox = selectedOrderEditableBoxByKey.get(selectedOrderEditingBoxKey);
    if (!activeBox) {
      setSelectedOrderEditingBoxKey(null);
      setSelectedOrderEditingBoxDraftByProductId({});
      setSelectedOrderEditingBoxError(null);
      return;
    }

    setSelectedOrderEditingBoxDraftByProductId((current) => {
      const hasAnyDraftValue = Object.keys(current).length > 0;
      return hasAnyDraftValue ? current : buildSelectedOrderBoxDraft(activeBox);
    });
  }, [buildSelectedOrderBoxDraft, selectedOrderEditableBoxByKey, selectedOrderEditingBoxKey]);

  const saveSelectedOrderBoxEdit = useCallback(async () => {
    if (!selectedOrder?.id || !selectedOrderEditingBox || !selectedOrderAllowsBoxEdit) return;
    const targetUnits = selectedOrderEditingBox.targetUnits;
    const normalizedDraftTotal = selectedOrderEditingBoxDraftTotalUnits;
    if (normalizedDraftTotal !== targetUnits) {
      setSelectedOrderEditingBoxError(`A caixa precisa fechar com ${targetUnits} un.`);
      return;
    }

    const nextParts = Object.entries(selectedOrderEditingBoxDraftByProductId)
      .map(([rawProductId, rawUnits]) => ({
        productId: Number(rawProductId),
        units: Math.max(Math.floor(rawUnits || 0), 0)
      }))
      .filter((entry) => entry.units > 0)
      .map((entry) => ({
        productId: entry.productId,
        productName: compactOrderProductName(productMap.get(entry.productId)?.name ?? `Produto ${entry.productId}`),
        units: entry.units
      }));

    if (nextParts.length === 0) {
      setSelectedOrderEditingBoxError('Adicione ao menos 1 sabor.');
      return;
    }

    const isAddingNewBox = selectedOrderEditingBox.key === SELECTED_ORDER_NEW_BOX_KEY;
    const nextBoxes = isAddingNewBox
      ? [...selectedOrderEditableBoxes.map((box) => box.parts), nextParts]
      : selectedOrderEditableBoxes.map((box) =>
          box.key === selectedOrderEditingBox.key ? nextParts : box.parts
        );
    const nextItems = buildSelectedOrderItemsPayload(nextBoxes);
    if (nextItems.length === 0) {
      setSelectedOrderEditingBoxError('Pedido precisa ter ao menos 1 item.');
      return;
    }

    const orderId = selectedOrder.id;
    setSelectedOrderEditingBoxError(null);
    setIsSavingSelectedOrderEditingBox(true);
    try {
      const updatedOrder = await apiFetch<OrderView>(`/orders/${orderId}/items`, {
        method: 'PUT',
        body: JSON.stringify({
          items: nextItems
        })
      });
      syncOrderInWorkspace(updatedOrder);
      setSelectedOrderEditingBoxKey(null);
      setSelectedOrderEditingBoxDraftByProductId({});
      setSelectedOrderEditingBoxError(null);
      notifySuccess(isAddingNewBox ? 'Caixa adicionada.' : 'Caixa atualizada.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível salvar a caixa.';
      setSelectedOrderEditingBoxError(message);
      notifyError(message);
    } finally {
      setIsSavingSelectedOrderEditingBox(false);
    }
  }, [
    buildSelectedOrderItemsPayload,
    notifyError,
    notifySuccess,
    productMap,
    selectedOrder,
    selectedOrderAllowsBoxEdit,
    selectedOrderEditableBoxes,
    selectedOrderEditingBox,
    selectedOrderEditingBoxDraftByProductId,
    selectedOrderEditingBoxDraftTotalUnits,
    syncOrderInWorkspace
  ]);

  const saveSelectedOrderCompanionEdit = useCallback(async () => {
    if (!selectedOrder?.id || !selectedOrderAllowsBoxEdit) return;
    if (selectedOrderEditingBoxKey) {
      setSelectedOrderCompanionEditError('Salve ou cancele a caixa aberta antes de mexer nas Amigas da Broa.');
      return;
    }

    const nextItems = buildSelectedOrderItemsPayload(
      selectedOrderEditableBoxes.map((box) => box.parts),
      selectedOrderCompanionDraftByProductId
    );
    if (nextItems.length === 0) {
      setSelectedOrderCompanionEditError('Pedido precisa ter ao menos 1 item.');
      return;
    }

    setSelectedOrderCompanionEditError(null);
    setIsSavingSelectedOrderCompanions(true);
    try {
      const updatedOrder = await apiFetch<OrderView>(`/orders/${selectedOrder.id}/items`, {
        method: 'PUT',
        body: JSON.stringify({
          items: nextItems
        })
      });
      syncOrderInWorkspace(updatedOrder);
      notifySuccess('Amigas da Broa atualizadas.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível salvar as Amigas da Broa.';
      setSelectedOrderCompanionEditError(message);
      notifyError(message);
    } finally {
      setIsSavingSelectedOrderCompanions(false);
    }
  }, [
    buildSelectedOrderItemsPayload,
    notifyError,
    notifySuccess,
    selectedOrder,
    selectedOrderAllowsBoxEdit,
    selectedOrderCompanionDraftByProductId,
    selectedOrderEditableBoxes,
    selectedOrderEditingBoxKey,
    syncOrderInWorkspace
  ]);

  const removeSelectedOrderEditingBox = useCallback(async () => {
    if (!selectedOrder?.id || !selectedOrderEditingBox || !selectedOrderAllowsBoxEdit) return;

    if (selectedOrderEditingBox.key === SELECTED_ORDER_NEW_BOX_KEY) {
      setSelectedOrderEditingBoxKey(null);
      setSelectedOrderEditingBoxDraftByProductId({});
      setSelectedOrderEditingBoxError(null);
      notifySuccess('Caixa descartada.');
      return;
    }

    const accepted = await confirm({
      title: 'Excluir caixa?',
      description: 'A caixa será removida e o total recalculado.',
      confirmLabel: 'Excluir caixa',
      cancelLabel: 'Cancelar',
      danger: true
    });
    if (!accepted) return;

    const nextBoxes = selectedOrderEditableBoxes
      .filter((box) => box.key !== selectedOrderEditingBox.key)
      .map((box) => box.parts);
    const nextItems = buildSelectedOrderItemsPayload(nextBoxes);
    if (nextItems.length === 0) {
      setSelectedOrderEditingBoxError('O pedido precisa ter ao menos 1 item.');
      return;
    }

    const orderId = selectedOrder.id;
    setSelectedOrderEditingBoxError(null);
    setIsDeletingSelectedOrderEditingBox(true);
    try {
      const updatedOrder = await apiFetch<OrderView>(`/orders/${orderId}/items`, {
        method: 'PUT',
        body: JSON.stringify({
          items: nextItems
        })
      });
      syncOrderInWorkspace(updatedOrder);
      setSelectedOrderEditingBoxKey(null);
      setSelectedOrderEditingBoxDraftByProductId({});
      setSelectedOrderEditingBoxError(null);
      notifySuccess('Caixa excluída.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível excluir a caixa.';
      setSelectedOrderEditingBoxError(message);
      notifyError(message);
    } finally {
      setIsDeletingSelectedOrderEditingBox(false);
    }
  }, [
    buildSelectedOrderItemsPayload,
    confirm,
    notifyError,
    notifySuccess,
    selectedOrder,
    selectedOrderAllowsBoxEdit,
    selectedOrderEditableBoxes,
    selectedOrderEditingBox,
    syncOrderInWorkspace
  ]);

  function renderOrderListLine(order: OrderView) {
    const dateLabel =
      formatOrderDateTimeLabel(resolveOrderDate(order) ?? safeDateFromIso(order.createdAt ?? null)) || 'Sem data';
    const publicWindowLabel = formatPublicScheduleWindowLabel(
      resolveOrderDate(order) ?? safeDateFromIso(order.createdAt ?? null)
    );
    const customerName = resolveCustomerName(order);
    const historyCustomer = resolveOrderCustomerProfile(order);
    const historyCustomerAddress = formatCustomerFullAddress(historyCustomer) || 'Endereço não informado';
    const historyCustomerPhone =
      formatPhoneBR(historyCustomer.phone) || (historyCustomer.phone || '').trim() || 'Telefone não informado';
    const statusDotClass = calendarStatusDotClass(order.status || '');
    const isActive = selectedOrder?.id === order.id;
    const paymentStatus = order.paymentStatus || 'PENDENTE';
    const balanceDue = toMoney(Math.max(order.balanceDue ?? (order.total ?? 0) - toMoney(order.amountPaid ?? 0), 0));
    const itemCount = (order.items || []).reduce((sum, item) => sum + Math.max(item.quantity || 0, 0), 0);
    const historyOrderNote = formatOrderNoteLabel(order.notes);

    return (
      <div
        key={`list-${order.id ?? 'na'}`}
        className={`orders-list-panel__line app-panel app-panel--expandable app-panel--interactive relative ${
          isActive ? 'app-panel--expanded' : ''
        }`}
      >
        <button
          type="button"
          className={`orders-list-panel__line-button ${!isOperationMode ? 'orders-list-panel__line-button--with-remove' : ''}`}
          onClick={() => openOrderDetail(order)}
        >
          <div className="flex flex-wrap items-start justify-between gap-1">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1">
                <span
                  className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold leading-4 ${orderStatusBadgeClass(order.status || '')}`}
                >
                  <span
                    className={`mr-1.5 inline-flex h-1.5 w-1.5 rounded-full ${statusDotClass}`}
                    aria-hidden="true"
                  />
                  {formatDisplayedOrderStatus(order.status)}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold leading-4 ${orderPaymentBadgeClass(paymentStatus)}`}
                >
                  {formatDisplayedPaymentStatus(paymentStatus)}
                </span>
                {isActive ? (
                  <span className="inline-flex items-center rounded-full border border-[color:var(--tone-roast-line)] bg-[color:var(--tone-roast-surface)] px-1.5 py-0 text-[10px] font-semibold leading-4 text-[color:var(--tone-roast-ink)]">
                    Em foco
                  </span>
                ) : null}
              </div>
              <p className="orders-list-panel__line-customer">{customerName}</p>
              <p className="orders-list-panel__line-meta">
                Pedido #{displayOrderNumber(order)} • {dateLabel}
                {publicWindowLabel ? ` • ${publicWindowLabel}` : ' • Fora da faixa publica'}
              </p>
              {historyOrderNote ? <p className="orders-list-panel__line-note">{historyOrderNote}</p> : null}
              <p className="orders-list-panel__line-contact">{historyCustomerAddress}</p>
              <p className="orders-list-panel__line-contact">{historyCustomerPhone}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="orders-list-panel__line-total">{formatCurrencyBR(order.total ?? 0)}</span>
              <span className="app-panel__chevron" aria-hidden="true" />
            </div>
          </div>

          <div className="app-panel__expand" aria-hidden={!isActive}>
            <div className="app-panel__expand-inner">
              <div className="app-panel__expand-surface grid gap-2 text-sm text-neutral-600">
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/80 bg-white/70 px-3 py-2">
                  <span>Unidades</span>
                  <span className="font-semibold text-neutral-900">{formatOrderUnitsLabel(itemCount)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/80 bg-white/70 px-3 py-2">
                  <span>Pagamento</span>
                  <span className="font-semibold text-neutral-900">
                    {paymentStatus === 'PAGO'
                      ? 'PIX recebido'
                      : balanceDue > 0
                        ? `Saldo ${formatCurrencyBR(balanceDue)}`
                        : paymentStatus === 'PENDENTE'
                          ? 'PIX pendente'
                          : paymentStatus}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </button>
        {!isOperationMode ? (
          <button
            type="button"
            className="orders-list-panel__line-remove app-button app-button-danger"
            onClick={(event) => {
              event.stopPropagation();
              removeOrder(order.id!);
            }}
          >
            Remover
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <BuilderLayoutProvider page="pedidos">
      <section className="grid gap-8">
      <BuilderLayoutItemSlot
        id="load_error"
        className={isSpotlightSlot('load_error') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'}
      >
      {loadError ? (
        <div className="app-panel">
          <p className="text-sm text-red-700">Erro ao carregar pedidos: {loadError}</p>
        </div>
      ) : null}
      </BuilderLayoutItemSlot>

      <BuilderLayoutItemSlot
        id="list"
        className={isSpotlightSlot('list') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'}
      >
        <OrdersBoard
          filters={null}
          helperText={null}
          toolbar={
            <div className="orders-calendar-toolbar">
	              <div className="orders-calendar-toolbar__controls">
	                <div className="app-inline-actions">
	                  {(['DAY', 'WEEK', 'MONTH'] as CalendarViewMode[]).map((view) => (
                    <button
                      key={view}
                      type="button"
                      className={`app-button ${calendarView === view ? 'app-button-primary' : 'app-button-ghost'}`}
                      onClick={() => setCalendarView(view)}
                    >
	                      {calendarViewLabels[view]}
	                    </button>
	                  ))}
	                </div>
	                <div className="orders-calendar-toolbar__cta xl:hidden">
	                  <button
	                    type="button"
                    className="app-button app-button-primary w-full sm:w-auto"
                    onClick={openNewOrderModal}
                  >
                    Novo pedido
                  </button>
                </div>
              </div>
              <div className="orders-calendar-nav">
                <button type="button" className="app-button app-button-ghost" onClick={() => shiftCalendar(-1)}>
                  ←
                </button>
                {calendarView === 'DAY' ? null : (
                  <p className="orders-calendar-nav__label">{calendarRangeLabel}</p>
                )}
                <button type="button" className="app-button app-button-ghost" onClick={() => shiftCalendar(1)}>
                  →
                </button>
                <button type="button" className="app-button app-button-primary" onClick={jumpCalendarToToday}>
                  hoje
                </button>
              </div>
            </div>
          }
        >
        {loading ? (
          <div className="app-panel border-dashed text-sm text-neutral-500">
            Carregando pedidos...
          </div>
        ) : (
          <>
            {calendarView === 'DAY' ? (
              <div className="orders-day-sheet">
                <div className="orders-day-sheet__header">
                  <div className="grid gap-1">
                    <h4 className="orders-day-sheet__title">{selectedCalendarDateTitle}</h4>
                    <p className="text-xs text-[color:var(--ink-muted)]">
                      {selectedScheduleDayBlockedCount > 0
                        ? `${selectedScheduleDayBlockedCount} faixa(s) indisponível(is) para agendamento.`
                        : 'Todas as faixas estão liberadas para agendamento.'}
                      {selectedScheduleDayUpdatedLabel ? ` Atualizado em ${selectedScheduleDayUpdatedLabel}.` : ''}
                    </p>
                  </div>
                  <div className="orders-day-sheet__availability">
                    {selectedScheduleDayWindows.map((window) => {
                      const blocked = !window.isOpen;
                      return (
                        <label
                          key={window.key}
                          className="orders-day-sheet__availability-option"
                          data-blocked={blocked ? 'true' : 'false'}
                        >
                          <input
                            type="checkbox"
                            checked={blocked}
                            disabled={isSavingSelectedScheduleDay}
                            onChange={() => void handleToggleSelectedScheduleWindow(window.key)}
                          />
                          <span>{window.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div
                  className="orders-day-grid"
                  style={
                    {
                      '--orders-day-grid-height': `${dayGridHeight}px`,
                      '--orders-day-grid-rows': `${dayHourSlots.length}`,
                      '--orders-day-grid-lanes': `${dayTimelineLaneCount}`
                    } as CSSProperties
                  }
                >
                  <div className="orders-day-grid__hours" aria-hidden="true">
                    {dayHourSlots.map((hour) => (
                      <div key={hour} className="orders-day-grid__hour">
                        <span className="orders-day-grid__hour-label">{`${`${hour}`.padStart(2, '0')}:00`}</span>
                      </div>
                    ))}
                  </div>
                  <div className="orders-day-grid__canvas">
                    {dayGridLineSlots.map((minutes) => {
                      const top = Math.round(
                        ((minutes - dayGridStartMinutes) / dayGridDurationMinutes) * dayGridHeight
                      );
                      return (
                        <div
                          key={`line-${minutes}`}
                          className="orders-day-grid__line"
                          style={{ top: `${top}px` }}
                          aria-hidden="true"
                        />
                      );
                    })}
                    {selectedDateCurrentTimeMarkerTop !== null ? (
                      <div
                        className="orders-calendar-now"
                        style={{ top: `${selectedDateCurrentTimeMarkerTop}px` }}
                        aria-hidden="true"
                      >
                        <span className="orders-calendar-now__dot" />
                      </div>
                    ) : null}
                    {selectedDateBlockedWindowEvents.map((item) => (
                      <div
                        key={`blocked-${item.key}`}
                        className="orders-day-grid__blocked"
                        style={{
                          top: `${item.top}px`,
                          height: `${item.height}px`
                        }}
                      >
                        <span className="orders-day-grid__blocked-title">{item.label}</span>
                        <span className="orders-day-grid__blocked-time">{item.timeLabel}</span>
                      </div>
                    ))}
                    {selectedDateTimelineEvents.length === 0 && selectedDateBlockedWindowEvents.length === 0 ? (
                      <div className="orders-day-grid__empty">sem pedidos no horario</div>
	                    ) : (
	                      selectedDateTimelineEvents.map((item) => {
	                        const status = resolveCalendarEntryStatus(item.entry);
	                        const isSelected = selectedOrder?.id === item.entry.order.id;
	                        const isCompactTimelineCard = item.laneCount > 1;
	                        const eventLabel = isCompactTimelineCard
	                          ? resolveCalendarEntryCustomerName(item.entry)
	                          : resolveCalendarEntryGridLabel(item.entry);
	                        const eventNote = isCompactTimelineCard ? '' : formatOrderNoteLabel(item.entry.order.notes);

	                        return (
	                          <button
	                            type="button"
	                            key={`timeline-${calendarEntryBaseKey(item.entry)}`}
	                            className={`orders-day-grid__event ${
	                              isSelected ? `ring-2 ring-offset-1 ${calendarStatusRingClass(status)}` : ''
	                            }`}
	                            data-label-mode={isCompactTimelineCard ? 'compact' : 'default'}
	                            onClick={() => handleDayGridEventClick(item.entry)}
	                            style={
	                              {
	                                top: `${item.top}px`,
	                                height: `${item.height}px`,
	                                '--orders-day-grid-lane': `${item.lane}`,
	                                '--orders-day-grid-group-lanes': `${item.laneCount}`,
	                                ...calendarStatusEventSurfaceStyle(status)
	                              } as CSSProperties
                            }
                          >
                            <span className="orders-day-grid__event-head">
	                              <span
	                                className={`orders-calendar-chip__dot ${calendarStatusDotClass(status)}`}
	                                aria-hidden="true"
	                              />
	                              <span className="orders-day-grid__event-time">
	                                {formatCalendarEntryTimeRangeLabel(item.entry)}
	                              </span>
	                              <span className="orders-day-grid__event-title">{eventLabel}</span>
	                            </span>
                            {eventNote ? (
                              <span className="orders-day-grid__event-note">{eventNote}</span>
                            ) : null}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
	            ) : calendarView === 'WEEK' ? (
	              <div className="orders-week-grid">
	                {weekTimelineCells.map((cell) => {
	                  return (
	                    <div
                      key={cell.key}
                      data-week-grid-date-key={cell.key}
                      className={`orders-week-grid__day ${
                        cell.isToday ? 'orders-week-grid__day--today' : ''
                      } ${cell.isSelected ? 'orders-week-grid__day--selected' : ''}`}
                    >
                      <button
                        type="button"
                        className="orders-week-grid__day-head w-full text-left"
                        onClick={() => selectCalendarDate(cell.date)}
                      >
                        <div>
                          <p className="orders-week-grid__weekday">
                            {formatCalendarWeekdayLabel(cell.date)}
                          </p>
                          <p className="orders-week-grid__date">
                            {cell.date.toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: '2-digit'
                            })}
                          </p>
                        </div>
                        <span className="orders-week-grid__count">{cell.entries.length}</span>
                      </button>

	                      <div
	                        className="orders-week-grid__canvas"
	                        style={
	                          {
	                            '--orders-week-grid-height': `${weekGridHeight}px`,
	                            '--orders-day-grid-lanes': `${cell.timelineLaneCount}`
	                          } as CSSProperties
	                        }
	                      >
                        {weekGridLineOffsets.map((top, index) => (
                          <div
                            key={`week-line-${cell.key}-${index}`}
                            className="orders-week-grid__line"
                            style={{ top: `${top}px` }}
                            aria-hidden="true"
                          />
                        ))}
                        {cell.isToday && currentTimeMarkerTop !== null ? (
                          <div
                            className="orders-calendar-now"
                            style={{ top: `${currentTimeMarkerTop}px` }}
                            aria-hidden="true"
                          >
                            <span className="orders-calendar-now__dot" />
                          </div>
                        ) : null}
	                        {cell.timelineEvents.length === 0 ? (
	                          <div className="orders-week-grid__empty">sem pedidos</div>
	                        ) : (
	                          cell.timelineEvents.map((item) => {
	                            const status = resolveCalendarEntryStatus(item.entry);
	                            const eventLabel = resolveCalendarEntryCompactName(item.entry);
	                            const isCompactTimelineCard = item.laneCount > 1;
	                            const eventNote = isCompactTimelineCard ? '' : formatOrderNoteLabel(item.entry.order.notes);
	                            const isSelected = selectedOrder?.id === item.entry.order.id;

	                            return (
	                              <button
	                                key={`week-event-${cell.key}-${
	                                  item.entry.order.id
	                                    ? `week-order-${item.entry.order.id}`
	                                    : `week-${calendarEntryBaseKey(item.entry)}`
	                                }`}
	                                type="button"
	                                className={`orders-week-grid__event ${
	                                  isSelected
	                                    ? `ring-2 ring-offset-1 ${calendarStatusRingClass(status)}`
	                                    : ''
	                                }`}
	                                data-label-mode={isCompactTimelineCard ? 'compact' : 'default'}
	                                style={
                                  {
                                    top: `${item.top}px`,
                                    height: `${item.height}px`,
                                    '--orders-day-grid-lane': `${item.lane}`,
                                    ...calendarStatusEventSurfaceStyle(status)
                                  } as CSSProperties
                                }
	                                onClick={(event) => {
	                                  event.stopPropagation();
	                                  handleWeekGridEventClick(item.entry);
	                                }}
	                              >
                                <span
                                  className={`orders-calendar-chip__dot ${calendarStatusDotClass(status)}`}
                                  aria-hidden="true"
                                />
                                <span className="orders-week-grid__event-time">
                                  {formatCalendarEntryTimeRangeLabel(item.entry)}
                                </span>
                                <span className="orders-week-grid__event-name">{eventLabel}</span>
                                {eventNote ? (
                                  <span className="orders-week-grid__event-note">{eventNote}</span>
                                ) : null}
                              </button>
                            );
                          })
                        )}
                      </div>

                      {cell.overflowCount > 0 ? (
                        <p className="orders-week-grid__overflow">
                          +{cell.overflowCount} fora do horario
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                className="orders-month-widget-grid"
                style={
                  {
                    '--orders-month-grid-height': `${dayGridHeight}px`,
                    '--orders-month-grid-rows': `${monthGridRows}`
                  } as CSSProperties
                }
              >
                {visibleMonthCells.map((cell) => {
                  const previewEntries = cell.entries.slice(0, MONTH_WIDGET_MAX_DOTS);
                  const overflowCount = Math.max(cell.entries.length - previewEntries.length, 0);

                  return (
                    <div
                      key={cell.key}
                      className={`orders-month-widget-day ${
                        cell.isSelected ? 'orders-month-widget-day--selected' : ''
                      } ${cell.isToday ? 'orders-month-widget-day--today' : ''}`}
                    >
                      <button
                        type="button"
                        className="orders-month-widget-day__head w-full text-left"
                        onClick={() => selectCalendarDate(cell.date)}
                      >
                        <span className="orders-month-widget-day__date">
                          {cell.date.toLocaleDateString('pt-BR', { day: '2-digit' })}
                        </span>
                        {cell.entries.length > 0 ? (
                          <span className="orders-month-widget-day__count">{cell.entries.length}</span>
                        ) : null}
                      </button>
                      <div className="orders-month-widget-day__events">
                        {previewEntries.map((entry) => {
                          const status = resolveCalendarEntryStatus(entry);
                          const isActiveEntry = selectedOrder?.id === entry.order.id;
                          const timeLabel = formatCalendarEntryTimeRangeLabel(entry);
                          const entryLabel = resolveCalendarEntryCompactName(entry);
                          const entryNote = formatOrderNoteLabel(entry.order.notes);

                          return (
                            <button
                              type="button"
                              key={`month-dot-${cell.key}-${calendarEntryBaseKey(entry)}`}
                              className={`orders-month-widget-day__event ${
                                isActiveEntry ? 'orders-month-widget-day__event--active' : ''
                              }`}
                              onClick={(event) => handleCalendarChipClick(event, entry)}
                              title={`${timeLabel} • ${entryLabel}${entryNote ? ` • ${entryNote}` : ''}`}
                              aria-label={`${timeLabel} ${entryLabel}${entryNote ? ` ${entryNote}` : ''}`}
                            >
                              <span
                                className={`orders-month-widget-day__event-dot ${calendarStatusDotClass(status)}`}
                                aria-hidden="true"
                              />
                            </button>
                          );
                        })}
                        {overflowCount > 0 ? (
                          <span className="orders-month-widget-day__more">+{overflowCount}</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="orders-list-panel">
              <div className="orders-list-panel__header">
                <div>
                  <p className="orders-list-panel__title">PEDIDOS</p>
                  <p className="orders-list-panel__subtitle">
                    {openVisibleOrderList.length} abertos • {deliveredVisibleOrderList.length} entregues
                  </p>
                </div>
              </div>
              <div className="orders-list-panel__stack">
                {openVisibleOrderList.length === 0 ? (
                  <p className="orders-list-panel__empty">Sem pedidos em aberto.</p>
                ) : (
                  openVisibleOrderList.map((order) => renderOrderListLine(order))
                )}
                {deliveredVisibleOrderList.length > 0 ? (
                  <div className="grid gap-2 pt-2">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-[18px] border border-[rgba(126,79,45,0.1)] bg-[linear-gradient(155deg,rgba(255,252,247,0.96),rgba(245,236,226,0.9))] px-4 py-3 text-left shadow-[0_8px_20px_rgba(57,39,24,0.04)]"
                      onClick={() => setIsDeliveredListExpanded((current) => !current)}
                      aria-expanded={isDeliveredListExpanded}
                    >
                      <span>
                        <span className="block text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">
                          Entregues
                        </span>
                        <span className="block text-sm text-[color:var(--ink-strong)]">
                          {deliveredVisibleOrderList.length} pedido(s)
                        </span>
                      </span>
                      <span
                        className={`text-sm font-semibold text-[color:var(--ink-muted)] transition-transform ${
                          isDeliveredListExpanded ? 'rotate-180' : ''
                        }`}
                        aria-hidden="true"
                      >
                        ˅
                      </span>
                    </button>
                    {isDeliveredListExpanded ? (
                      <div className="grid gap-2">
                        {deliveredVisibleOrderList.map((order) => renderOrderListLine(order))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )}
      </OrdersBoard>
      </BuilderLayoutItemSlot>

      <BuilderLayoutItemSlot
        id="detail"
        className={isSpotlightSlot('detail') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'}
      >
      {isNewOrderModalOpen ? (
        <div className="order-detail-modal" role="presentation" onClick={closeNewOrderModal}>
          <div
            className="order-detail-modal__dialog order-detail-modal__dialog--quick-create"
            ref={newOrderDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={newOrderTitleId}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id={newOrderTitleId} className="sr-only">
              Novo pedido
            </h2>
            <button type="button" className="order-detail-modal__close" onClick={closeNewOrderModal}>
              <AppIcon name="close" className="h-4 w-4" />
              Fechar
            </button>
            <div className="order-detail-modal__panel order-detail-modal__panel--quick-create">
              <OrderQuickCreate
                tutorialMode={tutorialMode}
                customerOptions={customerOptions}
                customerAddressOptions={newOrderCustomerAddressOptions.map((option) => ({
                  key: option.key,
                  label: option.label
                }))}
                productsForCards={orderableProducts}
                fulfillmentMode={newOrderFulfillmentMode}
                customerSearch={customerSearch}
                selectedCustomerId={newOrderCustomerId}
                selectedCustomerAddressKey={newOrderSelectedAddressKey}
                selectedCustomerAddressLabel={newOrderCustomerAddress}
                newOrderScheduledAt={newOrderScheduledAt}
                newOrderDiscountPct={newOrderDiscountPct}
                newOrderNotes={newOrderNotes}
                newOrderItems={newOrderItems}
                draftTotalUnits={draftTotalUnits}
                virtualBoxRemainingUnits={draftVirtualBoxRemainingUnits}
                canCreateOrder={canCreateOrder}
                isCreatingOrder={isCreatingOrder}
                isQuotingDelivery={isQuotingNewOrderDelivery}
                orderError={orderError}
                draftSubtotal={draftSubtotal}
                draftDiscount={draftDiscount}
                draftTotal={draftTotal}
                deliveryQuote={newOrderDeliveryQuote}
                deliveryQuoteError={newOrderDeliveryQuoteError}
                productMap={productMap}
                onFulfillmentModeChange={setNewOrderFulfillmentMode}
                onCustomerSearchChange={setCustomerSearch}
                onCustomerOptionPick={(option) => {
                  setCustomerSearch(option.label);
                  syncNewOrderCustomerSelection(option.label, customerOptions);
                }}
                onCustomerAddressKeyChange={setNewOrderSelectedAddressKey}
                onScheduledAtChange={setNewOrderScheduledAt}
                onScheduledWindowPick={(windowKey) => {
                  setNewOrderScheduledAt((current) => applyDateTimeLocalPickerWindow(current, windowKey));
                }}
                onDiscountChange={setNewOrderDiscountPct}
                onDiscountBlur={() => setNewOrderDiscountPct(normalizeDiscountPctInput(newOrderDiscountPct))}
                onNotesChange={setNewOrderNotes}
                onCreateOrder={createOrder}
                onRefreshDeliveryQuote={() => {
                  void refreshNewOrderDeliveryQuote();
                }}
                onClearDraft={clearDraft}
                onDecrementProduct={decrementDraftItem}
                onAddProductUnits={addDraftItemUnits}
                onSetProductQuantity={setDraftItemQuantity}
              />
            </div>
          </div>
        </div>
      ) : null}
      {selectedOrder && isOrderDetailModalOpen ? (
        <div className="order-detail-modal" role="presentation" onClick={closeOrderDetail}>
          <div
            className="order-detail-modal__dialog"
            ref={orderDetailDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={orderDetailTitleId}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id={orderDetailTitleId} className="sr-only">
              Pedido #{displayOrderNumber(selectedOrder)}
            </h2>
            <button type="button" className="order-detail-modal__close" onClick={closeOrderDetail}>
              <AppIcon name="close" className="h-4 w-4" />
              Fechar
            </button>
            <div className="app-panel order-detail-modal__panel grid gap-4">
          <div className="rounded-2xl border border-white/70 bg-white/80 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
              <div className="min-w-0 sm:flex-1">
                <ol className="order-workflow-strip">
                  {ORDER_WORKFLOW_STAGES.map((status, index) => {
                    const stageMeta = orderWorkflowStatusMeta[status];
                    const isPaymentStage = status === 'PAGO';
                    const stageLabel = isPaymentStage
                      ? formatWorkflowPaymentToggleLabel(selectedOrderPaymentStatus)
                      : stageMeta.label;
                    const statusIndex = isPaymentStage
                      ? ORDER_WORKFLOW_STATUSES.length
                      : ORDER_WORKFLOW_STATUSES.indexOf(status as OrderWorkflowStatus);
                    const isCurrent = isPaymentStage
                      ? selectedOrderPaymentStatus === 'PAGO'
                      : selectedOrderWorkflowStatus === status;
                    const isPassed = !isPaymentStage && selectedOrderWorkflowIndex > statusIndex;
                    const nextStage = ORDER_WORKFLOW_STAGES[index + 1];
                    const isConnectorActive =
                      nextStage === 'PAGO'
                        ? selectedOrderPaymentStatus === 'PAGO'
                        : selectedOrderWorkflowIndex > statusIndex;
                    const paymentToggleActionLabel =
                      selectedOrderPaymentStatus === 'PAGO'
                        ? 'Marcar pedido como pendente'
                        : 'Marcar pedido como pago';
                    const isDisabled =
                      isStatusUpdatePending ||
                      selectedOrderIsCancelled ||
                      (!isPaymentStage && isCurrent);

                    return (
                      <li key={status} className="order-workflow-strip__item">
                        <button
                          type="button"
                          className="order-workflow-strip__step group"
                          onClick={() => {
                            void selectOrderWorkflowStatus(status);
                          }}
                          disabled={isDisabled}
                          aria-current={isCurrent ? 'step' : undefined}
                          aria-label={
                            isPaymentStage
                              ? paymentToggleActionLabel
                              : isCurrent
                                ? `${stageLabel}: etapa atual`
                                : `Mover pedido para ${stageLabel}`
                          }
                          title={
                            isPaymentStage
                              ? paymentToggleActionLabel
                              : isCurrent
                                ? `${stageLabel}: etapa atual`
                                : `Mover pedido para ${stageLabel}`
                          }
                        >
                          <span
                            className={`flex h-12 w-12 items-center justify-center rounded-[18px] border transition-[transform,box-shadow,border-color,background-color,color] ${
                              isCurrent
                                ? stageMeta.activeClassName
                                : isPassed
                                  ? 'border-neutral-300 bg-white/94 text-neutral-700'
                                  : 'border-neutral-200 bg-white text-neutral-300'
                            } ${
                              !isCurrent && !selectedOrderIsCancelled
                                ? 'group-hover:-translate-y-0.5 group-hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)]'
                                : ''
                            }`}
                          >
                            <OrderWorkflowIllustration
                              name={stageMeta.illustration}
                              className="h-8 w-8"
                            />
                          </span>
                          <span
                            className={`mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                              isCurrent
                                ? 'text-[color:var(--ink-strong)]'
                                : isPassed
                                  ? 'text-[color:var(--ink-muted)]'
                                  : 'text-[color:color-mix(in_srgb,var(--ink-muted),white_34%)]'
                            }`}
                          >
                            {stageLabel}
                          </span>
                        </button>
                        {index < ORDER_WORKFLOW_STAGES.length - 1 ? (
                          <span
                            className={`order-workflow-strip__connector mx-2 mt-6 h-[2px] w-10 shrink-0 rounded-full ${
                              isConnectorActive ? stageMeta.activeLineClassName : 'bg-[color:var(--line-soft)]'
                            }`}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
            {selectedOrderIsCancelled ? (
              <p className="mt-2 text-xs text-[color:var(--tone-danger-ink)]">
                Pedido cancelado. Etapas bloqueadas.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-xl font-semibold">Pedido #{displayOrderNumber(selectedOrder)}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-[color:var(--ink-strong)]">{selectedCustomerNameLabel}</p>
                {selectedCustomer?.id ? (
                  <Link
                    href={`/clientes?editCustomerId=${selectedCustomer.id}`}
                    className="app-button app-button-ghost px-2 py-1 text-[11px]"
                  >
                    Ver cliente
                  </Link>
                ) : null}
              </div>
              <p className="mt-0.5 break-words text-xs text-[color:var(--ink-muted)]">{selectedCustomerAddressLabel}</p>
              <p className="mt-0.5 break-words text-xs text-[color:var(--ink-muted)]">{selectedCustomerPhoneLabel}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[color:var(--ink-muted)]">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${orderStatusBadgeClass(selectedOrder.status || '')}`}
                >
                  {formatDisplayedOrderStatus(selectedOrder.status)}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${orderPaymentBadgeClass(selectedOrderPaymentStatus)}`}
                >
                  {formatDisplayedPaymentStatus(selectedOrderPaymentStatus)}
                </span>
                <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold text-[color:var(--ink-muted)]">
                  {selectedOrderScheduledWindowLabel ? selectedOrderScheduledWindowLabel : 'Fora da faixa publica'}
                </span>
                <span>{formatCurrencyBR(selectedOrder.total ?? 0)}</span>
              </div>
              {selectedCustomer?.deletedAt ? (
                <p className="mt-1 text-xs text-[color:var(--tone-gold-ink)]">
                  Cliente excluído em {selectedCustomerDeletedAtLabel}. Pedido mantido.
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="app-button app-button-danger w-full sm:w-auto"
              onClick={() => removeOrder(selectedOrder.id!)}
            >
              Excluir
            </button>
          </div>
          <div>
            <div className="mb-3 grid gap-3 rounded-2xl border border-white/70 bg-white/80 p-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px_auto] xl:items-end">
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)]">
                Data e hora
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                  <input
                    className="app-input"
                    type="date"
                    value={selectedOrderEditPickerParts.date}
                    onChange={(event) =>
                      setSelectedOrderEditScheduledAt(
                        mergeDateTimeLocalPickerParts({
                          ...selectedOrderEditPickerParts,
                          date: event.target.value
                        })
                      )
                    }
                  />
                  <input
                    className="app-input"
                    type="time"
                    step={900}
                    value={`${selectedOrderEditPickerParts.hour}:${selectedOrderEditPickerParts.minute}`}
                    onChange={(event) =>
                      setSelectedOrderEditScheduledAt(
                        normalizeDateTimeLocalToAllowedQuarter(
                          mergeDateTimeLocalPickerParts({
                            ...selectedOrderEditPickerParts,
                            hour: event.target.value.split(':')[0] || selectedOrderEditPickerParts.hour,
                            minute: event.target.value.split(':')[1] || selectedOrderEditPickerParts.minute
                          })
                        )
                      )
                    }
                  />
                </div>
                <div className="mt-2 grid gap-2">
                  <div className="flex flex-wrap gap-2">
                    {EXTERNAL_ORDER_DELIVERY_WINDOWS.map((window) => (
                      <button
                        key={window.key}
                        type="button"
                        className={`app-button ${
                          selectedOrderEditScheduledWindowKey === window.key
                            ? 'app-button-primary'
                            : 'app-button-ghost'
                        } min-h-[38px] px-3 text-xs normal-case tracking-[0.02em]`}
                        onClick={() =>
                          setSelectedOrderEditScheduledAt((current) =>
                            applyDateTimeLocalPickerWindow(current, window.key)
                          )
                        }
                      >
                        {window.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs font-normal normal-case tracking-normal text-[color:var(--ink-muted)]">
                    {selectedOrderEditScheduledWindowLabel
                      ? `Faixa pública atual: ${selectedOrderEditScheduledWindowLabel}.`
                      : 'Horario fora das 3 faixas publicas de /pedido.'}
                  </p>
                </div>
              </label>
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)]">
                Desconto (%)
                <input
                  className="app-input"
                  type="text"
                  inputMode="decimal"
                  placeholder="0 a 100"
                  value={selectedOrderEditDiscountPct}
                  onChange={(event) => setSelectedOrderEditDiscountPct(event.target.value)}
                  onBlur={() => setSelectedOrderEditDiscountPct(normalizeDiscountPctInput(selectedOrderEditDiscountPct))}
                />
                {selectedOrderAppliedCoupon ? (
                  <p className="text-[11px] font-medium normal-case tracking-normal text-[color:var(--ink-muted)]">
                    Cupom usado: <strong className="text-[color:var(--ink-strong)]">{selectedOrderAppliedCoupon.code}</strong>
                    {typeof selectedOrderAppliedCoupon.discountPct === 'number'
                      ? ` (${selectedOrderAppliedCoupon.discountPct.toLocaleString('pt-BR', {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 2
                        })}%)`
                      : ''}
                  </p>
                ) : null}
              </label>
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)]">
                Obs.
                <input
                  className="app-input"
                  type="text"
                  value={selectedOrderEditNotes}
                  onChange={(event) => setSelectedOrderEditNotes(event.target.value)}
                  placeholder="Obs."
                />
              </label>
              <button
                type="button"
                className="app-button app-button-primary w-full xl:w-auto disabled:cursor-not-allowed disabled:opacity-60"
                onClick={saveSelectedOrderEdit}
                disabled={isSavingSelectedOrderEdit}
              >
                {isSavingSelectedOrderEdit ? 'Salvando...' : 'Salvar'}
              </button>
              {selectedOrderEditError ? (
                <p className="text-xs font-medium text-[color:var(--tone-roast-ink)] md:col-span-3">{selectedOrderEditError}</p>
              ) : null}
            </div>
            <div className="mb-3 grid gap-3 rounded-2xl border border-white/70 bg-white/80 p-3 lg:grid-cols-2 xl:grid-cols-3">
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)]">
                Nome
                <input
                  className="app-input"
                  type="text"
                  value={selectedOrderEditCustomerDraft.name}
                  onChange={(event) => updateSelectedOrderCustomerDraft({ name: event.target.value })}
                  placeholder="Nome do cliente"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)]">
                Telefone
                <input
                  className="app-input"
                  type="tel"
                  value={selectedOrderEditCustomerDraft.phone}
                  onChange={(event) => updateSelectedOrderCustomerDraft({ phone: event.target.value })}
                  placeholder="Telefone"
                />
              </label>
              <div className="grid gap-3 lg:col-span-2 xl:col-span-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)]">
                    Endereço
                  </p>
                  <button
                    type="button"
                    className="app-button app-button-ghost w-full text-xs sm:w-auto"
                    onClick={() => setIsSelectedOrderAddressEditing((current) => !current)}
                  >
                    {isSelectedOrderAddressEditing ? 'Fechar edição' : 'Editar endereço'}
                  </button>
                </div>
                {!isSelectedOrderAddressEditing ? (
                  <div className="rounded-2xl border border-white/70 bg-[color:var(--bg-soft)] px-3 py-3 text-sm text-[color:var(--ink-strong)]">
                    <p>{formatCustomerFullAddress(selectedOrderEditCustomerDraft)}</p>
                    <p className="mt-1 text-xs text-[color:var(--ink-muted)]">
                      {selectedOrderEditCustomerDraft.deliveryNotes || 'Sem observações de entrega'}
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-3 rounded-2xl border border-white/70 bg-[color:var(--bg-soft)] p-3 lg:grid-cols-2 xl:grid-cols-3">
                    {selectedCustomerAddressOptions.length > 0 ? (
                      <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)]">
                        Endereços salvos
                        <select
                          className="app-input text-sm normal-case tracking-normal text-[color:var(--ink-strong)]"
                          value={selectedOrderSavedAddressKey}
                          onChange={(event) => applySelectedOrderSavedAddress(event.target.value)}
                        >
                          {selectedCustomerAddressOptions.map((option) => (
                            <option key={option.key} value={option.key}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <div className="hidden xl:block" aria-hidden="true" />
                    )}
                    <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)] lg:col-span-2 xl:col-span-3">
                      Endereço
                      <input
                        className="app-input"
                        type="text"
                        value={selectedOrderEditCustomerDraft.address}
                        onChange={(event) =>
                          updateSelectedOrderCustomerDraft(
                            { address: event.target.value },
                            { clearGeocode: true }
                          )
                        }
                        onBlur={handleSelectedOrderAddressBlur}
                        placeholder="Rua, número, bairro, cidade"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)]">
                      Complemento
                      <input
                        className="app-input"
                        type="text"
                        value={selectedOrderEditCustomerDraft.addressLine2}
                        onChange={(event) => updateSelectedOrderCustomerDraft({ addressLine2: event.target.value })}
                        placeholder="Apto, bloco, referência"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)]">
                      Bairro
                      <input
                        className="app-input"
                        type="text"
                        value={selectedOrderEditCustomerDraft.neighborhood}
                        onChange={(event) =>
                          updateSelectedOrderCustomerDraft(
                            { neighborhood: event.target.value },
                            { clearGeocode: true }
                          )
                        }
                        placeholder="Bairro"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)]">
                      Cidade
                      <input
                        className="app-input"
                        type="text"
                        value={selectedOrderEditCustomerDraft.city}
                        onChange={(event) =>
                          updateSelectedOrderCustomerDraft({ city: event.target.value }, { clearGeocode: true })
                        }
                        placeholder="Cidade"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)]">
                      UF
                      <input
                        className="app-input"
                        type="text"
                        maxLength={2}
                        value={selectedOrderEditCustomerDraft.state}
                        onChange={(event) =>
                          updateSelectedOrderCustomerDraft(
                            { state: event.target.value.toUpperCase() },
                            { clearGeocode: true }
                          )
                        }
                        placeholder="UF"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)]">
                      CEP
                      <input
                        className="app-input"
                        type="text"
                        inputMode="numeric"
                        value={selectedOrderEditCustomerDraft.postalCode}
                        onChange={(event) =>
                          updateSelectedOrderCustomerDraft(
                            { postalCode: event.target.value },
                            { clearGeocode: true }
                          )
                        }
                        onBlur={handleSelectedOrderPostalCodeBlur}
                        placeholder="00000-000"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)] lg:col-span-2 xl:col-span-3">
                      Obs. entrega
                      <input
                        className="app-input"
                        type="text"
                        value={selectedOrderEditCustomerDraft.deliveryNotes}
                        onChange={(event) => updateSelectedOrderCustomerDraft({ deliveryNotes: event.target.value })}
                        placeholder="Portão, referência, instruções"
                      />
                    </label>
                    {selectedCustomer?.id && !selectedCustomer?.deletedAt ? (
                      <div className="flex items-center justify-start lg:col-span-2 xl:col-span-3">
                        <button
                          type="button"
                          className="app-button app-button-ghost w-full text-xs sm:w-auto"
                          onClick={saveSelectedOrderCustomerAddress}
                          disabled={isSavingSelectedOrderCustomerAddress}
                        >
                          {isSavingSelectedOrderCustomerAddress ? 'Salvando endereço...' : 'Salvar endereço no cliente'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <h4 className="font-semibold">Caixas</h4>
              <button
                type="button"
                className="app-button app-button-ghost w-full text-xs disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                onClick={() => openSelectedOrderBoxEditor(selectedOrderNewEditableBox)}
                disabled={
                  !selectedOrderAllowsBoxEdit ||
                  isSavingSelectedOrderEditingBox ||
                  isDeletingSelectedOrderEditingBox
                }
              >
                {selectedOrderEditingBoxKey === SELECTED_ORDER_NEW_BOX_KEY ? 'Fechar nova caixa' : 'Adicionar caixa'}
              </button>
            </div>
            {selectedOrderRenderedBoxes.length > 0 ? (
              <div className="mt-3 grid gap-2 rounded-2xl border border-white/70 bg-white/80 p-3">
                {selectedOrderRenderedBoxes.map((box) => {
                  const isEditingBox = selectedOrderEditingBoxKey === box.key;
                  const boxToneClass =
                    box.tone === 'OPEN'
                      ? 'border-[color:var(--tone-gold-line)] bg-[color:var(--tone-gold-surface)]'
                      : 'border-[color:var(--tone-sage-line)] bg-[color:var(--tone-sage-surface)]';
                  const boxLabelToneClass =
                    box.tone === 'OPEN' ? 'text-[color:var(--tone-gold-ink)]' : 'text-[color:var(--tone-sage-ink)]';
                  const boxTextToneClass =
                    box.tone === 'OPEN' ? 'text-[color:var(--tone-gold-ink)]' : 'text-[color:var(--tone-sage-ink)]';

                  return (
                    <div key={box.key} className={`rounded-2xl border px-3 py-2 ${boxToneClass}`}>
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span
                            className={`text-xs font-semibold uppercase tracking-[0.14em] ${boxLabelToneClass}`}
                          >
                            {box.label}
                          </span>
                          <span className={`max-w-full break-words text-xs font-semibold sm:truncate ${boxTextToneClass}`}>
                            {box.officialName}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="app-button app-button-ghost w-full text-xs disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                          onClick={() => openSelectedOrderBoxEditor(box)}
                          disabled={
                            !selectedOrderAllowsBoxEdit ||
                            isSavingSelectedOrderEditingBox ||
                            isDeletingSelectedOrderEditingBox
                          }
                        >
                          {isEditingBox ? 'Fechar' : 'Editar'}
                        </button>
                      </div>
                      <p className={`mt-1 text-sm font-medium ${boxTextToneClass}`}>
                        {formatOrderVirtualBoxParts(box.parts)}
                      </p>
                      {isEditingBox ? (
                        <div className="mt-2 grid gap-2 rounded-xl border border-white/80 bg-white/90 p-2.5">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                            Itens • {selectedOrderEditingBoxDraftTotalUnits}/{box.targetUnits} un
                          </p>
                          <div className="grid gap-1.5">
                            {selectedOrderEditingBoxRows.map((row) => {
                              const quantity =
                                Math.max(
                                  Math.floor(selectedOrderEditingBoxDraftByProductId[row.productId] || 0),
                                  0
                                ) || 0;
                              const remainingUnits = Math.max(
                                box.targetUnits - selectedOrderEditingBoxDraftTotalUnits,
                                0
                              );
                              const canAddUnits =
                                selectedOrderAllowsBoxEdit &&
                                !isSavingSelectedOrderEditingBox &&
                                !isDeletingSelectedOrderEditingBox;
                              const canAddOne = canAddUnits && remainingUnits >= 1;
                              const canAddThree = canAddUnits && remainingUnits >= 3;
                              const canAddFour = canAddUnits && remainingUnits >= 4;
                              const canAddFullBox = canAddUnits && remainingUnits >= ORDER_BOX_UNITS;
                              return (
                                <div
                                  key={`selected-order-box-row-${box.key}-${row.productId}`}
                                  className="flex flex-col gap-2 rounded-lg border border-white/70 bg-white/80 px-2 py-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
                                >
                                  <span className="break-words text-xs font-medium text-[color:var(--ink-muted)]">
                                    {row.productName}
                                  </span>
                                  <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                                    <button
                                      type="button"
                                      className="app-button app-button-ghost px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                                      onClick={() =>
                                        decrementSelectedOrderEditingBoxQuantity(row.productId)
                                      }
                                      disabled={
                                        quantity <= 0 ||
                                        !selectedOrderAllowsBoxEdit ||
                                        isSavingSelectedOrderEditingBox ||
                                        isDeletingSelectedOrderEditingBox
                                      }
                                      aria-label={`Diminuir ${row.productName}`}
                                    >
                                      -
                                    </button>
                                    <span className="min-w-6 text-center text-xs font-semibold text-[color:var(--ink-strong)]">
                                      {quantity}
                                    </span>
                                    <button
                                      type="button"
                                      className="app-button app-button-ghost px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                                      onClick={() =>
                                        addSelectedOrderEditingBoxQuantity(row.productId, 1)
                                      }
                                      disabled={!canAddOne}
                                      aria-label={`Aumentar ${row.productName}`}
                                    >
                                      +1
                                    </button>
                                    <button
                                      type="button"
                                      className="app-button app-button-ghost px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                                      onClick={() =>
                                        addSelectedOrderEditingBoxQuantity(row.productId, 3)
                                      }
                                      disabled={!canAddThree}
                                      aria-label={`Adicionar 3 unidades de ${row.productName}`}
                                    >
                                      +3
                                    </button>
                                    <button
                                      type="button"
                                      className="app-button app-button-ghost px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                                      onClick={() =>
                                        addSelectedOrderEditingBoxQuantity(row.productId, 4)
                                      }
                                      disabled={!canAddFour}
                                      aria-label={`Adicionar 4 unidades de ${row.productName}`}
                                    >
                                      +4
                                    </button>
                                    <button
                                      type="button"
                                      className="app-button app-button-primary px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                                      onClick={() =>
                                        addSelectedOrderEditingBoxQuantity(row.productId, ORDER_BOX_UNITS)
                                      }
                                      disabled={!canAddFullBox}
                                      aria-label={`Adicionar caixa de ${row.productName}`}
                                    >
                                      +1 cx
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {box.targetUnits === ORDER_BOX_UNITS ? (
                            <div className="rounded-lg border border-white/70 bg-white/80 px-2 py-2">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                                Mistas
                              </p>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                {runtimeOrderCatalog.boxEntries
                                  .filter((entry) => entry.kind === 'MIXED')
                                  .map((entry) => {
                                  const pairedFlavor = selectedOrderEditableFlavorByProductId.get(entry.productId);
                                  const canApplyMista =
                                    Boolean(runtimeOrderCatalog.traditionalFlavor) &&
                                    Boolean(pairedFlavor) &&
                                    selectedOrderAllowsBoxEdit &&
                                    !isSavingSelectedOrderEditingBox &&
                                    !isDeletingSelectedOrderEditingBox &&
                                    selectedOrderEditingBoxDraftTotalUnits === 0;
                                  return (
                                    <button
                                      key={`selected-order-box-mista-${box.key}-${entry.productId}`}
                                      type="button"
                                      className="app-button app-button-ghost px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                                      onClick={() => applySelectedOrderEditingBoxMistaShortcut(entry.productId)}
                                      disabled={!canApplyMista}
                                      aria-label={`Aplicar ${entry.label}`}
                                    >
                                      {entry.label.replace(/^Mista\s+/i, '')}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                          {selectedOrderEditingBoxError ? (
                            <p className="text-xs font-medium text-[color:var(--tone-roast-ink)]">{selectedOrderEditingBoxError}</p>
                          ) : null}
                          {!selectedOrderAllowsBoxEdit ? (
                            <p className="text-xs text-[color:var(--tone-gold-ink)]">
                              Esse status bloqueia a edicao das caixas.
                            </p>
                          ) : null}
                          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                            <button
                              type="button"
                              className="app-button app-button-danger w-full disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                              onClick={() => {
                                void removeSelectedOrderEditingBox();
                              }}
                              disabled={
                                !selectedOrderAllowsBoxEdit ||
                                isSavingSelectedOrderEditingBox ||
                                isDeletingSelectedOrderEditingBox
                              }
                            >
                              {isDeletingSelectedOrderEditingBox
                                ? 'Excluindo...'
                                : box.key === SELECTED_ORDER_NEW_BOX_KEY
                                  ? 'Descartar'
                                  : 'Excluir caixa'}
                            </button>
                            <button
                              type="button"
                              className="app-button app-button-ghost w-full disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                              onClick={() => openSelectedOrderBoxEditor(box)}
                              disabled={isSavingSelectedOrderEditingBox || isDeletingSelectedOrderEditingBox}
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              className="app-button app-button-primary w-full disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                              onClick={() => {
                                void saveSelectedOrderBoxEdit();
                              }}
                              disabled={
                                isSavingSelectedOrderEditingBox ||
                                isDeletingSelectedOrderEditingBox ||
                                !selectedOrderAllowsBoxEdit ||
                                selectedOrderEditingBoxDraftTotalUnits !== box.targetUnits
                              }
                            >
                              {isSavingSelectedOrderEditingBox ? 'Salvando...' : 'Salvar'}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 text-xs text-neutral-500">Sem caixas.</p>
            )}
            <div className="mt-3 grid gap-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <h4 className="font-semibold">Amigas da Broa</h4>
                <button
                  type="button"
                  className="app-button app-button-primary w-full text-xs disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  onClick={() => {
                    void saveSelectedOrderCompanionEdit();
                  }}
                  disabled={
                    !selectedOrderAllowsBoxEdit ||
                    !selectedOrderCompanionDraftDirty ||
                    Boolean(selectedOrderEditingBoxKey) ||
                    isSavingSelectedOrderCompanions
                  }
                >
                  {isSavingSelectedOrderCompanions ? 'Salvando...' : 'Salvar Amigas'}
                </button>
              </div>
              {selectedOrderEditableCompanionRows.length > 0 ? (
                <div className="grid gap-1.5 rounded-2xl border border-white/70 bg-white/80 p-3">
                  {selectedOrderEditableCompanionRows.map((row) => {
                    const quantity = Math.max(
                      Math.floor(selectedOrderCompanionDraftByProductId[row.productId] || 0),
                      0
                    );
                    const controlsDisabled =
                      !selectedOrderAllowsBoxEdit ||
                      Boolean(selectedOrderEditingBoxKey) ||
                      isSavingSelectedOrderCompanions;
                    return (
                      <div
                        key={`selected-order-companion-row-${row.productId}`}
                        className="flex flex-col gap-2 rounded-lg border border-white/70 bg-white/85 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="break-words text-sm font-semibold text-[color:var(--ink-strong)]">
                            {row.productName}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[color:var(--ink-muted)]">
                            {row.productMeta ? <span>{row.productMeta}</span> : null}
                            <span>{formatCurrencyBR(row.price)}</span>
                          </div>
                          {row.temporarilyOutOfStock ? (
                            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--tone-roast-ink)]">
                              Temporariamente sem estoque - em breve
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                          <button
                            type="button"
                            className="app-button app-button-ghost px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => decrementSelectedOrderCompanionQuantity(row.productId)}
                            disabled={quantity <= 0 || controlsDisabled}
                            aria-label={`Diminuir ${row.productName}`}
                          >
                            -
                          </button>
                          <span className="min-w-6 text-center text-xs font-semibold text-[color:var(--ink-strong)]">
                            {quantity}
                          </span>
                          <button
                            type="button"
                            className="app-button app-button-primary px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => addSelectedOrderCompanionQuantity(row.productId, 1)}
                            disabled={controlsDisabled || row.temporarilyOutOfStock}
                            aria-label={`Aumentar ${row.productName}`}
                          >
                            +1
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {selectedOrderCompanionEditError ? (
                    <p className="text-xs font-medium text-[color:var(--tone-roast-ink)]">
                      {selectedOrderCompanionEditError}
                    </p>
                  ) : null}
                  {!selectedOrderAllowsBoxEdit ? (
                    <p className="text-xs text-[color:var(--tone-gold-ink)]">
                      Esse status bloqueia a edicao das Amigas da Broa.
                    </p>
                  ) : selectedOrderEditingBoxKey ? (
                    <p className="text-xs text-[color:var(--ink-muted)]">
                      Salve ou cancele a caixa aberta antes de mexer nas Amigas da Broa.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-neutral-500">Sem itens Amigas da Broa disponíveis.</p>
              )}
            </div>
            <div className="mt-3 grid gap-2 rounded-2xl border border-white/70 bg-white/80 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">Produtos</p>
                <p className="text-sm font-semibold text-neutral-900">
                  {formatCurrencyBR(selectedOrderProductSubtotal)}
                </p>
              </div>
              <div className="grid gap-1.5 border-t border-neutral-200/80 pt-2">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">Frete</p>
                  <p className="text-sm font-semibold text-neutral-900">{selectedOrderDeliveryFeeLabel}</p>
                </div>
                {selectedOrder.fulfillmentMode === 'DELIVERY' ? (
                  <p className="text-xs text-neutral-600">{formatDeliveryEstimateCaption(selectedOrder)}</p>
                ) : null}
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-neutral-200/80 pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">Total</p>
                <p className="text-base font-semibold text-neutral-950">
                  {formatCurrencyBR(selectedOrderGrandTotal)}
                </p>
              </div>
            </div>
          </div>

            </div>
          </div>
        </div>
      ) : null}
      </BuilderLayoutItemSlot>

      </section>
      <button
        type="button"
        className="app-button app-button-primary orders-new-order-floating hidden xl:inline-flex"
        onClick={openNewOrderModal}
        aria-label="Novo pedido"
      >
        Novo pedido
      </button>
      </BuilderLayoutProvider>
    </>
  );
}

export function OrdersWorkspaceScreen() {
  return (
    <Suspense fallback={null}>
      <OrdersPageContent />
    </Suspense>
  );
}

export default function OrdersScreen() {
  return <OrdersWorkspaceScreen />;
}
