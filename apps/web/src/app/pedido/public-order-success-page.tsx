'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type PixCharge } from '@querobroapp/shared';
import { useFeedback } from '@/components/feedback-provider';
import {
  clearStoredOrderFinalized,
  readStoredOrderFinalized,
  type StoredOrderFinalized
} from '@/lib/order-finalized-storage';

function formatCurrencyBRL(value?: number | null) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2
  }).format(Number(value || 0));
}

function formatScheduledAt(value?: string | null) {
  if (!value) return 'data a confirmar';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'data a confirmar';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function resolveDeliveryWindowLabel(order: StoredOrderFinalized['order']) {
  if (order.deliveryWindowLabel) {
    return order.deliveryWindowLabel;
  }
  return formatScheduledAt(order.scheduledAt);
}

export function PublicOrderSuccessPage() {
  const router = useRouter();
  const { notifyError, notifyInfo } = useFeedback();
  const [successPayload, setSuccessPayload] = useState<StoredOrderFinalized | null>(null);
  const [isCopyingPix, setIsCopyingPix] = useState(false);

  useEffect(() => {
    const stored = readStoredOrderFinalized();
    if (!stored) {
      router.replace('/pedido');
      return;
    }
    setSuccessPayload(stored);
  }, [router]);

  const pixCharge = useMemo<PixCharge | null>(
    () => successPayload?.intake.pixCharge ?? null,
    [successPayload]
  );

  const startAnotherOrder = () => {
    clearStoredOrderFinalized();
    router.replace(successPayload?.returnPath || '/pedido');
  };

  const copyPixCode = async () => {
    if (!pixCharge?.copyPasteCode) return;

    try {
      setIsCopyingPix(true);
      await navigator.clipboard.writeText(pixCharge.copyPasteCode);
      notifyInfo('Código PIX copiado.');
    } catch {
      notifyError('Não foi possível copiar o código PIX.');
    } finally {
      setIsCopyingPix(false);
    }
  };

  if (!successPayload) {
    return null;
  }

  const { intake, order, productSubtotal } = successPayload;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(234,223,200,0.5),transparent_34%),radial-gradient(circle_at_top_right,rgba(210,228,219,0.54),transparent_30%),linear-gradient(180deg,#fbf4ea_0%,#f7efe3_100%)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[920px] items-center justify-center px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <section className="w-full overflow-hidden rounded-[24px] border border-[color:var(--tone-sage-line)] bg-[linear-gradient(165deg,rgba(250,253,251,0.99),rgba(239,247,242,0.95))] p-4 shadow-[0_18px_40px_rgba(84,99,90,0.1)] sm:rounded-[30px] sm:p-6 sm:shadow-[0_26px_80px_rgba(84,99,90,0.1)]">
          <div>
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.26em] text-[color:var(--tone-sage-ink)]">Pedido recebido</p>
            <h1 className="mt-1.5 text-[1.55rem] font-semibold text-[color:var(--ink-strong)] sm:mt-2 sm:text-3xl">
              Obrigado pelo pedido! Já recebemos sua solicitação.
            </h1>
            <p className="mt-2 text-[0.88rem] leading-6 text-[color:var(--ink-muted)] sm:text-sm">
              Programado para a faixa {resolveDeliveryWindowLabel(order)}.
            </p>
          </div>

          <div className="mt-5 grid gap-3 text-sm text-[color:var(--ink-muted)]">
            <div className="flex items-center justify-between gap-3 rounded-[24px] bg-white/78 px-4 py-3">
              <span>Produtos</span>
              <strong className="text-lg text-[color:var(--ink-strong)]">{formatCurrencyBRL(productSubtotal)}</strong>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-[24px] bg-white/78 px-4 py-3">
              <span>Frete</span>
              <strong className="text-lg text-[color:var(--ink-strong)]">
                {formatCurrencyBRL(intake.deliveryFee)}
              </strong>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-[24px] bg-white/78 px-4 py-3">
              <span>Total</span>
              <strong className="text-lg text-[color:var(--ink-strong)]">{formatCurrencyBRL(order.total)}</strong>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-[24px] bg-white/78 px-4 py-3">
              <span>Status</span>
              <strong className="text-[color:var(--ink-strong)]">
                {intake.stage === 'PIX_PENDING'
                  ? 'PIX pendente'
                  : intake.stage === 'PAID' || intake.stage === 'SCHEDULED'
                    ? 'PIX recebido'
                    : intake.stage}
              </strong>
            </div>
          </div>

          {pixCharge?.copyPasteCode ? (
            <div className="mt-5 grid gap-4">
              <div>
                <p className="text-sm font-semibold text-[color:var(--ink-strong)]">PIX copia e cola</p>
              </div>
              <textarea
                className="app-textarea min-h-[170px] border-[color:var(--tone-sage-line)] bg-white/84 font-mono text-[11px] leading-5 sm:text-xs"
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
                  {isCopyingPix ? 'Copiando...' : 'Copiar código PIX'}
                </button>
                <button className="app-button app-button-ghost" onClick={startAnotherOrder} type="button">
                  {successPayload.returnLabel}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-5 grid gap-3">
              <p className="rounded-[24px] bg-white/78 px-4 py-3 text-sm text-[color:var(--ink-muted)]">
                Pedido enviado. O PIX sera confirmado no atendimento.
              </p>
              <button className="app-button app-button-primary w-full sm:w-auto" onClick={startAnotherOrder} type="button">
                {successPayload.returnLabel}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
