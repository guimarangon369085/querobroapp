'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IconBrandWhatsapp,
  IconCashBanknote,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconMotorbike,
} from '@tabler/icons-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { buildCustomerAddressAutofill } from '@/lib/customer-autofill';
import { compactWhitespace } from '@/lib/format';

type ConfirmationOrder = {
  id: number;
  publicNumber?: number | null;
  status?: string | null;
  scheduledAt?: string | null;
  fulfillmentMode: string;
  total?: number | null;
  paymentStatus?: string | null;
  customerName: string;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerAddressLine1?: string | null;
  customerAddressLine2?: string | null;
  customerNeighborhood?: string | null;
  customerDeliveryNotes?: string | null;
  flavorSummary: string;
  whatsappUrl: string | null;
};

type ConfirmationQueueResponse = {
  dateKey: string;
  orderCount: number;
  orders: ConfirmationOrder[];
};

const ORDER_STATUS_OPTIONS = [
  { value: 'ABERTO', label: 'ABERTO' },
  { value: 'PRONTO', label: 'PRONTO' },
  { value: 'ENTREGUE', label: 'ENTREGUE' },
] as const;

const moneyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
});

const FLAVOR_BADGE_CLASS_BY_CODE: Record<string, string> = {
  T: 'border-[#d7a06b] bg-[#fff4e8] text-[#8f5828]',
  G: 'border-[#dd6d8f] bg-[#fff0f5] text-[#a33c61]',
  D: 'border-[#c8873f] bg-[#fff1df] text-[#8e5518]',
  Q: 'border-[#d6b24a] bg-[#fff7dc] text-[#896610]',
  R: 'border-[#cdbb84] bg-[#fff9ea] text-[#7d6a2d]',
  RJ: 'border-[#db8f68] bg-[#fff0e8] text-[#9a4d2a]',
  P: 'border-[#7e4c31] bg-[#f6ebe3] text-[#5f331c]',
};

const ORDER_ROW_TONE_CLASS_BY_STATUS: Record<string, string> = {
  ABERTO:
    'border-[color:var(--tone-cream-line)] bg-[color:color-mix(in_srgb,var(--tone-cream-surface),white_38%)]',
  PRONTO:
    'border-[color:var(--tone-olive-line)] bg-[color:color-mix(in_srgb,var(--tone-olive-surface),white_44%)]',
  ENTREGUE:
    'border-[color:var(--tone-sage-line)] bg-[color:color-mix(in_srgb,var(--tone-sage-surface),white_42%)]',
  CANCELADO:
    'border-[color:var(--tone-danger-line)] bg-[color:color-mix(in_srgb,var(--tone-danger-surface),white_45%)]',
};

const ORDER_STATUS_CHIP_CLASS_BY_STATUS: Record<string, string> = {
  ABERTO:
    'border-[color:var(--tone-cream-line)] bg-[color:var(--tone-cream-surface)] text-[color:var(--tone-cream-ink)]',
  PRONTO:
    'border-[color:var(--tone-olive-line)] bg-[color:var(--tone-olive-surface)] text-[color:var(--tone-olive-ink)]',
  ENTREGUE:
    'border-[color:var(--tone-sage-line)] bg-[color:var(--tone-sage-surface)] text-[color:var(--tone-sage-ink)]',
  CANCELADO:
    'border-[color:var(--tone-danger-line)] bg-[color:var(--tone-danger-surface)] text-[color:var(--tone-danger-ink)]',
};

function normalizeOrderStatus(status?: string | null) {
  const normalized = String(status || '')
    .trim()
    .toUpperCase();
  if (normalized === 'CONFIRMADO' || normalized === 'EM_PREPARACAO' || normalized === 'NO_FORNO')
    return 'ABERTO';
  if (normalized === 'PRONTA') return 'PRONTO';
  return normalized || 'ABERTO';
}

function orderRowToneClass(status?: string | null) {
  const normalized = normalizeOrderStatus(status);
  return ORDER_ROW_TONE_CLASS_BY_STATUS[normalized] || ORDER_ROW_TONE_CLASS_BY_STATUS.ABERTO;
}

