'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { Product } from '@querobroapp/shared';
import { AppIcon } from '@/components/app-icons';
import { FormField } from '@/components/form/FormField';
import { formatCurrencyBR } from '@/lib/format';
import { OrderCardArtwork } from './order-card-artwork';
import type { DeliveryQuote } from './orders-model';
import {
  ORDER_BOX_UNITS,
  buildRuntimeOrderCatalog,
  compactOrderProductName,
  resolveOrderCardArt,
  resolveOrderVirtualBoxLabel
} from './order-box-catalog';

const BOX_UNITS = ORDER_BOX_UNITS;

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
  customerAddressOptions: Array<{ key: string; label: string }>;
  productsForCards: Product[];
  fulfillmentMode: 'DELIVERY' | 'PICKUP';
  customerSearch: string;
  selectedCustomerId: number | '';
  selectedCustomerAddressKey: string;
  selectedCustomerAddressLabel: string;
  restoredFromLastOrder?: {
    orderId: number;
    customerName: string;
    referenceLabel: string;
  } | null;
  newOrderScheduledAt: string;
  newOrderDiscountPct: string;
  newOrderNotes: string;
  newOrderItems: Array<{ productId: number; quantity: number }>;
  draftTotalUnits: number;
  virtualBoxRemainingUnits: number;
  canCreateOrder: boolean;
  isCreatingOrder: boolean;
  isQuotingDelivery: boolean;
  orderError: string | null;
  draftSubtotal: number;
  draftDiscount: number;
  draftTotal: number;
  deliveryQuote: DeliveryQuote | null;
  deliveryQuoteError: string | null;
  productMap: Map<number, Product>;
  onFulfillmentModeChange: (value: 'DELIVERY' | 'PICKUP') => void;
  onCustomerSearchChange: (value: string) => void;
  onCustomerOptionPick: (option: SelectOption) => void;
  onCustomerAddressKeyChange: (value: string) => void;
  onScheduledAtChange: (value: string) => void;
  onDiscountChange: (value: string) => void;
  onDiscountBlur: () => void;
  onNotesChange: (value: string) => void;
  onCreateOrder: () => void;
  onRefreshDeliveryQuote: () => void;
  onClearDraft: () => void;
  onDecrementProduct: (productId: number) => void;
  onAddProductUnits: (productId: number, units: number) => void;
};

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
  return resolveOrderVirtualBoxLabel(parts);
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
  customerAddressOptions,
  productsForCards,
  customerSearch,
  fulfillmentMode,
  selectedCustomerId,
  selectedCustomerAddressKey,
  selectedCustomerAddressLabel,
  restoredFromLastOrder,
  newOrderScheduledAt,
  newOrderDiscountPct,
  newOrderNotes,
  newOrderItems,
  draftTotalUnits,
  virtualBoxRemainingUnits,
  canCreateOrder,
  isCreatingOrder,
  isQuotingDelivery,
  orderError,
  draftSubtotal,
  draftDiscount,
  draftTotal,
  deliveryQuote,
  deliveryQuoteError,
  productMap,
  onFulfillmentModeChange,
  onCustomerSearchChange,
  onCustomerOptionPick,
  onCustomerAddressKeyChange,
  onScheduledAtChange,
  onDiscountChange,
  onDiscountBlur,
  onNotesChange,
  onCreateOrder,
  onRefreshDeliveryQuote,
  onClearDraft,
  onDecrementProduct,
  onAddProductUnits
}: OrderQuickCreateProps) {
  const [mistaShortcutStack, setMistaShortcutStack] = useState<number[]>([]);
  const quantityByProductId = new Map(
    newOrderItems.map((item) => [item.productId, item.quantity] as const)
  );
  const draftCustomerLabel = customerSearch.trim() || 'Escolha um cliente';
  const requiresDeliveryQuote = fulfillmentMode === 'DELIVERY';
  const quotedDeliveryFee = requiresDeliveryQuote ? deliveryQuote?.fee ?? 0 : 0;
  const sponsoredDeliveryFee = requiresDeliveryQuote && Number(draftDiscount) >= Number(draftSubtotal) && draftSubtotal > 0
    ? quotedDeliveryFee
    : 0;
  const deliveryFee = sponsoredDeliveryFee > 0 ? 0 : quotedDeliveryFee;
  const marketingInvestmentTotal = draftDiscount + sponsoredDeliveryFee;
  const draftGrandTotal = draftTotal + deliveryFee;
  const hasReadyDeliveryQuote = !requiresDeliveryQuote || Boolean(deliveryQuote?.quoteToken);
  const primaryActionLabel = isCreatingOrder
    ? 'Criando pedido...'
    : requiresDeliveryQuote && isQuotingDelivery
      ? 'Calculando frete...'
      : hasReadyDeliveryQuote
        ? 'Criar pedido'
        : 'Calcular frete';
  const primaryActionDisabled =
    isCreatingOrder ||
    (requiresDeliveryQuote && isQuotingDelivery) ||
    (hasReadyDeliveryQuote
      ? !canCreateOrder
      : !selectedCustomerId || newOrderItems.length === 0);
  const runtimeCatalog = useMemo(() => buildRuntimeOrderCatalog(productsForCards), [productsForCards]);
  const mistaShortcutOptions = useMemo(
    () =>
      runtimeCatalog.boxEntries.filter((entry) => entry.kind === 'MIXED'),
    [runtimeCatalog]
  );
  const virtualBoxPartitions = useMemo(() => {
    const remainingByProductId = new Map<number, number>(
      newOrderItems.map((item) => [item.productId, Math.max(Math.floor(item.quantity || 0), 0)] as const)
    );
    const mistaBoxes: VirtualBoxPart[][] = [];

    for (const flavorId of mistaShortcutStack) {
      const traditionalId = runtimeCatalog.traditionalFlavor?.id;
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
          productName: compactOrderProductName(productMap.get(flavorId)?.name ?? `Produto ${flavorId}`),
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
  }, [mistaShortcutStack, newOrderItems, productMap, runtimeCatalog.traditionalFlavor?.id]);
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
  const customerSuggestions = useMemo(() => {
    const raw = customerSearch.trim().toLowerCase();
    if (!raw) return [];
    return customerOptions
      .filter((option) => {
        const full = option.label.toLowerCase();
        const withoutId = option.label.replace(/\s*\(#\d+\)\s*$/, '').trim().toLowerCase();
        return full.includes(raw) || withoutId.includes(raw);
      })
      .slice(0, 6);
  }, [customerOptions, customerSearch]);

  useEffect(() => {
    if (newOrderItems.length === 0 && mistaShortcutStack.length > 0) {
      setMistaShortcutStack([]);
    }
  }, [mistaShortcutStack.length, newOrderItems.length]);

  const applyMistaShortcut = (flavorId: number) => {
    const traditionalId = runtimeCatalog.traditionalFlavor?.id;
    if (!traditionalId || !flavorId) return;

    onAddProductUnits(traditionalId, 4);
    onAddProductUnits(flavorId, 3);
    setMistaShortcutStack((current) => [...current, flavorId]);
  };

  const handlePrimaryAction = () => {
    if (!hasReadyDeliveryQuote) {
      onRefreshDeliveryQuote();
      return;
    }
    onCreateOrder();
  };

  return (
    <div className="order-quick-create grid gap-5">
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

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3 sm:col-span-2 xl:col-span-1">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500">Atendimento</p>
          <div className="mt-2 inline-flex rounded-full border border-[color:var(--line-soft)] bg-[rgba(255,251,246,0.92)] p-1">
            {(['DELIVERY', 'PICKUP'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  fulfillmentMode === mode
                    ? 'bg-[color:var(--ink-strong)] text-white'
                    : 'text-neutral-600'
                }`}
                onClick={() => onFulfillmentModeChange(mode)}
              >
                {mode === 'DELIVERY' ? 'Entrega' : 'Retirada'}
              </button>
            ))}
          </div>
        </div>
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
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500">Frete</p>
          <p className="mt-1 text-base font-semibold text-neutral-900">
            {!requiresDeliveryQuote
              ? 'Sem frete'
              : isQuotingDelivery
              ? 'Cotando...'
              : deliveryQuote
                ? sponsoredDeliveryFee > 0
                  ? `Marketing • ${formatCurrencyBR(sponsoredDeliveryFee)}`
                  : formatCurrencyBR(deliveryFee)
                : 'A confirmar'}
          </p>
        </div>
        <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500">Total</p>
          <p className="mt-1 text-base font-semibold text-neutral-900">{formatCurrencyBR(draftGrandTotal)}</p>
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
          {!selectedCustomerId && customerSuggestions.length > 0 ? (
            <div className="grid gap-2 rounded-2xl border border-[color:var(--line-soft)] bg-white/85 p-2">
              {customerSuggestions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="app-button app-button-ghost w-full justify-start text-left normal-case tracking-[0.02em]"
                  onClick={() => onCustomerOptionPick(option)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          {!selectedCustomerId && customerSearch.trim() ? (
            <p className="text-xs text-neutral-500">
              Selecione um cliente da lista para vincular o pedido corretamente.
            </p>
          ) : null}
          {selectedCustomerId ? (
            <div className="grid gap-2">
              {customerAddressOptions.length > 0 ? (
                <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500">
                  Endereço do pedido
                  <select
                    className="app-input text-sm normal-case tracking-normal text-neutral-800"
                    value={selectedCustomerAddressKey}
                    onChange={(event) => onCustomerAddressKeyChange(event.target.value)}
                  >
                    {customerAddressOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <p className="text-xs text-neutral-500">
                {selectedCustomerAddressLabel || 'Endereco nao informado.'}
              </p>
            </div>
          ) : null}
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
          <FormField label="Desconto (%)">
            <input
              className="app-input"
              placeholder="0 a 100"
              value={newOrderDiscountPct}
              inputMode="decimal"
              aria-describedby="order-discount-pct-hint"
              onChange={(e) => onDiscountChange(e.target.value)}
              onBlur={onDiscountBlur}
            />
            <p id="order-discount-pct-hint" className="mt-1 text-xs text-[color:var(--ink-muted)]">
              Campo livre de 0% a 100%.
            </p>
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3">
        {productsForCards.map((product) => {
          const selectedQty = quantityByProductId.get(product.id!) || 0;
          const isSelected = selectedQty > 0;
          const productArt = resolveOrderCardArt(product);
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
              <div className="grid grid-cols-[84px_minmax(0,1fr)] items-start gap-4">
                <div className="relative h-[84px] w-[84px] shrink-0">
                  <div className="relative h-full w-full overflow-hidden rounded-[22px] border border-white/80 bg-white/80 shadow-[0_12px_28px_rgba(70,44,26,0.1)]">
                    <OrderCardArtwork
                      alt={compactOrderProductName(product.name)}
                      art={productArt}
                      sizes="84px"
                    />
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="text-[0.96rem] font-semibold leading-tight text-[color:var(--ink-strong)]">
                    {compactOrderProductName(product.name)}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-2 border-t border-[rgba(126,79,45,0.08)] pt-4">
                <div className="order-quick-create__product-primary grid grid-cols-[54px_minmax(0,1fr)_54px] items-center gap-2">
                  <button
                    type="button"
                    className="order-quick-create__qty-button app-button app-button-ghost"
                    onClick={() => onDecrementProduct(product.id!)}
                    disabled={selectedQty <= 0}
                  >
                    -
                  </button>
                  <span className="order-quick-create__qty-value rounded-2xl border border-white/80 bg-white/88 px-3 py-2.5 text-center text-sm font-semibold text-neutral-900">
                    {selectedQty}
                  </span>
                  <button
                    type="button"
                    className="order-quick-create__qty-button app-button app-button-ghost"
                    onClick={() => onAddProductUnits(product.id!, 1)}
                  >
                    +1
                  </button>
                </div>
                <div className="order-quick-create__product-secondary grid grid-cols-3 gap-2">
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
      </div>

      <div
        data-quick-order-product-id="mista"
        className={`order-quick-create__product-card rounded-2xl border p-4 transition ${
          mistaShortcutStack.length > 0
            ? 'border-amber-200 bg-amber-50/80 shadow-[0_10px_26px_rgba(168,112,42,0.12)]'
            : 'border-white/80 bg-white/80'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.96rem] font-semibold text-[color:var(--ink-strong)]">Caixas mistas</p>
          </div>
          <span className="rounded-full border border-white/80 bg-white/86 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
            {mistaShortcutStack.length} mista{mistaShortcutStack.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {mistaShortcutOptions.map((entry) => {
            const canApplyShortcut = Boolean(runtimeCatalog.traditionalFlavor && runtimeCatalog.flavorProductById.get(entry.productId));
            return (
              <button
                key={`mista-shortcut-${entry.productId}`}
                type="button"
                className="flex items-center gap-3 rounded-2xl border border-white/80 bg-white/82 px-3 py-3 text-left transition hover:border-[rgba(126,79,45,0.18)] hover:bg-white disabled:cursor-not-allowed disabled:opacity-55"
                onClick={() => applyMistaShortcut(entry.productId)}
                disabled={!canApplyShortcut}
              >
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-2xl border border-white/85 bg-white shadow-[0_10px_22px_rgba(70,44,26,0.08)]">
                  <OrderCardArtwork alt={entry.label} art={entry.art} sizes="48px" />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">
                    M
                  </p>
                  <p className="line-clamp-2 text-sm font-semibold text-[color:var(--ink-strong)]">
                    {entry.label.replace(/^Mista\s+/i, '')}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2 text-sm text-[color:var(--ink-muted)]">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">
          Resumo
        </p>
        <div className="grid gap-3 rounded-[24px] border border-white/75 bg-[linear-gradient(160deg,rgba(255,251,246,0.94),rgba(243,231,216,0.9))] p-4 shadow-[0_14px_34px_rgba(70,44,26,0.08)]">
          <div className="grid gap-2 rounded-[20px] bg-white/80 p-4">
            <div className="flex items-center justify-between gap-3">
              <span>Caixas fechadas</span>
              <strong className="text-[color:var(--ink-strong)]">{virtualBoxPartitions.boxes.length}</strong>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Broas calculadas</span>
              <strong className="text-[color:var(--ink-strong)]">{displayTotalUnits}</strong>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Produtos</span>
              <strong className="text-[color:var(--ink-strong)]">{formatCurrencyBR(draftSubtotal)}</strong>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Investimento marketing</span>
              <strong className="text-[color:var(--ink-strong)]">
                {`${newOrderDiscountPct && newOrderDiscountPct !== '0' ? `${newOrderDiscountPct}%` : '0%'} • ${formatCurrencyBR(marketingInvestmentTotal)}`}
              </strong>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Frete estimado</span>
              <strong className="text-[color:var(--ink-strong)]">
                {!requiresDeliveryQuote
                  ? 'Sem frete'
                  : isQuotingDelivery
                  ? 'Calculando...'
                  : deliveryQuote
                    ? sponsoredDeliveryFee > 0
                      ? `Marketing • ${formatCurrencyBR(sponsoredDeliveryFee)}`
                      : formatCurrencyBR(deliveryFee)
                    : 'A confirmar'}
              </strong>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-[rgba(126,79,45,0.08)] pt-3">
              <span className="font-semibold text-[color:var(--ink-strong)]">Total</span>
              <strong className="text-base text-[color:var(--ink-strong)]">
                {formatCurrencyBR(draftGrandTotal)}
              </strong>
            </div>
            <p className="text-xs leading-5 text-[color:var(--ink-muted)]">
              O percentual vira investimento de marketing em amostras. Com 100% de desconto, o frete tambem zera para recebimento e entra como marketing.
            </p>
          </div>

          {virtualBoxPartitions.boxes.length > 0 || virtualBoxPartitions.openBox.length > 0 ? (
            <div className="grid gap-2 rounded-2xl border border-white/70 bg-white/80 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]">
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
          ) : (
            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm">
              Nenhuma caixa ainda.
            </div>
          )}

          {requiresDeliveryQuote && deliveryQuoteError ? (
            <div className="app-inline-notice app-inline-notice--warning rounded-[20px] px-4 py-3">
              {deliveryQuoteError}
            </div>
          ) : requiresDeliveryQuote && deliveryQuote ? (
            <div className="rounded-[20px] border border-[rgba(126,79,45,0.08)] bg-white/80 px-4 py-3 text-xs leading-5 text-[color:var(--ink-muted)]">
              {deliveryQuote.expiresAt ? 'Frete calculado e pronto para uso neste pedido.' : 'Frete calculado para este pedido.'}
            </div>
          ) : !requiresDeliveryQuote ? (
            <div className="rounded-[20px] border border-[rgba(126,79,45,0.08)] bg-white/80 px-4 py-3 text-xs leading-5 text-[color:var(--ink-muted)]">
              Pedido de retirada sem frete.
            </div>
          ) : null}
        </div>
      </div>

      <div className="app-form-actions">
        <button
          className="order-quick-create__submit app-button app-button-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handlePrimaryAction}
          disabled={primaryActionDisabled}
        >
          {primaryActionLabel}
        </button>
      </div>
      {orderError ? <p className="text-xs text-red-600">{orderError}</p> : null}
      {!canCreateOrder && !orderError && !tutorialMode ? (
        <p className="text-xs text-neutral-500">
          {!selectedCustomerId
            ? 'Escolha um cliente.'
            : newOrderItems.length === 0
              ? 'Escolha ao menos uma caixa.'
              : requiresDeliveryQuote && isQuotingDelivery
                ? 'Aguarde a cotacao do frete.'
                : requiresDeliveryQuote && !hasReadyDeliveryQuote
                  ? 'Calcule o frete para liberar a criacao.'
                  : 'Revise o pedido.'}
        </p>
      ) : null}
    </div>
  );
}
