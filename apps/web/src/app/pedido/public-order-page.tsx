'use client';

import { useMemo, useState } from 'react';
import type { ExternalOrderSubmission, OrderIntakeMeta, PixCharge } from '@querobroapp/shared';
import { FormField } from '@/components/form/FormField';
import { useFeedback } from '@/components/feedback-provider';

const flavorLabels = {
  T: 'Tradicional (T)',
  G: 'Goiabada (G)',
  D: 'Doce de Leite (D)',
  Q: 'Queijo do Serro (Q)',
  R: 'Requeijao de Corte (R)'
} as const;

type FlavorCode = keyof typeof flavorLabels;

type PublicOrderFormState = {
  name: string;
  phone: string;
  fulfillmentMode: 'DELIVERY' | 'PICKUP';
  address: string;
  deliveryNotes: string;
  date: string;
  time: string;
  notes: string;
  flavors: Record<FlavorCode, string>;
};

type PublicOrderResult = {
  order: {
    id: number;
    total?: number;
    scheduledAt?: string | null;
  };
  intake: OrderIntakeMeta;
};

const initialFormState: PublicOrderFormState = {
  name: '',
  phone: '',
  fulfillmentMode: 'DELIVERY',
  address: '',
  deliveryNotes: '',
  date: '',
  time: '',
  notes: '',
  flavors: {
    T: '',
    G: '',
    D: '',
    Q: '',
    R: ''
  }
};

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