function orderStatusChipClass(status?: string | null) {
  const normalized = normalizeOrderStatus(status);
  return ORDER_STATUS_CHIP_CLASS_BY_STATUS[normalized] || ORDER_STATUS_CHIP_CLASS_BY_STATUS.ABERTO;
}

function normalizePaymentStatus(status?: string | null) {
  const normalized = String(status || '')
    .trim()
    .toUpperCase();
  if (normalized === 'PAGO' || normalized === 'PARCIAL') return normalized;
  return 'PENDENTE';
}

function parseFlavorSummary(summary?: string | null) {
  return String(summary || '')
    .split(/[•|,]/)
    .map((part) => compactWhitespace(part))
    .filter(Boolean)
    .map((part) => {
      const quantityFirst = part.match(/^(\d+)\s*x?\s*([A-Za-z]{1,2})$/);
      if (quantityFirst) {
        return {
          quantity: Number(quantityFirst[1]),
          code: String(quantityFirst[2] || '').toUpperCase(),
          raw: part,
        };
      }
      const codeFirst = part.match(/^([A-Za-z]{1,2})\s*[x×]\s*(\d+)$/);
      if (codeFirst) {
        return {
          quantity: Number(codeFirst[2]),
          code: String(codeFirst[1] || '').toUpperCase(),
          raw: part,
        };
      }
      return {
        quantity: null,
        code: null,
        raw: part,
      };
    });
}

