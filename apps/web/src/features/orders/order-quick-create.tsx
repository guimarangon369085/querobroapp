'use client';

import type { Product } from '@querobroapp/shared';
import { FormField } from '@/components/form/FormField';
import { formatCurrencyBR } from '@/lib/format';

type SelectOption = {
  id: number;
  label: string;
};

type OrderQuickCreateProps = {
  tutorialMode: boolean;
  customerOptions: SelectOption[];
  productOptions: SelectOption[];
  customerSearch: string;
  draftProductSearch: string;
  draftQty: number;
  newOrderScheduledAt: string;
  newOrderDiscount: string;
  newOrderNotes: string;
  newOrderItems: Array<{ productId: number; quantity: number }>;
  canCreateOrder: boolean;
  orderError: string | null;
  draftSubtotal: number;
  draftDiscount: number;
  draftTotal: number;
  productMap: Map<number, Product>;
  onCustomerSearchChange: (value: string) => void;
  onProductSearchChange: (value: string) => void;
  onDraftQtyChange: (value: string) => void;
  onScheduledAtChange: (value: string) => void;
  onDiscountChange: (value: string) => void;
  onDiscountBlur: () => void;
  onNotesChange: (value: string) => void;
  onAddItemDraft: () => void;
  onCreateOrder: () => void;
  onRemoveDraftItem: (index: number) => void;
  onClearDraft: () => void;
};

export function OrderQuickCreate({
  tutorialMode,
  customerOptions,
  productOptions,
  customerSearch,
  draftProductSearch,
  draftQty,
  newOrderScheduledAt,
  newOrderDiscount,
  newOrderNotes,
  newOrderItems,
  canCreateOrder,
  orderError,
  draftSubtotal,
  draftDiscount,
  draftTotal,
  productMap,
  onCustomerSearchChange,
  onProductSearchChange,
  onDraftQtyChange,
  onScheduledAtChange,
  onDiscountChange,
  onDiscountBlur,
  onNotesChange,
  onAddItemDraft,
  onCreateOrder,
  onRemoveDraftItem,
  onClearDraft
}: OrderQuickCreateProps) {
  return (
    <div className="app-panel grid gap-5">
      <div className="app-inline-actions">
        <button className="app-button app-button-ghost" onClick={onClearDraft}>
          Limpar rascunho
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <FormField label="Cliente" hint="Digite para buscar e selecione">
          <input
            className="app-input"
            list="customers-list"
            placeholder="Buscar cliente..."
            value={customerSearch}
            onChange={(e) => onCustomerSearchChange(e.target.value)}
          />
          <datalist id="customers-list">
            {customerOptions.map((customer) => (
              <option key={customer.id} value={customer.label} />
            ))}
          </datalist>
        </FormField>
        <FormField label="Produto" hint="Digite para buscar">
          <input
            className="app-input"
            list="products-list"
            placeholder="Buscar produto..."
            value={draftProductSearch}
            onChange={(e) => onProductSearchChange(e.target.value)}
          />
          <datalist id="products-list">
            {productOptions.map((product) => (
              <option key={product.id} value={product.label} />
            ))}
          </datalist>
        </FormField>
        <FormField label="Quantidade">
          <input
            className="app-input"
            type="number"
            min={1}
            value={draftQty}
            onChange={(e) => onDraftQtyChange(e.target.value)}
          />
        </FormField>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label="Data e horario" hint="Agenda principal do pedido">
          <input
            className="app-input"
            type="datetime-local"
            value={newOrderScheduledAt}
            onChange={(e) => onScheduledAtChange(e.target.value)}
          />
        </FormField>
        <FormField label="Desconto (R$)" hint="Opcional">
          <input
            className="app-input"
            placeholder="0,00"
            value={newOrderDiscount}
            inputMode="decimal"
            onChange={(e) => onDiscountChange(e.target.value)}
            onBlur={onDiscountBlur}
          />
        </FormField>
      </div>
      <details className="app-details">
        <summary>Mais opcoes</summary>
        <div className="mt-3 grid gap-3">
          <FormField label="Observacoes" hint="Opcional">
            <input
              className="app-input"
              placeholder="Observacoes do pedido"
              value={newOrderNotes}
              onChange={(e) => onNotesChange(e.target.value)}
            />
          </FormField>
        </div>
      </details>
      <div className="app-form-actions app-form-actions--mobile-sticky">
        <button className="app-button app-button-ghost" onClick={onAddItemDraft}>
          Adicionar item
        </button>
        <button
          className="app-button app-button-primary disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onCreateOrder}
          disabled={!canCreateOrder}
        >
          Criar pedido
        </button>
      </div>
      {newOrderItems.length > 0 ? (
        <div className="grid gap-2 text-sm text-neutral-600">
          {newOrderItems.map((item, index) => {
            const product = productMap.get(item.productId);
            const total = (product?.price ?? 0) * item.quantity;
            return (
              <div
                key={`${item.productId}-${index}`}
                className="flex items-center justify-between rounded-lg border border-white/60 bg-white/70 px-3 py-2"
              >
                <div>
                  <p className="text-neutral-800">
                    {product?.name ?? `Produto ${item.productId}`} x {item.quantity}
                  </p>
                  <p className="text-xs text-neutral-500">{formatCurrencyBR(total)}</p>
                </div>
                <button className="app-button app-button-danger" onClick={() => onRemoveDraftItem(index)}>
                  Remover
                </button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center justify-between rounded-lg bg-white/70 px-3 py-2 text-sm">
            <span>Subtotal</span>
            <span className="font-semibold">{formatCurrencyBR(draftSubtotal)}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between rounded-lg bg-white/70 px-3 py-2 text-sm">
            <span>Desconto</span>
            <span className="font-semibold">{formatCurrencyBR(draftDiscount)}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between rounded-lg bg-white/90 px-3 py-2 text-sm">
            <span>Total</span>
            <span className="font-semibold">{formatCurrencyBR(draftTotal)}</span>
          </div>
        </div>
      ) : null}
      {orderError ? <p className="text-xs text-red-600">{orderError}</p> : null}
      {!canCreateOrder && !orderError && !tutorialMode ? (
        <p className="text-xs text-neutral-500">
          Selecione um cliente e pelo menos um item para criar o pedido.
        </p>
      ) : null}
    </div>
  );
}
