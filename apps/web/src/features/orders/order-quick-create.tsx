'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  EXTERNAL_ORDER_DELIVERY_WINDOWS,
  resolveExternalOrderDeliveryWindowKeyForDate,
  resolveExternalOrderDeliveryWindowLabel,
  type ExternalOrderDeliveryWindowKey,
  type Product
} from '@querobroapp/shared';
import { AppIcon } from '@/components/app-icons';
import { FormField } from '@/components/form/FormField';
import { formatCurrencyBR } from '@/lib/format';
import { OrderCardArtwork } from './order-card-artwork';
import type { DeliveryQuote } from './orders-model';
import {
  ORDER_BOX_UNITS,
  ORDER_BOX_PRICE_CUSTOM,
  buildRuntimeOrderCatalog,
  compactOrderProductName,
  resolveOrderCardArt,
  resolveRuntimeOrderItemGroup,
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
  onScheduledWindowPick: (windowKey: ExternalOrderDeliveryWindowKey) => void;
  onDiscountChange: (value: string) => void;
  onDiscountBlur: () => void;
  onNotesChange: (value: string) => void;
  onCreateOrder: () => void;
  onRefreshDeliveryQuote: () => void;
  onClearDraft: () => void;
  onDecrementProduct: (productId: number) => void;
  onAddProductUnits: (productId: number, units: number) => void;
  onSetProductQuantity: (productId: number, quantity: number) => void;
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
  onScheduledWindowPick,
  onDiscountChange,
  onDiscountBlur,
  onNotesChange,
  onCreateOrder,
  onRefreshDeliveryQuote,
  onClearDraft,
  onDecrementProduct,
  onAddProductUnits,
  onSetProductQuantity
}: OrderQuickCreateProps) {
  const [mistaShortcutStack, setMistaShortcutStack] = useState<number[]>([]);
  const [isFulfillmentModeCoolingDown, setIsFulfillmentModeCoolingDown] = useState(false);
  const fulfillmentModeCooldownTimeoutRef = useRef<number | null>(null);
  const quickCreateProductMap = useMemo(
    () => new Map(productsForCards.map((product) => [product.id!, product] as const)),
    [productsForCards]
  );
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
    isFulfillmentModeCoolingDown ||
    (requiresDeliveryQuote && isQuotingDelivery) ||
    (hasReadyDeliveryQuote
      ? !canCreateOrder
      : !selectedCustomerId || newOrderItems.length === 0);
  const runtimeCatalog = useMemo(() => buildRuntimeOrderCatalog(productsForCards), [productsForCards]);
  const flavorProductsForCards = useMemo(
    () =>
      runtimeCatalog.flavorProducts
        .map((product) => quickCreateProductMap.get(product.id))
        .filter((product): product is Product => Boolean(product)),
    [quickCreateProductMap, runtimeCatalog]
  );
  const companionProductsForCards = useMemo(
    () =>
      runtimeCatalog.companionProducts
        .map((product) => ({
          runtime: product,
          product: quickCreateProductMap.get(product.id) ?? productMap.get(product.id)
        }))
        .filter((entry): entry is { runtime: (typeof runtimeCatalog.companionProducts)[number]; product: Product } =>
          Boolean(entry.product)
        ),
    [productMap, quickCreateProductMap, runtimeCatalog]
  );
  const mistaShortcutOptions = useMemo(
    () =>
      runtimeCatalog.boxEntries.filter((entry) => entry.kind === 'MIXED'),
    [runtimeCatalog]
  );
  const virtualBoxPartitions = useMemo(() => {
    const remainingByProductId = new Map<number, number>(
      newOrderItems
        .filter((item) => resolveRuntimeOrderItemGroup(productMap.get(item.productId)) === 'FLAVOR')
        .map((item) => [item.productId, Math.max(Math.floor(item.quantity || 0), 0)] as const)
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
  const companionUnits = useMemo(
    () =>
      newOrderItems.reduce((sum, item) => {
        if (resolveRuntimeOrderItemGroup(productMap.get(item.productId)) !== 'COMPANION') return sum;
        return sum + Math.max(Math.floor(item.quantity || 0), 0);
      }, 0),
    [newOrderItems, productMap]
  );
  const scheduledPickerParts = useMemo(
    () => splitDateTimeLocalPickerParts(newOrderScheduledAt),
    [newOrderScheduledAt]
  );
  const scheduledWindowKey = useMemo(() => {
    const parsed = new Date(newOrderScheduledAt);
    if (Number.isNaN(parsed.getTime())) return null;
    return resolveExternalOrderDeliveryWindowKeyForDate(parsed);
  }, [newOrderScheduledAt]);
  const scheduledWindowLabel = useMemo(
    () => resolveExternalOrderDeliveryWindowLabel(scheduledWindowKey),
    [scheduledWindowKey]
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
  const singleBoxEntries = useMemo(
    () => runtimeCatalog.boxEntries.filter((entry) => entry.kind === 'SINGLE'),
    [runtimeCatalog]
  );
  const mixedBoxEntries = useMemo(
    () => runtimeCatalog.boxEntries.filter((entry) => entry.kind === 'MIXED'),
    [runtimeCatalog]
  );
  const mixedBoxCountsByFlavorId = useMemo(() => {
    const counts = new Map<number, number>();
    for (const flavorId of mistaShortcutStack) {
      counts.set(flavorId, (counts.get(flavorId) || 0) + 1);
    }
    return counts;
  }, [mistaShortcutStack]);
  const mixedReservedUnitsByProductId = useMemo(() => {
    const reserved = new Map<number, number>();
    const traditionalId = runtimeCatalog.traditionalFlavor?.id;
    for (const flavorId of mistaShortcutStack) {
      if (traditionalId) {
        reserved.set(traditionalId, (reserved.get(traditionalId) || 0) + 4);
      }
      reserved.set(flavorId, (reserved.get(flavorId) || 0) + 3);
    }
    return reserved;
  }, [mistaShortcutStack, runtimeCatalog.traditionalFlavor?.id]);
  const singleBoxCountByProductId = useMemo(() => {
    const counts = new Map<number, number>();
    for (const entry of singleBoxEntries) {
      const totalUnits = quantityByProductId.get(entry.productId) || 0;
      const mixedReservedUnits = mixedReservedUnitsByProductId.get(entry.productId) || 0;
      const eligibleUnits = Math.max(totalUnits - mixedReservedUnits, 0);
      counts.set(entry.productId, Math.floor(eligibleUnits / BOX_UNITS));
    }
    return counts;
  }, [mixedReservedUnitsByProductId, quantityByProductId, singleBoxEntries]);
  const customUnitsByProductId = useMemo(() => {
    const counts = new Map<number, number>();
    for (const product of flavorProductsForCards) {
      const totalUnits = quantityByProductId.get(product.id!) || 0;
      const mixedReservedUnits = mixedReservedUnitsByProductId.get(product.id!) || 0;
      const singleBoxUnits = (singleBoxCountByProductId.get(product.id!) || 0) * BOX_UNITS;
      counts.set(product.id!, Math.max(totalUnits - mixedReservedUnits - singleBoxUnits, 0));
    }
    return counts;
  }, [flavorProductsForCards, mixedReservedUnitsByProductId, quantityByProductId, singleBoxCountByProductId]);

  useEffect(() => {
    if (newOrderItems.length === 0 && mistaShortcutStack.length > 0) {
      setMistaShortcutStack([]);
    }
  }, [mistaShortcutStack.length, newOrderItems.length]);

  useEffect(() => {
    return () => {
      if (fulfillmentModeCooldownTimeoutRef.current !== null) {
        window.clearTimeout(fulfillmentModeCooldownTimeoutRef.current);
      }
    };
  }, []);

  const armFulfillmentModeCooldown = () => {
    if (typeof window === 'undefined') return;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if (fulfillmentModeCooldownTimeoutRef.current !== null) {
      window.clearTimeout(fulfillmentModeCooldownTimeoutRef.current);
    }
    setIsFulfillmentModeCoolingDown(true);
    fulfillmentModeCooldownTimeoutRef.current = window.setTimeout(() => {
      setIsFulfillmentModeCoolingDown(false);
      fulfillmentModeCooldownTimeoutRef.current = null;
    }, 420);
  };

  const applyMistaShortcut = (flavorId: number) => {
    const traditionalId = runtimeCatalog.traditionalFlavor?.id;
    if (!traditionalId || !flavorId) return;

    onAddProductUnits(traditionalId, 4);
    onAddProductUnits(flavorId, 3);
    setMistaShortcutStack((current) => [...current, flavorId]);
  };

  const removeMistaShortcut = (flavorId: number) => {
    const traditionalId = runtimeCatalog.traditionalFlavor?.id;
    if (!traditionalId || !flavorId) return;
    const currentTraditionalQty = quantityByProductId.get(traditionalId) || 0;
    const currentFlavorQty = quantityByProductId.get(flavorId) || 0;
    if (currentTraditionalQty < 4 || currentFlavorQty < 3) return;
    const nextIndex = mistaShortcutStack.lastIndexOf(flavorId);
    if (nextIndex < 0) return;

    onSetProductQuantity(traditionalId, currentTraditionalQty - 4);
    onSetProductQuantity(flavorId, currentFlavorQty - 3);
    setMistaShortcutStack((current) => {
      const next = [...current];
      next.splice(nextIndex, 1);
      return next;
    });
  };

  const setSingleBoxCount = (productId: number, nextBoxCountRaw: number) => {
    const normalizedBoxCount = Math.max(Math.floor(nextBoxCountRaw), 0);
    const mixedReservedUnits = mixedReservedUnitsByProductId.get(productId) || 0;
    const customUnits = customUnitsByProductId.get(productId) || 0;
    onSetProductQuantity(productId, mixedReservedUnits + normalizedBoxCount * BOX_UNITS + customUnits);
  };

  const adjustCustomFlavorUnits = (productId: number, delta: number) => {
    const normalizedDelta = Math.trunc(delta);
    if (normalizedDelta === 0) return;
    const mixedReservedUnits = mixedReservedUnitsByProductId.get(productId) || 0;
    const singleBoxUnits = (singleBoxCountByProductId.get(productId) || 0) * BOX_UNITS;
    const customUnits = customUnitsByProductId.get(productId) || 0;
    const nextCustomUnits = Math.max(customUnits + normalizedDelta, 0);
    onSetProductQuantity(productId, mixedReservedUnits + singleBoxUnits + nextCustomUnits);
  };

  const handlePrimaryAction = () => {
    if (isFulfillmentModeCoolingDown) return;
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

      <div className="public-order-layout">
        <div className="grid gap-4 rounded-[26px] border border-[rgba(126,79,45,0.1)] bg-[rgb(255,253,250)] p-4 shadow-[0_22px_60px_rgba(70,44,26,0.1)] sm:gap-5 sm:rounded-[32px] sm:p-6 sm:shadow-[0_26px_90px_rgba(70,44,26,0.1)] xl:rounded-none xl:border-0 xl:bg-transparent xl:p-0 xl:shadow-none">
          <div className="public-order-intake-grid">
            <section className="rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-white p-4 sm:rounded-[28px] sm:p-6 xl:h-full xl:p-7">
              <div className="mb-4 flex items-center justify-between gap-4 sm:mb-5">
                <div>
                  <h2 className="text-[1.35rem] font-semibold text-[color:var(--ink-strong)] sm:text-2xl">Dados</h2>
                </div>
                <Link href="/clientes" className="app-button app-button-ghost text-xs">
                  Novo cliente
                </Link>
              </div>
              <div className="grid gap-4 xl:grid-cols-1">
                <FormField label="Cliente">
                  <input
                    className="app-input xl:h-14 xl:text-[1.02rem]"
                    list="customers-list"
                    placeholder="Nome do cliente"
                    value={customerSearch}
                    onChange={(event) => onCustomerSearchChange(event.target.value)}
                    autoCapitalize="words"
                  />
                </FormField>
                <datalist id="customers-list">
                  {customerOptions.map((customer) => (
                    <option key={customer.id} value={customer.label} />
                  ))}
                </datalist>
                {!selectedCustomerId && customerSuggestions.length > 0 ? (
                  <div className="grid gap-2 rounded-2xl border border-[color:var(--line-soft)] bg-white p-2">
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
                {selectedCustomerId ? (
                  <div className="grid gap-3">
                    {customerAddressOptions.length > 0 ? (
                      <FormField
                        label={fulfillmentMode === 'DELIVERY' ? 'Endereço do pedido' : 'Ponto de retirada'}
                      >
                        <select
                          className="app-input xl:h-14 xl:text-[1.02rem]"
                          value={selectedCustomerAddressKey}
                          onChange={(event) => onCustomerAddressKeyChange(event.target.value)}
                        >
                          {customerAddressOptions.map((option) => (
                            <option key={option.key} value={option.key}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </FormField>
                    ) : null}
                    <div className="rounded-[18px] border border-[rgba(126,79,45,0.08)] bg-[rgb(250,245,239)] px-4 py-3 text-sm text-[color:var(--ink-muted)]">
                      {selectedCustomerAddressLabel || 'Endereço não informado.'}
                    </div>
                  </div>
                ) : customerSearch.trim() ? (
                  <p className="text-xs text-[color:var(--ink-muted)]">
                    Selecione um cliente da lista para vincular o pedido corretamente.
                  </p>
                ) : (
                  <p className="text-xs text-[color:var(--ink-muted)]">Escolha um cliente para começar.</p>
                )}
              </div>
            </section>

            <section className="public-order-fulfillment-section rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-white p-4 sm:rounded-[28px] sm:p-6 xl:p-7">
              <div className="mb-4 sm:mb-5">
                <h2 className="text-[1.35rem] font-semibold text-[color:var(--ink-strong)] sm:text-2xl">
                  Entrega ou retirada
                </h2>
              </div>

              <div className="public-order-mode-grid">
                {([
                  {
                    value: 'DELIVERY' as const,
                    title: 'Entrega',
                    description: 'Receber no endereço do cliente.'
                  },
                  {
                    value: 'PICKUP' as const,
                    title: 'Retirada',
                    description: 'Buscar no local combinado.'
                  }
                ] as const).map((option) => {
                  const active = fulfillmentMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        if (fulfillmentMode === option.value) return;
                        armFulfillmentModeCooldown();
                        onFulfillmentModeChange(option.value);
                      }}
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
                  <FormField label={fulfillmentMode === 'DELIVERY' ? 'Endereço para entrega' : 'Ponto de retirada'}>
                    <div className="app-input flex min-h-[56px] items-center xl:text-[1.02rem]">
                      {selectedCustomerAddressLabel || 'Selecione um cliente para ver o endereço.'}
                    </div>
                  </FormField>
                </div>
                <div className="public-order-schedule-grid__complement">
                  <FormField label="Data">
                    <input
                      className="app-input xl:h-14 xl:text-[1.02rem]"
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
                  </FormField>
                </div>
                <FormField label="Horario">
                  <input
                    className="app-input xl:h-14 xl:text-[1.02rem]"
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
                </FormField>
                <FormField label="Faixa de horario">
                  <div className="grid gap-2.5">
                    {EXTERNAL_ORDER_DELIVERY_WINDOWS.map((window) => {
                      const active = scheduledWindowKey === window.key;
                      return (
                        <button
                          key={window.key}
                          type="button"
                          onClick={() => onScheduledWindowPick(window.key)}
                          className={`rounded-[18px] border px-4 py-3 text-left transition ${
                            active
                              ? 'border-[rgba(181,68,57,0.28)] bg-[rgb(255,245,241)] shadow-[0_14px_28px_rgba(181,68,57,0.12)]'
                              : 'border-[rgba(126,79,45,0.12)] bg-[rgb(252,248,242)] hover:border-[rgba(126,79,45,0.22)]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-[color:var(--ink-strong)] xl:text-[1rem]">
                                {window.label}
                              </p>
                              <p className="mt-1 text-xs text-[color:var(--ink-muted)] xl:text-[0.9rem]">
                                {active ? 'Faixa escolhida' : 'Usar esta faixa'}
                              </p>
                            </div>
                            {active ? (
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

              <p className="mt-4 text-xs text-[color:var(--ink-muted)]">
                {scheduledWindowLabel
                  ? `Faixa publica atual: ${scheduledWindowLabel}.`
                  : 'Horario fora das 3 faixas publicas de /pedido.'}
              </p>
            </section>
          </div>

          <section className="rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-white p-4 sm:rounded-[28px] sm:p-6 xl:p-7">
            <div className="mb-4 flex flex-col gap-2 sm:mb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
              <div>
                <h2 className="text-[1.35rem] font-semibold text-[color:var(--ink-strong)] sm:text-2xl">
                  Caixas
                </h2>
              </div>
            </div>

            <div className="public-order-box-grid">
              {singleBoxEntries.map((entry) => {
                const boxCount = singleBoxCountByProductId.get(entry.productId) || 0;
                const active = boxCount > 0;
                return (
                  <article
                    key={entry.key}
                    data-quick-order-product-id={entry.productId}
                    className={`public-order-box-card group grid gap-3 overflow-hidden rounded-[22px] border p-3 shadow-[0_14px_28px_rgba(74,47,31,0.08)] transition-transform duration-300 hover:-translate-y-1 sm:gap-4 sm:rounded-[26px] sm:p-4 sm:shadow-[0_16px_38px_rgba(74,47,31,0.08)] xl:gap-4 xl:p-5 ${
                      entry.accentClassName
                    } ${active ? 'ring-1 ring-[rgba(181,68,57,0.16)]' : ''}`}
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
                          {formatCurrencyBR(entry.priceEstimate)}
                        </p>
                      </div>
                    </div>

                    <div className="public-order-box-card__controls">
                      <button
                        type="button"
                        onClick={() => setSingleBoxCount(entry.productId, Math.max(boxCount - 1, 0))}
                        className="public-order-box-card__stepper rounded-[16px] border border-white/85 bg-white font-semibold text-[color:var(--ink-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] transition hover:bg-white sm:rounded-[18px]"
                        aria-label={`Diminuir ${entry.label}`}
                      >
                        −
                      </button>
                      <div className="public-order-box-card__summary">
                        <input
                          className="app-input public-order-box-card__field text-center font-semibold"
                          inputMode="numeric"
                          value={boxCount > 0 ? String(boxCount) : ''}
                          onChange={(event) => {
                            const normalized = event.target.value.replace(/[^\d]/g, '');
                            setSingleBoxCount(entry.productId, normalized ? Number(normalized) : 0);
                          }}
                          placeholder="0"
                          aria-label={entry.label}
                        />
                        <div className="public-order-box-card__pill rounded-[16px] border border-white/80 bg-white sm:rounded-[18px]">
                          <span className="public-order-box-card__pill-count">{boxCount}</span>
                          <span className="public-order-box-card__pill-label">
                            {boxCount === 1 ? 'caixa' : 'caixas'}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSingleBoxCount(entry.productId, boxCount + 1)}
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
          </section>

          {mixedBoxEntries.length ? (
            <section
              data-quick-order-product-id="mista"
              className="rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-white p-4 sm:rounded-[28px] sm:p-6 xl:p-7"
            >
              <div className="rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-[rgb(247,239,230)] p-4 sm:rounded-[26px] sm:p-5 xl:p-6">
                <div className="mb-4 flex flex-col gap-2 sm:mb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                  <div>
                    <h2 className="text-[1.1rem] font-semibold text-[color:var(--ink-strong)] sm:text-[1.35rem]">
                      Caixas Mistas
                    </h2>
                    <p className="mt-1 text-[0.82rem] leading-5 text-[color:var(--ink-muted)] sm:text-sm">
                      1 caixa = 4 tradicionais + 3 broas de um sabor
                    </p>
                  </div>
                </div>
                <div className="public-order-box-grid">
                  {mixedBoxEntries.map((entry) => {
                    const mixedQty = mixedBoxCountsByFlavorId.get(entry.productId) || 0;
                    const canApplyShortcut = Boolean(
                      runtimeCatalog.traditionalFlavor && runtimeCatalog.flavorProductById.get(entry.productId)
                    );
                    return (
                      <article
                        key={`mista-shortcut-${entry.productId}`}
                        className={`public-order-box-card group grid gap-3 overflow-hidden rounded-[22px] border p-3 shadow-[0_14px_28px_rgba(74,47,31,0.08)] transition-transform duration-300 hover:-translate-y-1 sm:gap-4 sm:rounded-[26px] sm:p-4 sm:shadow-[0_16px_38px_rgba(74,47,31,0.08)] xl:gap-4 xl:p-5 ${entry.accentClassName} ${
                          mixedQty > 0 ? 'ring-1 ring-[rgba(181,68,57,0.16)]' : ''
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
                              {formatCurrencyBR(entry.priceEstimate)}
                            </p>
                          </div>
                        </div>
                        <div className="public-order-box-card__controls">
                          <button
                            type="button"
                            onClick={() => removeMistaShortcut(entry.productId)}
                            className="public-order-box-card__stepper rounded-[16px] border border-white/85 bg-white font-semibold text-[color:var(--ink-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] transition hover:bg-white sm:rounded-[18px]"
                            disabled={mixedQty <= 0}
                            aria-label={`Diminuir ${entry.label}`}
                          >
                            −
                          </button>
                          <div className="public-order-box-card__summary">
                            <div className="public-order-box-card__pill rounded-[16px] border border-white/80 bg-white sm:rounded-[18px]">
                              <span className="public-order-box-card__pill-count">{mixedQty}</span>
                              <span className="public-order-box-card__pill-label">
                                {mixedQty === 1 ? 'caixa' : 'caixas'}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => applyMistaShortcut(entry.productId)}
                            className="public-order-box-card__stepper rounded-[16px] border border-white/85 bg-white font-semibold text-[color:var(--ink-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] transition hover:bg-white sm:rounded-[18px]"
                            disabled={!canApplyShortcut}
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
            </section>
          ) : null}

          <section className="rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-white p-4 sm:rounded-[28px] sm:p-6 xl:p-7">
            <div className="mt-0 rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-[rgb(247,239,230)] p-4 sm:rounded-[26px] sm:p-5 xl:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between xl:items-center">
                <div>
                  <h3 className="text-[1.1rem] font-semibold text-[color:var(--ink-strong)] sm:text-[1.35rem]">
                    Monte Sua Caixa
                  </h3>
                  <p className="mt-1 text-[0.82rem] leading-5 text-[color:var(--ink-muted)] sm:text-sm">
                    Monte sua caixa com 7 broas como quiser!
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[color:var(--ink-strong)]">
                    {formatCurrencyBR(ORDER_BOX_PRICE_CUSTOM)}
                  </p>
                </div>
              </div>

              <div className="public-order-custom-grid mt-4">
                <article
                  className={`public-order-custom-card rounded-[20px] border p-4 xl:p-5 ${
                    hasOpenVirtualBox
                      ? 'border-[color:var(--tone-gold-line)] bg-[color:var(--tone-gold-surface)]'
                      : draftTotalUnits > 0
                        ? 'border-[color:var(--tone-sage-line)] bg-[color:var(--tone-sage-surface)]'
                        : 'border-white/80 bg-white'
                  }`}
                >
                  <div className="public-order-custom-card__header">
                    <div>
                      <p className="text-sm font-semibold text-[color:var(--ink-strong)]">Monte Sua Caixa #1</p>
                      <p className="mt-1 text-[0.82rem] leading-5 text-[color:var(--ink-muted)]">
                        {displayTotalUnits === 0
                          ? 'Monte sua caixa com 7 broas.'
                          : hasOpenVirtualBox
                            ? `Faltam ${remainingUnitsToCloseBox}.`
                            : 'Fechada.'}
                      </p>
                    </div>
                    <div className="public-order-custom-card__meta">
                      <span className="rounded-full border border-white/80 bg-white px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)] sm:text-xs">
                        {displayTotalUnits}/7
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2">
                    {flavorProductsForCards.map((product) => {
                      const quantity = customUnitsByProductId.get(product.id!) || 0;
                      const productArt = resolveOrderCardArt(product);
                      return (
                        <div
                          key={`custom-row-${product.id}`}
                          className="public-order-custom-row rounded-[16px] border border-white/80 bg-white px-3 py-2.5"
                        >
                          <div className="public-order-custom-row__info">
                            <div className="relative h-10 w-10 shrink-0">
                              <div className="relative h-full w-full overflow-hidden rounded-xl border border-white/80 bg-white shadow-[0_8px_18px_rgba(70,44,26,0.08)]">
                                <OrderCardArtwork
                                  alt={compactOrderProductName(product.name)}
                                  art={productArt}
                                  sizes="40px"
                                />
                              </div>
                            </div>
                            <p className="public-order-custom-row__label text-[0.82rem] font-semibold text-[color:var(--ink-strong)] sm:text-sm">
                              {compactOrderProductName(product.name)}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="public-order-custom-row__button h-10 rounded-[14px] border border-white/85 bg-white text-[1.15rem] font-semibold text-[color:var(--ink-strong)] transition hover:bg-white sm:text-xl"
                            onClick={() => adjustCustomFlavorUnits(product.id!, -1)}
                            disabled={quantity <= 0}
                            aria-label={`Diminuir ${compactOrderProductName(product.name)} na Monte Sua Caixa`}
                          >
                            −
                          </button>
                          <div className="public-order-custom-row__qty text-center text-[0.82rem] font-semibold text-[color:var(--ink-strong)] sm:text-sm">
                            {quantity}
                          </div>
                          <button
                            type="button"
                            className="public-order-custom-row__button h-10 rounded-[14px] border border-white/85 bg-white text-[1.15rem] font-semibold text-[color:var(--ink-strong)] transition hover:bg-white sm:text-xl"
                            onClick={() => adjustCustomFlavorUnits(product.id!, 1)}
                            aria-label={`Aumentar ${compactOrderProductName(product.name)} na Monte Sua Caixa`}
                          >
                            +
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </article>
              </div>
            </div>
          </section>

          {companionProductsForCards.length ? (
            <section className="rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-white p-4 sm:rounded-[28px] sm:p-6 xl:p-7">
              <div className="public-order-companion-header mb-4 flex flex-col gap-2 sm:mb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                <div className="public-order-companion-header__copy">
                  <h2 className="text-[1.35rem] font-semibold text-[color:var(--ink-strong)] sm:text-2xl">
                    AMIGAS DA BROA
                  </h2>
                  <p className="public-order-companion-header__note mt-1 text-[0.82rem] leading-5 text-[color:var(--ink-muted)] sm:text-sm">
                    Selecione os adicionais sem misturar a regra de desconto das broas.
                  </p>
                </div>
              </div>

              <div className="public-order-box-rail-shell public-order-box-rail-shell--companion">
                <div className="public-order-box-rail public-order-box-rail--companion">
                  {companionProductsForCards.map(({ runtime, product }) => {
                    const selectedQty = quantityByProductId.get(product.id!) || 0;
                    const isSelected = selectedQty > 0;
                    const temporarilyOutOfStock = runtime.temporarilyOutOfStock;
                    const productArt = resolveOrderCardArt(product);
                    const secondaryLine = [runtime.displayFlavor, runtime.measureLabel].filter(Boolean).join(' • ');
                    return (
                      <article
                        key={`companion-${product.id}`}
                        data-quick-order-product-id={`companion-${product.id}`}
                        className={`public-order-box-card public-order-box-card--rail public-order-box-card--companion group grid gap-3 overflow-hidden rounded-[22px] border p-3 shadow-[0_14px_28px_rgba(74,47,31,0.08)] sm:gap-4 sm:rounded-[26px] sm:p-4 sm:shadow-[0_16px_38px_rgba(74,47,31,0.08)] xl:gap-4 xl:p-5 border-[color:var(--tone-sage-line)] bg-[linear-gradient(165deg,var(--tone-sage-surface),rgba(251,253,252,0.98))] ${
                          isSelected ? 'ring-1 ring-[rgba(84,116,91,0.18)]' : ''
                        }`}
                      >
                        <div className="public-order-box-card__hero public-order-box-card__hero--companion">
                          <div className="public-order-box-card__media public-order-box-card__media--companion relative shrink-0">
                            <div className="public-order-box-card__art-surface relative h-full w-full overflow-hidden rounded-[18px] bg-white sm:rounded-[22px] xl:rounded-[24px]">
                              <OrderCardArtwork
                                alt={runtime.label}
                                art={productArt}
                                className="bg-white"
                                imageClassName={`h-full w-full object-contain ${
                                  temporarilyOutOfStock ? 'grayscale opacity-70' : ''
                                }`}
                                overlayClassName="absolute inset-0 bg-transparent"
                                managedUploadFit="contain-tight"
                                sizes="(max-width: 640px) 100px, (max-width: 1279px) 132px, (max-width: 1535px) 42vw, 22vw"
                              />
                            </div>
                          </div>
                          <div className="public-order-box-card__body public-order-box-card__body--companion">
                            <h3 className="public-order-box-card__title public-order-box-card__title--companion text-[0.96rem] font-semibold leading-tight tracking-[-0.02em] text-[color:var(--ink-strong)] sm:text-lg xl:text-[1.08rem]">
                              <span>{runtime.displayTitle || compactOrderProductName(product.name)}</span>
                            </h3>
                            <div className="public-order-box-card__detail public-order-box-card__detail--companion mt-2 grid gap-0.5 text-[0.76rem] leading-[1.35] text-[color:var(--ink-muted)] sm:text-sm sm:leading-6 xl:text-[0.84rem] xl:leading-6">
                              {secondaryLine ? <p>{secondaryLine}</p> : null}
                              {runtime.displayMakerLine ? <p>{runtime.displayMakerLine}</p> : null}
                            </div>
                            {temporarilyOutOfStock ? (
                              <p className="mt-2 text-[0.68rem] font-semibold uppercase leading-5 tracking-[0.08em] text-[color:var(--tone-roast-ink)] sm:text-[0.72rem]">
                                Temporariamente sem estoque
                              </p>
                            ) : null}
                            <p className="public-order-box-card__price public-order-box-card__price--companion mt-1 text-sm font-semibold text-[color:var(--ink-strong)] xl:pt-3 xl:text-[1rem]">
                              {formatCurrencyBR(Number(product.price || 0))}
                            </p>
                          </div>
                        </div>

                        <div className="public-order-box-card__controls public-order-box-card__controls--companion">
                          <button
                            type="button"
                            onClick={() => onDecrementProduct(product.id!)}
                            className="public-order-box-card__stepper public-order-box-card__stepper--companion rounded-[16px] border border-white/85 bg-white font-semibold text-[color:var(--ink-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] transition hover:bg-white sm:rounded-[18px]"
                            disabled={selectedQty <= 0}
                            aria-label={`Diminuir ${runtime.label}`}
                          >
                            −
                          </button>
                          <div className="public-order-box-card__summary public-order-box-card__summary--companion">
                            <div className="public-order-box-card__pill public-order-box-card__pill--companion rounded-[16px] border border-white/80 bg-white sm:rounded-[18px]">
                              <span className="public-order-box-card__pill-count public-order-box-card__pill-count--companion">
                                {selectedQty}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onAddProductUnits(product.id!, 1)}
                            className="public-order-box-card__stepper public-order-box-card__stepper--companion rounded-[16px] border border-white/85 bg-white font-semibold text-[color:var(--ink-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] transition hover:bg-white sm:rounded-[18px]"
                            disabled={temporarilyOutOfStock}
                            aria-label={`Aumentar ${runtime.label}`}
                          >
                            +
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}

          <section className="rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-white p-4 sm:rounded-[28px] sm:p-6 xl:p-7">
            <div className="mb-4">
              <h2 className="text-[1.35rem] font-semibold text-[color:var(--ink-strong)] sm:text-2xl">Observacoes</h2>
            </div>
            <FormField label="Observacoes do pedido">
              <textarea
                className="app-textarea min-h-[120px]"
                value={newOrderNotes}
                onChange={(event) => onNotesChange(event.target.value)}
                placeholder="Ex.: tocar o interfone, confirmar retirada antes, evitar atraso."
              />
            </FormField>
          </section>

          <section className="rounded-[22px] border border-[rgba(126,79,45,0.08)] bg-white p-4 sm:rounded-[28px] sm:p-6 xl:p-7">
            <div className="mb-4">
                  <h2 className="text-[1.35rem] font-semibold text-[color:var(--ink-strong)] sm:text-2xl">Desconto</h2>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--ink-muted)]">
                    O desconto interno segue a regra operacional e pode zerar o frete quando atingir 100%.
                  </p>
                </div>
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                <FormField label="Desconto (%)">
                  <input
                    className="app-input xl:h-14 xl:text-[1.02rem]"
                    placeholder="0 a 100"
                    value={newOrderDiscountPct}
                    inputMode="decimal"
                    onChange={(event) => onDiscountChange(event.target.value)}
                    onBlur={onDiscountBlur}
                  />
                </FormField>
                <div className="rounded-[18px] border border-[rgba(126,79,45,0.08)] bg-[rgb(250,245,239)] px-4 py-3 text-sm font-semibold text-[color:var(--ink-strong)]">
                  {newOrderDiscountPct && newOrderDiscountPct !== '0' ? `${newOrderDiscountPct}%` : '0%'}
                </div>
              </div>
          </section>

          {orderError ? (
            <div className="app-inline-notice app-inline-notice--error rounded-[24px] px-5 py-4 shadow-[0_14px_32px_rgba(157,31,44,0.08)]">
              {orderError}
            </div>
          ) : null}
        </div>

        <aside className="grid gap-4 self-start sm:gap-5 xl:sticky xl:top-6">
          <section className="order-1 overflow-hidden rounded-[24px] border border-[rgba(126,79,45,0.1)] bg-[linear-gradient(165deg,#fffcf8,#f3e7d8)] p-4 shadow-[0_18px_40px_rgba(70,44,26,0.1)] sm:rounded-[30px] sm:p-5 sm:shadow-[0_26px_80px_rgba(70,44,26,0.12)] xl:max-h-[calc(var(--app-vh,1vh)*100-10rem)] xl:overflow-y-auto xl:p-4 2xl:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[1.35rem] font-semibold text-[color:var(--ink-strong)] sm:text-2xl">Pedido</h2>
              </div>
              <div className="rounded-full bg-white px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)] sm:text-xs">
                {fulfillmentMode === 'DELIVERY' ? 'Entrega' : 'Retirada'}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:mt-5">
              <div className="grid gap-2 rounded-[20px] bg-white p-4 sm:rounded-[24px]">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-[18px] border border-[rgba(126,79,45,0.08)] bg-white px-3 py-3">
                    <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                      Caixas
                    </span>
                    <strong className="mt-1 block text-[1.35rem] text-[color:var(--ink-strong)]">
                      {virtualBoxPartitions.boxes.length}
                    </strong>
                  </div>
                  <div className="rounded-[18px] border border-[rgba(126,79,45,0.08)] bg-white px-3 py-3">
                    <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                      Broas
                    </span>
                    <strong className="mt-1 block text-[1.35rem] text-[color:var(--ink-strong)]">{displayTotalUnits}</strong>
                  </div>
                  <div className="rounded-[18px] border border-[rgba(126,79,45,0.08)] bg-white px-3 py-3">
                    <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                      Amigas
                    </span>
                    <strong className="mt-1 block text-[1.35rem] text-[color:var(--ink-strong)]">{companionUnits}</strong>
                  </div>
                  <div className="rounded-[18px] border border-[rgba(126,79,45,0.08)] bg-white px-3 py-3">
                    <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                      Subtotal
                    </span>
                    <strong className="mt-1 block text-base text-[color:var(--ink-strong)]">
                      {formatCurrencyBR(draftSubtotal)}
                    </strong>
                  </div>
                  <div className="rounded-[18px] border border-[rgba(126,79,45,0.08)] bg-white px-3 py-3 sm:col-span-2">
                    <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                      Investimento marketing
                    </span>
                    <strong className="mt-1 block text-base text-[color:var(--ink-strong)]">
                      {`${newOrderDiscountPct && newOrderDiscountPct !== '0' ? `${newOrderDiscountPct}%` : '0%'} • ${formatCurrencyBR(marketingInvestmentTotal)}`}
                    </strong>
                  </div>
                  <div className="rounded-[18px] border border-[rgba(126,79,45,0.08)] bg-white px-3 py-3 sm:col-span-2">
                    <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">
                      Frete estimado
                    </span>
                    <strong className="mt-1 block text-base text-[color:var(--ink-strong)]">
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
                      className="rounded-2xl border border-[color:var(--tone-sage-line)] bg-[color:var(--tone-sage-surface)] px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--tone-sage-ink)]">
                            #{index + 1}
                          </span>
                          <span className="truncate text-xs font-semibold text-[color:var(--tone-sage-ink)]">
                            {resolveVirtualBoxOfficialName(box)}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-[color:var(--tone-sage-ink)]">1 cx</span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-[color:var(--tone-sage-ink)]">
                        {formatVirtualBoxParts(box)}
                      </p>
                    </div>
                  ))}
                  {virtualBoxPartitions.openBox.length > 0 ? (
                    <div className="rounded-2xl border border-[color:var(--tone-gold-line)] bg-[color:var(--tone-gold-surface)] px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--tone-gold-ink)]">
                          Aberta
                        </span>
                        <span className="text-xs font-semibold text-[color:var(--tone-gold-ink)]">
                          {virtualBoxPartitions.openBoxUnits}/7 cx
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-[color:var(--tone-gold-ink)]">
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

              <button
                type="button"
                className="app-button app-button-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handlePrimaryAction}
                disabled={primaryActionDisabled}
              >
                {primaryActionLabel}
              </button>

              {!canCreateOrder && !orderError && !tutorialMode ? (
                <p className="text-xs text-neutral-500">
                  {!selectedCustomerId
                    ? 'Escolha um cliente.'
                    : newOrderItems.length === 0
                      ? 'Escolha ao menos um item.'
                      : requiresDeliveryQuote && isQuotingDelivery
                        ? 'Aguarde a cotação do frete.'
                        : requiresDeliveryQuote && !hasReadyDeliveryQuote
                          ? 'Calcule o frete para liberar a criação.'
                          : 'Revise o pedido.'}
                </p>
              ) : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
