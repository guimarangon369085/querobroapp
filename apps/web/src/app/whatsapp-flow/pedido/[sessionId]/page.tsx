'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { FormField } from '@/components/form/FormField';
import { apiFetch } from '@/lib/api';
import { formatCurrencyBR } from '@/lib/format';

type FlowProduct = {
  id: number;
  name: string;
  price: number;
  category: string | null;
};

type FlowSessionResponse = {
  sessionId: string;
  status: 'PENDING' | 'COMPLETED';
  expiresAt: string;
  createdOrderId: number | null;
  createdCustomerId: number | null;
  prefill: {
    customerName: string | null;
    customerPhone: string | null;
    address: string | null;
    deliveryNotes: string | null;
    scheduledAt: string | null;
    notes: string | null;
  };
  products: FlowProduct[];
  submitEndpoint: string;
  sessionToken: string;
};

type FlowSubmitResponse = {
  ok: boolean;
  sessionId: string;
  customerId: number | null;
  orderId: number | null;
  alreadyCompleted?: boolean;
};

function toLocalDateTimeInput(value?: string | null) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
  const day = `${parsed.getDate()}`.padStart(2, '0');
  const hours = `${parsed.getHours()}`.padStart(2, '0');
  const minutes = `${parsed.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toIsoDateTime(value: string) {
  if (!value.trim()) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString();
}

export default function WhatsappOrderIntakeFlowPage() {
  const params = useParams<{ sessionId: string }>();
  const searchParams = useSearchParams();
  const sessionId = String(params?.sessionId || '').trim();
  const token = (searchParams.get('token') || '').trim();

  const [session, setSession] = useState<FlowSessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<FlowSubmitResponse | null>(null);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!sessionId || !token) {
      setLoading(false);
      setError('Sessao ou token ausente para abrir o WhatsApp Flow.');
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    apiFetch<FlowSessionResponse>(`/whatsapp/flows/order-intake/sessions/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(token)}`)
      .then((response) => {
        if (!active) return;
        setSession(response);
        setCustomerName(response.prefill.customerName || '');
        setCustomerPhone(response.prefill.customerPhone || '');
        setCustomerAddress(response.prefill.address || '');
        setDeliveryNotes(response.prefill.deliveryNotes || '');
        setScheduledAt(toLocalDateTimeInput(response.prefill.scheduledAt));
        setOrderNotes(response.prefill.notes || '');
        setQuantities(
          Object.fromEntries(response.products.map((product) => [product.id, '']))
        );
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Nao foi possivel carregar o WhatsApp Flow.');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [sessionId, token]);

  const selectedItems = useMemo(() => {
    if (!session) return [];
    return session.products
      .map((product) => {
        const quantity = Number.parseInt(quantities[product.id] || '0', 10);
        if (!Number.isFinite(quantity) || quantity <= 0) return null;
        return {
          productId: product.id,
          quantity,
          total: product.price * quantity,
          name: product.name
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [quantities, session]);

  const orderTotal = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.total, 0),
    [selectedItems]
  );
  const completedResult = useMemo(() => {
    if (submitResult) return submitResult;
    if (!session || session.status !== 'COMPLETED') return null;
    return {
      ok: true,
      sessionId: session.sessionId,
      customerId: session.createdCustomerId,
      orderId: session.createdOrderId,
      alreadyCompleted: true
    };
  }, [session, submitResult]);

  const submit = async () => {
    if (!session) return;
    const scheduledAtIso = toIsoDateTime(scheduledAt);
    if (!customerName.trim() || !customerPhone.trim() || !scheduledAtIso || selectedItems.length === 0) {
      setError('Preencha nome, telefone, horario e ao menos um item.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await apiFetch<FlowSubmitResponse>('/whatsapp/flows/order-intake/submit', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: session.sessionId,
          token,
          customer: {
            name: customerName,
            phone: customerPhone,
            address: customerAddress || null,
            deliveryNotes: deliveryNotes || null
          },
          order: {
            scheduledAt: scheduledAtIso,
            notes: orderNotes || null,
            items: selectedItems.map((item) => ({
              productId: item.productId,
              quantity: item.quantity
            }))
          }
        })
      });
      setSubmitResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel enviar o WhatsApp Flow.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <section className="app-panel">Carregando WhatsApp Flow...</section>;
  }

  if (error && !session) {
    return <section className="app-panel text-sm text-red-700">{error}</section>;
  }

  if (!session) {
    return <section className="app-panel text-sm text-neutral-500">Sessao indisponivel.</section>;
  }

  return (
    <section className="grid gap-6">
      <div className="app-panel grid gap-2">
        <p className="text-sm font-semibold text-neutral-900">WhatsApp Flow · pedido</p>
        <p className="text-sm text-neutral-600">
          Preencha cliente e pedido aqui. Ao concluir, o app cria o cliente e o pedido automaticamente.
        </p>
        <p className="text-xs text-neutral-500">
          Sessao expira em {new Date(session.expiresAt).toLocaleString('pt-BR')}
        </p>
      </div>

      {completedResult ? (
        <div className="app-panel grid gap-3">
          <p className="text-sm font-semibold text-emerald-900">
            {completedResult.alreadyCompleted ? 'Esta sessao ja foi concluida.' : 'Pedido criado com sucesso.'}
          </p>
          {completedResult.orderId ? (
            <p className="text-sm text-neutral-700">Pedido #{completedResult.orderId} pronto no app.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {completedResult.orderId ? (
              <Link className="app-button app-button-primary" href="/pedidos">
                Abrir pedidos
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="app-panel grid gap-5">
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Nome">
              <input
                className="app-input"
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder="Nome do cliente"
              />
            </FormField>
            <FormField label="Telefone">
              <input
                className="app-input"
                value={customerPhone}
                onChange={(event) => setCustomerPhone(event.target.value)}
                placeholder="5511999999999"
                inputMode="tel"
              />
            </FormField>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Endereco">
              <input
                className="app-input"
                value={customerAddress}
                onChange={(event) => setCustomerAddress(event.target.value)}
                placeholder="Rua, numero, bairro"
              />
            </FormField>
            <FormField label="Horario do pedido">
              <input
                className="app-input"
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
            </FormField>
          </div>

          <details className="app-details">
            <summary>Observacoes</summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <FormField label="Entrega">
                <input
                  className="app-input"
                  value={deliveryNotes}
                  onChange={(event) => setDeliveryNotes(event.target.value)}
                  placeholder="Portao, referencia"
                />
              </FormField>
              <FormField label="Pedido">
                <input
                  className="app-input"
                  value={orderNotes}
                  onChange={(event) => setOrderNotes(event.target.value)}
                  placeholder="Observacoes do pedido"
                />
              </FormField>
            </div>
          </details>

          <div className="grid gap-3">
            {session.products.map((product) => (
              <div
                key={product.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/60 bg-white/70 px-3 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-neutral-900">{product.name}</p>
                  <p className="text-xs text-neutral-500">
                    {(product.category || 'Produto')} • {formatCurrencyBR(product.price)}
                  </p>
                </div>
                <input
                  className="app-input w-24"
                  type="number"
                  min={0}
                  value={quantities[product.id] || ''}
                  onChange={(event) =>
                    setQuantities((current) => ({ ...current, [product.id]: event.target.value }))
                  }
                  placeholder="0"
                />
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-white/60 bg-white/70 px-3 py-3 text-sm text-neutral-700">
            <p>{selectedItems.length} item(ns) selecionado(s)</p>
            <p className="mt-1 font-semibold text-neutral-900">Total: {formatCurrencyBR(orderTotal)}</p>
          </div>

          {error ? <p className="text-xs text-red-600">{error}</p> : null}

          <div className="app-form-actions app-form-actions--mobile-sticky">
            <button
              type="button"
              className="app-button app-button-primary"
              onClick={submit}
              disabled={submitting}
            >
              {submitting ? 'Enviando...' : 'Concluir no app'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
