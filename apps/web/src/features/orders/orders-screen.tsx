'use client';

import Link from 'next/link';
import {
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type MouseEvent
} from 'react';
import {
  resolveDisplayNumber,
  roundMoney,
  type Customer,
  type InventoryItem,
  type InventoryMovement,
  type OrderIntake,
  type Product
} from '@querobroapp/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { writeStoredOrderFinalized } from '@/lib/order-finalized-storage';
import { useDialogA11y } from '@/lib/use-dialog-a11y';
import {
  compactWhitespace,
  formatCurrencyBR,
  formatMoneyInputBR,
  formatPhoneBR,
  parseCurrencyBR,
  parseLocaleNumber
} from '@/lib/format';
import { consumeFocusQueryParam, scrollToLayoutSlot } from '@/lib/layout-scroll';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { AppIcon, type AppIconName } from '@/components/app-icons';
import { useFeedback } from '@/components/feedback-provider';
import { BuilderLayoutItemSlot, BuilderLayoutProvider } from '@/components/builder-layout';
import { OrdersBoard } from './orders-board';
import { OrderQuickCreate } from './order-quick-create';
import {
  ORDER_BOX_UNITS,
  buildRuntimeOrderCatalog,
  calculateOrderSubtotalFromProductItems,
  compactOrderProductName,
  resolveOrderVirtualBoxLabel
} from './order-box-catalog';
import { type DeliveryQuote, type MassPrepEvent, type OrderView } from './orders-model';
import {
  fetchInternalDeliveryQuote,
  fetchOrdersWorkspace,
  submitOrderIntake
} from './orders-api';

const TEST_DATA_TAG = '[TESTE_E2E]';
const TUTORIAL_QUERY_VALUE = 'primeira_vez';
const MASS_PREP_EVENT_NAME = 'FAZER MASSA';
const MONTH_WIDGET_MAX_DOTS = 8;
const WEEK_TIMELINE_MAX_VISIBLE_EVENTS = 5;
const SELECTED_ORDER_NEW_BOX_KEY = 'box-new';
const MASS_READY_ITEM_NAME = 'MASSA PRONTA';
const MASS_READY_BROAS_PER_RECIPE = 21;
const MASS_PREP_DEFAULT_BATCH_RECIPES = 2;
const MASS_PREP_RECIPE_INGREDIENTS = [
  { key: 'LEITE', displayName: 'Leite', aliases: ['LEITE'], unit: 'ml', qtyPerRecipe: 240 },
  {
    key: 'MANTEIGA',
    displayName: 'Manteiga',
    aliases: ['MANTEIGA', 'MANTEIGA COM SAL'],
    unit: 'g',
    qtyPerRecipe: 150
  },
  { key: 'ACUCAR', displayName: 'Acucar', aliases: ['ACUCAR', 'AÇÚCAR'], unit: 'g', qtyPerRecipe: 120 },
  {
    key: 'FARINHA_DE_TRIGO',
    displayName: 'Farinha de trigo',
    aliases: ['FARINHA DE TRIGO'],
    unit: 'g',
    qtyPerRecipe: 130
  },
  {
    key: 'FUBA_DE_CANJICA',
    displayName: 'Fuba de canjica',
    aliases: ['FUBA DE CANJICA', 'FUBÁ DE CANJICA'],
    unit: 'g',
    qtyPerRecipe: 130
  },
  { key: 'OVOS', displayName: 'Ovos', aliases: ['OVOS'], unit: 'uni', qtyPerRecipe: 6 }
] as const;

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
type DraftOrderItem = {
  productId: number;
  quantity: number;
};
type CustomerLastOrderDraft = {
  customerId: number;
  customerName: string;
  orderId: number;
  referenceLabel: string;
  referenceTime: number;
  fulfillmentMode: 'DELIVERY' | 'PICKUP';
  items: DraftOrderItem[];
  discount: number;
  notes: string;
};

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

function normalizeDraftOrderItems(items?: Array<{ productId?: number; quantity?: number }> | null) {
  return (items || [])
    .map((item) => ({
      productId: Number(item.productId),
      quantity: Math.max(Math.floor(item.quantity || 0), 0)
    }))
    .filter((item) => Number.isFinite(item.productId) && item.productId > 0 && item.quantity > 0);
}

