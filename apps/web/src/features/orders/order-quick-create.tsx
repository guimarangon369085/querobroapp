'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { Product } from '@querobroapp/shared';
import { AppIcon } from '@/components/app-icons';
import { FormField } from '@/components/form/FormField';
import { formatCurrencyBR } from '@/lib/format';
import {
  ORDER_BOX_UNITS,
  ORDER_FLAVOR_OFFICIAL_BOX_NAME_BY_CODE,
  ORDER_MISTA_OFFICIAL_BOX_NAME_BY_CODE,
  ORDER_MISTA_SHORTCUT_CODES,
  ORDER_SABORES_REFERENCE_IMAGE,
  compactOrderProductName,
  normalizeOrderFlavorName,
  resolveOrderCardImage,
  resolveOrderFlavorCodeFromName,
  resolveOrderReferenceImage,
  type OrderFlavorCode,
  type OrderMistaShortcutCode
} from './order-box-catalog';

const BOX_UNITS = ORDER_BOX_UNITS;
const MISTA_SHORTCUT_CODES = ORDER_MISTA_SHORTCUT_CODES;

type MistaShortcutCode = OrderMistaShortcutCode;
type FlavorShortcutCode = OrderFlavorCode;

type SelectOption = {
  id: number;
  label: string;
};

type VirtualBoxPart = {
  productId: number;
  productName: string;
  units: number;
};

type OrderQuickCreateProps = {
  tutorialMode: boolean;
  customerOptions: SelectOption[];
  productsForCards: Product[];
  customerSearch: string;
  restoredFromLastOrder?: {
    orderId: number;
    customerName: string;
    referenceLabel: string;
  } | null;
  newOrderScheduledAt: string;
  newOrderDiscount: string;
  newOrderNotes: string;
  newOrderItems: Array<{ productId: number; quantity: number }>;
  draftTotalUnits: number;
  virtualBoxRemainingUnits: number;
  canCreateOrder: boolean;
  isCreatingOrder: boolean;
  orderError: string | null;
  draftTotal: number;
  productMap: Map<number, Product>;
  onCustomerSearchChange: (value: string) => void;
  onScheduledAtChange: (value: string) => void;
  onDiscountChange: (value: string) => void;
  onDiscountBlur: () => void;
  onNotesChange: (value: string) => void;
  onCreateOrder: () => void;
  onClearDraft: () => void;
  onDecrementProduct: (productId: number) => void;
  onAddProductUnits: (productId: number, units: number) => void;
};

const flavorOfficialBoxNameByCode = ORDER_FLAVOR_OFFICIAL_BOX_NAME_BY_CODE;

const mistaOfficialBoxNameByCode = ORDER_MISTA_OFFICIAL_BOX_NAME_BY_CODE;

function formatDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateTimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function normalizeDateTimeLocalToAllowedQuarter(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return value;

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
  if (Number.isNaN(parsed.getTime())) return value;

  const minuteValue = parsed.getMinutes();
  if (minuteValue < 8) {
    parsed.setMinutes(0, 0, 0);
  } else if (minuteValue < 23) {
    parsed.setMinutes(15, 0, 0);
  } else if (minuteValue < 38) {
    parsed.setMinutes(30, 0, 0);
  } else {
    parsed.setHours(parsed.getHours() + 1, 0, 0, 0);
  }

  return formatDateTimeLocalValue(parsed);
}

function splitDateTimeLocalPickerParts(value: string) {
  const normalizedValue = normalizeDateTimeLocalToAllowedQuarter(value);
  const match = normalizedValue.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    const fallback = new Date();
    return {
      date: formatDateInputValue(fallback),
      hour: `${fallback.getHours()}`.padStart(2, '0'),
      minute:
        fallback.getMinutes() >= 30
          ? '30'
          : fallback.getMinutes() >= 15
            ? '15'
            : '00'
    };
  }

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
  if (Number.isNaN(parsed.getTime())) {
    const fallback = new Date();
    return {
      date: formatDateInputValue(fallback),
      hour: `${fallback.getHours()}`.padStart(2, '0'),
      minute:
        fallback.getMinutes() >= 30
          ? '30'
          : fallback.getMinutes() >= 15
            ? '15'
            : '00'
    };
  }

  return {
    date: formatDateInputValue(parsed),
    hour: `${parsed.getHours()}`.padStart(2, '0'),
    minute: parsed.getMinutes() >= 30 ? '30' : parsed.getMinutes() >= 15 ? '15' : '00'
  };
}

