'use client';
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent
} from 'react';
import type { Customer } from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';
import {
  buildWhatsAppUrl,
  compactWhitespace,
  formatPhoneBR,
  formatPostalCodeBR,
  normalizeAddress,
  normalizePhone,
  titleCase
} from '@/lib/format';
import { consumeFocusQueryParam, scrollToLayoutSlot } from '@/lib/layout-scroll';
import { useSurfaceMode } from '@/hooks/use-surface-mode';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { AppIcon } from '@/components/app-icons';
import { useFeedback } from '@/components/feedback-provider';
import { FormField } from '@/components/form/FormField';
import { useSearchParams } from 'next/navigation';
import { BuilderLayoutItemSlot, BuilderLayoutProvider } from '@/components/builder-layout';
import {
  buildCustomerAddressAutofill,
  buildCustomerAddressSummary,
  buildCustomerNameAutofill,
  type CustomerAutofillPatch,
  lookupPostalCodeAutofill
} from '@/lib/customer-autofill';

const emptyCustomer: Partial<Customer> = {
  name: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  address: '',
  addressLine1: '',
  addressLine2: '',
  neighborhood: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'Brasil',
  deliveryNotes: ''
};

const TEST_DATA_TAG = '[TESTE_E2E]';
const TUTORIAL_QUERY_VALUE = 'primeira_vez';
const CUSTOMER_AUTOFILL_FIELDS = [
  'address',
  'addressLine1',
  'addressLine2',
  'city',
  'country',
  'firstName',
  'lastName',
  'neighborhood',
  'postalCode',
  'state'
] as const;

type CustomerAutofillField = (typeof CUSTOMER_AUTOFILL_FIELDS)[number];

function createCustomerAutofillState() {
  return Object.fromEntries(CUSTOMER_AUTOFILL_FIELDS.map((field) => [field, ''])) as Record<
    CustomerAutofillField,
    string
  >;
}

function containsTestDataTag(value?: string | null) {
  return (value || '').toLowerCase().includes(TEST_DATA_TAG.toLowerCase());
}

function withTestDataTag(value?: string | null) {
  const normalized = (value || '').trim();
  if (!normalized) return TEST_DATA_TAG;
  if (containsTestDataTag(normalized)) return normalized;
  return `${normalized} ${TEST_DATA_TAG}`;
}