function renderFlavorSummary(summary?: string | null) {
  const entries = parseFlavorSummary(summary);
  if (!entries.length) {
    return <div className="text-[color:var(--ink-muted)]">Sem composicao</div>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map((entry, index) => {
        if (!entry.code || entry.quantity == null) {
          return (
            <span
              key={`${entry.raw}-${index}`}
              className="inline-flex rounded-full border border-[color:var(--line-soft)] bg-white px-2 py-0.5 text-[11px] font-semibold text-[color:var(--ink-muted)]"
            >
              {entry.raw}
            </span>
          );
        }
        return (
          <span
            key={`${entry.code}-${index}`}
            className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${FLAVOR_BADGE_CLASS_BY_CODE[entry.code] || 'border-[color:var(--line-soft)] bg-white text-[color:var(--ink-muted)]'}`}
          >
            {entry.quantity}x{entry.code}
          </span>
        );
      })}
    </div>
  );
}

function currentDateKey() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date())
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatDateLabel(dateKey: string) {
  const parsed = new Date(`${dateKey}T12:00:00-03:00`);
  if (Number.isNaN(parsed.getTime())) return dateKey;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    weekday: 'long',
  }).format(parsed);
}

function shiftDateKey(dateKey: string, offsetDays: number) {
  const parsed = new Date(`${dateKey}T12:00:00-03:00`);
  if (Number.isNaN(parsed.getTime())) return dateKey;
  parsed.setUTCDate(parsed.getUTCDate() + offsetDays);
  return parsed.toISOString().slice(0, 10);
}

function formatTime(value?: string | null) {
  if (!value) return 'Sem horario';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Sem horario';
  return timeFormatter.format(parsed);
}

function formatMode(value: string) {
  return value === 'PICKUP' ? 'Retirada' : 'Entrega';
}

function buildDirectWhatsappUrl(order: ConfirmationOrder) {
  const normalizedPhone = String(order.customerPhone || '').replace(/\D/g, '');
  if (normalizedPhone) {
    return `https://wa.me/${normalizedPhone}`;
  }

  const rawUrl = String(order.whatsappUrl || '').trim();
  if (!rawUrl) return null;

  try {
    const parsed = new URL(rawUrl);
    const pathPhone = parsed.pathname.replace(/^\/+/, '').replace(/\D/g, '');
    if (pathPhone) {
      return `https://wa.me/${pathPhone}`;
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return rawUrl.split('?')[0] || null;
  }
}

function stripTrailingPostalCode(value: string) {
  return value
    .replace(/\b\d{5}-?\d{3}\b/g, '')
    .replace(/\s*,\s*$/, '')
    .trim();
}

function parseShortAddress(source: string) {
  const normalized = stripTrailingPostalCode(source).replace(/\s+/g, ' ').trim();
  if (!normalized) return { addressLine1: '', neighborhood: '' };

  const segments = normalized
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const first = segments[0] || '';
  const second = segments[1] || '';

  if (second.includes(' - ')) {
    const [numberPart, neighborhoodPart] = second.split(/\s+-\s+/, 2);
    return {
      addressLine1: [first, numberPart].filter(Boolean).join(', ').trim(),
      neighborhood: neighborhoodPart?.trim() || '',
    };
  }

  if (/^\d+[A-Za-z]?$/.test(second)) {
    return {
      addressLine1: [first, second].filter(Boolean).join(', ').trim(),
      neighborhood: segments[2]?.trim() || '',
    };
  }

  if (first.includes(' - ')) {
    const [addressLine1, neighborhood] = first.split(/\s+-\s+/, 2);
    return {
      addressLine1: addressLine1.trim(),
      neighborhood: neighborhood?.trim() || '',
    };
  }

  return {
    addressLine1: first,
    neighborhood: second && !/^[A-Za-zÀ-ÿ\s]+ - [A-Za-z]{2}$/u.test(second) ? second : '',
  };
}

function formatCustomerAddress(order: ConfirmationOrder) {
  const inferred = buildCustomerAddressAutofill(order.customerAddress || '');
  const parsedFromRaw = parseShortAddress(
    order.customerAddress || order.customerAddressLine1 || '',
  );
  const candidateLine1 = compactWhitespace(order.customerAddressLine1 || '');
  const candidateNeighborhood = compactWhitespace(order.customerNeighborhood || '');
  const addressLine1 = compactWhitespace(
    parsedFromRaw.addressLine1 || inferred.addressLine1 || candidateLine1,
  );
  const neighborhood = compactWhitespace(
    candidateNeighborhood || parsedFromRaw.neighborhood || inferred.neighborhood || '',
  );
  const addressLine2 = compactWhitespace(order.customerAddressLine2 || '');
  const deliveryNotesRaw = compactWhitespace(order.customerDeliveryNotes || '');
  const deliveryNotes =
    deliveryNotesRaw.startsWith('[') && deliveryNotesRaw.endsWith(']') ? '' : deliveryNotesRaw;
  const complement =
    addressLine2 && addressLine2.toLowerCase() === deliveryNotes.toLowerCase()
      ? addressLine2
      : addressLine2;
  const visibleAddress = [addressLine1, neighborhood, complement].filter(Boolean).join(', ');

  if (visibleAddress && deliveryNotes) {
    if (complement && complement.toLowerCase() === deliveryNotes.toLowerCase()) {
      return visibleAddress;
    }
    return `${visibleAddress} • Obs: ${deliveryNotes}`;
  }
  return visibleAddress || (deliveryNotes ? `Obs.: ${deliveryNotes}` : 'Sem endereço');
}

type OrderStatusControlProps = {
  orderId: number;
  status?: string | null;
  rowBusy: boolean;
  onChange: (orderId: number, status: string) => void;
  className?: string;
};

function OrderStatusControl({
  orderId,
  status,
  rowBusy,
  onChange,
  className = '',
}: OrderStatusControlProps) {
  return (
    <div
      className={`relative inline-flex min-w-[8.75rem] items-center rounded-full border shadow-sm transition ${orderStatusChipClass(status)} ${
        rowBusy ? 'opacity-75' : ''
      } ${className}`.trim()}
    >
      <select
        value={normalizeOrderStatus(status)}
        onChange={(event) => void onChange(orderId, event.target.value)}
        disabled={rowBusy}
        className="h-9 w-full appearance-none bg-transparent pl-3 pr-9 text-center text-[11px] font-semibold tracking-[0.18em] outline-none disabled:cursor-wait"
      >
        {ORDER_STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 opacity-70">
        <IconChevronDown size={14} stroke={2.2} aria-hidden="true" />
      </span>
    </div>
  );
}

type OrderActionButtonsProps = {
  order: ConfirmationOrder;
  rowBusy: boolean;
  isPaid: boolean;
  onTogglePaid: (orderId: number, nextPaid: boolean) => void;
};

function OrderActionButtons({ order, rowBusy, isPaid, onTogglePaid }: OrderActionButtonsProps) {
  return (
    <div className="flex items-center gap-2">
      {order.whatsappUrl ? (
        <>
          <a
            href={order.whatsappUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Abrir WhatsApp de ${order.customerName}`}
            title={`WhatsApp de ${order.customerName}`}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--tone-sage-line)] bg-[color:var(--tone-sage-surface)] text-[color:var(--tone-sage-ink)] shadow-sm transition-transform hover:scale-[1.03]"
          >
            <IconBrandWhatsapp size={20} stroke={1.9} aria-hidden="true" />
          </a>
          <a
            href={buildDirectWhatsappUrl(order) || order.whatsappUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Abrir WhatsApp de ${order.customerName} pelo atalho de entregue`}
            title={`Atalho entregue para ${order.customerName}`}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--tone-sage-line)] bg-[color:color-mix(in_srgb,var(--tone-sage-surface),white_16%)] text-[color:var(--tone-sage-ink)] shadow-sm transition-transform hover:scale-[1.03]"
          >
            <IconMotorbike size={20} stroke={1.9} aria-hidden="true" />
          </a>
        </>
      ) : (
        <span className="text-[color:var(--ink-muted)]">Sem link</span>
      )}
      <button
        type="button"
        onClick={() => void onTogglePaid(order.id, !isPaid)}
        disabled={rowBusy}
        aria-label={
          isPaid
            ? `Desmarcar pagamento de ${order.customerName}`
            : `Marcar pagamento como pago para ${order.customerName}`
        }
        title={
          isPaid
            ? `Desmarcar ${order.customerName} como pago`
            : `Marcar ${order.customerName} como pago`
        }
        className={`inline-flex h-10 w-10 items-center justify-center rounded-full border shadow-sm transition-transform ${
          isPaid
            ? 'border-[color:var(--tone-olive-line)] bg-[color:var(--tone-olive-surface)] text-[color:var(--tone-olive-ink)] hover:scale-[1.03]'
            : 'border-[color:var(--tone-cream-line)] bg-[color:var(--tone-cream-surface)] text-[color:var(--tone-cream-ink)] hover:scale-[1.03]'
        } ${rowBusy && !isPaid ? 'opacity-75' : ''}`}
      >
        <IconCashBanknote size={20} stroke={1.9} aria-hidden="true" />
      </button>
    </div>
  );
}

type OrderMobileCardProps = {
  order: ConfirmationOrder;
  statusUpdateOrderId: number | null;
  paymentUpdateOrderId: number | null;
  onUpdateStatus: (orderId: number, status: string) => void;
  onTogglePaid: (orderId: number, nextPaid: boolean) => void;
};

function OrderMobileCard({
  order,
  statusUpdateOrderId,
  paymentUpdateOrderId,
  onUpdateStatus,
  onTogglePaid,
}: OrderMobileCardProps) {
  const paymentStatus = normalizePaymentStatus(order.paymentStatus);
  const rowBusy = statusUpdateOrderId === order.id || paymentUpdateOrderId === order.id;
  const isPaid = paymentStatus === 'PAGO';

  return (
    <article
      className={`rounded-[24px] border p-4 shadow-[var(--shadow-soft)] ${orderRowToneClass(order.status)}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--ink-muted)]">
            {formatTime(order.scheduledAt)} • {formatMode(order.fulfillmentMode)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-[color:var(--ink-strong)]">
              {order.customerName}
            </h2>
            <span className="text-sm text-[color:var(--ink-muted)]">
              #{order.publicNumber || order.id}
            </span>
          </div>
          <p className="mt-1 text-sm text-[color:var(--ink-muted)]">
            {order.customerPhone || 'Sem telefone'}
          </p>
        </div>
        <OrderStatusControl
          orderId={order.id}
          status={order.status}
          rowBusy={rowBusy}
          onChange={onUpdateStatus}
          className="w-full sm:w-auto"
        />
      </div>

      <div className="mt-4 grid gap-3">
        <section className="rounded-[20px] border border-[color:var(--line-soft)] bg-white/80 px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--ink-muted)]">
            Endereço
          </p>
          <p className="mt-2 break-words text-sm leading-6 text-[color:var(--ink-muted)]">
            {formatCustomerAddress(order)}
          </p>
        </section>

        <section className="rounded-[20px] border border-[color:var(--line-soft)] bg-white/80 px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--ink-muted)]">
              Pedido
            </p>
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${isPaid ? 'border-[color:var(--tone-olive-line)] bg-[color:var(--tone-olive-surface)] text-[color:var(--tone-olive-ink)]' : 'border-[color:var(--tone-cream-line)] bg-[color:var(--tone-cream-surface)] text-[color:var(--tone-cream-ink)]'}`}
            >
              {isPaid ? 'Pago' : 'Pendente'}
            </span>
          </div>
          <div className="mt-2">{renderFlavorSummary(order.flavorSummary)}</div>
          <p className="mt-3 text-base font-semibold text-[color:var(--ink-strong)]">
            {moneyFormatter.format(Number(order.total || 0))}
          </p>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <OrderActionButtons
            order={order}
            rowBusy={rowBusy}
            isPaid={isPaid}
            onTogglePaid={onTogglePaid}
          />
        </div>
      </div>
    </article>
  );
}

export default function ConfirmacoesQueueScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dateKey = searchParams.get('date') || currentDateKey();
  const [data, setData] = useState<ConfirmationQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusUpdateOrderId, setStatusUpdateOrderId] = useState<number | null>(null);
  const [paymentUpdateOrderId, setPaymentUpdateOrderId] = useState<number | null>(null);
  const [statusActionError, setStatusActionError] = useState<string | null>(null);

  const changeDate = useCallback(
    (offsetDays: number) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set('date', shiftDateKey(dateKey, offsetDays));
      router.push(`${pathname}?${nextParams.toString()}`, { scroll: false });
    },
    [dateKey, pathname, router, searchParams],
  );

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatusActionError(null);
    try {
      const response = await fetch(
        `/api/internal/orders/daily-digest/preview?date=${encodeURIComponent(dateKey)}`,
        {
          method: 'GET',
          cache: 'no-store',
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | ConfirmationQueueResponse
        | { message?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          (payload as { message?: string } | null)?.message ||
            'Falha ao carregar a fila de confirmações.',
        );
      }
      setData(payload as ConfirmationQueueResponse);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : 'Falha ao carregar a fila de confirmações.',
      );
    } finally {
      setLoading(false);
    }
  }, [dateKey]);

  const updateOrderStatus = useCallback(
    async (orderId: number, status: string) => {
      if (statusUpdateOrderId != null || paymentUpdateOrderId != null) return;
      setStatusUpdateOrderId(orderId);
      setStatusActionError(null);
      try {
        const response = await fetch(`/api/internal/orders/${orderId}/status`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ status }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            (payload as { message?: string } | null)?.message || 'Falha ao atualizar o status.',
          );
        }
        const nextStatus = normalizeOrderStatus(
          (payload as { status?: string } | null)?.status || status,
        );
        setData((current) => {
          if (!current) return current;
          return {
            ...current,
            orders: current.orders.map((order) =>
              order.id === orderId
                ? {
                    ...order,
                    status: nextStatus,
                  }
                : order,
            ),
          };
        });
      } catch (updateError) {
        setStatusActionError(
          updateError instanceof Error ? updateError.message : 'Falha ao atualizar o status.',
        );
      } finally {
        setStatusUpdateOrderId(null);
      }
    },
    [paymentUpdateOrderId, statusUpdateOrderId],
  );

  const markOrderPaid = useCallback(
    async (orderId: number, nextPaid: boolean) => {
      if (paymentUpdateOrderId != null || statusUpdateOrderId != null) return;
      setPaymentUpdateOrderId(orderId);
      setStatusActionError(null);
      try {
        const response = await fetch(`/api/internal/orders/${orderId}/mark-paid`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ paid: nextPaid }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { paymentStatus?: string | null }
          | { message?: string }
          | null;
        if (!response.ok) {
          throw new Error(
            (payload as { message?: string } | null)?.message || 'Falha ao atualizar o pagamento.',
          );
        }
        const nextPaymentStatus = normalizePaymentStatus(
          (payload as { paymentStatus?: string | null } | null)?.paymentStatus,
        );
        setData((current) => {
          if (!current) return current;
          return {
            ...current,
            orders: current.orders.map((order) =>
              order.id === orderId
                ? {
                    ...order,
                    paymentStatus: nextPaymentStatus,
                  }
                : order,
            ),
          };
        });
      } catch (updateError) {
        setStatusActionError(
          updateError instanceof Error ? updateError.message : 'Falha ao atualizar o pagamento.',
        );
      } finally {
        setPaymentUpdateOrderId(null);
      }
    },
    [paymentUpdateOrderId, statusUpdateOrderId],
  );

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const totals = useMemo(() => {
    const orders = data?.orders || [];
    return {
      deliveries: orders.filter((order) => order.fulfillmentMode !== 'PICKUP').length,
      pickups: orders.filter((order) => order.fulfillmentMode === 'PICKUP').length,
      gross: orders.reduce((sum, order) => sum + Number(order.total || 0), 0),
    };
  }, [data]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <section className="rounded-[28px] border border-[color:var(--line-soft)] bg-[color:var(--bg-card)] px-5 py-5 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[color:var(--ink-muted)]">
              Confirmacoes do dia
            </p>
            <h1 className="text-3xl font-semibold text-[color:var(--ink-strong)]">
              {formatDateLabel(dateKey)}
            </h1>
            <p className="text-sm text-[color:var(--ink-muted)]">
              {loading
                ? 'Carregando fila...'
                : `${data?.orderCount || 0} pedido(s) na fila de confirmação`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => changeDate(-1)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[color:var(--line-soft)] bg-white text-[color:var(--ink-strong)] shadow-sm transition-transform hover:scale-[1.03]"
              aria-label="Ver dia anterior"
              title="Dia anterior"
            >
              <IconChevronLeft size={18} stroke={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => changeDate(1)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[color:var(--line-soft)] bg-white text-[color:var(--ink-strong)] shadow-sm transition-transform hover:scale-[1.03]"
              aria-label="Ver próximo dia"
              title="Próximo dia"
            >
              <IconChevronRight size={18} stroke={2} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[color:var(--line-soft)] bg-white px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.24em] text-[color:var(--ink-muted)]">
              Pedidos
            </p>
            <p className="mt-2 text-2xl font-semibold text-[color:var(--ink-strong)]">
              {data?.orderCount || 0}
            </p>
          </div>
          <div className="rounded-2xl border border-[color:var(--line-soft)] bg-white px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.24em] text-[color:var(--ink-muted)]">
              Entrega / retirada
            </p>
            <p className="mt-2 text-2xl font-semibold text-[color:var(--ink-strong)]">
              {totals.deliveries} / {totals.pickups}
            </p>
          </div>
          <div className="rounded-2xl border border-[color:var(--line-soft)] bg-white px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.24em] text-[color:var(--ink-muted)]">
              Total do dia
            </p>
            <p className="mt-2 text-2xl font-semibold text-[color:var(--ink-strong)]">
              {moneyFormatter.format(totals.gross)}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-[color:var(--line-soft)] bg-[color:var(--bg-card)] shadow-[var(--shadow-soft)]">
        {statusActionError ? (
          <div className="px-5 pt-5 text-sm text-[color:var(--tone-danger-ink)]">
            {statusActionError}
          </div>
        ) : null}
        {error ? (
          <div className="px-5 py-5 text-sm text-[color:var(--tone-danger-ink)]">{error}</div>
        ) : loading ? (
          <div className="px-5 py-5 text-sm text-[color:var(--ink-muted)]">
            Carregando pedidos para confirmação...
          </div>
        ) : data && data.orders.length > 0 ? (
          <>
            <div className="grid gap-3 px-3 py-3 lg:hidden">
              {data.orders.map((order) => (
                <OrderMobileCard
                  key={order.id}
                  order={order}
                  statusUpdateOrderId={statusUpdateOrderId}
                  paymentUpdateOrderId={paymentUpdateOrderId}
                  onUpdateStatus={updateOrderStatus}
                  onTogglePaid={markOrderPaid}
                />
              ))}
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table className="min-w-full border-separate [border-spacing:0_0.55rem]">
                <thead>
                  <tr className="border-b border-[color:var(--line-soft)] text-left text-[11px] uppercase tracking-[0.22em] text-[color:var(--ink-muted)]">
                    <th className="px-4 py-3 font-semibold">Horario</th>
                    <th className="px-4 py-3 font-semibold">Cliente</th>
                    <th className="px-4 py-3 font-semibold">Endereço</th>
                    <th className="px-4 py-3 font-semibold">Pedido</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Acao</th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((order) => (
                    <tr key={order.id} className="align-top">
                      {(() => {
                        const paymentStatus = normalizePaymentStatus(order.paymentStatus);
                        const rowBusy =
                          statusUpdateOrderId === order.id || paymentUpdateOrderId === order.id;
                        const isPaid = paymentStatus === 'PAGO';
                        return (
                          <>
                            <td
                              className={`border-y px-4 py-4 text-sm text-[color:var(--ink-strong)] first:border-l first:rounded-l-[18px] ${orderRowToneClass(order.status)}`}
                            >
                              <div className="font-semibold">{formatTime(order.scheduledAt)}</div>
                              <div className="text-[color:var(--ink-muted)]">
                                {formatMode(order.fulfillmentMode)}
                              </div>
                            </td>
                            <td
                              className={`border-y px-4 py-4 text-sm text-[color:var(--ink-strong)] ${orderRowToneClass(order.status)}`}
                            >
                              <div className="font-semibold">{order.customerName}</div>
                              <div className="text-[color:var(--ink-muted)]">
                                {order.customerPhone || 'Sem telefone'}
                              </div>
                            </td>
                            <td
                              className={`max-w-[20rem] border-y px-4 py-4 text-sm text-[color:var(--ink-strong)] ${orderRowToneClass(order.status)}`}
                            >
                              <div className="break-words leading-6 text-[color:var(--ink-muted)]">
                                {formatCustomerAddress(order)}
                              </div>
                            </td>
                            <td
                              className={`border-y px-4 py-4 text-sm text-[color:var(--ink-strong)] ${orderRowToneClass(order.status)}`}
                            >
                              <div className="font-semibold">#{order.publicNumber || order.id}</div>
                              <div className="mt-1">{renderFlavorSummary(order.flavorSummary)}</div>
                              <div className="mt-1 text-[color:var(--ink-strong)]">
                                {moneyFormatter.format(Number(order.total || 0))}
                              </div>
                            </td>
                            <td
                              className={`border-y px-4 py-4 text-sm ${orderRowToneClass(order.status)}`}
                            >
                              <OrderStatusControl
                                orderId={order.id}
                                status={order.status}
                                rowBusy={rowBusy}
                                onChange={updateOrderStatus}
                              />
                            </td>
                            <td
                              className={`border-y border-r px-4 py-4 text-sm last:rounded-r-[18px] ${orderRowToneClass(order.status)}`}
                            >
                              <OrderActionButtons
                                order={order}
                                rowBusy={rowBusy}
                                isPaid={isPaid}
                                onTogglePaid={markOrderPaid}
                              />
                            </td>
                          </>
                        );
                      })()}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="px-5 py-5 text-sm text-[color:var(--ink-muted)]">
            Nenhum pedido programado para esta data.
          </div>
        )}
      </section>
    </main>
  );
}