function mergeDateTimeLocalPickerParts(parts: { date: string; hour: string; minute: string }) {
  if (!parts.date) return '';
  return `${parts.date}T${parts.hour}:${parts.minute}`;
}

function formatVirtualBoxProgress(totalUnits: number, remainingUnits: number) {
  if (totalUnits <= 0) return '0 cx';

  const fullBoxes = Math.floor(totalUnits / BOX_UNITS);
  if (remainingUnits <= 0) return `${fullBoxes} cx`;

  const openUnits = totalUnits % BOX_UNITS;
  return `${fullBoxes} cx + ${openUnits}/7`;
}

function resolveVirtualBoxOfficialName(parts: VirtualBoxPart[]) {
  const normalizedParts = parts
    .map((part) => ({
      code: resolveOrderFlavorCodeFromName(part.productName),
      units: Math.max(Math.floor(part.units || 0), 0),
      productName: part.productName
    }))
    .filter((part) => part.units > 0);

  if (normalizedParts.length === 2) {
    const traditionalPart = normalizedParts.find((part) => part.code === 'T' && part.units === 4);
    const pairedFlavorPart = normalizedParts.find(
      (part) => part.code && part.code !== 'T' && part.units === 3
    );
    if (
      traditionalPart &&
      pairedFlavorPart &&
      (pairedFlavorPart.code === 'G' ||
        pairedFlavorPart.code === 'D' ||
        pairedFlavorPart.code === 'Q' ||
        pairedFlavorPart.code === 'R')
    ) {
      return mistaOfficialBoxNameByCode[pairedFlavorPart.code];
    }
  }

  if (normalizedParts.length === 1 && normalizedParts[0]?.units === BOX_UNITS && normalizedParts[0].code) {
    return flavorOfficialBoxNameByCode[normalizedParts[0].code];
  }

  if (normalizedParts.length === 1 && normalizedParts[0]) {
    return `Caixa de ${normalizedParts[0].productName}`;
  }

  return 'Caixa Sabores';
}

function resolveFlavorShortcutProductIds(products: Product[]) {
  const ids: Partial<Record<FlavorShortcutCode, number>> = {};

  for (const product of products) {
    if (typeof product.id !== 'number') continue;
    const normalized = normalizeOrderFlavorName(product.name);

    if (!ids.T && normalized.includes('tradicional')) {
      ids.T = product.id;
    }
    if (!ids.G && normalized.includes('goiabada')) {
      ids.G = product.id;
    }
    if (!ids.D && normalized.includes('doce')) {
      ids.D = product.id;
    }
    if (!ids.Q && normalized.includes('queijo')) {
      ids.Q = product.id;
    }
    if (!ids.R && normalized.includes('requeij')) {
      ids.R = product.id;
    }
  }

  return ids;
}