function parseFlavorValue(value: string) {
  const parsed = Number(String(value || '').replace(/[^\d-]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function toLocalIso(date: string, time: string) {
  if (!date || !time) return null;
  const [year, month, day] = date.split('-').map((entry) => Number(entry));
  const [hour, minute] = time.split(':').map((entry) => Number(entry));
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
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

export function PublicOrderPage() {
  const { notifyError, notifySuccess, notifyInfo } = useFeedback();
  const [form, setForm] = useState<PublicOrderFormState>(initialFormState);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<PublicOrderResult | null>(null);
  const [isCopyingPix, setIsCopyingPix] = useState(false);

  const parsedFlavors = useMemo(() => {
    return {
      T: parseFlavorValue(form.flavors.T),
      G: parseFlavorValue(form.flavors.G),
      D: parseFlavorValue(form.flavors.D),
      Q: parseFlavorValue(form.flavors.Q),
      R: parseFlavorValue(form.flavors.R)
    };
  }, [form.flavors]);

  const totalBroas = useMemo(
    () => Object.values(parsedFlavors).reduce((sum, quantity) => sum + quantity, 0),
    [parsedFlavors]
  );

  const totalBoxesApprox = useMemo(() => (totalBroas > 0 ? Math.ceil(totalBroas / 7) : 0), [totalBroas]);

  const pixCharge: PixCharge | null = result?.intake.pixCharge ?? null;

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const scheduledAt = toLocalIso(form.date, form.time);
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
    if (totalBroas <= 0) {
      setError('Informe ao menos 1 broa.');
      return;
    }

    const payload: ExternalOrderSubmission = {
      version: 1,
      customer: {
        name: form.name.trim(),
        phone: form.phone.trim(),
        address: form.fulfillmentMode === 'DELIVERY' ? form.address.trim() : null,
        deliveryNotes: form.deliveryNotes.trim() || null
      },
      fulfillment: {
        mode: form.fulfillmentMode,
        scheduledAt
      },
      flavors: parsedFlavors,
      notes: form.notes.trim() || null,
      source: {
        channel: 'PUBLIC_FORM',
        originLabel: 'public-order-page',
        externalId: `public-form:${Date.now()}:${form.phone.replace(/\D/g, '') || 'sem-telefone'}`
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
        throw new Error(extractErrorMessage(data));
      }
      setResult(data as PublicOrderResult);
      notifySuccess('Pedido enviado.');
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Nao foi possivel enviar o pedido.';
      setError(message);
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
    setForm(initialFormState);
    setError(null);
    setResult(null);
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <div className="app-panel overflow-hidden border border-[color:var(--line-soft)] bg-[rgba(255,252,248,0.94)] p-0 shadow-[var(--shadow-strong)]">
          <div className="border-b border-[color:var(--line-soft)] bg-[linear-gradient(140deg,rgba(251,232,207,0.95),rgba(244,221,193,0.68))] px-6 py-8 sm:px-8">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.34em] text-[color:var(--ink-muted)]">
              Pedido do cliente
            </p>
            <h1 className="mt-2 text-4xl font-semibold text-[color:var(--ink-strong)] sm:text-[2.9rem]">
              Monte seu pedido
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--ink-muted)] sm:text-base">
              Preencha nome, entrega e quantas broas voce quer de cada sabor. O pedido entra direto no app e o PIX sai no final.
            </p>
            <div className="mt-5 flex flex-wrap gap-3 text-xs font-medium text-[color:var(--ink-muted)]">
              <span className="app-chip">Canal publico</span>
              <span className="app-chip">PIX no final</span>
              <span className="app-chip">Sem conversa manual para cadastrar</span>
            </div>
          </div>

          <form className="grid gap-8 px-6 py-6 sm:px-8" onSubmit={onSubmit}>
            <section className="grid gap-4 md:grid-cols-2">
              <FormField label="Nome completo">
                <input
                  className="app-input"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Nome e sobrenome"
                  autoComplete="name"
                />
              </FormField>
              <FormField label="Telefone com WhatsApp">
                <input
                  className="app-input"
                  value={form.phone}
                  onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                  placeholder="(31) 99999-9999"
                  autoComplete="tel"
                  inputMode="tel"
                />
              </FormField>
            </section>

            <section className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
              <FormField label="Como voce quer receber?">
                <select
                  className="app-select"
                  value={form.fulfillmentMode}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      fulfillmentMode: event.target.value === 'PICKUP' ? 'PICKUP' : 'DELIVERY'
                    }))
                  }
                >
                  <option value="DELIVERY">Entrega</option>
                  <option value="PICKUP">Retirada</option>
                </select>
              </FormField>
              <FormField
                label={form.fulfillmentMode === 'DELIVERY' ? 'Endereco para entrega' : 'Ponto de retirada'}
                hint={form.fulfillmentMode === 'DELIVERY' ? 'Rua, numero e bairro.' : 'Retirada no ponto combinado.'}
              >
                <input
                  className="app-input"
                  value={form.address}
                  onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
                  placeholder={form.fulfillmentMode === 'DELIVERY' ? 'Rua, numero e bairro' : 'Retirada'}
                  autoComplete={form.fulfillmentMode === 'DELIVERY' ? 'street-address' : 'off'}
                />
              </FormField>
            </section>

            <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px_180px]">
              <FormField label="Complemento / referencia" hint="Portao, bloco, ponto de referencia.">
                <input
                  className="app-input"
                  value={form.deliveryNotes}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, deliveryNotes: event.target.value }))
                  }
                  placeholder="Portao azul, interfone, bloco"
                />
              </FormField>
              <FormField label="Data">
                <input
                  className="app-input"
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                />
              </FormField>
              <FormField label="Horario">
                <input
                  className="app-input"
                  type="time"
                  value={form.time}
                  onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))}
                />
              </FormField>
            </section>

            <section className="grid gap-4">
              <div>
                <p className="app-section-title">Sabores</p>
                <p className="mt-1 text-sm text-[color:var(--ink-muted)]">
                  Informe a quantidade de broas por sabor. O total do pedido sera calculado no app.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                {(Object.keys(flavorLabels) as FlavorCode[]).map((code) => (
                  <FormField key={code} label={flavorLabels[code]}>
                    <input
                      className="app-input"
                      inputMode="numeric"
                      value={form.flavors[code]}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          flavors: {
                            ...current.flavors,
                            [code]: event.target.value
                          }
                        }))
                      }
                      placeholder="0"
                    />
                  </FormField>
                ))}
              </div>
            </section>

            <FormField label="Observacoes do pedido" hint="Use apenas se precisar combinar algo fora do padrao.">
              <textarea
                className="app-textarea min-h-[120px]"
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Ex.: tocar o interfone, confirmar retirada antes, evitar atraso."
              />
            </FormField>

            {error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            <div className="app-form-actions">
              <button className="app-button app-button-primary" disabled={isSubmitting} type="submit">
                {isSubmitting ? 'Enviando pedido...' : 'Enviar pedido'}
              </button>
              <button className="app-button app-button-ghost" onClick={resetForm} type="button">
                Limpar
              </button>
            </div>
          </form>
        </div>

        <aside className="grid gap-4 self-start">
          <section className="app-panel grid gap-4 border border-[color:var(--line-soft)] bg-[rgba(255,251,247,0.9)] p-5 shadow-[var(--shadow-soft)]">
            <div>
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-[color:var(--ink-muted)]">
                Resumo rapido
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-[color:var(--ink-strong)]">Seu pedido agora</h2>
            </div>
            <dl className="grid gap-3 text-sm text-[color:var(--ink-muted)]">
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/70 px-4 py-3">
                <dt>Total de broas</dt>
                <dd className="text-base font-semibold text-[color:var(--ink-strong)]">{totalBroas}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/70 px-4 py-3">
                <dt>Caixas aproximadas</dt>
                <dd className="text-base font-semibold text-[color:var(--ink-strong)]">{totalBoxesApprox}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/70 px-4 py-3">
                <dt>Recebimento</dt>
                <dd className="text-base font-semibold text-[color:var(--ink-strong)]">
                  {form.fulfillmentMode === 'DELIVERY' ? 'Entrega' : 'Retirada'}
                </dd>
              </div>
              <div className="rounded-2xl bg-white/70 px-4 py-3">
                <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                  Data e horario
                </dt>
                <dd className="mt-1 text-base font-semibold text-[color:var(--ink-strong)]">
                  {form.date && form.time ? `${form.date} ${form.time}` : 'Preencha para confirmar'}
                </dd>
              </div>
            </dl>
          </section>

          <section className="app-panel grid gap-3 border border-[color:var(--line-soft)] bg-[rgba(245,232,214,0.86)] p-5 shadow-[var(--shadow-soft)]">
            <h2 className="text-xl font-semibold text-[color:var(--ink-strong)]">Como funciona</h2>
            <ol className="grid gap-2 text-sm leading-6 text-[color:var(--ink-muted)]">
              <li>1. Voce monta o pedido aqui.</li>
              <li>2. O pedido entra direto no sistema.</li>
              <li>3. O PIX aparece no final para concluir no app do banco.</li>
            </ol>
          </section>

          {result ? (
            <section className="app-panel grid gap-4 border border-emerald-200 bg-[rgba(239,250,244,0.94)] p-5 shadow-[var(--shadow-soft)]">
              <div>
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-emerald-700">
                  Pedido recebido
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-[color:var(--ink-strong)]">
                  Pedido #{result.order.id}
                </h2>
                <p className="mt-2 text-sm text-[color:var(--ink-muted)]">
                  Entrega prevista para {formatScheduledAt(result.order.scheduledAt)}.
                </p>
              </div>

              <dl className="grid gap-3 text-sm text-[color:var(--ink-muted)]">
                <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/70 px-4 py-3">
                  <dt>Total</dt>
                  <dd className="text-base font-semibold text-[color:var(--ink-strong)]">
                    {formatCurrencyBRL(result.order.total)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/70 px-4 py-3">
                  <dt>Status</dt>
                  <dd className="text-base font-semibold text-[color:var(--ink-strong)]">
                    {result.intake.stage === 'PIX_PENDING' ? 'PIX pendente' : result.intake.stage}
                  </dd>
                </div>
              </dl>

              {pixCharge?.copyPasteCode ? (
                <div className="grid gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[color:var(--ink-strong)]">PIX para pagamento</p>
                    <p className="mt-1 text-sm text-[color:var(--ink-muted)]">
                      Abra o app do banco, escolha PIX copia e cola e use o codigo abaixo.
                    </p>
                  </div>
                  <textarea
                    className="app-textarea min-h-[148px] font-mono text-xs leading-5"
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
                    <button className="app-button app-button-ghost" onClick={resetForm} type="button">
                      Fazer outro pedido
                    </button>
                  </div>
                </div>
              ) : (
                <p className="rounded-2xl bg-white/70 px-4 py-3 text-sm text-[color:var(--ink-muted)]">
                  Pedido enviado. O PIX sera confirmado no atendimento.
                </p>
              )}
            </section>
          ) : null}
        </aside>
      </section>
    </div>
  );
}