function CustomersPageContent() {
  const searchParams = useSearchParams();
  const { tutorialMode, isSpotlightSlot } = useTutorialSpotlight(searchParams, TUTORIAL_QUERY_VALUE);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form, setForm] = useState<Partial<Customer>>(emptyCustomer);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const { isOperationMode } = useSurfaceMode('clientes');
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const openedCustomerIdRef = useRef<number | null>(null);
  const customerAutofillRef = useRef(createCustomerAutofillState());
  const postalCodeLookupAbortRef = useRef<AbortController | null>(null);
  const { confirm, notifyError, notifySuccess, notifyUndo } = useFeedback();

  const load = () => apiFetch<Customer[]>('/customers').then(setCustomers);

  useEffect(() => {
    load().catch(console.error);
  }, []);

  useEffect(() => {
    return () => {
      postalCodeLookupAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const focus = consumeFocusQueryParam(searchParams);
    if (!focus) return;

    const allowed = new Set(['header', 'kpis_search', 'form', 'list']);
    if (!allowed.has(focus)) return;

    scrollToLayoutSlot(focus, {
      focus: focus === 'form',
      focusSelector: focus === 'form' ? 'input, select, textarea' : undefined
    });
  }, [searchParams]);

  const resetCustomerAutofill = () => {
    postalCodeLookupAbortRef.current?.abort();
    postalCodeLookupAbortRef.current = null;
    customerAutofillRef.current = createCustomerAutofillState();
  };

  const mergeCustomerAutofill = (
    currentForm: Partial<Customer>,
    patch: CustomerAutofillPatch
  ): Partial<Customer> => {
    let nextForm = currentForm;

    for (const field of CUSTOMER_AUTOFILL_FIELDS) {
      if (!(field in patch)) continue;

      const nextValue = `${(patch[field] as string | undefined) ?? ''}`;
      const currentValue = `${(nextForm[field] as string | undefined) ?? ''}`;
      const lastAutoValue = customerAutofillRef.current[field];

      if (currentValue === nextValue) {
        customerAutofillRef.current[field] = nextValue;
        continue;
      }

      if (!currentValue || currentValue === lastAutoValue) {
        if (nextForm === currentForm) {
          nextForm = { ...currentForm };
        }
        (nextForm as Record<CustomerAutofillField, string | undefined>)[field] = nextValue;
        customerAutofillRef.current[field] = nextValue;
      }
    }

    return nextForm;
  };

  const seedCustomerAutofill = (currentForm: Partial<Customer>, patch: CustomerAutofillPatch) => {
    for (const field of CUSTOMER_AUTOFILL_FIELDS) {
      if (!(field in patch)) continue;
      const nextValue = `${(patch[field] as string | undefined) ?? ''}`;
      const currentValue = `${(currentForm[field] as string | undefined) ?? ''}`;
      customerAutofillRef.current[field] = currentValue && currentValue === nextValue ? nextValue : '';
    }
  };

  const primeCustomerAutofill = (currentForm: Partial<Customer>) => {
    customerAutofillRef.current = createCustomerAutofillState();
    seedCustomerAutofill(currentForm, buildCustomerNameAutofill(currentForm.name));
    seedCustomerAutofill(currentForm, buildCustomerAddressAutofill(currentForm.address));

    const structuredAddress = buildCustomerAddressSummary(currentForm);
    if (structuredAddress && compactWhitespace(currentForm.address || '') === compactWhitespace(structuredAddress)) {
      seedCustomerAutofill(currentForm, {
        address: structuredAddress,
        addressLine1: currentForm.addressLine1 || '',
        city: currentForm.city || '',
        country: currentForm.country || '',
        neighborhood: currentForm.neighborhood || '',
        postalCode: formatPostalCodeBR(currentForm.postalCode || ''),
        state: currentForm.state?.trim().toUpperCase() || ''
      });
    }
  };

  const handleNameChange = (rawValue: string) => {
    setForm((prev) => {
      const nextForm = prev.name === rawValue ? prev : { ...prev, name: rawValue };
      return mergeCustomerAutofill(nextForm, buildCustomerNameAutofill(rawValue));
    });
  };

  const handleAddressChange = (rawValue: string) => {
    setForm((prev) => {
      const nextForm = prev.address === rawValue ? prev : { ...prev, address: rawValue };
      return mergeCustomerAutofill(nextForm, buildCustomerAddressAutofill(rawValue));
    });
  };

  const handlePostalCodeLookup = async (postalCode: string) => {
    postalCodeLookupAbortRef.current?.abort();
    const controller = new AbortController();
    postalCodeLookupAbortRef.current = controller;

    try {
      const patch = await lookupPostalCodeAutofill(postalCode, { signal: controller.signal });
      if (!patch) return;

      setForm((prev) => {
        if (formatPostalCodeBR(prev.postalCode || '') !== formatPostalCodeBR(postalCode)) {
          return prev;
        }

        let nextForm = mergeCustomerAutofill(prev, patch);
        const nextAddress = buildCustomerAddressSummary(nextForm);
        if (nextAddress) {
          nextForm = mergeCustomerAutofill(nextForm, { address: nextAddress });
        }
        return nextForm;
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      console.error(error);
    } finally {
      if (postalCodeLookupAbortRef.current === controller) {
        postalCodeLookupAbortRef.current = null;
      }
    }
  };

  const handlePostalCodeChange = (rawValue: string) => {
    const nextPostalCode = formatPostalCodeBR(rawValue);
    setForm((prev) => (prev.postalCode === nextPostalCode ? prev : { ...prev, postalCode: nextPostalCode }));

    if (nextPostalCode.replace(/\D/g, '').length === 8) {
      void handlePostalCodeLookup(nextPostalCode);
      return;
    }

    postalCodeLookupAbortRef.current?.abort();
    postalCodeLookupAbortRef.current = null;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name || form.name.trim().length < 2) {
      setError('Informe um nome valido.');
      return;
    }
    const normalizedPhone = normalizePhone(form.phone || '');
    if (!normalizedPhone || normalizedPhone.length < 10) {
      setError('Informe um telefone valido (com DDD).');
      return;
    }
    if (!form.addressLine1 && !form.address) {
      setError('Informe o endereco (rua e numero).');
      return;
    }
    setError(null);

    const fullName = titleCase(form.name || '');
    const split = fullName.split(' ').filter(Boolean);
    const fallbackFirst = split[0] || '';
    const fallbackLast = split.length > 1 ? split.slice(1).join(' ') : '';

    const payloadBase = {
      ...form,
      name: fullName,
      firstName: form.firstName ? titleCase(form.firstName) : fallbackFirst,
      lastName: form.lastName ? titleCase(form.lastName) : fallbackLast,
      phone: normalizePhone(form.phone || ''),
      email: form.email?.trim() || undefined,
      address: normalizeAddress(form.address || ''),
      addressLine1: normalizeAddress(form.addressLine1 || ''),
      addressLine2: normalizeAddress(form.addressLine2 || ''),
      neighborhood: normalizeAddress(form.neighborhood || ''),
      city: normalizeAddress(form.city || ''),
      state: form.state?.trim().toUpperCase() || undefined,
      postalCode: form.postalCode?.trim() || undefined,
      country: normalizeAddress(form.country || ''),
      deliveryNotes: form.deliveryNotes?.trim() || undefined
    };
    const payload =
      tutorialMode && !editingId
        ? {
            ...payloadBase,
            deliveryNotes: withTestDataTag(payloadBase.deliveryNotes)
          }
        : payloadBase;

    try {
      if (editingId) {
        await apiFetch(`/customers/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        await apiFetch('/customers', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }

      resetCustomerAutofill();
      setForm(emptyCustomer);
      setEditingId(null);
      await load();
      notifySuccess(editingId ? 'Cliente atualizado com sucesso.' : 'Cliente criado com sucesso.');
      scrollToLayoutSlot('list');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel salvar o cliente.');
    }
  };

  const startEdit = (customer: Customer) => {
    setEditingId(customer.id!);
    const nextForm: Partial<Customer> = {
      name: customer.name,
      firstName: customer.firstName ?? '',
      lastName: customer.lastName ?? '',
      email: customer.email ?? '',
      phone: formatPhoneBR(customer.phone ?? ''),
      address: customer.address ?? '',
      addressLine1: customer.addressLine1 ?? '',
      addressLine2: customer.addressLine2 ?? '',
      neighborhood: customer.neighborhood ?? '',
      city: customer.city ?? '',
      state: customer.state ?? '',
      postalCode: customer.postalCode ?? '',
      country: customer.country ?? 'Brasil',
      deliveryNotes: customer.deliveryNotes ?? ''
    };
    resetCustomerAutofill();
    primeCustomerAutofill(nextForm);
    setForm(nextForm);
    scrollToLayoutSlot('form', { focus: true, focusSelector: 'input, select, textarea' });
  };

  const cancelEdit = () => {
    setEditingId(null);
    resetCustomerAutofill();
    setForm(emptyCustomer);
  };

  useEffect(() => {
    const raw = searchParams.get('editCustomerId');
    if (!raw) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    if (openedCustomerIdRef.current === parsed) return;

    const customer = customers.find((entry) => entry.id === parsed);
    if (!customer) return;
    openedCustomerIdRef.current = parsed;
    startEdit(customer);
    // `startEdit` changes identity on each render, but this effect should react only to the query param/list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, customers]);

  const remove = async (id: number) => {
    const customerToRestore = customers.find((entry) => entry.id === id);
    const accepted = await confirm({
      title: 'Remover cliente?',
      description: 'Essa acao exclui o cliente permanentemente.',
      confirmLabel: 'Remover',
      cancelLabel: 'Cancelar',
      danger: true
    });
    if (!accepted) return;
    try {
      await apiFetch(`/customers/${id}`, { method: 'DELETE' });
      if (editingId === id) {
        cancelEdit();
      }
      await load();
      if (customerToRestore) {
        notifyUndo(`Cliente ${customerToRestore.name} removido com sucesso.`, async () => {
          await apiFetch('/customers', {
            method: 'POST',
            body: JSON.stringify({
              name: customerToRestore.name,
              firstName: customerToRestore.firstName ?? null,
              lastName: customerToRestore.lastName ?? null,
              email: customerToRestore.email ?? null,
              phone: customerToRestore.phone ?? null,
              address: customerToRestore.address ?? null,
              addressLine1: customerToRestore.addressLine1 ?? null,
              addressLine2: customerToRestore.addressLine2 ?? null,
              neighborhood: customerToRestore.neighborhood ?? null,
              city: customerToRestore.city ?? null,
              state: customerToRestore.state ?? null,
              postalCode: customerToRestore.postalCode ?? null,
              country: customerToRestore.country ?? 'Brasil',
              deliveryNotes: customerToRestore.deliveryNotes ?? null
            })
          });
          await load();
          notifySuccess('Cliente restaurado com sucesso.');
          scrollToLayoutSlot('list');
        });
      } else {
        notifySuccess('Cliente removido com sucesso.');
      }
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel remover o cliente.');
    }
  };

  const handleCustomerCardKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    customer: Customer
  ) => {
    if (event.currentTarget !== event.target) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    startEdit(customer);
  };

  const stopCustomerCardAction = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter((customer) => {
      const name = customer.name.toLowerCase();
      const phone = customer.phone || '';
      const address = customer.address || '';
      const city = customer.city || '';
      const neighborhood = customer.neighborhood || '';
      return (
        name.includes(query) ||
        phone.includes(query) ||
        address.toLowerCase().includes(query) ||
        city.toLowerCase().includes(query) ||
        neighborhood.toLowerCase().includes(query) ||
        `${customer.id}`.includes(query)
      );
    });
  }, [customers, search]);

  return (
    <>
    <BuilderLayoutProvider page="clientes">
      <section className="grid gap-8">
      <BuilderLayoutItemSlot
        id="kpis_search"
        className={
          isSpotlightSlot('kpis_search') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'
        }
      >
      <div className="app-panel flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-neutral-700">{customers.length} cliente(s)</span>
        <input
          className="app-input md:w-auto md:min-w-[320px]"
          placeholder="Buscar por nome, telefone ou endereco"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      </BuilderLayoutItemSlot>

      <BuilderLayoutItemSlot
        id="form"
        className={isSpotlightSlot('form') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'}
      >
      <form onSubmit={submit} className="app-panel grid gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
            Cadastro rapido
          </p>
          <h3 className="mt-1 text-lg font-semibold text-neutral-900">
            So o minimo para vender e entregar
          </h3>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Nome completo" error={error}>
            <input
              className="app-input"
              placeholder="Nome completo"
              ref={nameInputRef}
              value={form.name || ''}
              onChange={(e) => handleNameChange(e.target.value)}
              onBlur={(e) => handleNameChange(titleCase(e.target.value))}
            />
          </FormField>
          <FormField label="Telefone" hint="DDD + numero">
            <input
              className="app-input"
              placeholder="(11) 99999-9999"
              value={form.phone || ''}
              inputMode="tel"
              autoComplete="tel"
              onChange={(e) => setForm((prev) => ({ ...prev, phone: formatPhoneBR(e.target.value) }))}
            />
          </FormField>
          <FormField label="Endereco completo" hint="Digite o endereco manualmente.">
            <input
              className="app-input"
              placeholder="Rua, numero, bairro, cidade"
              value={form.address || ''}
              autoComplete="street-address"
              onChange={(e) => handleAddressChange(e.target.value)}
              onBlur={(e) => handleAddressChange(normalizeAddress(e.target.value) || '')}
            />
          </FormField>
        </div>

        <details className="app-details">
          <summary>
            <span className="inline-flex items-center gap-2">
              <AppIcon name="tools" className="h-4 w-4" />
              Mais
            </span>
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <FormField label="Instrucoes de entrega" hint="Portao, referencia, interfone">
              <input
                className="app-input"
                placeholder="Ex: portao preto, tocar 18"
                value={form.deliveryNotes || ''}
                onChange={(e) => setForm((prev) => ({ ...prev, deliveryNotes: e.target.value }))}
              />
            </FormField>
            <FormField label="Email" hint="Opcional">
              <input
                className="app-input"
                placeholder="email@exemplo.com"
                value={form.email || ''}
                inputMode="email"
                autoComplete="email"
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              />
            </FormField>

            {!isOperationMode ? (
              <>
                <FormField label="Primeiro nome" hint="Opcional (preenchido automaticamente)">
                  <input
                    className="app-input"
                    placeholder="Primeiro nome"
                    value={form.firstName || ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
                  />
                </FormField>
                <FormField label="Sobrenome" hint="Opcional (preenchido automaticamente)">
                  <input
                    className="app-input"
                    placeholder="Sobrenome"
                    value={form.lastName || ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, lastName: e.target.value }))}
                  />
                </FormField>
                <FormField label="Rua e numero" hint="Linha 1">
                  <input
                    className="app-input"
                    placeholder="Ex: Rua X, 123"
                    value={form.addressLine1 || ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, addressLine1: e.target.value }))}
                  />
                </FormField>
                <FormField label="Complemento" hint="Apartamento, bloco, etc">
                  <input
                    className="app-input"
                    placeholder="Apto, bloco, andar..."
                    value={form.addressLine2 || ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, addressLine2: e.target.value }))}
                  />
                </FormField>
                <FormField label="Bairro">
                  <input
                    className="app-input"
                    placeholder="Bairro"
                    value={form.neighborhood || ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, neighborhood: e.target.value }))}
                  />
                </FormField>
                <FormField label="Cidade">
                  <input
                    className="app-input"
                    placeholder="Cidade"
                    value={form.city || ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))}
                  />
                </FormField>
                <FormField label="Estado (UF)">
                  <input
                    className="app-input"
                    placeholder="SP"
                    value={form.state || ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, state: e.target.value }))}
                  />
                </FormField>
                <FormField label="CEP">
                  <input
                    className="app-input"
                    placeholder="00000-000"
                    value={form.postalCode || ''}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    onChange={(e) => handlePostalCodeChange(e.target.value)}
                  />
                </FormField>
                <FormField label="Pais">
                  <input
                    className="app-input"
                    placeholder="Brasil"
                    value={form.country || ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value }))}
                  />
                </FormField>
              </>
            ) : null}
          </div>
        </details>
        <div className="app-form-actions">
          <button className="app-button app-button-primary w-full md:w-auto" type="submit">
            <AppIcon name={editingId ? 'refresh' : 'plus'} className="h-4 w-4" />
            {editingId ? 'Atualizar' : 'Criar'}
          </button>
          {editingId && (
            <button
              className="app-button app-button-ghost"
              type="button"
              onClick={cancelEdit}
            >
              <AppIcon name="close" className="h-4 w-4" />
              Cancelar
            </button>
          )}
        </div>
      </form>
      </BuilderLayoutItemSlot>

      <BuilderLayoutItemSlot
        id="list"
        className={isSpotlightSlot('list') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'}
      >
      <div className="grid gap-3">
        {filteredCustomers.map((customer) => {
          const isExpanded = editingId === customer.id;
          const customerPhoneLabel = formatPhoneBR(customer.phone) || 'Sem telefone';
          const customerPhoneHref = buildWhatsAppUrl(customer.phone);
          return (
            <div
              key={customer.id}
              className={`app-panel app-panel--interactive app-panel--expandable ${
                isExpanded ? 'app-panel--expanded' : ''
              }`}
              role="button"
              tabIndex={0}
              onClick={() => startEdit(customer)}
              onKeyDown={(event) => handleCustomerCardKeyDown(event, customer)}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <p className="text-lg font-semibold">{customer.name}</p>
                    <span className="app-panel__chevron" aria-hidden="true" />
                  </div>
                  {customerPhoneHref ? (
                    <a
                      href={customerPhoneHref}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex text-sm text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-900"
                      onClick={stopCustomerCardAction}
                    >
                      {customerPhoneLabel}
                    </a>
                  ) : (
                    <p className="mt-1 text-sm text-neutral-500">{customerPhoneLabel}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  {!isOperationMode ? (
                    <button
                      type="button"
                      className="app-button app-button-danger"
                      onClick={(event) => {
                        stopCustomerCardAction(event);
                        void remove(customer.id!);
                      }}
                    >
                      <AppIcon name="close" className="h-4 w-4" />
                      Remover
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="app-panel__expand" aria-hidden={!isExpanded}>
                <div className="app-panel__expand-inner">
                  <div className="app-panel__expand-surface text-sm text-neutral-600">
                    {customer.address || 'Sem endereco'}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {filteredCustomers.length === 0 && (
          <div className="app-panel border-dashed text-sm text-neutral-500">
            Nenhum cliente encontrado com este filtro.
          </div>
        )}
      </div>
      </BuilderLayoutItemSlot>

      </section>
    </BuilderLayoutProvider>
    </>
  );
}

export default function CustomersPage() {
  return (
    <Suspense fallback={null}>
      <CustomersPageContent />
    </Suspense>
  );
}