function buildVirtualBoxPartitions(
  items: Array<{ productId: number; quantity: number }>,
  productMap: Map<number, Product>
) {
  const boxes: VirtualBoxPart[][] = [];
  let currentBox: VirtualBoxPart[] = [];
  let currentBoxUnits = 0;

  const appendPart = (parts: VirtualBoxPart[], nextPart: VirtualBoxPart) => {
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
      const unitsToTake = Math.min(remainingUnits, BOX_UNITS - currentBoxUnits);
      appendPart(currentBox, {
        productId: item.productId,
        productName,
        units: unitsToTake
      });
      currentBoxUnits += unitsToTake;
      remainingUnits -= unitsToTake;

      if (currentBoxUnits === BOX_UNITS) {
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

function formatVirtualBoxParts(parts: VirtualBoxPart[]) {
  return parts.map((part) => `${part.units} ${part.productName}`).join(' + ');
}

export function OrderQuickCreate({
  tutorialMode,
  customerOptions,
  productsForCards,
  customerSearch,
  restoredFromLastOrder,
  newOrderScheduledAt,
  newOrderDiscount,
  newOrderNotes,
  newOrderItems,
  draftTotalUnits,
  virtualBoxRemainingUnits,
  canCreateOrder,
  isCreatingOrder,
  orderError,
  draftTotal,
  productMap,
  onCustomerSearchChange,
  onScheduledAtChange,
  onDiscountChange,
  onDiscountBlur,
  onNotesChange,
  onCreateOrder,
  onClearDraft,
  onDecrementProduct,
  onAddProductUnits
}: OrderQuickCreateProps) {
  const [mistaShortcutStack, setMistaShortcutStack] = useState<MistaShortcutCode[]>([]);
  const quantityByProductId = new Map(
    newOrderItems.map((item) => [item.productId, item.quantity] as const)
  );
  const draftCustomerLabel = customerSearch.trim() || 'Escolha um cliente';
  const flavorShortcutProductIds = useMemo(
    () => resolveFlavorShortcutProductIds(productsForCards),
    [productsForCards]
  );
  const virtualBoxPartitions = useMemo(() => {
    const remainingByProductId = new Map<number, number>(
      newOrderItems.map((item) => [item.productId, Math.max(Math.floor(item.quantity || 0), 0)] as const)
    );
    const mistaBoxes: VirtualBoxPart[][] = [];

    for (const code of mistaShortcutStack) {
      const traditionalId = flavorShortcutProductIds.T;
      const flavorId = flavorShortcutProductIds[code];
      if (!traditionalId || !flavorId) continue;

      const traditionalBalance = remainingByProductId.get(traditionalId) || 0;
      const flavorBalance = remainingByProductId.get(flavorId) || 0;
      if (traditionalBalance < 4 || flavorBalance < 3) continue;

      remainingByProductId.set(traditionalId, traditionalBalance - 4);
      remainingByProductId.set(flavorId, flavorBalance - 3);
      mistaBoxes.push([
        {
          productId: traditionalId,
          productName: compactOrderProductName(productMap.get(traditionalId)?.name ?? 'Tradicional (T)'),
          units: 4
        },
        {
          productId: flavorId,
          productName: compactOrderProductName(productMap.get(flavorId)?.name ?? `Sabor ${code}`),
          units: 3
        }
      ]);
    }

    const remainingItems = Array.from(remainingByProductId.entries())
      .filter(([, quantity]) => quantity > 0)
      .map(([productId, quantity]) => ({ productId, quantity }));
    const remainingPartitions = buildVirtualBoxPartitions(remainingItems, productMap);

    return {
      boxes: [...mistaBoxes, ...remainingPartitions.boxes],
      openBox: remainingPartitions.openBox,
      openBoxUnits: remainingPartitions.openBoxUnits
    };
  }, [flavorShortcutProductIds, mistaShortcutStack, newOrderItems, productMap]);
  const computedTotalUnits =
    virtualBoxPartitions.boxes.length * BOX_UNITS + virtualBoxPartitions.openBoxUnits;
  const remainingUnitsToCloseBox = virtualBoxPartitions.openBoxUnits
    ? BOX_UNITS - virtualBoxPartitions.openBoxUnits
    : virtualBoxRemainingUnits;
  const hasOpenVirtualBox = computedTotalUnits > 0 && remainingUnitsToCloseBox > 0;
  const displayTotalUnits = Math.max(draftTotalUnits, computedTotalUnits);
  const scheduledPickerParts = useMemo(
    () => splitDateTimeLocalPickerParts(newOrderScheduledAt),
    [newOrderScheduledAt]
  );

  useEffect(() => {
    if (newOrderItems.length === 0 && mistaShortcutStack.length > 0) {
      setMistaShortcutStack([]);
    }
  }, [mistaShortcutStack.length, newOrderItems.length]);

  const applyMistaShortcut = (code: MistaShortcutCode) => {
    const traditionalId = flavorShortcutProductIds.T;
    const flavorId = flavorShortcutProductIds[code];
    if (!traditionalId || !flavorId) return;

    onAddProductUnits(traditionalId, 4);
    onAddProductUnits(flavorId, 3);
    setMistaShortcutStack((current) => [...current, code]);
  };

  return (
    <div className="order-quick-create app-panel grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-neutral-900">Pedido</h3>
        </div>
        <button
          type="button"
          className="order-quick-create__clear app-button app-button-ghost"
          onClick={onClearDraft}
          aria-label="Limpar"
          title="Limpar"
        >
          ↺
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500">Cliente</p>
          <p className="mt-1 text-base font-semibold text-neutral-900">{draftCustomerLabel}</p>
        </div>
        <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500">Caixas</p>
          <p className="mt-1 text-base font-semibold text-neutral-900">
            {virtualBoxPartitions.boxes.length} fechada(s)
            {virtualBoxPartitions.openBoxUnits > 0
              ? ` • ${virtualBoxPartitions.openBoxUnits}/7 aberta`
              : ''}
          </p>
        </div>
        <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500">Total</p>
          <p className="mt-1 text-base font-semibold text-neutral-900">{formatCurrencyBR(draftTotal)}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-2 text-sm text-neutral-700">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[0.9rem] font-semibold text-neutral-700">Cliente</span>
            <Link href="/clientes" className="app-button app-button-ghost text-xs">
              Novo cliente
            </Link>
          </div>
          <input
            className="app-input"
            list="customers-list"
            placeholder="Cliente"
            value={customerSearch}
            onChange={(e) => onCustomerSearchChange(e.target.value)}
          />
          <datalist id="customers-list">
            {customerOptions.map((customer) => (
              <option key={customer.id} value={customer.label} />
            ))}
          </datalist>
        </div>
        <FormField label="Data">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
            <input
              className="app-input"
              type="date"
              value={scheduledPickerParts.date}
              onChange={(event) =>
                onScheduledAtChange(
                  mergeDateTimeLocalPickerParts({
                    ...scheduledPickerParts,
                    date: event.target.value
                  })
                )
              }
            />
            <input
              className="app-input"
              type="time"
              step={900}
              value={`${scheduledPickerParts.hour}:${scheduledPickerParts.minute}`}
              onChange={(event) =>
                onScheduledAtChange(
                  normalizeDateTimeLocalToAllowedQuarter(
                    mergeDateTimeLocalPickerParts({
                      ...scheduledPickerParts,
                      hour: event.target.value.split(':')[0] || scheduledPickerParts.hour,
                      minute: event.target.value.split(':')[1] || scheduledPickerParts.minute
                    })
                  )
                )
              }
            />
          </div>
        </FormField>
      </div>

      {restoredFromLastOrder ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <div className="flex items-start gap-3">
            <AppIcon name="refresh" className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">Ultimo pedido.</p>
              <p className="mt-1 text-xs opacity-80">
                {restoredFromLastOrder.customerName} • pedido #{restoredFromLastOrder.orderId}
                {restoredFromLastOrder.referenceLabel ? ` • ${restoredFromLastOrder.referenceLabel}` : ''}
              </p>
              <p className="mt-1 text-xs opacity-80">Revise e crie.</p>
            </div>
          </div>
        </div>
      ) : null}

      <details className="app-details">
        <summary>
          <span className="inline-flex items-center gap-2">
            <AppIcon name="tools" className="h-4 w-4" />
            Mais
          </span>
        </summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <FormField label="Desconto">
            <input
              className="app-input"
              placeholder="0,00"
              value={newOrderDiscount}
              inputMode="decimal"
              onChange={(e) => onDiscountChange(e.target.value)}
              onBlur={onDiscountBlur}
            />
          </FormField>
          <FormField label="Obs.">
            <input
              className="app-input"
              placeholder="Obs."
              value={newOrderNotes}
              onChange={(e) => onNotesChange(e.target.value)}
            />
          </FormField>
        </div>
      </details>

      <div
        className={`rounded-2xl border px-4 py-3 text-sm ${
          hasOpenVirtualBox
            ? 'border-amber-200 bg-amber-50 text-amber-950'
            : draftTotalUnits > 0
              ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
              : 'border-neutral-200 bg-white text-neutral-700'
        }`}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.1em] opacity-70">Caixas</p>
        <p className="mt-1 font-semibold">
          {formatVirtualBoxProgress(displayTotalUnits, remainingUnitsToCloseBox)}
        </p>
        {hasOpenVirtualBox ? (
          <p className="mt-1 text-xs opacity-75">
            Faltam {remainingUnitsToCloseBox} un para fechar a caixa.
          </p>
        ) : displayTotalUnits > 0 ? (
          <p className="mt-1 text-xs opacity-75">Todas as caixas estao fechadas.</p>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {productsForCards.map((product) => {
          const selectedQty = quantityByProductId.get(product.id!) || 0;
          const isSelected = selectedQty > 0;
          const productImage = resolveOrderCardImage(product.name);
          const productReferenceImage = resolveOrderReferenceImage(product.name);
          return (
            <div
              key={product.id}
              data-quick-order-product-id={product.id}
              className={`order-quick-create__product-card rounded-2xl border p-3 transition ${
                isSelected
                  ? 'border-amber-200 bg-amber-50/80 shadow-[0_10px_26px_rgba(168,112,42,0.12)]'
                  : 'border-white/80 bg-white/80'
              }`}
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="relative h-16 w-16 shrink-0">
                  <div className="relative h-full w-full overflow-hidden rounded-2xl border border-white/80 bg-white/80 shadow-[0_10px_24px_rgba(70,44,26,0.08)]">
                    <Image
                      alt={compactOrderProductName(product.name)}
                      className="h-full w-full object-cover"
                      fill
                      sizes="64px"
                      src={productImage}
                    />
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_24%,rgba(46,29,20,0.12)_100%)]" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 h-10 w-8 overflow-hidden rounded-xl border border-white/90 bg-white/90 shadow-[0_10px_18px_rgba(70,44,26,0.16)]">
                    <Image
                      alt={`${compactOrderProductName(product.name)} no cardapio oficial`}
                      className="h-full w-full object-cover"
                      fill
                      sizes="32px"
                      src={productReferenceImage}
                    />
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_34%,rgba(46,29,20,0.06)_100%)]" />
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-900">{compactOrderProductName(product.name)}</p>
                </div>
              </div>
              <div className="mt-3 grid gap-2">
                <div className="order-quick-create__product-actions flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="order-quick-create__qty-button app-button app-button-ghost"
                    onClick={() => onDecrementProduct(product.id!)}
                    disabled={selectedQty <= 0}
                  >
                    -
                  </button>
                  <span className="order-quick-create__qty-value min-w-10 text-center text-sm font-semibold text-neutral-900">
                    {selectedQty}
                  </span>
                  <button
                    type="button"
                    className="order-quick-create__qty-button app-button app-button-ghost"
                    onClick={() => onAddProductUnits(product.id!, 1)}
                  >
                    +1
                  </button>
                  <button
                    type="button"
                    className="order-quick-create__qty-button app-button app-button-ghost"
                    onClick={() => onAddProductUnits(product.id!, 3)}
                  >
                    +3
                  </button>
                  <button
                    type="button"
                    className="order-quick-create__qty-button app-button app-button-ghost"
                    onClick={() => onAddProductUnits(product.id!, 4)}
                  >
                    +4
                  </button>
                  <button
                    type="button"
                    className="order-quick-create__qty-button order-quick-create__qty-button--primary app-button app-button-primary"
                    onClick={() => onAddProductUnits(product.id!, BOX_UNITS)}
                  >
                    +1 cx
                  </button>
                </div>
                {hasOpenVirtualBox ? (
                  <button
                    type="button"
                    className="order-quick-create__close-box app-button app-button-ghost w-full"
                    onClick={() => onAddProductUnits(product.id!, remainingUnitsToCloseBox)}
                  >
                    Fechar (+{remainingUnitsToCloseBox})
                  </button>
                ) : displayTotalUnits > 0 ? (
                  <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-xs font-semibold text-emerald-800">
                    Fechada
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
        <div
          data-quick-order-product-id="mista"
          className={`order-quick-create__product-card rounded-2xl border p-3 transition ${
            mistaShortcutStack.length > 0
              ? 'border-amber-200 bg-amber-50/80 shadow-[0_10px_26px_rgba(168,112,42,0.12)]'
              : 'border-white/80 bg-white/80'
          }`}
        >
          <div className="flex flex-wrap items-start gap-3">
            <div className="relative h-16 w-16 shrink-0">
              <div className="relative h-full w-full overflow-hidden rounded-2xl border border-white/80 bg-white/80 shadow-[0_10px_24px_rgba(70,44,26,0.08)]">
                <Image
                  alt="Caixa mista"
                  className="h-full w-full object-cover"
                  fill
                  sizes="64px"
                  src="/querobroa-brand/green-composition.jpg"
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_24%,rgba(46,29,20,0.12)_100%)]" />
              </div>
              <div className="absolute -bottom-1 -right-1 h-10 w-8 overflow-hidden rounded-xl border border-white/90 bg-white/90 shadow-[0_10px_18px_rgba(70,44,26,0.16)]">
                <Image
                  alt="Sabores no cardapio oficial"
                  className="h-full w-full object-cover"
                  fill
                  sizes="32px"
                  src={ORDER_SABORES_REFERENCE_IMAGE}
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_34%,rgba(46,29,20,0.06)_100%)]" />
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-900">Mista (M)</p>
            </div>
          </div>
          <div className="mt-3 grid gap-2">
            <div className="order-quick-create__product-actions flex flex-wrap items-center gap-2">
              <span className="order-quick-create__qty-value min-w-10 text-center text-sm font-semibold text-neutral-900">
                {mistaShortcutStack.length}
              </span>
              {MISTA_SHORTCUT_CODES.map((code) => {
                const canApplyShortcut = Boolean(
                  flavorShortcutProductIds.T && flavorShortcutProductIds[code]
                );
                return (
                  <button
                    key={`mista-shortcut-${code}`}
                    type="button"
                    className="order-quick-create__qty-button app-button app-button-ghost"
                    onClick={() => applyMistaShortcut(code)}
                    disabled={!canApplyShortcut}
                  >
                    {code}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="app-form-actions">
        <button
          className="order-quick-create__submit app-button app-button-primary w-full md:w-auto disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onCreateOrder}
          disabled={!canCreateOrder || isCreatingOrder}
        >
          {isCreatingOrder ? 'Criando...' : 'Criar'}
        </button>
      </div>

      {newOrderItems.length > 0 ? (
        <div className="grid gap-2 text-sm text-neutral-600">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
            Resumo
          </p>
          {virtualBoxPartitions.boxes.length > 0 || virtualBoxPartitions.openBox.length > 0 ? (
            <div className="grid gap-2 rounded-2xl border border-white/70 bg-white/80 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
                Caixas
              </p>
              {virtualBoxPartitions.boxes.map((box, index) => (
                <div
                  key={`virtual-box-${index + 1}`}
                  className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800">
                        #{index + 1}
                      </span>
                      <span className="truncate text-xs font-semibold text-emerald-900">
                        {resolveVirtualBoxOfficialName(box)}
                      </span>
                    </div>
                    <span className="text-xs font-semibold text-emerald-800">1 cx</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-emerald-950">
                    {formatVirtualBoxParts(box)}
                  </p>
                </div>
              ))}
              {virtualBoxPartitions.openBox.length > 0 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800">
                      Aberta
                    </span>
                    <span className="text-xs font-semibold text-amber-800">
                      {virtualBoxPartitions.openBoxUnits}/7 cx
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-amber-950">
                    {formatVirtualBoxParts(virtualBoxPartitions.openBox)}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {orderError ? <p className="text-xs text-red-600">{orderError}</p> : null}
      {!canCreateOrder && !orderError && !tutorialMode ? (
        <p className="text-xs text-neutral-500">Escolha um cliente.</p>
      ) : null}
    </div>
  );
}