function formatOrderNoteLabel(value?: string | null) {
  const normalized = compactWhitespace(value || '');
  return normalized ? `Obs: ${normalized}` : '';
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

function orderStatusBadgeClass(status: string) {
  if (status === 'ENTREGUE') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (status === 'CANCELADO') return 'bg-rose-100 text-rose-800 border-rose-200';
  if (status === 'PRONTO') return 'bg-blue-100 text-blue-800 border-blue-200';
  return 'bg-neutral-100 text-neutral-700 border-neutral-200';
}

function orderPaymentBadgeClass(status?: string | null) {
  if (status === 'PAGO') return 'bg-violet-100 text-violet-800 border-violet-200';
  if (status === 'PARCIAL') return 'bg-amber-100 text-amber-800 border-amber-200';
  return 'bg-neutral-100 text-neutral-700 border-neutral-200';
}

function massPrepStatusBadgeClass(status?: MassPrepEventStatus | null) {
  if (status === 'PRONTA') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (status === 'NO_FORNO') return 'bg-amber-100 text-amber-800 border-amber-200';
  if (status === 'PREPARO') return 'bg-orange-100 text-orange-800 border-orange-200';
  return 'bg-rose-100 text-rose-800 border-rose-200';
}

function formatDisplayedOrderStatus(status?: string | null) {
  if (!status) return '';
  if (status === 'EM_PREPARACAO') return 'NO FORNO';
  return status;
}

function formatDisplayedPaymentStatus(status?: string | null) {
  if (!status) return 'PENDENTE';
  if (status === 'PARCIAL') return 'PARCIAL';
  if (status === 'PAGO') return 'PAGO';
  return 'PENDENTE';
}

function formatWorkflowPaymentToggleLabel(status?: string | null) {
  return status === 'PAGO' ? 'PAGO' : 'NAO PAGO';
}

function formatMassPrepStatus(status?: MassPrepEventStatus | null) {
  if (!status) return '';
  if (status === 'PREPARO') return 'EM PREPARO';
  if (status === 'NO_FORNO') return 'NO FORNO';
  if (status === 'PRONTA') return 'PRONTA';
  return status;
}

function displayOrderNumber(order?: { id?: number | null; publicNumber?: number | null } | null) {
  return resolveDisplayNumber(order) ?? order?.id ?? '-';
}

function displayCustomerNumber(customer?: { id?: number | null; publicNumber?: number | null } | null) {
  return resolveDisplayNumber(customer) ?? customer?.id ?? '-';
}

function formatCustomerFullAddress(customer?: Customer | null) {
  if (!customer) return '';
  const normalizedAddress = (customer.address || '').trim();
  if (normalizedAddress) return normalizedAddress;

  const cityState = [customer.city, customer.state]
    .map((part) => (part || '').trim())
    .filter(Boolean)
    .join(' - ');
  const structuredParts = [
    customer.addressLine1,
    customer.addressLine2,
    customer.neighborhood,
    cityState,
    customer.postalCode,
    customer.country
  ]
    .map((part) => (part || '').trim())
    .filter(Boolean);
  return structuredParts.join(', ');
}

function inventoryCategoryLabel(category?: string | null) {
  if (category === 'INGREDIENTE') return 'Ingrediente';
  if (category === 'EMBALAGEM_INTERNA') return 'Embalagem interna';
  if (category === 'EMBALAGEM_EXTERNA') return 'Embalagem externa';
  return category || 'Sem categoria';
}

function formatInventoryBalance(value: number) {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

function formatInventoryBalanceInput(value: number) {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

function normalizeTextForSort(value?: string | null) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function quickCreateProductRank(product: Product) {
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

function roundInventoryQty(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

type OrderWorkflowIllustrationName =
  | 'phone-check'
  | 'mixer'
  | 'oven'
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
  const sharedProps = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 2.35
  };

  const textProps = {
    fill: 'currentColor',
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontWeight: 700
  };

  if (name === 'phone-check') {
    return (
      <svg aria-hidden="true" className={className} viewBox="0 0 64 64">
        <rect {...sharedProps} x="12" y="7" width="20" height="48" rx="4.5" />
        <path {...sharedProps} d="M18.5 33.5 24 39l10.5-10.5" />
      </svg>
    );
  }

  if (name === 'mixer') {
    return (
      <svg aria-hidden="true" className={className} viewBox="0 0 64 64">
        <circle {...sharedProps} cx="16" cy="10.5" r="2.8" />
        <path {...sharedProps} d="M14 31V22.5c0-7.8 9-12.5 22.5-12.5 13.9 0 21.5 4.3 21.5 11.4 0 5.3-4.1 9.8-10.2 11.1" />
        <path {...sharedProps} d="M14.5 24.5h27.5" />
        <path {...sharedProps} d="M21 24.5v28.5" />
        <path {...sharedProps} d="M21 53H10.5" />
        <path {...sharedProps} d="M20.5 53h14l2.5 4H50" />
        <path {...sharedProps} d="M28 32.5c2.6-1.5 10.6-1.5 13.2 0v10.4c0 6.3-3.7 10.3-9.8 10.3s-9.8-4-9.8-10.3V32.5c0-1.9 1.5-3.4 3.4-3.4h12.8c1.9 0 3.4 1.5 3.4 3.4" />
        <path {...sharedProps} d="M42 29.5v12" />
        <text {...textProps} x="25.2" y="21.4" fontSize="6.1" letterSpacing="1.3">
          SMEG
        </text>
      </svg>
    );
  }

  if (name === 'oven') {
    return (
      <svg aria-hidden="true" className={className} viewBox="0 0 64 64">
        <rect {...sharedProps} x="8.5" y="14" width="47" height="36" rx="3.5" />
        <path {...sharedProps} d="M8.5 24h47" />
        <circle {...sharedProps} cx="18" cy="18.8" r="2.6" />
        <circle {...sharedProps} cx="31.5" cy="18.8" r="2.6" />
        <circle {...sharedProps} cx="45" cy="18.8" r="2.6" />
        <rect {...sharedProps} x="18" y="29.2" width="28" height="15.8" rx="1.8" />
        <path {...sharedProps} d="M26 41c0-2.4 2.3-3.2 2.3-5.6 0-2.3-2.3-3.1-2.3-5.5" />
        <path {...sharedProps} d="M32.3 41c0-2.4 2.3-3.2 2.3-5.6 0-2.3-2.3-3.1-2.3-5.5" />
        <path {...sharedProps} d="M38.6 41c0-2.4 2.3-3.2 2.3-5.6 0-2.3-2.3-3.1-2.3-5.5" />
      </svg>
    );
  }

  if (name === 'bag-check') {
    return (
      <svg aria-hidden="true" className={className} viewBox="0 0 64 64">
        <path {...sharedProps} d="M20 26h25l-2.7 27H22.7L20 26Z" />
        <path {...sharedProps} d="M24.5 26v-5.8c0-5 3.6-8.7 8.4-8.7 4.8 0 8.4 3.7 8.4 8.7V26" />
        <path {...sharedProps} d="M42.5 11.5 48 17l9-9" />
        <text
          {...textProps}
          x="24"
          y="44"
          fontSize="5.15"
          textLength="17.8"
          lengthAdjust="spacingAndGlyphs"
        >
          @QUEROBROA
        </text>
      </svg>
    );
  }

  if (name === 'pix') {
    return (
      <svg aria-hidden="true" className={className} viewBox="0 0 64 64">
        <path {...sharedProps} d="M21 13h7.4l4.7 4.7-7.2 7.2a4.7 4.7 0 0 1-6.6 0L13 18.6 17.7 14a4.7 4.7 0 0 1 3.3-1z" />
        <path {...sharedProps} d="m31 22.8 6.1 6.1a4.7 4.7 0 0 0 6.6 0l7.3-7.3-4.7-4.6a4.7 4.7 0 0 0-3.3-1.4h-7.3" />
        <path {...sharedProps} d="m31 41.2 6.1-6.1a4.7 4.7 0 0 1 6.6 0l7.3 7.3-4.7 4.6a4.7 4.7 0 0 1-3.3 1.4h-7.3" />
        <path {...sharedProps} d="M21 51h7.4l4.7-4.7-7.2-7.2a4.7 4.7 0 0 0-6.6 0L13 45.4l4.7 4.6A4.7 4.7 0 0 0 21 51z" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 64 64">
      <circle {...sharedProps} cx="18" cy="49" r="3.7" />
      <circle {...sharedProps} cx="45" cy="49" r="3.7" />
      <rect {...sharedProps} x="14" y="31" width="11.5" height="12.5" rx="1.2" />
      <path {...sharedProps} d="M25.5 43h9.5l4.5 5.5h7.5" />
      <path {...sharedProps} d="M34.5 43V35h6.7l4.3 4.3" />
      <path {...sharedProps} d="M49.5 48.5h3.3c3 0 5.2-2.3 5.2-5.2v-6.1" />
      <path {...sharedProps} d="M54 26.5h4.8l2.7 5.2" />
      <path {...sharedProps} d="M57.3 37.3 61 35.2" />
      <path {...sharedProps} d="M34 30.4h-5.4c-1.6 0-2.9 1.3-2.9 2.9V43" />
    </svg>
  );
}

type OrderWorkflowStatus = 'ABERTO' | 'CONFIRMADO' | 'EM_PREPARACAO' | 'PRONTO' | 'ENTREGUE';
type OrderWorkflowStage = OrderWorkflowStatus | 'PAGO';

const ORDER_WORKFLOW_STATUSES: OrderWorkflowStatus[] = [
  'ABERTO',
  'CONFIRMADO',
  'EM_PREPARACAO',
  'PRONTO',
  'ENTREGUE'
];
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
    activeClassName: 'border-stone-300 bg-stone-100 text-stone-700',
    passedDotClassName: 'bg-stone-500',
    activeLineClassName: 'bg-stone-400'
  },
  CONFIRMADO: {
    label: 'Massa',
    illustration: 'mixer',
    activeClassName: 'border-amber-300 bg-amber-100 text-amber-800',
    passedDotClassName: 'bg-amber-500',
    activeLineClassName: 'bg-amber-400'
  },
  EM_PREPARACAO: {
    label: 'Forno',
    illustration: 'oven',
    activeClassName: 'border-orange-300 bg-orange-100 text-orange-800',
    passedDotClassName: 'bg-orange-500',
    activeLineClassName: 'bg-orange-400'
  },
  PRONTO: {
    label: 'Pronto',
    illustration: 'bag-check',
    activeClassName: 'border-sky-300 bg-sky-100 text-sky-800',
    passedDotClassName: 'bg-sky-500',
    activeLineClassName: 'bg-sky-400'
  },
  ENTREGUE: {
    label: 'Entregue',
    illustration: 'scooter',
    activeClassName: 'border-emerald-300 bg-emerald-100 text-emerald-800',
    passedDotClassName: 'bg-emerald-500',
    activeLineClassName: 'bg-emerald-400'
  },
  PAGO: {
    label: 'Pago',
    illustration: 'pix',
    activeClassName: 'border-violet-300 bg-violet-100 text-violet-800',
    passedDotClassName: 'bg-violet-500',
    activeLineClassName: 'bg-violet-400'
  }
};

type MassPrepEventStatus = MassPrepEvent['status'];
type MassPrepWorkflowStatus = MassPrepEventStatus;
const MASS_PREP_EVENT_STATUSES: MassPrepEventStatus[] = [
  'INGREDIENTES',
  'PREPARO',
  'NO_FORNO',
  'PRONTA'
];
const massPrepEventStatusTransitions: Record<MassPrepEventStatus, MassPrepEventStatus[]> = {
  INGREDIENTES: ['PREPARO'],
  PREPARO: ['NO_FORNO'],
  NO_FORNO: ['PRONTA'],
  PRONTA: []
};
const massPrepWorkflowStatusMeta: Record<
  MassPrepWorkflowStatus,
  {
    label: string;
    icon: AppIconName;
    activeClassName: string;
    passedDotClassName: string;
    activeLineClassName: string;
  }
> = {
  INGREDIENTES: {
    label: 'Ingredientes',
    icon: 'spark',
    activeClassName: 'border-rose-300 bg-rose-100 text-rose-800',
    passedDotClassName: 'bg-rose-500',
    activeLineClassName: 'bg-rose-400'
  },
  PREPARO: {
    label: 'Preparo',
    icon: 'tools',
    activeClassName: 'border-orange-300 bg-orange-100 text-orange-800',
    passedDotClassName: 'bg-orange-500',
    activeLineClassName: 'bg-orange-400'
  },
  NO_FORNO: {
    label: 'No Forno',
    icon: 'pedidos',
    activeClassName: 'border-amber-300 bg-amber-100 text-amber-800',
    passedDotClassName: 'bg-amber-500',
    activeLineClassName: 'bg-amber-400'
  },
  PRONTA: {
    label: 'Pronta',
    icon: 'plus',
    activeClassName: 'border-emerald-300 bg-emerald-100 text-emerald-800',
    passedDotClassName: 'bg-emerald-500',
    activeLineClassName: 'bg-emerald-400'
  }
};

function toOrderWorkflowStatus(status?: string | null): OrderWorkflowStatus | null {
  if (!status) return null;
  return ORDER_WORKFLOW_STATUSES.includes(status as OrderWorkflowStatus)
    ? (status as OrderWorkflowStatus)
    : null;
}

function resolveAdjacentMassPrepWorkflowStatus(
  currentStatus: MassPrepEventStatus | null | undefined,
  direction: 'backward' | 'forward'
): MassPrepWorkflowStatus | null {
  if (!currentStatus) return null;

  const currentIndex = MASS_PREP_EVENT_STATUSES.indexOf(currentStatus);
  if (currentIndex < 0) return null;
  const candidateIndex = direction === 'forward' ? currentIndex + 1 : currentIndex - 1;
  const candidate = MASS_PREP_EVENT_STATUSES[candidateIndex];
  if (!candidate) return null;

  const allowedTransitions = massPrepEventStatusTransitions[currentStatus] || [];
  return allowedTransitions.includes(candidate) ? candidate : null;
}

type CalendarViewMode = 'DAY' | 'WEEK' | 'MONTH';

const calendarViewLabels: Record<CalendarViewMode, string> = {
  DAY: 'Dia',
  WEEK: 'Semana',
  MONTH: 'Mes'
};

type CalendarOrderEntry = {
  kind: 'ORDER' | 'MASS_PREP';
  order: OrderView;
  createdAt: Date;
  dateKey: string;
  massPrepEvent: MassPrepEvent | null;
};

type InventoryBalanceCard = {
  itemId: number;
  name: string;
  unit: string;
  category: string;
  balance: number;
};

type DayGridDragState = {
  pointerId: number;
  eventKey: string;
  orderId: number;
  previousScheduledAtIso: string | null;
  baseDate: Date;
  baseMinutes: number;
  previewMinutes: number;
  lane: number;
  height: number;
  startClientY: number;
};

type DayGridDragIntentState = {
  pointerId: number;
  eventKey: string;
  orderId: number;
  previousScheduledAtIso: string | null;
  baseDate: Date;
  baseMinutes: number;
  lane: number;
  height: number;
  target: HTMLButtonElement;
  startClientX: number;
  startClientY: number;
  holdTimeoutId: number;
};

type WeekGridDragState = {
  pointerId: number;
  eventKey: string;
  orderId: number;
  previousScheduledAtIso: string | null;
  entry: CalendarOrderEntry;
  sourceDateKey: string;
  previewDateKey: string;
  baseMinutes: number;
  previewMinutes: number;
  height: number;
  startClientY: number;
};

type WeekGridDragIntentState = {
  pointerId: number;
  eventKey: string;
  orderId: number;
  previousScheduledAtIso: string | null;
  entry: CalendarOrderEntry;
  sourceDateKey: string;
  baseMinutes: number;
  height: number;
  target: HTMLButtonElement;
  startClientX: number;
  startClientY: number;
  holdTimeoutId: number;
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
  return entry.kind === 'ORDER' && typeof orderId === 'number' && entry.order.id === orderId;
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
  const baseDuration = dayGridSnapMinutes;

  const entriesInsideGrid = entries
    .filter((entry) => {
      const minutes = minutesIntoDay(entry.createdAt);
      return minutes >= dayGridStartMinutes && minutes < dayGridEndMinutes;
    })
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

  let timelineSourceEntries = entriesInsideGrid.slice(0, WEEK_TIMELINE_MAX_VISIBLE_EVENTS);
  if (typeof forcedOrderId === 'number' && forcedOrderId > 0) {
    const alreadyVisible = timelineSourceEntries.some((entry) => isMatchingOrderEntry(entry, forcedOrderId));
    if (!alreadyVisible) {
      const forcedEntry = entriesInsideGrid.find((entry) => isMatchingOrderEntry(entry, forcedOrderId));
      if (forcedEntry) {
        timelineSourceEntries = [
          ...timelineSourceEntries.filter((entry) => !isMatchingOrderEntry(entry, forcedOrderId)).slice(0, Math.max(WEEK_TIMELINE_MAX_VISIBLE_EVENTS - 1, 0)),
          forcedEntry
        ].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      }
    }
  }

  const timelineEvents = buildTimelineLaneLayout(
    timelineSourceEntries.map((entry) => {
      const startMinutes = clampNumber(
        Math.round(minutesIntoDay(entry.createdAt) / dayGridSnapMinutes) * dayGridSnapMinutes,
        dayGridStartMinutes,
        dayGridEndMinutes - dayGridSnapMinutes
      );

      return {
        entry,
        startMinutes,
        endMinutes: startMinutes + baseDuration,
        top: Math.round((startMinutes - dayGridStartMinutes) * pixelsPerMinute),
        height: weekGridMinEventHeight
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
    return 'Cotacao do frete indisponivel. Revise os dados do cliente e atualize o frete.';
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
    return 'Frete ainda nao cotado.';
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
  if (status === 'PRONTA') return 'bg-emerald-500';
  if (status === 'NO_FORNO') return 'bg-amber-500';
  if (status === 'PREPARO') return 'bg-orange-400';
  if (status === 'INGREDIENTES') return 'bg-rose-500';
  if (status === 'ENTREGUE') return 'bg-emerald-500';
  if (status === 'CANCELADO') return 'bg-rose-500';
  if (status === 'PRONTO') return 'bg-sky-500';
  if (status === 'EM_PREPARACAO') return 'bg-orange-400';
  if (status === 'CONFIRMADO') return 'bg-amber-400';
  return 'bg-stone-400';
}

function calendarStatusEventSurfaceStyle(status: string): CSSProperties {
  if (status === 'PRONTA') {
    return {
      borderColor: 'rgba(16, 185, 129, 0.36)',
      backgroundColor: 'rgba(236, 253, 245, 0.9)'
    };
  }
  if (status === 'NO_FORNO') {
    return {
      borderColor: 'rgba(245, 158, 11, 0.34)',
      backgroundColor: 'rgba(255, 251, 235, 0.9)'
    };
  }
  if (status === 'PREPARO') {
    return {
      borderColor: 'rgba(251, 146, 60, 0.36)',
      backgroundColor: 'rgba(255, 247, 237, 0.9)'
    };
  }
  if (status === 'INGREDIENTES') {
    return {
      borderColor: 'rgba(244, 63, 94, 0.34)',
      backgroundColor: 'rgba(255, 241, 242, 0.9)'
    };
  }
  if (status === 'ENTREGUE') {
    return {
      borderColor: 'rgba(16, 185, 129, 0.36)',
      backgroundColor: 'rgba(236, 253, 245, 0.9)'
    };
  }
  if (status === 'CANCELADO') {
    return {
      borderColor: 'rgba(244, 63, 94, 0.34)',
      backgroundColor: 'rgba(255, 241, 242, 0.9)'
    };
  }
  if (status === 'PRONTO') {
    return {
      borderColor: 'rgba(14, 165, 233, 0.34)',
      backgroundColor: 'rgba(240, 249, 255, 0.9)'
    };
  }
  if (status === 'EM_PREPARACAO') {
    return {
      borderColor: 'rgba(251, 146, 60, 0.36)',
      backgroundColor: 'rgba(255, 247, 237, 0.9)'
    };
  }
  if (status === 'CONFIRMADO') {
    return {
      borderColor: 'rgba(245, 158, 11, 0.34)',
      backgroundColor: 'rgba(255, 251, 235, 0.9)'
    };
  }
  return {
    borderColor: 'rgba(120, 113, 108, 0.32)',
    backgroundColor: 'rgba(250, 250, 249, 0.9)'
  };
}

function calendarStatusRingClass(status: string) {
  if (status === 'PRONTA') return 'ring-emerald-300';
  if (status === 'NO_FORNO') return 'ring-amber-300';
  if (status === 'PREPARO') return 'ring-orange-300';
  if (status === 'INGREDIENTES') return 'ring-rose-300';
  if (status === 'ENTREGUE') return 'ring-emerald-300';
  if (status === 'CANCELADO') return 'ring-rose-300';
  if (status === 'PRONTO') return 'ring-sky-300';
  if (status === 'EM_PREPARACAO') return 'ring-orange-300';
  if (status === 'CONFIRMADO') return 'ring-amber-300';
  return 'ring-stone-300';
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

function calendarEntryBaseKey(entry: CalendarOrderEntry) {
  if (entry.kind === 'MASS_PREP' && entry.massPrepEvent?.id) {
    return `mass-${entry.massPrepEvent.id}`;
  }
  return `order-${entry.order.id ?? '-'}-${entry.createdAt.getTime()}`;
}

function buildInventoryBalanceMap(movements: InventoryMovement[]) {
  const ordered = [...movements].sort((left, right) => {
    const leftTime = safeDateFromIso(left.createdAt ?? null)?.getTime() ?? 0;
    const rightTime = safeDateFromIso(right.createdAt ?? null)?.getTime() ?? 0;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return (left.id ?? 0) - (right.id ?? 0);
  });

  const balanceByItem = new Map<number, number>();
  for (const movement of ordered) {
    const itemId = movement.itemId;
    if (!itemId) continue;
    const current = balanceByItem.get(itemId) || 0;
    if (movement.type === 'IN') {
      balanceByItem.set(itemId, roundInventoryQty(current + movement.quantity));
    } else if (movement.type === 'OUT') {
      balanceByItem.set(itemId, roundInventoryQty(current - movement.quantity));
    } else if (movement.type === 'ADJUST') {
      balanceByItem.set(itemId, roundInventoryQty(movement.quantity));
    }
  }
  return balanceByItem;
}

function buildInventoryBalanceCards(
  inventoryItems: InventoryItem[],
  inventoryMovements: InventoryMovement[]
) {
  const balanceByItem = buildInventoryBalanceMap(inventoryMovements);
  return inventoryItems
    .filter((item) => typeof item.id === 'number')
    .map((item) => ({
      itemId: item.id as number,
      name: item.name,
      unit: item.unit,
      category: item.category,
      balance: roundInventoryQty(balanceByItem.get(item.id as number) || 0)
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
}

function OrdersPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tutorialMode, isSpotlightSlot } = useTutorialSpotlight(searchParams, TUTORIAL_QUERY_VALUE);
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [massPrepEvents, setMassPrepEvents] = useState<MassPrepEvent[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderView | null>(null);
  const [isOrderDetailModalOpen, setIsOrderDetailModalOpen] = useState(false);
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
  const [newOrderCustomerId, setNewOrderCustomerId] = useState<number | ''>('');
  const [newOrderFulfillmentMode, setNewOrderFulfillmentMode] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY');
  const [customerSearch, setCustomerSearch] = useState('');
  const [newOrderItems, setNewOrderItems] = useState<Array<{ productId: number; quantity: number }>>([]);
  const [newOrderDiscount, setNewOrderDiscount] = useState<string>('0,00');
  const [newOrderNotes, setNewOrderNotes] = useState<string>('');
  const [newOrderScheduledAt, setNewOrderScheduledAt] = useState<string>(() => defaultOrderDateTimeInput());
  const [restoredLastOrderDraft, setRestoredLastOrderDraft] = useState<{
    customerId: number;
    customerName: string;
    orderId: number;
    referenceLabel: string;
  } | null>(null);
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
  const isOperationMode = true;
  const [dayGridDragState, setDayGridDragState] = useState<DayGridDragState | null>(null);
  const [weekGridDragState, setWeekGridDragState] = useState<WeekGridDragState | null>(null);
  const dayGridDragIntentRef = useRef<DayGridDragIntentState | null>(null);
  const weekGridDragIntentRef = useRef<WeekGridDragIntentState | null>(null);
  const dayGridSuppressClickRef = useRef<string | null>(null);
  const weekGridSuppressClickRef = useRef<string | null>(null);
  const dayGridScrollLockRef = useRef<{
    bodyOverflow: string;
    bodyTouchAction: string;
    htmlOverflow: string;
    htmlTouchAction: string;
    preventTouchMove: (event: TouchEvent) => void;
  } | null>(null);
  const weekGridCanvasByDateKeyRef = useRef(new Map<string, HTMLDivElement>());
  const [isStatusUpdatePending, setIsStatusUpdatePending] = useState(false);
  const [isMassPrepStockModalOpen, setIsMassPrepStockModalOpen] = useState(false);
  const [selectedMassPrepEvent, setSelectedMassPrepEvent] = useState<MassPrepEvent | null>(null);
  const [massPrepStockCards, setMassPrepStockCards] = useState<InventoryBalanceCard[]>([]);
  const [massPrepEditBalanceByItemId, setMassPrepEditBalanceByItemId] = useState<Record<number, string>>({});
  const [massPrepEditErrorByItemId, setMassPrepEditErrorByItemId] = useState<Record<number, string>>({});
  const [massPrepSavingItemId, setMassPrepSavingItemId] = useState<number | null>(null);
  const massPrepPendingActionItemIdsRef = useRef<Set<number>>(new Set());
  const [massPrepPrepareError, setMassPrepPrepareError] = useState<string | null>(null);
  const [isPreparingMassReady, setIsPreparingMassReady] = useState(false);
  const massPrepPrepareInFlightRef = useRef(false);
  const massPrepPrepareRequestKeyRef = useRef<string | null>(null);
  const [isUpdatingMassPrepStatus, setIsUpdatingMassPrepStatus] = useState(false);
  const [isDeletingMassPrepEvent, setIsDeletingMassPrepEvent] = useState(false);
  const [massPrepStockLoading, setMassPrepStockLoading] = useState(false);
  const [massPrepStockError, setMassPrepStockError] = useState<string | null>(null);
  const [selectedOrderEditScheduledAt, setSelectedOrderEditScheduledAt] = useState<string>('');
  const [selectedOrderEditNotes, setSelectedOrderEditNotes] = useState<string>('');
  const [selectedOrderEditError, setSelectedOrderEditError] = useState<string | null>(null);
  const [isSavingSelectedOrderEdit, setIsSavingSelectedOrderEdit] = useState(false);
  const [selectedOrderEditingBoxKey, setSelectedOrderEditingBoxKey] = useState<string | null>(null);
  const [selectedOrderEditingBoxDraftByProductId, setSelectedOrderEditingBoxDraftByProductId] = useState<
    Record<number, number>
  >({});
  const [selectedOrderEditingBoxError, setSelectedOrderEditingBoxError] = useState<string | null>(null);
  const [isSavingSelectedOrderEditingBox, setIsSavingSelectedOrderEditingBox] = useState(false);
  const [isDeletingSelectedOrderEditingBox, setIsDeletingSelectedOrderEditingBox] = useState(false);
  const newOrderQuoteRequestIdRef = useRef(0);
  const newOrderDialogRef = useRef<HTMLDivElement | null>(null);
  const orderDetailDialogRef = useRef<HTMLDivElement | null>(null);
  const massPrepDialogRef = useRef<HTMLDivElement | null>(null);
  const selectedOrderId = selectedOrder?.id ?? null;
  const selectedMassPrepEventId = selectedMassPrepEvent?.id ?? null;
  const newOrderTitleId = useId();
  const orderDetailTitleId = useId();
  const massPrepTitleId = useId();
  const { confirm, notifyError, notifySuccess, presentSuccess } = useFeedback();

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const {
        orders: ordersData,
        customers: customersData,
        products: productsData,
        massPrepEvents: massPrepEventsData
      } =
        await fetchOrdersWorkspace();
      setOrders(ordersData);
      setMassPrepEvents(massPrepEventsData);
      setCustomers(customersData);
      setProducts(productsData);
      if (selectedOrderId) {
        const fresh = ordersData.find((o) => o.id === selectedOrderId) || null;
        setSelectedOrder(fresh);
        if (!fresh) {
          setIsOrderDetailModalOpen(false);
        }
      }
      if (selectedMassPrepEventId) {
        const freshMassPrep = massPrepEventsData.find((entry) => entry.id === selectedMassPrepEventId) || null;
        setSelectedMassPrepEvent(freshMassPrep);
        if (!freshMassPrep) {
          setIsMassPrepStockModalOpen(false);
        }
      }
      return ordersData;
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Falha ao carregar dados de pedidos.');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [selectedMassPrepEventId, selectedOrderId]);

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
    setIsMassPrepStockModalOpen(false);
    setOrderError(null);
    setIsNewOrderModalOpen(true);
  }, []);

  const closeNewOrderModal = useCallback(() => {
    setIsNewOrderModalOpen(false);
    setOrderError(null);
  }, []);

  const closeMassPrepStockModal = useCallback(() => {
    setIsMassPrepStockModalOpen(false);
    setSelectedMassPrepEvent(null);
    setMassPrepEditBalanceByItemId({});
    setMassPrepEditErrorByItemId({});
    setMassPrepSavingItemId(null);
    setMassPrepPrepareError(null);
    setIsPreparingMassReady(false);
    setIsUpdatingMassPrepStatus(false);
    setIsDeletingMassPrepEvent(false);
    setMassPrepStockLoading(false);
    setMassPrepStockError(null);
    setMassPrepStockCards([]);
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

  useDialogA11y({
    isOpen: isMassPrepStockModalOpen,
    dialogRef: massPrepDialogRef,
    onClose: closeMassPrepStockModal
  });

  const loadMassPrepStockSnapshot = useCallback(async () => {
    const [inventoryItems, inventoryMovements] = await Promise.all([
      apiFetch<InventoryItem[]>('/inventory-items'),
      apiFetch<InventoryMovement[]>('/inventory-movements')
    ]);
    return buildInventoryBalanceCards(inventoryItems, inventoryMovements);
  }, []);

  const openMassPrepStockModal = useCallback(
    async (entry: CalendarOrderEntry) => {
      if (entry.kind !== 'MASS_PREP' || !entry.massPrepEvent) {
        return;
      }

      setSelectedOrder(entry.order);
      setIsOrderDetailModalOpen(false);
      setSelectedMassPrepEvent(entry.massPrepEvent);
      setIsMassPrepStockModalOpen(true);
      setMassPrepStockLoading(true);
      setMassPrepStockError(null);
      setMassPrepEditErrorByItemId({});
      setMassPrepSavingItemId(null);
      setMassPrepPrepareError(null);
      setIsPreparingMassReady(false);
      setIsUpdatingMassPrepStatus(false);
      setIsDeletingMassPrepEvent(false);

      try {
        const cards = await loadMassPrepStockSnapshot();
        setMassPrepStockCards(cards);
        setMassPrepEditBalanceByItemId(
          Object.fromEntries(
            cards.map((card) => [card.itemId, formatInventoryBalanceInput(card.balance)])
          )
        );
      } catch (err) {
        setMassPrepStockCards([]);
        setMassPrepEditBalanceByItemId({});
        setMassPrepStockError(err instanceof Error ? err.message : 'Nao foi possivel carregar o saldo de estoque.');
      } finally {
        setMassPrepStockLoading(false);
      }
    },
    [loadMassPrepStockSnapshot]
  );

  const saveMassPrepItemBalance = useCallback(
    async (itemId: number) => {
      if (massPrepPendingActionItemIdsRef.current.has(itemId)) return;

      const rawValue = massPrepEditBalanceByItemId[itemId];
      const parsedValue = parseLocaleNumber(rawValue);
      if (parsedValue == null || !Number.isFinite(parsedValue)) {
        setMassPrepEditErrorByItemId((current) => ({
          ...current,
          [itemId]: 'Informe um saldo valido.'
        }));
        return;
      }

      const currentCard = massPrepStockCards.find((card) => card.itemId === itemId);
      if (!currentCard) return;

      const normalizedCurrent = roundInventoryQty(currentCard.balance);
      const normalizedNext = roundInventoryQty(parsedValue);
      if (Math.abs(normalizedCurrent - normalizedNext) < 0.0001) {
        setMassPrepEditBalanceByItemId((current) => ({
          ...current,
          [itemId]: formatInventoryBalanceInput(currentCard.balance)
        }));
        setMassPrepEditErrorByItemId((current) => ({
          ...current,
          [itemId]: ''
        }));
        return;
      }

      const delta = roundInventoryQty(normalizedNext - normalizedCurrent);
      const deltaAbs = roundInventoryQty(Math.abs(delta));
      const movementLabel = delta > 0 ? 'entrada' : 'saida';

      massPrepPendingActionItemIdsRef.current.add(itemId);
      try {
        const accepted = await confirm({
          title: delta > 0 ? 'Confirmar entrada?' : 'Confirmar saida?',
          description: `Saldo: ${formatInventoryBalance(normalizedCurrent)} ${currentCard.unit}. Vai para ${formatInventoryBalance(
            normalizedNext
          )} ${currentCard.unit}. Registra ${movementLabel} de ${formatInventoryBalance(deltaAbs)} ${
            currentCard.unit
          } em ${currentCard.name}.`,
          confirmLabel: delta > 0 ? 'Confirmar entrada' : 'Confirmar saida',
          cancelLabel: 'Cancelar'
        });
        if (!accepted) {
          setMassPrepEditBalanceByItemId((current) => ({
            ...current,
            [itemId]: formatInventoryBalanceInput(currentCard.balance)
          }));
          setMassPrepEditErrorByItemId((current) => ({
            ...current,
            [itemId]: ''
          }));
          return;
        }

        setMassPrepSavingItemId(itemId);
        setMassPrepEditErrorByItemId((current) => ({
          ...current,
          [itemId]: ''
        }));

        await apiFetch(`/inventory-items/${itemId}/effective-balance`, {
          method: 'POST',
          body: JSON.stringify({
            quantity: normalizedNext,
            reason: `Ajuste manual via pop-up FAZER MASSA (${formatInventoryBalance(
              normalizedCurrent
            )} -> ${formatInventoryBalance(normalizedNext)} ${currentCard.unit})`
          })
        });

        const refreshedCards = await loadMassPrepStockSnapshot();
        setMassPrepStockCards(refreshedCards);
        setMassPrepEditBalanceByItemId(
          Object.fromEntries(
            refreshedCards.map((card) => [card.itemId, formatInventoryBalanceInput(card.balance)])
          )
        );
        notifySuccess(
          `${delta > 0 ? 'Entrada' : 'Saida'} registrada: ${formatInventoryBalance(deltaAbs)} ${currentCard.unit} em ${currentCard.name}.`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Nao foi possivel salvar o saldo deste item.';
        setMassPrepEditErrorByItemId((current) => ({
          ...current,
          [itemId]: message
        }));
        notifyError(message);
      } finally {
        massPrepPendingActionItemIdsRef.current.delete(itemId);
        setMassPrepSavingItemId(null);
      }
    },
    [confirm, loadMassPrepStockSnapshot, massPrepEditBalanceByItemId, massPrepStockCards, notifyError, notifySuccess]
  );

  const removeSelectedMassPrepEvent = useCallback(async () => {
    const orderId = selectedMassPrepEvent?.orderId;
    if (!orderId) return;

    const accepted = await confirm({
      title: 'Excluir FAZER MASSA?',
      description: 'O pedido continua. So o evento sera removido.',
      confirmLabel: 'Excluir evento',
      cancelLabel: 'Cancelar',
      danger: true
    });
    if (!accepted) return;

    setIsDeletingMassPrepEvent(true);
    try {
      await apiFetch(`/orders/${orderId}/mass-prep-event`, { method: 'DELETE' });
      closeMassPrepStockModal();
      await loadAll();
      notifySuccess('FAZER MASSA excluido.');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel excluir FAZER MASSA.');
    } finally {
      setIsDeletingMassPrepEvent(false);
    }
  }, [closeMassPrepStockModal, confirm, loadAll, notifyError, notifySuccess, selectedMassPrepEvent]);

  const updateSelectedMassPrepEventStatus = useCallback(
    async (nextStatus: MassPrepEventStatus) => {
      if (!selectedMassPrepEvent) return;
      if (selectedMassPrepEvent.status === nextStatus) return;

      setIsUpdatingMassPrepStatus(true);
      setMassPrepPrepareError(null);
      try {
        const updatedEvent = await apiFetch<MassPrepEvent>(
          `/orders/${selectedMassPrepEvent.orderId}/mass-prep-event/status`,
          {
            method: 'PATCH',
            body: JSON.stringify({ status: nextStatus })
          }
        );
        setSelectedMassPrepEvent(updatedEvent);
        await loadAll();
        notifySuccess(`FAZER MASSA: ${formatMassPrepStatus(nextStatus)}.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Nao foi possivel atualizar FAZER MASSA.';
        setMassPrepPrepareError(message);
        notifyError(message);
      } finally {
        setIsUpdatingMassPrepStatus(false);
      }
    },
    [loadAll, notifyError, notifySuccess, selectedMassPrepEvent]
  );

  const openCalendarEntry = useCallback(
    (entry: CalendarOrderEntry) => {
      if (entry.kind === 'MASS_PREP') {
        void openMassPrepStockModal(entry);
        return;
      }
      openOrderDetail(entry.order);
    },
    [openMassPrepStockModal, openOrderDetail]
  );

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
    setSelectedOrderEditNotes(selectedOrder.notes ?? '');
    setSelectedOrderEditError(null);
  }, [isOrderDetailModalOpen, selectedOrder]);

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
    setNewOrderFulfillmentMode('DELIVERY');
    setCustomerSearch('');
    setNewOrderItems([]);
    setNewOrderDiscount('0,00');
    setNewOrderNotes(tutorialMode ? withTestDataTag('', 'Pedido do momento') : '');
    setNewOrderScheduledAt(defaultOrderDateTimeInput());
    setRestoredLastOrderDraft(null);
    setNewOrderDeliveryQuote(null);
    setNewOrderDeliveryQuoteError(null);
    setOrderError(null);
  };

  const createOrder = async () => {
    if (isCreatingOrder) return;
    if (!newOrderCustomerId || newOrderItems.length === 0) {
      setOrderError('Selecione cliente e caixa.');
      return;
    }
    if (!newOrderScheduledAtDate) {
      setOrderError('Informe data e hora.');
      return;
    }
    if (draftDiscount < 0) {
      setOrderError('Desconto nao pode ser negativo.');
      return;
    }
    if (isQuotingNewOrderDelivery) {
      setOrderError('Aguarde a cotacao do frete terminar.');
      return;
    }
    if (newOrderFulfillmentMode === 'DELIVERY' && !newOrderDeliveryQuote) {
      setOrderError(newOrderDeliveryQuoteError || 'A estimativa de frete e obrigatoria para criar.');
      return;
    }
    setOrderError(null);
    setIsCreatingOrder(true);
    try {
      const payload: OrderIntake = {
        version: 1,
        intent: 'CONFIRMED',
        customer: {
          customerId: Number(newOrderCustomerId)
        },
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
          discount: parseCurrencyBR(newOrderDiscount),
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
        throw new Error('Pedido criado sem identificador valido.');
      }
      setNewOrderCustomerId('');
      setNewOrderFulfillmentMode('DELIVERY');
      setCustomerSearch('');
      setNewOrderItems([]);
      setNewOrderDiscount('0,00');
      setNewOrderNotes(tutorialMode ? withTestDataTag('', 'Pedido do momento') : '');
      setNewOrderScheduledAt(defaultOrderDateTimeInput());
      setRestoredLastOrderDraft(null);
      setNewOrderDeliveryQuote(null);
      setNewOrderDeliveryQuoteError(null);
      setIsNewOrderModalOpen(false);
      writeStoredOrderFinalized({
        version: 1,
        origin: 'INTERNAL_DASHBOARD',
        savedAt: new Date().toISOString(),
        returnPath: '/pedidos',
        returnLabel: 'Voltar para pedidos',
        productSubtotal: Math.max(roundMoney((createdOrder.total || 0) - (created.intake.deliveryFee || 0)), 0),
        order: {
          id: createdOrder.id,
          publicNumber: createdOrder.publicNumber ?? null,
          total: createdOrder.total ?? null,
          scheduledAt: createdOrder.scheduledAt ?? null
        },
        intake: {
          stage: created.intake.stage,
          deliveryFee: created.intake.deliveryFee,
          pixCharge: created.intake.pixCharge
        }
      });
      await loadAll();
      router.push('/pedidofinalizado');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nao foi possivel criar.';
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
      setSelectedOrder(null);
      setIsOrderDetailModalOpen(false);
      await loadAll();
      notifySuccess('Pedido excluido.');
      scrollToLayoutSlot('list');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel excluir.');
    }
  };

  const updateStatus = async (orderId: number, status: string) => {
    if (isStatusUpdatePending) return;
    setIsStatusUpdatePending(true);
    try {
      const currentOrder = orders.find((entry) => entry.id === orderId) ?? selectedOrder;
      await apiFetch(`/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await loadAll();
      if (status === 'ENTREGUE') {
        presentSuccess('Pedido finalizado e movido para entregue.', `Pedido #${displayOrderNumber(currentOrder)}`);
      } else {
        notifySuccess(`Status atualizado para ${formatDisplayedOrderStatus(status)}.`);
      }
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel atualizar o status.');
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
      await apiFetch(`/orders/${orderId}/mark-paid`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      const refreshedOrders = await loadAll();
      const freshSelected = refreshedOrders.find((entry) => entry.id === orderId) || null;
      if (freshSelected && selectedOrder?.id === orderId) {
        setSelectedOrder(freshSelected);
      }
      notifySuccess(
        shouldMarkPaid
          ? `Pagamento confirmado para o pedido #${displayOrderNumber(currentOrder)}.`
          : `Pedido #${displayOrderNumber(currentOrder)} marcado como nao pago.`
      );
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel atualizar o pagamento.');
    } finally {
      setIsStatusUpdatePending(false);
    }
  };

  const applyLocalOrderSchedule = (orderId: number, scheduledAtIso: string | null) => {
    setOrders((current) =>
      current.map((order) => (order.id === orderId ? { ...order, scheduledAt: scheduledAtIso } : order))
    );
    setSelectedOrder((current) =>
      current?.id === orderId ? { ...current, scheduledAt: scheduledAtIso } : current
    );
  };

  const persistOrderSchedule = async (
    orderId: number,
    nextDate: Date,
    options: {
      previousScheduledAtIso: string | null;
      notifyOnSuccess?: boolean;
    }
  ) => {
    const { previousScheduledAtIso, notifyOnSuccess = true } = options;
    const nextScheduledAtIso = nextDate.toISOString();

    applyLocalOrderSchedule(orderId, nextScheduledAtIso);

    try {
      await apiFetch(`/orders/${orderId}`, {
        method: 'PUT',
        body: JSON.stringify({ scheduledAt: nextScheduledAtIso }),
      });
      await loadAll();
      if (notifyOnSuccess) {
        notifySuccess('Data atualizada.');
      }
      return true;
    } catch (err) {
      applyLocalOrderSchedule(orderId, previousScheduledAtIso);
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel atualizar a data.');
      return false;
    }
  };

  const productMap = useMemo(() => {
    return new Map(products.map((p) => [p.id!, p]));
  }, [products]);
  const orderableProducts = useMemo(() => {
    const canonical = products.filter((product) => {
      const normalizedName = normalizeTextForSort(product.name);
      const normalizedCategory = normalizeTextForSort(product.category);
      return product.active !== false && normalizedCategory === 'sabores' && normalizedName.startsWith('broa ');
    });

    if (canonical.length > 0) {
      return sortQuickCreateProducts(canonical);
    }

    return sortQuickCreateProducts(products.filter((product) => product.active !== false));
  }, [products]);
  const runtimeOrderCatalog = useMemo(
    () => buildRuntimeOrderCatalog(orderableProducts.length > 0 ? orderableProducts : products),
    [orderableProducts, products]
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

  const customerOptions = useMemo(
    () =>
      customers
        .filter((customer) => !customer.deletedAt)
        .map((c) => ({ id: c.id!, label: `${c.name} (#${c.id})` })),
    [customers]
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
    for (const customer of customers) {
      if (customer.id) {
        map.set(customer.id, customer);
      }
    }
    for (const order of orders) {
      const customer = order.customer;
      if (customer?.id && !map.has(customer.id)) {
        map.set(customer.id, customer);
      }
    }
    return map;
  }, [customers, orders]);

  const resolveCustomerName = useCallback(
    (order: OrderView) => {
      const candidate = customerMap.get(order.customerId) ?? order.customer;
      if (!candidate) return 'Sem cliente';
      const baseName = candidate.name || 'Cliente';
      return candidate.deletedAt ? `${baseName} (excluído)` : baseName;
    },
    [customerMap]
  );
  const latestOrderDraftByCustomerId = useMemo(() => {
    const map = new Map<number, CustomerLastOrderDraft>();

    for (const order of orders) {
      const customerId = Number(order.customerId || 0);
      if (!Number.isFinite(customerId) || customerId <= 0) continue;

      const items = normalizeDraftOrderItems(order.items);
      if (items.length === 0) continue;

      const referenceDate = resolveOrderDate(order);
      const referenceTime = referenceDate?.getTime() ?? 0;
      const current = map.get(customerId);
      if (
        current &&
        (current.referenceTime > referenceTime ||
          (current.referenceTime === referenceTime && current.orderId >= (order.id ?? 0)))
      ) {
        continue;
      }

      const fallbackCustomer = customerMap.get(customerId) || order.customer || null;
      const customerName =
        customerMap.get(customerId)?.name ||
        order.customer?.name ||
        `Cliente #${displayCustomerNumber(fallbackCustomer)}`;
      map.set(customerId, {
        customerId,
        customerName,
        orderId: order.id ?? 0,
        referenceLabel: formatOrderDateTimeLabel(referenceDate),
        referenceTime,
        fulfillmentMode: order.fulfillmentMode === 'PICKUP' ? 'PICKUP' : 'DELIVERY',
        items,
        discount: typeof order.discount === 'number' ? order.discount : 0,
        notes: order.notes || ''
      });
    }

    return map;
  }, [customerMap, orders]);

  const resolveCalendarEntryCompactName = useCallback(
    (entry: CalendarOrderEntry) => {
      if (entry.kind === 'MASS_PREP') return MASS_PREP_EVENT_NAME;
      return compactCustomerLabelForCalendar(resolveCustomerName(entry.order));
    },
    [resolveCustomerName]
  );
  const resolveCalendarEntryGridLabel = useCallback(
    (entry: CalendarOrderEntry) => {
      const customer = customerMap.get(entry.order.customerId) ?? entry.order.customer ?? null;
      const customerName = resolveCustomerName(entry.order);
      const customerAddress = formatCustomerFullAddress(customer) || 'Endereco nao informado';

      if (entry.kind === 'MASS_PREP') {
        return `${MASS_PREP_EVENT_NAME} • ${customerName} • ${customerAddress}`;
      }

      return `${customerName} • ${customerAddress}`;
    },
    [customerMap, resolveCustomerName]
  );

  const resolveCalendarEntryStatus = useCallback((entry: CalendarOrderEntry) => {
    if (entry.kind === 'MASS_PREP') {
      return entry.massPrepEvent?.status || 'INGREDIENTES';
    }
    return entry.order.status || '';
  }, []);

  const visibleOrders = useMemo(() => {
    if (!isOperationMode) return orders;
    return orders.filter((order) => order.status !== 'CANCELADO');
  }, [orders, isOperationMode]);

  const sortedVisibleOrderList = useMemo(() => {
    return [...visibleOrders].sort((a, b) => {
      const aDeliveryAt = resolveOrderDate(a) ?? safeDateFromIso(a.createdAt ?? null) ?? new Date(0);
      const bDeliveryAt = resolveOrderDate(b) ?? safeDateFromIso(b.createdAt ?? null) ?? new Date(0);
      const deliveryDiff = bDeliveryAt.getTime() - aDeliveryAt.getTime();
      if (deliveryDiff !== 0) return deliveryDiff;

      const aCreatedAt = safeDateFromIso(a.createdAt ?? null) ?? new Date(0);
      const bCreatedAt = safeDateFromIso(b.createdAt ?? null) ?? new Date(0);
      const createdDiff = bCreatedAt.getTime() - aCreatedAt.getTime();
      if (createdDiff !== 0) return createdDiff;

      return (b.id ?? 0) - (a.id ?? 0);
    });
  }, [visibleOrders]);

  const calendarEntries = useMemo<CalendarOrderEntry[]>(() => {
    const orderEntries = visibleOrders
      .map((order) => {
        const createdAt = resolveOrderDate(order) || new Date();
        return {
          kind: 'ORDER' as const,
          order,
          createdAt,
          dateKey: dateKeyFromDate(startOfLocalDay(createdAt)),
          massPrepEvent: null
        };
      });

    const visibleOrderById = new Map<number, OrderView>();
    for (const order of visibleOrders) {
      if (order.id) {
        visibleOrderById.set(order.id, order);
      }
    }

    const massPrepEntries: CalendarOrderEntry[] = [];
    for (const event of massPrepEvents) {
      const linkedOrder = visibleOrderById.get(event.orderId);
      if (!linkedOrder) continue;
      const createdAt = safeDateFromIso(event.startsAt);
      if (!createdAt) continue;
      massPrepEntries.push({
        kind: 'MASS_PREP',
        order: linkedOrder,
        createdAt,
        dateKey: dateKeyFromDate(startOfLocalDay(createdAt)),
        massPrepEvent: event
      });
    }

    return [...orderEntries, ...massPrepEntries]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }, [massPrepEvents, visibleOrders]);

  const calendarOrdersByDate = useMemo(() => {
    const grouped = new Map<string, CalendarOrderEntry[]>();
    for (const entry of calendarEntries) {
      const bucket = grouped.get(entry.dateKey) || [];
      bucket.push(entry);
      grouped.set(entry.dateKey, bucket);
    }
    return grouped;
  }, [calendarEntries]);

  const todayDateKey = dateKeyFromDate(new Date());
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

  const selectedDateEntries = useMemo(() => {
    const entries = calendarOrdersByDate.get(selectedCalendarDateKey) || [];
    return [...entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }, [calendarOrdersByDate, selectedCalendarDateKey]);
  const selectedDateProductionSummary = useMemo(() => {
    const byCustomer = new Map<
      string,
      {
        customerLabel: string;
        flavorCounts: Map<number, { label: string; quantity: number }>;
      }
    >();

    for (const entry of selectedDateEntries) {
      if (entry.kind !== 'ORDER') continue;

      const customerName = resolveCustomerName(entry.order);
      const customerKey = entry.order.customerId
        ? `customer:${entry.order.customerId}`
        : `name:${normalizeTextForSort(customerName) || 'sem-cliente'}`;
      const current = byCustomer.get(customerKey) || {
        customerLabel: compactCustomerLabelForCalendar(customerName),
        flavorCounts: new Map<number, { label: string; quantity: number }>()
      };

      for (const item of entry.order.items || []) {
        const quantity = Math.max(Math.floor(item.quantity || 0), 0);
        if (quantity <= 0) continue;

        const label = compactOrderProductName(productMap.get(item.productId)?.name ?? `Produto ${item.productId}`);
        const existing = current.flavorCounts.get(item.productId) || {
          label,
          quantity: 0
        };
        existing.quantity += quantity;
        current.flavorCounts.set(item.productId, existing);
      }

      byCustomer.set(customerKey, current);
    }

    return Array.from(byCustomer.values()).map((entry) => ({
      customerLabel: entry.customerLabel,
      flavorSummary:
        Array.from(entry.flavorCounts.entries())
          .map(([productId, flavor]) => ({
            productId,
            label: flavor.label,
            quantity: flavor.quantity,
            product: productMap.get(productId) || null
          }))
          .sort((left, right) => {
            const leftProduct = left.product;
            const rightProduct = right.product;
            if (leftProduct && rightProduct) {
              const rankDiff = quickCreateProductRank(leftProduct) - quickCreateProductRank(rightProduct);
              if (rankDiff !== 0) return rankDiff;
            }
            return left.label.localeCompare(right.label, 'pt-BR');
          })
          .map((flavor) => `${flavor.label} - ${flavor.quantity.toLocaleString('pt-BR')}`)
          .join(' • ') || 'Sem sabores mapeados'
    }));
  }, [productMap, resolveCustomerName, selectedDateEntries]);

  const monthCells = useMemo(() => {
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
  }, [calendarAnchorDate, calendarOrdersByDate, selectedCalendarDateKey, todayDateKey]);

  const weekCells = useMemo(() => {
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
  }, [calendarAnchorDate, calendarOrdersByDate, selectedCalendarDateKey, todayDateKey]);
  const weekDateByKey = useMemo(
    () => new Map(weekCells.map((cell) => [cell.key, cell.date] as const)),
    [weekCells]
  );

  const dayHourSlots = useMemo(() => Array.from({ length: 14 }, (_, index) => index + 8), []);
  const dayGridStartMinutes = (dayHourSlots[0] ?? 0) * 60;
  const dayGridEndMinutes = ((dayHourSlots[dayHourSlots.length - 1] ?? 23) + 1) * 60;
  const dayGridDurationMinutes = Math.max(dayGridEndMinutes - dayGridStartMinutes, 60);
  const dayGridPixelsPerHour = 40;
  const dayGridSnapMinutes = 30;
  const dayGridDragHoldMs = 200;
  const dayGridDragStartDistancePx = 8;
  const dayGridHeight = Math.round((dayGridDurationMinutes / 60) * dayGridPixelsPerHour);
  const dayGridLineSlots = useMemo(
    () =>
      Array.from(
        { length: Math.floor(dayGridDurationMinutes / dayGridSnapMinutes) },
        (_, index) => dayGridStartMinutes + index * dayGridSnapMinutes
      ),
    [dayGridDurationMinutes, dayGridSnapMinutes, dayGridStartMinutes]
  );
  const selectedDateEntriesInsideGrid = useMemo(() => {
    return selectedDateEntries.filter((entry) => {
      const minutes = minutesIntoDay(entry.createdAt);
      return minutes >= dayGridStartMinutes && minutes < dayGridEndMinutes;
    });
  }, [dayGridEndMinutes, dayGridStartMinutes, selectedDateEntries]);
  const selectedDateOverflowEntries = useMemo(() => {
    return selectedDateEntries.filter((entry) => {
      const minutes = minutesIntoDay(entry.createdAt);
      return minutes < dayGridStartMinutes || minutes >= dayGridEndMinutes;
    });
  }, [dayGridEndMinutes, dayGridStartMinutes, selectedDateEntries]);
  const selectedDateTimelineEvents = useMemo(() => {
    const pixelsPerMinute = dayGridHeight / dayGridDurationMinutes;
    const baseDuration = dayGridSnapMinutes;
    const minCardHeight = Math.max(Math.round(baseDuration * pixelsPerMinute), 42);

    const timelineItems = selectedDateEntriesInsideGrid.map((entry) => {
      const startMinutes = clampNumber(
        Math.round(minutesIntoDay(entry.createdAt) / dayGridSnapMinutes) * dayGridSnapMinutes,
        dayGridStartMinutes,
        dayGridEndMinutes - dayGridSnapMinutes
      );

      return {
        entry,
        startMinutes,
        endMinutes: startMinutes + baseDuration,
        top: Math.round((startMinutes - dayGridStartMinutes) * pixelsPerMinute),
        height: minCardHeight
      };
    });

    return buildTimelineLaneLayout(timelineItems);
  }, [
    dayGridDurationMinutes,
    dayGridEndMinutes,
    dayGridHeight,
    dayGridSnapMinutes,
    dayGridStartMinutes,
    selectedDateEntriesInsideGrid
  ]);
  const dayTimelineLaneCount = useMemo(
    () =>
      Math.max(
        selectedDateTimelineEvents.reduce((max, item) => Math.max(max, item.laneCount), 0),
        1
      ),
    [selectedDateTimelineEvents]
  );
  const weekGridHeight = Math.max(Math.round(dayGridHeight * 0.58), 320);
  const weekGridMinEventHeight = 30;
  const weekGridLineOffsets = useMemo(
    () =>
      dayGridLineSlots.map((minutes) =>
        Math.round(((minutes - dayGridStartMinutes) / dayGridDurationMinutes) * weekGridHeight)
      ),
    [dayGridDurationMinutes, dayGridLineSlots, dayGridStartMinutes, weekGridHeight]
  );
  const weekTimelineCells = useMemo(() => {
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

  const handleDayGridEventClick = (entry: CalendarOrderEntry, eventKey: string) => {
    if (dayGridSuppressClickRef.current === eventKey) {
      dayGridSuppressClickRef.current = null;
      return;
    }
    openCalendarEntry(entry);
  };

  const handleWeekGridEventClick = (entry: CalendarOrderEntry, eventKey: string) => {
    if (weekGridSuppressClickRef.current === eventKey) {
      weekGridSuppressClickRef.current = null;
      return;
    }
    openCalendarEntry(entry);
  };

  const lockDayGridScroll = useCallback(() => {
    if (typeof document === 'undefined' || dayGridScrollLockRef.current) return;
    const body = document.body;
    const html = document.documentElement;
    const preventTouchMove = (event: TouchEvent) => {
      event.preventDefault();
    };
    dayGridScrollLockRef.current = {
      bodyOverflow: body.style.overflow,
      bodyTouchAction: body.style.touchAction,
      htmlOverflow: html.style.overflow,
      htmlTouchAction: html.style.touchAction,
      preventTouchMove
    };
    body.style.overflow = 'hidden';
    body.style.touchAction = 'none';
    html.style.overflow = 'hidden';
    html.style.touchAction = 'none';
    document.addEventListener('touchmove', preventTouchMove, { passive: false, capture: true });
  }, []);

  const unlockDayGridScroll = useCallback(() => {
    if (typeof document === 'undefined' || !dayGridScrollLockRef.current) return;
    const body = document.body;
    const html = document.documentElement;
    document.removeEventListener('touchmove', dayGridScrollLockRef.current.preventTouchMove, true);
    body.style.overflow = dayGridScrollLockRef.current.bodyOverflow;
    body.style.touchAction = dayGridScrollLockRef.current.bodyTouchAction;
    html.style.overflow = dayGridScrollLockRef.current.htmlOverflow;
    html.style.touchAction = dayGridScrollLockRef.current.htmlTouchAction;
    dayGridScrollLockRef.current = null;
  }, []);

  const activateDayGridDrag = useCallback(
    (intent: DayGridDragIntentState) => {
      if (dayGridDragIntentRef.current?.pointerId !== intent.pointerId) return;
      if (intent.target.isConnected) {
        intent.target.setPointerCapture(intent.pointerId);
      }
      lockDayGridScroll();
      setDayGridDragState({
        pointerId: intent.pointerId,
        eventKey: intent.eventKey,
        orderId: intent.orderId,
        previousScheduledAtIso: intent.previousScheduledAtIso,
        baseDate: intent.baseDate,
        baseMinutes: intent.baseMinutes,
        previewMinutes: intent.baseMinutes,
        lane: intent.lane,
        height: intent.height,
        startClientY: intent.startClientY
      });
      dayGridDragIntentRef.current = null;
    },
    [lockDayGridScroll]
  );

  const activateWeekGridDrag = useCallback(
    (intent: WeekGridDragIntentState) => {
      if (weekGridDragIntentRef.current?.pointerId !== intent.pointerId) return;
      if (intent.target.isConnected) {
        intent.target.setPointerCapture(intent.pointerId);
      }
      lockDayGridScroll();
      setWeekGridDragState({
        pointerId: intent.pointerId,
        eventKey: intent.eventKey,
        orderId: intent.orderId,
        previousScheduledAtIso: intent.previousScheduledAtIso,
        entry: intent.entry,
        sourceDateKey: intent.sourceDateKey,
        previewDateKey: intent.sourceDateKey,
        baseMinutes: intent.baseMinutes,
        previewMinutes: intent.baseMinutes,
        height: intent.height,
        startClientY: intent.startClientY
      });
      weekGridDragIntentRef.current = null;
    },
    [lockDayGridScroll]
  );

  useEffect(() => {
    return () => {
      if (dayGridDragIntentRef.current) {
        window.clearTimeout(dayGridDragIntentRef.current.holdTimeoutId);
        dayGridDragIntentRef.current = null;
      }
      if (weekGridDragIntentRef.current) {
        window.clearTimeout(weekGridDragIntentRef.current.holdTimeoutId);
        weekGridDragIntentRef.current = null;
      }
      unlockDayGridScroll();
    };
  }, [unlockDayGridScroll]);

  const registerWeekGridCanvas = useCallback((dateKey: string, element: HTMLDivElement | null) => {
    if (element) {
      weekGridCanvasByDateKeyRef.current.set(dateKey, element);
      return;
    }
    weekGridCanvasByDateKeyRef.current.delete(dateKey);
  }, []);

  const resolveWeekGridPreviewPosition = useCallback(
    (clientX: number, clientY: number, fallbackDateKey: string) => {
      if (typeof document === 'undefined') return null;
      const target = document.elementFromPoint(clientX, clientY);
      const targetDay = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-week-grid-date-key]') : null;
      const nextDateKey = targetDay?.dataset.weekGridDateKey || fallbackDateKey;
      const targetDate = weekDateByKey.get(nextDateKey);
      const canvas = weekGridCanvasByDateKeyRef.current.get(nextDateKey);
      if (!targetDate || !canvas) return null;

      const rect = canvas.getBoundingClientRect();
      const relativeY = clampNumber(clientY - rect.top, 0, rect.height);
      const rawMinutes =
        dayGridStartMinutes + (relativeY / Math.max(rect.height, 1)) * dayGridDurationMinutes;
      const previewMinutes = clampNumber(
        Math.round(rawMinutes / dayGridSnapMinutes) * dayGridSnapMinutes,
        dayGridStartMinutes,
        dayGridEndMinutes - dayGridSnapMinutes
      );

      return {
        previewDateKey: nextDateKey,
        previewMinutes
      };
    },
    [
      dayGridDurationMinutes,
      dayGridEndMinutes,
      dayGridSnapMinutes,
      dayGridStartMinutes,
      weekDateByKey
    ]
  );

  const handleDayGridEventPointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    item: { entry: CalendarOrderEntry; lane: number; height: number }
  ) => {
    if (!event.isPrimary) return;
    if (item.entry.kind !== 'ORDER') return;
    const orderId = item.entry.order.id;
    if (!orderId) return;

    const baseMinutes = clampNumber(
      Math.round(minutesIntoDay(item.entry.createdAt) / dayGridSnapMinutes) * dayGridSnapMinutes,
      dayGridStartMinutes,
      dayGridEndMinutes - dayGridSnapMinutes
    );

    if (dayGridDragIntentRef.current) {
      window.clearTimeout(dayGridDragIntentRef.current.holdTimeoutId);
      dayGridDragIntentRef.current = null;
    }
    dayGridSuppressClickRef.current = null;
    const intent: DayGridDragIntentState = {
      pointerId: event.pointerId,
      eventKey: `timeline-${calendarEntryBaseKey(item.entry)}`,
      orderId,
      previousScheduledAtIso: item.entry.order.scheduledAt ?? null,
      baseDate: item.entry.createdAt,
      baseMinutes,
      lane: item.lane,
      height: item.height,
      target: event.currentTarget,
      startClientX: event.clientX,
      startClientY: event.clientY,
      holdTimeoutId: 0
    };
    intent.holdTimeoutId = window.setTimeout(() => activateDayGridDrag(intent), dayGridDragHoldMs);
    dayGridDragIntentRef.current = intent;
  };

  const handleDayGridEventPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const activeDrag = dayGridDragState;
    if (activeDrag && event.pointerId === activeDrag.pointerId) {
      event.preventDefault();
      const pixelsPerMinute = dayGridHeight / dayGridDurationMinutes;
      const rawDeltaMinutes = (event.clientY - activeDrag.startClientY) / pixelsPerMinute;
      const snappedDeltaMinutes =
        Math.round(rawDeltaMinutes / dayGridSnapMinutes) * dayGridSnapMinutes;
      const nextMinutes = clampNumber(
        activeDrag.baseMinutes + snappedDeltaMinutes,
        dayGridStartMinutes,
        dayGridEndMinutes - dayGridSnapMinutes
      );

      if (nextMinutes === activeDrag.previewMinutes) return;

      setDayGridDragState((current) =>
        current ? { ...current, previewMinutes: nextMinutes } : current
      );
      return;
    }

    const intent = dayGridDragIntentRef.current;
    if (!intent || event.pointerId !== intent.pointerId) return;

    const distanceX = Math.abs(event.clientX - intent.startClientX);
    const distanceY = Math.abs(event.clientY - intent.startClientY);
    if (Math.max(distanceX, distanceY) < dayGridDragStartDistancePx) return;

    window.clearTimeout(intent.holdTimeoutId);
    dayGridDragIntentRef.current = null;
  };

  const handleWeekGridEventPointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    cell: { key: string },
    item: { entry: CalendarOrderEntry; height: number }
  ) => {
    if (!event.isPrimary) return;
    if (item.entry.kind !== 'ORDER') return;
    const orderId = item.entry.order.id;
    if (!orderId) return;

    const baseMinutes = clampNumber(
      Math.round(minutesIntoDay(item.entry.createdAt) / dayGridSnapMinutes) * dayGridSnapMinutes,
      dayGridStartMinutes,
      dayGridEndMinutes - dayGridSnapMinutes
    );

    if (weekGridDragIntentRef.current) {
      window.clearTimeout(weekGridDragIntentRef.current.holdTimeoutId);
      weekGridDragIntentRef.current = null;
    }
    weekGridSuppressClickRef.current = null;
    const intent: WeekGridDragIntentState = {
      pointerId: event.pointerId,
      eventKey: `week-order-${orderId}`,
      orderId,
      previousScheduledAtIso: item.entry.order.scheduledAt ?? null,
      entry: item.entry,
      sourceDateKey: cell.key,
      baseMinutes,
      height: item.height,
      target: event.currentTarget,
      startClientX: event.clientX,
      startClientY: event.clientY,
      holdTimeoutId: 0
    };
    intent.holdTimeoutId = window.setTimeout(() => activateWeekGridDrag(intent), dayGridDragHoldMs);
    weekGridDragIntentRef.current = intent;
  };

  const handleWeekGridEventPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const activeDrag = weekGridDragState;
    if (activeDrag && event.pointerId === activeDrag.pointerId) {
      event.preventDefault();
      const preview = resolveWeekGridPreviewPosition(
        event.clientX,
        event.clientY,
        activeDrag.previewDateKey
      );
      if (!preview) return;
      if (
        preview.previewDateKey === activeDrag.previewDateKey &&
        preview.previewMinutes === activeDrag.previewMinutes
      ) {
        return;
      }

      setWeekGridDragState((current) =>
        current
          ? {
              ...current,
              previewDateKey: preview.previewDateKey,
              previewMinutes: preview.previewMinutes
            }
          : current
      );
      return;
    }

    const intent = weekGridDragIntentRef.current;
    if (!intent || event.pointerId !== intent.pointerId) return;

    const distanceX = Math.abs(event.clientX - intent.startClientX);
    const distanceY = Math.abs(event.clientY - intent.startClientY);
    if (Math.max(distanceX, distanceY) < dayGridDragStartDistancePx) return;

    window.clearTimeout(intent.holdTimeoutId);
    weekGridDragIntentRef.current = null;
  };

  const finishDayGridDrag = async (pointerId: number) => {
    if (!dayGridDragState || pointerId !== dayGridDragState.pointerId) return;

    const currentDrag = dayGridDragState;
    setDayGridDragState(null);
    unlockDayGridScroll();

    dayGridSuppressClickRef.current = currentDrag.eventKey;

    if (currentDrag.previewMinutes === currentDrag.baseMinutes) return;

    await persistOrderSchedule(
      currentDrag.orderId,
      dateWithMinutes(currentDrag.baseDate, currentDrag.previewMinutes),
      {
        previousScheduledAtIso: currentDrag.previousScheduledAtIso,
        notifyOnSuccess: false
      }
    );
  };

  const finishWeekGridDrag = async (pointerId: number) => {
    if (!weekGridDragState || pointerId !== weekGridDragState.pointerId) return;

    const currentDrag = weekGridDragState;
    setWeekGridDragState(null);
    unlockDayGridScroll();

    weekGridSuppressClickRef.current = currentDrag.eventKey;

    if (
      currentDrag.previewDateKey === currentDrag.sourceDateKey &&
      currentDrag.previewMinutes === currentDrag.baseMinutes
    ) {
      return;
    }

    const previewDate = weekDateByKey.get(currentDrag.previewDateKey);
    if (!previewDate) return;

    await persistOrderSchedule(
      currentDrag.orderId,
      dateWithMinutes(previewDate, currentDrag.previewMinutes),
      {
        previousScheduledAtIso: currentDrag.previousScheduledAtIso,
        notifyOnSuccess: false
      }
    );
  };

  const handleDayGridEventPointerUp = async (event: PointerEvent<HTMLButtonElement>) => {
    const intent = dayGridDragIntentRef.current;
    if (intent?.pointerId === event.pointerId) {
      window.clearTimeout(intent.holdTimeoutId);
      dayGridDragIntentRef.current = null;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    await finishDayGridDrag(event.pointerId);
  };

  const handleDayGridEventPointerCancel = (event: PointerEvent<HTMLButtonElement>) => {
    const intent = dayGridDragIntentRef.current;
    if (intent?.pointerId === event.pointerId) {
      window.clearTimeout(intent.holdTimeoutId);
      dayGridDragIntentRef.current = null;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (dayGridDragState && event.pointerId === dayGridDragState.pointerId) {
      setDayGridDragState(null);
      unlockDayGridScroll();
    }
  };

  const handleWeekGridEventPointerUp = async (event: PointerEvent<HTMLButtonElement>) => {
    const intent = weekGridDragIntentRef.current;
    if (intent?.pointerId === event.pointerId) {
      window.clearTimeout(intent.holdTimeoutId);
      weekGridDragIntentRef.current = null;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    await finishWeekGridDrag(event.pointerId);
  };

  const handleWeekGridEventPointerCancel = (event: PointerEvent<HTMLButtonElement>) => {
    const intent = weekGridDragIntentRef.current;
    if (intent?.pointerId === event.pointerId) {
      window.clearTimeout(intent.holdTimeoutId);
      weekGridDragIntentRef.current = null;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (weekGridDragState && event.pointerId === weekGridDragState.pointerId) {
      setWeekGridDragState(null);
      unlockDayGridScroll();
    }
  };

  const handleCalendarChipClick = (
    event: MouseEvent<HTMLButtonElement>,
    entry: CalendarOrderEntry
  ) => {
    event.stopPropagation();
    openCalendarEntry(entry);
  };

  const draftTotalUnits = useMemo(
    () => newOrderItems.reduce((sum, item) => sum + Math.max(item.quantity || 0, 0), 0),
    [newOrderItems]
  );

  const draftSubtotal = useMemo(() => {
    return calculateOrderSubtotalFromItems(newOrderItems, productMap);
  }, [newOrderItems, productMap]);

  const draftDiscount = useMemo(() => Math.max(parseCurrencyBR(newOrderDiscount), 0), [newOrderDiscount]);
  const draftTotal = Math.max(draftSubtotal - draftDiscount, 0);
  const selectedNewOrderCustomer = useMemo(
    () =>
      typeof newOrderCustomerId === 'number'
        ? customers.find((customer) => customer.id === newOrderCustomerId) || null
        : null,
    [customers, newOrderCustomerId]
  );
  const newOrderCustomerAddress = useMemo(
    () => formatCustomerFullAddress(selectedNewOrderCustomer),
    [selectedNewOrderCustomer]
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
      newOrderItems
        .filter((item) => Math.max(Math.floor(item.quantity || 0), 0) > 0)
        .map((item) => ({
          name: productMap.get(item.productId)?.name ?? `Produto ${item.productId}`,
          quantity: Math.max(Math.floor(item.quantity || 0), 0)
        })),
    [newOrderItems, productMap]
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
    () => buildOrderVirtualBoxPartitions(selectedOrder?.items || [], productMap),
    [selectedOrder, productMap]
  );
  const selectedOrderEditableBoxes = useMemo<OrderVirtualEditableBox[]>(() => {
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
  }, [selectedOrderVirtualBoxPartitions]);
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
    if (selectedOrderEditingBoxKey !== SELECTED_ORDER_NEW_BOX_KEY) {
      return selectedOrderEditableBoxes;
    }
    return [...selectedOrderEditableBoxes, selectedOrderNewEditableBox];
  }, [selectedOrderEditableBoxes, selectedOrderEditingBoxKey, selectedOrderNewEditableBox]);
  const selectedOrderEditableBoxByKey = useMemo(() => {
    return new Map(selectedOrderRenderedBoxes.map((box) => [box.key, box]));
  }, [selectedOrderRenderedBoxes]);
  const selectedOrderEditingBox = selectedOrderEditingBoxKey
    ? selectedOrderEditableBoxByKey.get(selectedOrderEditingBoxKey) || null
    : null;
  const selectedOrderEditingBoxDraftTotalUnits = useMemo(() => {
    return Object.values(selectedOrderEditingBoxDraftByProductId).reduce(
      (sum, quantity) => sum + Math.max(Math.floor(quantity || 0), 0),
      0
    );
  }, [selectedOrderEditingBoxDraftByProductId]);
  const selectedOrderEditPickerParts = useMemo(
    () =>
      splitDateTimeLocalPickerParts(
        selectedOrderEditScheduledAt || normalizeDateTimeLocalToAllowedQuarter(formatDateTimeLocalValue(new Date()))
      ),
    [selectedOrderEditScheduledAt]
  );
  const selectedCustomer = selectedOrder
    ? selectedOrder.customer || customers.find((customer) => customer.id === selectedOrder.customerId) || null
    : null;
  const selectedCustomerNameLabel = selectedOrder ? resolveCustomerName(selectedOrder) : 'Sem cliente';
  const selectedCustomerAddressLabel = formatCustomerFullAddress(selectedCustomer) || 'Endereco nao informado';
  const selectedCustomerPhoneLabel =
    formatPhoneBR(selectedCustomer?.phone) || (selectedCustomer?.phone || '').trim() || 'Telefone nao informado';
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
    setNewOrderDiscount('0,00');
    setNewOrderNotes(tutorialMode ? withTestDataTag('', 'Pedido do momento') : '');
    setOrderError(null);
  }, [tutorialMode]);
  const applyLastOrderDraftForCustomer = useCallback(
    (customerId: number | '') => {
      if (!customerId) {
        if (restoredLastOrderDraft) {
          resetNewOrderDraftDetails();
        }
        setRestoredLastOrderDraft(null);
        return;
      }

      const lastOrderDraft = latestOrderDraftByCustomerId.get(customerId);
      if (!lastOrderDraft) {
        if (restoredLastOrderDraft) {
          resetNewOrderDraftDetails();
        }
        setRestoredLastOrderDraft(null);
        return;
      }

      setNewOrderItems(lastOrderDraft.items);
      setNewOrderFulfillmentMode(lastOrderDraft.fulfillmentMode);
      setNewOrderDiscount(formatMoneyInputBR(lastOrderDraft.discount) || '0,00');
      setNewOrderNotes(lastOrderDraft.notes);
      setOrderError(null);
      setRestoredLastOrderDraft({
        customerId: lastOrderDraft.customerId,
        customerName: lastOrderDraft.customerName,
        orderId: lastOrderDraft.orderId,
        referenceLabel: lastOrderDraft.referenceLabel
      });
    },
    [latestOrderDraftByCustomerId, resetNewOrderDraftDetails, restoredLastOrderDraft]
  );
  const syncNewOrderCustomerSelection = useCallback(
    (value: string, options: Array<{ id: number; label: string }>) => {
      const parsedId = parseIdFromLabel(value, options);
      const nextCustomerId = Number.isFinite(parsedId) ? parsedId : '';
      setNewOrderCustomerId((current) => (current === nextCustomerId ? current : nextCustomerId));
      if (
        nextCustomerId &&
        restoredLastOrderDraft?.customerId === nextCustomerId &&
        restoredLastOrderDraft.orderId === latestOrderDraftByCustomerId.get(nextCustomerId)?.orderId
      ) {
        return;
      }
      applyLastOrderDraftForCustomer(nextCustomerId);
    },
    [applyLastOrderDraftForCustomer, latestOrderDraftByCustomerId, restoredLastOrderDraft]
  );
  useEffect(() => {
    if (!customerSearch.trim()) {
      if (newOrderCustomerId) {
        syncNewOrderCustomerSelection('', customerOptions);
      }
      return;
    }
    syncNewOrderCustomerSelection(customerSearch, customerOptions);
  }, [customerOptions, customerSearch, newOrderCustomerId, syncNewOrderCustomerSelection]);

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
        setNewOrderDeliveryQuoteError('Cliente sem endereco completo para cotacao do frete.');
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
            name: selectedNewOrderCustomer.name,
            phone: selectedNewOrderCustomer.phone ?? null,
            address: newOrderCustomerAddress,
            placeId: selectedNewOrderCustomer.placeId ?? null,
            lat: typeof selectedNewOrderCustomer.lat === 'number' ? selectedNewOrderCustomer.lat : null,
            lng: typeof selectedNewOrderCustomer.lng === 'number' ? selectedNewOrderCustomer.lng : null,
            deliveryNotes: selectedNewOrderCustomer.deliveryNotes ?? null
          },
          manifest: {
            items: newOrderQuoteManifestItems,
            subtotal: draftSubtotal,
            totalUnits: draftTotalUnits
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
        const message = error instanceof Error ? error.message : 'Nao foi possivel calcular o frete agora.';
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
      draftTotalUnits,
      newOrderCustomerAddress,
      newOrderFulfillmentMode,
      newOrderQuoteManifestItems,
      newOrderScheduledAtIso,
      newOrderQuoteRequestIdRef,
      selectedNewOrderCustomer
    ]
  );

  useEffect(() => {
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
      setNewOrderDeliveryQuoteError('Cliente sem endereco completo para cotacao do frete.');
      setIsQuotingNewOrderDelivery(false);
      return;
    }

    newOrderQuoteRequestIdRef.current += 1;
    setNewOrderDeliveryQuote(null);
    setNewOrderDeliveryQuoteError(null);
    setIsQuotingNewOrderDelivery(false);
  }, [
    draftSubtotal,
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
  const selectedMassPrepStatus = selectedMassPrepEvent?.status ?? null;
  const selectedMassPrepWorkflowIndex = selectedMassPrepStatus
    ? MASS_PREP_EVENT_STATUSES.indexOf(selectedMassPrepStatus)
    : -1;
  const selectedMassPrepPreviousWorkflowStatus = resolveAdjacentMassPrepWorkflowStatus(
    selectedMassPrepStatus,
    'backward'
  );
  const selectedMassPrepNextWorkflowStatus = resolveAdjacentMassPrepWorkflowStatus(
    selectedMassPrepStatus,
    'forward'
  );
  const massReadyLookupName = useMemo(() => normalizeTextForSort(MASS_READY_ITEM_NAME), []);
  const massPrepIngredientCards = useMemo(() => {
    return massPrepStockCards.filter((card) => normalizeTextForSort(card.name) !== massReadyLookupName);
  }, [massPrepStockCards, massReadyLookupName]);
  const massPrepRecipesPossibleFromStock = useMemo(() => {
    let possibleRecipes = Number.POSITIVE_INFINITY;

    for (const ingredient of MASS_PREP_RECIPE_INGREDIENTS) {
      const ingredientCard =
        massPrepIngredientCards.find((card) =>
          ingredient.aliases.some(
            (alias) => normalizeTextForSort(alias) === normalizeTextForSort(card.name)
          )
        ) || null;
      const availableQty = roundInventoryQty(ingredientCard?.balance || 0);
      const possibleForIngredient = ingredient.qtyPerRecipe
        ? Math.floor(availableQty / ingredient.qtyPerRecipe)
        : 0;
      possibleRecipes = Math.min(possibleRecipes, possibleForIngredient);
    }

    return Number.isFinite(possibleRecipes) ? Math.max(possibleRecipes, 0) : 0;
  }, [massPrepIngredientCards]);
  const massPrepExecutableBatchRecipes =
    massPrepRecipesPossibleFromStock >= MASS_PREP_DEFAULT_BATCH_RECIPES
      ? MASS_PREP_DEFAULT_BATCH_RECIPES
      : massPrepRecipesPossibleFromStock >= 1
        ? 1
        : 0;
  const massPrepDraftTargetRecipes =
    massPrepExecutableBatchRecipes > 0 ? massPrepExecutableBatchRecipes : 1;
  const massPrepRecipeAvailabilityRows = useMemo(() => {
    return MASS_PREP_RECIPE_INGREDIENTS.map((ingredient) => {
      const ingredientCard =
        massPrepIngredientCards.find((card) =>
          ingredient.aliases.some(
            (alias) => normalizeTextForSort(alias) === normalizeTextForSort(card.name)
          )
        ) || null;
      const availableQty = roundInventoryQty(ingredientCard?.balance || 0);
      const requiredForDraft = roundInventoryQty(
        ingredient.qtyPerRecipe * massPrepDraftTargetRecipes
      );
      const missingForDraft = roundInventoryQty(Math.max(requiredForDraft - availableQty, 0));
      return {
        key: ingredient.key,
        displayName: ingredient.displayName,
        unit: ingredient.unit,
        qtyPerRecipe: ingredient.qtyPerRecipe,
        ingredientCard,
        availableQty,
        requiredForDraft,
        missingForDraft
      };
    });
  }, [massPrepDraftTargetRecipes, massPrepIngredientCards]);
  const massPrepHasMissingForDraft = massPrepExecutableBatchRecipes <= 0;

  const prepareMassReadyFromIngredients = useCallback(async () => {
    if (!selectedMassPrepEvent) return;
    if (massPrepHasMissingForDraft) {
      setMassPrepPrepareError('Falta insumo para 1 receita de MASSA PRONTA.');
      return;
    }
    if (massPrepPrepareInFlightRef.current) return;

    massPrepPrepareInFlightRef.current = true;
    setMassPrepPrepareError(null);
    setIsPreparingMassReady(true);
    try {
      const requestKey =
        massPrepPrepareRequestKeyRef.current ||
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `mass-prep-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`);
      massPrepPrepareRequestKeyRef.current = requestKey;
      const response = await apiFetch<{ recipesPrepared: number }>('/inventory-mass-ready/prepare', {
        method: 'POST',
        body: JSON.stringify({
          recipes: MASS_PREP_DEFAULT_BATCH_RECIPES,
          orderId: selectedMassPrepEvent.orderId,
          reason: `Conversao manual via pop-up ${MASS_PREP_EVENT_NAME}`,
          requestKey
        })
      });

      const refreshedCards = await loadMassPrepStockSnapshot();
      setMassPrepStockCards(refreshedCards);
      setMassPrepEditBalanceByItemId(
        Object.fromEntries(
          refreshedCards.map((card) => [card.itemId, formatInventoryBalanceInput(card.balance)])
        )
      );
      massPrepPrepareRequestKeyRef.current = null;
      notifySuccess(`MASSA PRONTA +${response.recipesPrepared} receita(s).`);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Nao foi possivel gerar MASSA PRONTA.';
      setMassPrepPrepareError(message);
      notifyError(message);
    } finally {
      massPrepPrepareInFlightRef.current = false;
      setIsPreparingMassReady(false);
    }
  }, [
    loadMassPrepStockSnapshot,
    massPrepHasMissingForDraft,
    notifyError,
    notifySuccess,
    selectedMassPrepEvent
  ]);

  useEffect(() => {
    massPrepPrepareInFlightRef.current = false;
    massPrepPrepareRequestKeyRef.current = null;
  }, [selectedMassPrepEvent?.id]);

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

  const saveSelectedOrderEdit = async () => {
    if (!selectedOrder?.id) return;
    const parsedScheduledAt = parseDateTimeLocalInput(selectedOrderEditScheduledAt);
    if (!parsedScheduledAt) {
      setSelectedOrderEditError('Informe data e hora.');
      return;
    }

    setSelectedOrderEditError(null);
    setIsSavingSelectedOrderEdit(true);
    try {
      await apiFetch(`/orders/${selectedOrder.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          scheduledAt: parsedScheduledAt.toISOString(),
          notes: selectedOrderEditNotes.trim() ? selectedOrderEditNotes.trim() : null
        })
      });
      const refreshedOrders = await loadAll();
      const freshSelected = refreshedOrders.find((entry) => entry.id === selectedOrder.id) || null;
      if (freshSelected) {
        setSelectedOrder(freshSelected);
      }
      notifySuccess('Pedido salvo.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nao foi possivel salvar o pedido.';
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

  const selectedOrderEditingBoxRows = useMemo(() => {
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
  }, [productMap, selectedOrderEditableFlavorEntries, selectedOrderEditingBoxDraftByProductId]);

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
          `Cabem mais ${remainingUnits} un nesta caixa.`
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
    const nextItems = mapOrderVirtualBoxPartsToItems(nextBoxes);
    if (nextItems.length === 0) {
      setSelectedOrderEditingBoxError('Pedido precisa ter ao menos 1 item.');
      return;
    }

    const orderId = selectedOrder.id;
    setSelectedOrderEditingBoxError(null);
    setIsSavingSelectedOrderEditingBox(true);
    try {
      await apiFetch<OrderView>(`/orders/${orderId}/items`, {
        method: 'PUT',
        body: JSON.stringify({
          items: nextItems
        })
      });

      const refreshedOrders = await loadAll();
      const freshSelected = refreshedOrders.find((entry) => entry.id === orderId) || null;
      if (freshSelected) {
        setSelectedOrder(freshSelected);
      }
      setSelectedOrderEditingBoxKey(null);
      setSelectedOrderEditingBoxDraftByProductId({});
      setSelectedOrderEditingBoxError(null);
      notifySuccess(isAddingNewBox ? 'Caixa adicionada.' : 'Caixa atualizada.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nao foi possivel salvar a caixa.';
      setSelectedOrderEditingBoxError(message);
      notifyError(message);
    } finally {
      setIsSavingSelectedOrderEditingBox(false);
    }
  }, [
    loadAll,
    notifyError,
    notifySuccess,
    productMap,
    selectedOrder,
    selectedOrderAllowsBoxEdit,
    selectedOrderEditableBoxes,
    selectedOrderEditingBox,
    selectedOrderEditingBoxDraftByProductId,
    selectedOrderEditingBoxDraftTotalUnits
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
      description: 'A caixa sera removida e o total recalculado.',
      confirmLabel: 'Excluir caixa',
      cancelLabel: 'Cancelar',
      danger: true
    });
    if (!accepted) return;

    const nextBoxes = selectedOrderEditableBoxes
      .filter((box) => box.key !== selectedOrderEditingBox.key)
      .map((box) => box.parts);
    const nextItems = mapOrderVirtualBoxPartsToItems(nextBoxes);
    if (nextItems.length === 0) {
      setSelectedOrderEditingBoxError('O pedido precisa ter ao menos 1 caixa.');
      return;
    }

    const orderId = selectedOrder.id;
    setSelectedOrderEditingBoxError(null);
    setIsDeletingSelectedOrderEditingBox(true);
    try {
      await apiFetch<OrderView>(`/orders/${orderId}/items`, {
        method: 'PUT',
        body: JSON.stringify({
          items: nextItems
        })
      });

      const refreshedOrders = await loadAll();
      const freshSelected = refreshedOrders.find((entry) => entry.id === orderId) || null;
      if (freshSelected) {
        setSelectedOrder(freshSelected);
      }
      setSelectedOrderEditingBoxKey(null);
      setSelectedOrderEditingBoxDraftByProductId({});
      setSelectedOrderEditingBoxError(null);
      notifySuccess('Caixa excluida.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nao foi possivel excluir a caixa.';
      setSelectedOrderEditingBoxError(message);
      notifyError(message);
    } finally {
      setIsDeletingSelectedOrderEditingBox(false);
    }
  }, [
    confirm,
    loadAll,
    notifyError,
    notifySuccess,
    selectedOrder,
    selectedOrderAllowsBoxEdit,
    selectedOrderEditableBoxes,
    selectedOrderEditingBox
  ]);

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
          summary={
            <div className="xl:hidden">
              <div className="rounded-[20px] border border-[rgba(126,79,45,0.08)] bg-white/82 p-3 shadow-[0_14px_30px_rgba(70,44,26,0.06)]">
                <button
                  type="button"
                  className="app-button app-button-primary w-full"
                  onClick={openNewOrderModal}
                >
                  Novo pedido
                </button>
              </div>
            </div>
          }
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
                  <h4 className="orders-day-sheet__title">{selectedCalendarDateTitle}</h4>
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
                    {selectedDateTimelineEvents.length === 0 ? (
                      <div className="orders-day-grid__empty">sem pedidos no horario</div>
                    ) : (
                      selectedDateTimelineEvents.map((item) => {
                        const status = resolveCalendarEntryStatus(item.entry);
                        const isSelected = selectedOrder?.id === item.entry.order.id;
                        const isDraggable = item.entry.kind === 'ORDER';
                        const eventKey = `timeline-${calendarEntryBaseKey(item.entry)}`;
                        const eventLabel = resolveCalendarEntryGridLabel(item.entry);
                        const eventNote = formatOrderNoteLabel(item.entry.order.notes);
                        const activeDrag = dayGridDragState?.eventKey === eventKey ? dayGridDragState : null;
                        const displayTop = activeDrag
                          ? Math.round(
                              ((activeDrag.previewMinutes - dayGridStartMinutes) /
                                dayGridDurationMinutes) *
                                dayGridHeight
                            )
                          : item.top;

                        return (
                          <button
                            type="button"
                            key={eventKey}
                            className={`orders-day-grid__event ${
                              isSelected ? `ring-2 ring-offset-1 ${calendarStatusRingClass(status)}` : ''
                            } ${activeDrag ? 'orders-day-grid__event--dragging' : ''}`}
                            onClick={() => handleDayGridEventClick(item.entry, eventKey)}
                            onPointerDown={
                              isDraggable
                                ? (event) => handleDayGridEventPointerDown(event, item)
                                : undefined
                            }
                            onPointerMove={isDraggable ? handleDayGridEventPointerMove : undefined}
                            onPointerUp={isDraggable ? handleDayGridEventPointerUp : undefined}
                            onPointerCancel={isDraggable ? handleDayGridEventPointerCancel : undefined}
                            style={
                              {
                                top: `${displayTop}px`,
                                height: `${activeDrag ? activeDrag.height : item.height}px`,
                                '--orders-day-grid-lane': `${activeDrag ? activeDrag.lane : item.lane}`,
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
                                {dateWithMinutes(
                                  item.entry.createdAt,
                                  activeDrag ? activeDrag.previewMinutes : minutesIntoDay(item.entry.createdAt)
                                ).toLocaleTimeString('pt-BR', {
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
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
                {selectedDateOverflowEntries.length > 0 ? (
                  <div className="orders-day-timeline__overflow">
                    <div className="orders-day-timeline__overflow-list">
                      {selectedDateOverflowEntries.map((entry) => {
                        const entryNote = formatOrderNoteLabel(entry.order.notes);
                        return (
                          <button
                            type="button"
                            key={`overflow-${calendarEntryBaseKey(entry)}`}
                            className={`orders-day-timeline__event ${
                              selectedOrder?.id === entry.order.id
                                ? `ring-2 ring-offset-1 ${calendarStatusRingClass(resolveCalendarEntryStatus(entry))}`
                                : ''
                            }`}
                            style={calendarStatusEventSurfaceStyle(resolveCalendarEntryStatus(entry))}
                            onClick={() => openCalendarEntry(entry)}
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={`orders-calendar-chip__dot ${calendarStatusDotClass(resolveCalendarEntryStatus(entry))}`}
                                aria-hidden="true"
                              />
                              <span className="orders-day-timeline__event-title">
                                {resolveCalendarEntryCompactName(entry)}
                              </span>
                            </div>
                            {entryNote ? (
                              <span className="orders-day-timeline__event-note">{entryNote}</span>
                            ) : null}
                            <span className="orders-day-timeline__event-meta">
                              {entry.createdAt.toLocaleTimeString('pt-BR', {
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : calendarView === 'WEEK' ? (
              <div className="orders-week-grid">
                {weekTimelineCells.map((cell) => {
                  const activeWeekDrag = weekGridDragState;
                  let displayTimelineEvents = cell.timelineEvents;
                  let displayTimelineLaneCount = cell.timelineLaneCount;

                  if (activeWeekDrag && activeWeekDrag.previewDateKey === cell.key) {
                    const filteredEntries = cell.entries.filter(
                      (entry) => !isMatchingOrderEntry(entry, activeWeekDrag.orderId)
                    );
                    const previewDate = weekDateByKey.get(activeWeekDrag.previewDateKey);
                    if (previewDate) {
                      filteredEntries.push({
                        ...activeWeekDrag.entry,
                        createdAt: dateWithMinutes(previewDate, activeWeekDrag.previewMinutes),
                        dateKey: activeWeekDrag.previewDateKey
                      });
                    }
                    const previewMetrics = buildWeekTimelineMetrics(filteredEntries, {
                      weekGridHeight,
                      dayGridDurationMinutes,
                      dayGridEndMinutes,
                      dayGridSnapMinutes,
                      dayGridStartMinutes,
                      weekGridMinEventHeight,
                      forcedOrderId:
                        activeWeekDrag.previewDateKey === cell.key ? activeWeekDrag.orderId : undefined
                    });
                    displayTimelineEvents = previewMetrics.timelineEvents;
                    displayTimelineLaneCount = previewMetrics.timelineLaneCount;
                  }

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
                        ref={(element) => registerWeekGridCanvas(cell.key, element)}
                        className="orders-week-grid__canvas"
                        style={
                          {
                            '--orders-week-grid-height': `${weekGridHeight}px`,
                            '--orders-day-grid-lanes': `${displayTimelineLaneCount}`
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
                        {displayTimelineEvents.length === 0 ? (
                          <div className="orders-week-grid__empty">sem pedidos</div>
                        ) : (
                          displayTimelineEvents.map((item) => {
                            const status = resolveCalendarEntryStatus(item.entry);
                            const eventLabel = resolveCalendarEntryCompactName(item.entry);
                            const eventNote = formatOrderNoteLabel(item.entry.order.notes);
                            const isSelected = selectedOrder?.id === item.entry.order.id;
                            const isDraggable = item.entry.kind === 'ORDER';
                            const eventKey =
                              item.entry.kind === 'ORDER' && item.entry.order.id
                                ? `week-order-${item.entry.order.id}`
                                : `week-${calendarEntryBaseKey(item.entry)}`;
                            const isDragging = weekGridDragState?.eventKey === eventKey;
                            const isSourceGhost =
                              isDragging &&
                              weekGridDragState?.sourceDateKey === cell.key &&
                              weekGridDragState.previewDateKey !== cell.key;

                            return (
                              <button
                                key={`week-event-${cell.key}-${eventKey}`}
                                type="button"
                                className={`orders-week-grid__event ${
                                  isSelected
                                    ? `ring-2 ring-offset-1 ${calendarStatusRingClass(status)}`
                                    : ''
                                } ${isDragging ? 'orders-week-grid__event--dragging' : ''} ${
                                  isSourceGhost ? 'orders-week-grid__event--ghost' : ''
                                }`}
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
                                  handleWeekGridEventClick(item.entry, eventKey);
                                }}
                                onPointerDown={
                                  isDraggable
                                    ? (event) => handleWeekGridEventPointerDown(event, cell, item)
                                    : undefined
                                }
                                onPointerMove={isDraggable ? handleWeekGridEventPointerMove : undefined}
                                onPointerUp={isDraggable ? handleWeekGridEventPointerUp : undefined}
                                onPointerCancel={isDraggable ? handleWeekGridEventPointerCancel : undefined}
                              >
                                <span
                                  className={`orders-calendar-chip__dot ${calendarStatusDotClass(status)}`}
                                  aria-hidden="true"
                                />
                                <span className="orders-week-grid__event-time">
                                  {item.entry.createdAt.toLocaleTimeString('pt-BR', {
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
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
                          const timeLabel = entry.createdAt.toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit'
                          });
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
                  <p className="orders-list-panel__subtitle">Total {sortedVisibleOrderList.length}</p>
                </div>
              </div>
              {selectedDateProductionSummary.length > 0 ? (
                <div className="mb-3 rounded-[22px] border border-[rgba(126,79,45,0.1)] bg-[linear-gradient(155deg,rgba(255,252,247,0.96),rgba(245,236,226,0.9))] p-3 shadow-[0_12px_28px_rgba(70,44,26,0.06)]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">
                        Resumo do dia
                      </p>
                      <p className="text-xs text-neutral-500">{selectedCalendarDateTitle}</p>
                    </div>
                    <span className="rounded-full border border-white/80 bg-white/82 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)]">
                      {selectedDateProductionSummary.length} cliente(s)
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {selectedDateProductionSummary.map((entry) => (
                      <div
                        key={`${entry.customerLabel}-${entry.flavorSummary}`}
                        className="rounded-[18px] border border-white/80 bg-white/82 px-3 py-2 shadow-[0_8px_20px_rgba(57,39,24,0.04)]"
                      >
                        <p className="text-sm font-semibold text-[color:var(--ink-strong)]">{entry.customerLabel}</p>
                        <p className="text-xs leading-5 text-neutral-600">{entry.flavorSummary}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="orders-list-panel__stack">
                {sortedVisibleOrderList.length === 0 ? (
                  <p className="orders-list-panel__empty">
                    Sem pedidos.
                  </p>
                ) : (
                  sortedVisibleOrderList.map((order) => {
                    const dateLabel =
                      formatOrderDateTimeLabel(
                        resolveOrderDate(order) ?? safeDateFromIso(order.createdAt ?? null)
                      ) || 'Sem data';
                    const customerName = resolveCustomerName(order);
                    const historyCustomer = customerMap.get(order.customerId) ?? order.customer ?? null;
                    const historyCustomerAddress =
                      formatCustomerFullAddress(historyCustomer) || 'Endereco nao informado';
                    const historyCustomerPhone =
                      formatPhoneBR(historyCustomer?.phone) ||
                      (historyCustomer?.phone || '').trim() ||
                      'Telefone nao informado';
                    const statusDotClass = calendarStatusDotClass(order.status || '');
                    const isActive = selectedOrder?.id === order.id;
                    const paymentStatus = order.paymentStatus || 'PENDENTE';
                    const amountPaid = toMoney(order.amountPaid ?? 0);
                    const balanceDue = toMoney(
                      Math.max(order.balanceDue ?? (order.total ?? 0) - amountPaid, 0)
                    );
                    const itemCount = (order.items || []).reduce(
                      (sum, item) => sum + Math.max(item.quantity || 0, 0),
                      0
                    );
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
                                  <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-100 px-1.5 py-0 text-[10px] font-semibold leading-4 text-amber-900">
                                    Em foco
                                  </span>
                                ) : null}
                              </div>
                              <p className="orders-list-panel__line-customer">{customerName}</p>
                              <p className="orders-list-panel__line-meta">
                                Pedido #{displayOrderNumber(order)} • {dateLabel}
                              </p>
                              {historyOrderNote ? (
                                <p className="orders-list-panel__line-note">{historyOrderNote}</p>
                              ) : null}
                              <p className="orders-list-panel__line-contact">{historyCustomerAddress}</p>
                              <p className="orders-list-panel__line-contact">{historyCustomerPhone}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="orders-list-panel__line-total">
                                {formatCurrencyBR(order.total ?? 0)}
                              </span>
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
                  })
                )}
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
                productsForCards={orderableProducts}
                fulfillmentMode={newOrderFulfillmentMode}
                customerSearch={customerSearch}
                selectedCustomerId={newOrderCustomerId}
                restoredFromLastOrder={restoredLastOrderDraft}
                newOrderScheduledAt={newOrderScheduledAt}
                newOrderDiscount={newOrderDiscount}
                newOrderNotes={newOrderNotes}
                newOrderItems={newOrderItems}
                draftTotalUnits={draftTotalUnits}
                virtualBoxRemainingUnits={draftVirtualBoxRemainingUnits}
                canCreateOrder={canCreateOrder}
                isCreatingOrder={isCreatingOrder}
                isQuotingDelivery={isQuotingNewOrderDelivery}
                orderError={orderError}
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
                onScheduledAtChange={setNewOrderScheduledAt}
                onDiscountChange={setNewOrderDiscount}
                onDiscountBlur={() =>
                  setNewOrderDiscount(formatMoneyInputBR(newOrderDiscount || '0') || '0,00')
                }
                onNotesChange={setNewOrderNotes}
                onCreateOrder={createOrder}
                onRefreshDeliveryQuote={() => {
                  void refreshNewOrderDeliveryQuote();
                }}
                onClearDraft={clearDraft}
                onDecrementProduct={decrementDraftItem}
                onAddProductUnits={addDraftItemUnits}
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
                      selectedOrderPaymentStatus === 'PAGO' ? 'Marcar pedido como nao pago' : 'Marcar pedido como pago';
                    const isDisabled =
                      isStatusUpdatePending || selectedOrderIsCancelled || (!isPaymentStage && isCurrent);

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
                              className="h-7 w-7"
                            />
                          </span>
                          <span
                            className={`mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                              isCurrent
                                ? 'text-neutral-800'
                                : isPassed
                                  ? 'text-neutral-600'
                                  : 'text-neutral-400'
                            }`}
                          >
                            {stageLabel}
                          </span>
                        </button>
                        {index < ORDER_WORKFLOW_STAGES.length - 1 ? (
                          <span
                            className={`order-workflow-strip__connector mx-2 mt-6 h-[2px] w-10 shrink-0 rounded-full ${
                              isConnectorActive ? stageMeta.activeLineClassName : 'bg-neutral-200'
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
              <p className="mt-2 text-xs text-rose-600">
                Pedido cancelado. Etapas bloqueadas.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-xl font-semibold">Pedido #{displayOrderNumber(selectedOrder)}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-neutral-900">{selectedCustomerNameLabel}</p>
                {selectedCustomer?.id ? (
                  <Link
                    href={`/clientes?editCustomerId=${selectedCustomer.id}`}
                    className="app-button app-button-ghost px-2 py-1 text-[11px]"
                  >
                    Ver cliente
                  </Link>
                ) : null}
              </div>
              <p className="mt-0.5 break-words text-xs text-neutral-600">{selectedCustomerAddressLabel}</p>
              <p className="mt-0.5 break-words text-xs text-neutral-600">{selectedCustomerPhoneLabel}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-500">
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
                <span>{formatCurrencyBR(selectedOrder.total ?? 0)}</span>
              </div>
              {selectedCustomer?.deletedAt ? (
                <p className="mt-1 text-xs text-amber-600">
                  Cliente excluido em {selectedCustomerDeletedAtLabel}. Pedido mantido.
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
            <div className="mb-3 grid gap-3 rounded-2xl border border-white/70 bg-white/80 p-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-end">
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500">
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
              </label>
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500">
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
                <p className="text-xs font-medium text-rose-700 md:col-span-3">{selectedOrderEditError}</p>
              ) : null}
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
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-emerald-200 bg-emerald-50';
                  const boxLabelToneClass =
                    box.tone === 'OPEN' ? 'text-amber-800' : 'text-emerald-800';
                  const boxTextToneClass =
                    box.tone === 'OPEN' ? 'text-amber-950' : 'text-emerald-950';

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
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
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
                                  <span className="break-words text-xs font-medium text-neutral-700">
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
                                    <span className="min-w-6 text-center text-xs font-semibold text-neutral-900">
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
                              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
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
                            <p className="text-xs font-medium text-rose-700">{selectedOrderEditingBoxError}</p>
                          ) : null}
                          {!selectedOrderAllowsBoxEdit ? (
                            <p className="text-xs text-amber-700">
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
      {isMassPrepStockModalOpen && selectedMassPrepEvent ? (
        <div className="order-detail-modal" role="presentation" onClick={closeMassPrepStockModal}>
          <div
            className="order-detail-modal__dialog"
            ref={massPrepDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={massPrepTitleId}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id={massPrepTitleId} className="sr-only">
              Saldo atual de estoque para fazer massa
            </h2>
            <button type="button" className="order-detail-modal__close" onClick={closeMassPrepStockModal}>
              <AppIcon name="close" className="h-4 w-4" />
              Fechar
            </button>
            <div className="app-panel order-detail-modal__panel grid gap-4">
              <div className="rounded-2xl border border-white/70 bg-white/80 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                  <div className="min-w-0 sm:flex-1">
                    <ol className="order-workflow-strip">
                      {MASS_PREP_EVENT_STATUSES.map((status, index) => {
                        const stageMeta = massPrepWorkflowStatusMeta[status];
                        const isCurrent = selectedMassPrepStatus === status;
                        const isPassed = selectedMassPrepWorkflowIndex > index;
                        const isConnectorActive = selectedMassPrepWorkflowIndex > index;

                        return (
                          <li key={status} className="order-workflow-strip__item">
                            <div className="order-workflow-strip__step">
                              <span
                                className={`flex h-9 w-9 items-center justify-center rounded-full border ${
                                  isCurrent
                                    ? stageMeta.activeClassName
                                    : isPassed
                                      ? 'border-neutral-300 bg-neutral-100 text-neutral-700'
                                      : 'border-neutral-200 bg-white text-neutral-400'
                                }`}
                              >
                                {isCurrent ? (
                                  <AppIcon name={stageMeta.icon} className="h-4 w-4" />
                                ) : (
                                  <span
                                    className={`h-2.5 w-2.5 rounded-full ${
                                      isPassed ? stageMeta.passedDotClassName : 'bg-neutral-300'
                                    }`}
                                  />
                                )}
                              </span>
                              <span
                                className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                                  isCurrent
                                    ? 'text-neutral-800'
                                    : isPassed
                                      ? 'text-neutral-600'
                                      : 'text-neutral-400'
                                }`}
                              >
                                {stageMeta.label}
                              </span>
                            </div>
                            {index < MASS_PREP_EVENT_STATUSES.length - 1 ? (
                              <span
                                className={`order-workflow-strip__connector mx-2 mt-4 h-[2px] w-10 shrink-0 rounded-full ${
                                  isConnectorActive ? stageMeta.activeLineClassName : 'bg-neutral-200'
                                }`}
                              />
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${massPrepStatusBadgeClass(selectedMassPrepStatus)}`}
                      >
                        {formatMassPrepStatus(selectedMassPrepStatus)}
                      </span>
                      {selectedMassPrepStatus === 'INGREDIENTES' ? (
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${
                            massPrepHasMissingForDraft
                              ? 'border-rose-200 bg-rose-50 text-rose-700'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {massPrepHasMissingForDraft ? 'Falta insumo' : 'Ingredientes ok'}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
                    <button
                      type="button"
                      className="app-button app-button-ghost flex-1 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
                      onClick={() => {
                        if (!selectedMassPrepPreviousWorkflowStatus) return;
                        void updateSelectedMassPrepEventStatus(selectedMassPrepPreviousWorkflowStatus);
                      }}
                      disabled={
                        isUpdatingMassPrepStatus ||
                        isDeletingMassPrepEvent ||
                        !selectedMassPrepPreviousWorkflowStatus
                      }
                      aria-label="Voltar etapa"
                    >
                      <AppIcon name="back" className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="app-button app-button-primary flex-1 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
                      onClick={() => {
                        if (!selectedMassPrepNextWorkflowStatus) return;
                        void updateSelectedMassPrepEventStatus(selectedMassPrepNextWorkflowStatus);
                      }}
                      disabled={
                        isUpdatingMassPrepStatus ||
                        isDeletingMassPrepEvent ||
                        !selectedMassPrepNextWorkflowStatus ||
                        (selectedMassPrepNextWorkflowStatus === 'PREPARO' && massPrepHasMissingForDraft)
                      }
                      aria-label="Avancar etapa"
                    >
                      <AppIcon name="back" className="h-4 w-4 rotate-180" />
                    </button>
                    <button
                      type="button"
                      className="app-button app-button-danger w-full disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                      onClick={() => {
                        void removeSelectedMassPrepEvent();
                      }}
                      disabled={isDeletingMassPrepEvent || isUpdatingMassPrepStatus}
                    >
                      {isDeletingMassPrepEvent ? 'Excluindo...' : 'Excluir evento'}
                    </button>
                  </div>
                </div>
              </div>

              {massPrepStockLoading ? (
                <p className="rounded-2xl border border-dashed border-neutral-200 bg-white/70 px-3 py-4 text-sm text-neutral-500">
                  Carregando estoque...
                </p>
              ) : massPrepStockError ? (
                <p className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-4 text-sm text-rose-700">
                  {massPrepStockError}
                </p>
              ) : (
                <div className="grid gap-3">
                  <article className="mass-prep-ready-highlight">
                    <h4 className="mass-prep-ready-highlight__title">MASSA PRONTA</h4>
                    <p className="text-xs text-neutral-600">
                      Padrao: 2 receitas = 42 broas. Se faltar insumo: 1 receita ={' '}
                      {MASS_READY_BROAS_PER_RECIPE} broas.
                    </p>
                    <p className="text-xs text-neutral-600">
                      Proxima: {massPrepDraftTargetRecipes} receita(s) ={' '}
                      {massPrepDraftTargetRecipes * MASS_READY_BROAS_PER_RECIPE} broa(s).
                    </p>
                    <button
                      type="button"
                      className="app-button app-button-primary disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => {
                        void prepareMassReadyFromIngredients();
                      }}
                      disabled={isPreparingMassReady || massPrepExecutableBatchRecipes <= 0}
                    >
                      {isPreparingMassReady
                        ? 'Lançando...'
                        : `MASSA PRONTA (+${massPrepDraftTargetRecipes})`}
                    </button>
                    <div className="mass-prep-ready-highlight__recipe-grid">
                      {massPrepRecipeAvailabilityRows.map((row) => (
                        <div
                          key={`mass-prep-ingredient-recipe-${row.key}`}
                          className={`mass-prep-ready-highlight__recipe-row ${
                            row.missingForDraft > 0 ? 'mass-prep-ready-highlight__recipe-row--missing' : ''
                          }`}
                        >
                          <span>{row.displayName}</span>
                          <span>
                            {row.requiredForDraft} {row.unit} / saldo {formatInventoryBalance(row.availableQty)}{' '}
                            {row.ingredientCard?.unit || row.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                    {massPrepPrepareError ? (
                      <p className="mass-prep-ready-highlight__error">{massPrepPrepareError}</p>
                    ) : null}
                  </article>

                  {massPrepIngredientCards.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-neutral-200 bg-white/70 px-3 py-4 text-sm text-neutral-500">
                      Sem ingredientes no estoque.
                    </p>
                  ) : null}

                  <div className="mass-prep-stock-grid">
                    {massPrepIngredientCards.map((card) => {
                      const editValue =
                        massPrepEditBalanceByItemId[card.itemId] ?? formatInventoryBalanceInput(card.balance);
                      const itemError = massPrepEditErrorByItemId[card.itemId];
                      const isSavingItem = massPrepSavingItemId === card.itemId;

                      return (
                        <article key={`mass-prep-stock-${card.itemId}`} className="mass-prep-stock-card">
                          <p className="mass-prep-stock-card__category">{inventoryCategoryLabel(card.category)}</p>
                          <h4 className="mass-prep-stock-card__name">{card.name}</h4>
                          <p className="mass-prep-stock-card__balance">
                            Saldo: {formatInventoryBalance(card.balance)} {card.unit}
                          </p>
                          <label className="mass-prep-stock-card__edit-label">
                            Novo saldo ({card.unit})
                            <input
                              type="text"
                              inputMode="decimal"
                              className="app-input mass-prep-stock-card__input"
                              value={editValue}
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                setMassPrepEditBalanceByItemId((current) => ({
                                  ...current,
                                  [card.itemId]: nextValue
                                }));
                                setMassPrepEditErrorByItemId((current) => ({
                                  ...current,
                                  [card.itemId]: ''
                                }));
                              }}
                              onBlur={() => {
                                void saveMassPrepItemBalance(card.itemId);
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== 'Enter') return;
                                event.preventDefault();
                                void saveMassPrepItemBalance(card.itemId);
                              }}
                              placeholder="0"
                              disabled={isSavingItem}
                            />
                          </label>
                          {itemError ? <p className="mass-prep-stock-card__error">{itemError}</p> : null}
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}
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
