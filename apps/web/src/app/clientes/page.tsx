'use client';
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from 'react';
import type { Customer, OrderItem, Product } from '@querobroapp/shared';
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
import { useRouter, useSearchParams } from 'next/navigation';
import { BuilderLayoutItemSlot, BuilderLayoutProvider } from '@/components/builder-layout';
import {
  buildCustomerAddressAutofill,
  buildCustomerAddressAutofillFromGooglePlace,
  buildCustomerAddressSummary,
  buildCustomerNameAutofill,
  type CustomerAutofillPatch,
  type GooglePlaceResultLike,
  lookupPostalCodeAutofill
} from '@/lib/customer-autofill';
import { loadGooglePlacesLibrary } from '@/lib/google-places';

const emptyCustomer: Partial<Customer> = {
  name: '',
  firstName: '',
  lastName: '',
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

const GOOGLE_MAPS_API_KEY = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();

type CustomerOrderPreview = {
  id: number;
  customerId: number;
  status: string;
  createdAt?: string | null;
  scheduledAt?: string | null;
  notes?: string | null;
  total?: number | null;
  discount?: number | null;
  items?: Array<Pick<OrderItem, 'productId' | 'quantity'>>;
};

function formatDateTimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
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

function defaultRepeatOrderDateTimeInput() {
  const baseline = new Date();
  baseline.setMinutes(baseline.getMinutes() + 30);
  baseline.setSeconds(0, 0);
  return formatDateTimeLocalValue(baseline);
}

function formatOrderDateTimeLabel(isoValue?: string | null) {
  if (!isoValue) return 'Sem horario definido';
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) return 'Sem horario definido';
  return parsed.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatOrderStatusLabel(status?: string | null) {
  if (!status) return 'Sem status';
  if (status === 'EM_PREPARACAO') return 'NO FORNO';
  return status.replace(/_/g, ' ');
}

function normalizeLooseText(value?: string | null) {
  return compactWhitespace(value || '');
}

function shouldPromoteAutofillValue(currentValue?: string | null, inferredValue?: string | null) {
  const current = normalizeLooseText(currentValue);
  const inferred = normalizeLooseText(inferredValue);
  if (!inferred) return false;
  if (!current) return true;
  if (current.length <= 1 && inferred.length > current.length && inferred.toLowerCase().startsWith(current.toLowerCase())) {
    return true;
  }
  if (current.length <= 2 && inferred.length > current.length && inferred.toLowerCase().startsWith(current.toLowerCase())) {
    return true;
  }
  return false;
}

function pickPromotedValue(currentValue?: string | null, inferredValue?: string | null) {
  if (shouldPromoteAutofillValue(currentValue, inferredValue)) {
    return normalizeLooseText(inferredValue) || '';
  }
  return normalizeLooseText(currentValue) || '';
}

function CustomersPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tutorialMode, isSpotlightSlot } = useTutorialSpotlight(searchParams, TUTORIAL_QUERY_VALUE);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form, setForm] = useState<Partial<Customer>>(emptyCustomer);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [customerRecentOrders, setCustomerRecentOrders] = useState<CustomerOrderPreview[]>([]);
  const [customerOrdersError, setCustomerOrdersError] = useState<string | null>(null);
  const [isLoadingCustomerOrders, setIsLoadingCustomerOrders] = useState(false);
  const [isCustomerInfoEditing, setIsCustomerInfoEditing] = useState(false);
  const [lastOrderAtByCustomerId, setLastOrderAtByCustomerId] = useState<Record<number, number>>({});
  const [orderCountByCustomerId, setOrderCountByCustomerId] = useState<Record<number, number>>({});
  const [productNameById, setProductNameById] = useState<Record<number, string>>({});
  const [repeatDraftOrderId, setRepeatDraftOrderId] = useState<number | null>(null);
  const [repeatDraftScheduledAt, setRepeatDraftScheduledAt] = useState(() => defaultRepeatOrderDateTimeInput());
  const [repeatDraftError, setRepeatDraftError] = useState<string | null>(null);
  const [isRepeatOrderPending, setIsRepeatOrderPending] = useState(false);
  const { isOperationMode } = useSurfaceMode('clientes');
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const modalAddressInputRef = useRef<HTMLInputElement | null>(null);
  const openedCustomerIdRef = useRef<number | null>(null);
  const customerAutofillRef = useRef(createCustomerAutofillState());
  const postalCodeLookupAbortRef = useRef<AbortController | null>(null);
  const { confirm, notifyError, notifySuccess, notifyUndo } = useFeedback();

  const load = async () => {
    const [nextCustomers, orders] = await Promise.all([
      apiFetch<Customer[]>('/customers'),
      apiFetch<CustomerOrderPreview[]>('/orders')
    ]);

    const nextLastOrderAtByCustomerId: Record<number, number> = {};
    const nextOrderCountByCustomerId: Record<number, number> = {};
    for (const order of orders) {
      const customerId = Number(order.customerId || 0);
      if (!Number.isFinite(customerId) || customerId <= 0) continue;
      nextOrderCountByCustomerId[customerId] = (nextOrderCountByCustomerId[customerId] || 0) + 1;
      const referenceIso = order.createdAt || order.scheduledAt || '';
      const referenceTime = new Date(referenceIso).getTime();
      if (!Number.isFinite(referenceTime)) continue;
      const current = nextLastOrderAtByCustomerId[customerId];
      if (!Number.isFinite(current) || referenceTime > current) {
        nextLastOrderAtByCustomerId[customerId] = referenceTime;
      }
    }

    setLastOrderAtByCustomerId(nextLastOrderAtByCustomerId);
    setOrderCountByCustomerId(nextOrderCountByCustomerId);
    setCustomers(nextCustomers);
  };

  useEffect(() => {
    load().catch(console.error);
  }, []);

  useEffect(() => {
    return () => {
      postalCodeLookupAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) return;

    const inputs = Array.from(
      new Set([addressInputRef.current, modalAddressInputRef.current].filter(Boolean))
    ) as HTMLInputElement[];
    if (inputs.length === 0) return;

    let disposed = false;
    const listeners: Array<{ remove?: () => void }> = [];

    const applyGooglePatch = (patch: ReturnType<typeof buildCustomerAddressAutofillFromGooglePlace>) => {
      if (Object.keys(patch).length === 0) return;
      setForm((prev) => {
        const next: Partial<Customer> = {
          ...prev,
          // Complemento permanece manual; nao e preenchido pelo endereco do Google.
          address: `${patch.address || ''}`,
          addressLine1: `${patch.addressLine1 || ''}`,
          neighborhood: `${patch.neighborhood || ''}`,
          city: `${patch.city || ''}`,
          state: `${patch.state || ''}`,
          postalCode: `${patch.postalCode || ''}`,
          country: `${patch.country || 'Brasil'}`,
          placeId: `${patch.placeId || ''}`,
          ...(typeof patch.lat === 'number' ? { lat: patch.lat } : { lat: undefined }),
          ...(typeof patch.lng === 'number' ? { lng: patch.lng } : { lng: undefined })
        };

        customerAutofillRef.current.address = `${next.address || ''}`;
        customerAutofillRef.current.addressLine1 = `${next.addressLine1 || ''}`;
        customerAutofillRef.current.city = `${next.city || ''}`;
        customerAutofillRef.current.country = `${next.country || ''}`;
        customerAutofillRef.current.neighborhood = `${next.neighborhood || ''}`;
        customerAutofillRef.current.postalCode = `${next.postalCode || ''}`;
        customerAutofillRef.current.state = `${next.state || ''}`;

        return next;
      });
    };

    void loadGooglePlacesLibrary({ apiKey: GOOGLE_MAPS_API_KEY })
      .then((google) => {
        if (disposed) return;
        const mapsApi = (google as { maps?: { places?: { Autocomplete?: unknown } } }).maps;
        const placesApi = mapsApi?.places as
          | {
              Autocomplete?: new (
                input: HTMLInputElement,
                options?: Record<string, unknown>
              ) => {
                addListener: (
                  eventName: string,
                  handler: () => void
                ) => {
                  remove?: () => void;
                };
                getPlace?: () => unknown;
              };
            }
          | undefined;

        if (!placesApi?.Autocomplete) return;

        for (const input of inputs) {
          const autocomplete = new placesApi.Autocomplete(input, {
            fields: ['address_components', 'formatted_address', 'geometry', 'place_id'],
            componentRestrictions: { country: 'br' },
            types: ['address']
          });

          const listener = autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace?.();
            const patch = buildCustomerAddressAutofillFromGooglePlace(place as GooglePlaceResultLike);
            applyGooglePatch(patch);
          });
          listeners.push(listener);
        }
      })
      .catch((error) => {
        console.warn(error instanceof Error ? error.message : 'Google Places indisponivel no momento.');
      });

    return () => {
      disposed = true;
      for (const listener of listeners) {
        if (listener?.remove) listener.remove();
      }
    };
  }, [isCustomerModalOpen, isCustomerInfoEditing]);

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
    const inferredNamePatch = buildCustomerNameAutofill(fullName);
    const inferredAddressPatch = buildCustomerAddressAutofill(form.address || '');

    const promotedFirstName = pickPromotedValue(form.firstName, inferredNamePatch.firstName || fallbackFirst);
    const promotedLastName = pickPromotedValue(form.lastName, inferredNamePatch.lastName || fallbackLast);
    const promotedAddressLine1 = pickPromotedValue(form.addressLine1, inferredAddressPatch.addressLine1);
    const promotedNeighborhood = pickPromotedValue(form.neighborhood, inferredAddressPatch.neighborhood);
    const promotedCity = pickPromotedValue(form.city, inferredAddressPatch.city);
    const promotedState = pickPromotedValue(form.state, inferredAddressPatch.state).toUpperCase();
    const promotedPostalCode = formatPostalCodeBR(
      pickPromotedValue(form.postalCode, inferredAddressPatch.postalCode)
    );

    const payloadBase = {
      ...form,
      name: fullName,
      firstName: promotedFirstName ? titleCase(promotedFirstName) : fallbackFirst,
      lastName: promotedLastName ? titleCase(promotedLastName) : fallbackLast,
      phone: normalizePhone(form.phone || ''),
      email: null,
      address: normalizeAddress(form.address || ''),
      addressLine1: normalizeAddress(promotedAddressLine1),
      addressLine2: normalizeAddress(form.addressLine2 || ''),
      neighborhood: normalizeAddress(promotedNeighborhood),
      city: normalizeAddress(promotedCity),
      state: promotedState || undefined,
      postalCode: promotedPostalCode || undefined,
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

    const isEditing = editingId != null;

    try {
      if (isEditing) {
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
      if (isEditing) {
        setSelectedCustomer(null);
        setIsCustomerModalOpen(false);
        setCustomerRecentOrders([]);
        setRepeatDraftOrderId(null);
        setRepeatDraftError(null);
      }
      await load();
      notifySuccess(isEditing ? 'Cliente atualizado com sucesso.' : 'Cliente criado com sucesso.');
      scrollToLayoutSlot('list');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Nao foi possivel salvar o cliente.');
    }
  };

  const startEdit = (customer: Customer, options?: { focusForm?: boolean }) => {
    const inferredNamePatch = buildCustomerNameAutofill(customer.name);
    const inferredAddressPatch = buildCustomerAddressAutofill(customer.address);
    const promotedFirstName = pickPromotedValue(customer.firstName, inferredNamePatch.firstName);
    const promotedLastName = pickPromotedValue(customer.lastName, inferredNamePatch.lastName);
    const promotedAddressLine1 = pickPromotedValue(customer.addressLine1, inferredAddressPatch.addressLine1);
    const promotedNeighborhood = pickPromotedValue(customer.neighborhood, inferredAddressPatch.neighborhood);
    const promotedCity = pickPromotedValue(customer.city, inferredAddressPatch.city);
    const promotedState = pickPromotedValue(customer.state, inferredAddressPatch.state).toUpperCase();
    const promotedPostalCode = formatPostalCodeBR(
      pickPromotedValue(customer.postalCode, inferredAddressPatch.postalCode)
    );

    setEditingId(customer.id!);
    const nextForm: Partial<Customer> = {
      name: customer.name,
      firstName: promotedFirstName,
      lastName: promotedLastName,
      phone: formatPhoneBR(customer.phone ?? ''),
      address: customer.address ?? '',
      addressLine1: promotedAddressLine1,
      addressLine2: customer.addressLine2 ?? '',
      neighborhood: promotedNeighborhood,
      city: promotedCity,
      state: promotedState,
      postalCode: promotedPostalCode,
      country: customer.country ?? 'Brasil',
      deliveryNotes: customer.deliveryNotes ?? ''
    };
    resetCustomerAutofill();
    primeCustomerAutofill(nextForm);
    setForm(nextForm);
    if (options?.focusForm ?? true) {
      scrollToLayoutSlot('form', { focus: true, focusSelector: 'input, select, textarea' });
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    resetCustomerAutofill();
    setForm(emptyCustomer);
    setSelectedCustomer(null);
    setIsCustomerModalOpen(false);
    setCustomerRecentOrders([]);
    setCustomerOrdersError(null);
    setIsLoadingCustomerOrders(false);
    setIsCustomerInfoEditing(false);
    setRepeatDraftOrderId(null);
    setRepeatDraftError(null);
  };

  const clearCustomerForm = () => {
    setError(null);
    setEditingId(null);
    resetCustomerAutofill();
    setForm(emptyCustomer);
  };

  const formatOrderItemsSummary = (items?: Array<Pick<OrderItem, 'productId' | 'quantity'>>) => {
    if (!items || items.length === 0) return 'Sem caixas';
    const parts = items
      .map((item) => {
        const productName = productNameById[item.productId] || `Produto #${item.productId}`;
        return `${productName} x${Math.max(Math.floor(item.quantity || 0), 0)}`;
      })
      .filter(Boolean);
    if (parts.length <= 3) return parts.join(' • ');
    return `${parts.slice(0, 3).join(' • ')} +${parts.length - 3}`;
  };

  const loadCustomerRecentOrders = async (customerId: number) => {
    setIsLoadingCustomerOrders(true);
    setCustomerOrdersError(null);

    try {
      const [orders, products] = await Promise.all([
        apiFetch<CustomerOrderPreview[]>('/orders'),
        apiFetch<Product[]>('/products')
      ]);

      const nextProductNameById: Record<number, string> = {};
      for (const product of products) {
        if (typeof product.id !== 'number') continue;
        nextProductNameById[product.id] = product.name;
      }
      setProductNameById(nextProductNameById);

      const recent = orders
        .filter((order) => order.customerId === customerId)
        .sort((left, right) => {
          const leftTime = new Date(left.createdAt || left.scheduledAt || 0).getTime();
          const rightTime = new Date(right.createdAt || right.scheduledAt || 0).getTime();
          return rightTime - leftTime;
        })
        .slice(0, 8);

      setCustomerRecentOrders(recent);
      return recent;
    } catch (err) {
      setCustomerOrdersError(err instanceof Error ? err.message : 'Nao foi possivel carregar os pedidos do cliente.');
      setCustomerRecentOrders([]);
      return [] as CustomerOrderPreview[];
    } finally {
      setIsLoadingCustomerOrders(false);
    }
  };

  const openCustomerModal = async (
    customer: Customer,
    options?: { preselectRepeatOrderId?: number | null }
  ) => {
    startEdit(customer, { focusForm: false });
    setSelectedCustomer(customer);
    setIsCustomerModalOpen(true);
    setIsCustomerInfoEditing(false);
    setRepeatDraftOrderId(null);
    setRepeatDraftError(null);
    const recentOrders = await loadCustomerRecentOrders(customer.id!);
    const targetOrderId = options?.preselectRepeatOrderId;
    if (!targetOrderId) return;
    const targetOrder = recentOrders.find((order) => order.id === targetOrderId);
    if (targetOrder) {
      startRepeatOrder(targetOrder);
    }
  };

  const closeCustomerModal = () => {
    cancelEdit();
  };

  const startRepeatOrder = (order: CustomerOrderPreview) => {
    setRepeatDraftOrderId(order.id);
    setRepeatDraftScheduledAt(defaultRepeatOrderDateTimeInput());
    setRepeatDraftError(null);
  };

  const cancelRepeatOrder = () => {
    setRepeatDraftOrderId(null);
    setRepeatDraftError(null);
    setRepeatDraftScheduledAt(defaultRepeatOrderDateTimeInput());
  };

  const confirmRepeatOrder = async (order: CustomerOrderPreview) => {
    if (!selectedCustomer?.id) return;

    const parsedScheduledAt = parseDateTimeLocalInput(repeatDraftScheduledAt);
    if (!parsedScheduledAt) {
      setRepeatDraftError('Informe data e horario validos para criar o pedido.');
      return;
    }

    const nextItems = (order.items || [])
      .map((item) => ({
        productId: Number(item.productId),
        quantity: Math.max(Math.floor(item.quantity || 0), 0)
      }))
      .filter((item) => Number.isFinite(item.productId) && item.productId > 0 && item.quantity > 0);

    if (nextItems.length === 0) {
      setRepeatDraftError('Esse pedido nao possui caixas validas para refazer.');
      return;
    }

    setRepeatDraftError(null);
    setIsRepeatOrderPending(true);
    try {
      await apiFetch('/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerId: selectedCustomer.id,
          items: nextItems,
          discount: typeof order.discount === 'number' ? order.discount : 0,
          notes: order.notes || undefined,
          scheduledAt: parsedScheduledAt.toISOString()
        })
      });
      notifySuccess('Pedido recriado e enviado para a agenda.');
      closeCustomerModal();
      router.push('/pedidos?focus=list');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nao foi possivel refazer o pedido.';
      setRepeatDraftError(message);
      notifyError(message);
    } finally {
      setIsRepeatOrderPending(false);
    }
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
    void openCustomerModal(customer);
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
              email: null,
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
    void openCustomerModal(customer);
  };

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase();
    const baseList = !query
      ? customers
      : customers.filter((customer) => {
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
        neighborhood.toLowerCase().includes(query)
      );
    });

    return [...baseList].sort((left, right) => {
      const leftId = Number(left.id || 0);
      const rightId = Number(right.id || 0);
      const leftLastOrderAt = lastOrderAtByCustomerId[leftId] ?? Number.NEGATIVE_INFINITY;
      const rightLastOrderAt = lastOrderAtByCustomerId[rightId] ?? Number.NEGATIVE_INFINITY;
      if (leftLastOrderAt !== rightLastOrderAt) {
        return rightLastOrderAt - leftLastOrderAt;
      }
      return rightId - leftId;
    });
  }, [customers, lastOrderAtByCustomerId, search]);

  const addressRecommendations = useMemo(() => {
    const unique = new Set<string>();
    for (const customer of customers) {
      const normalizedAddress = compactWhitespace(customer.address || '');
      if (normalizedAddress) unique.add(normalizedAddress);
    }
    return Array.from(unique).slice(0, 80);
  }, [customers]);

  return (
    <>
    <BuilderLayoutProvider page="clientes">
      <section className="grid gap-8">
      <BuilderLayoutItemSlot
        id="form"
        className={isSpotlightSlot('form') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'}
      >
      <form onSubmit={submit} className="app-panel grid gap-5">
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
          <FormField label="Telefone">
            <input
              className="app-input"
              placeholder="(11) 99999-9999"
              value={form.phone || ''}
              inputMode="tel"
              autoComplete="tel"
              onChange={(e) => setForm((prev) => ({ ...prev, phone: formatPhoneBR(e.target.value) }))}
            />
          </FormField>
          <FormField label="Endereço">
            <input
              className="app-input"
              placeholder="Rua, numero, bairro, cidade"
              ref={addressInputRef}
              list="customer-address-recommendations"
              value={form.address || ''}
              autoComplete="street-address"
              onChange={(e) => handleAddressChange(e.target.value)}
              onBlur={(e) => handleAddressChange(normalizeAddress(e.target.value) || '')}
            />
            {addressRecommendations.length > 0 ? (
              <datalist id="customer-address-recommendations">
                {addressRecommendations.map((entry) => (
                  <option key={entry} value={entry} />
                ))}
              </datalist>
            ) : null}
          </FormField>
          <FormField label="Complemento">
            <input
              className="app-input"
              placeholder="Apto, bloco, andar..."
              value={form.addressLine2 || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, addressLine2: e.target.value }))}
            />
          </FormField>
        </div>

        <details className="app-details">
          <summary>
            <span className="app-details__summary-label">
              Mais Informações
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

            {!isOperationMode ? (
              <>
                <FormField label="Primeiro nome">
                  <input
                    className="app-input"
                    placeholder="Primeiro nome"
                    value={form.firstName || ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
                  />
                </FormField>
                <FormField label="Sobrenome">
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
          <button
            type="button"
            className="order-quick-create__clear app-button app-button-ghost"
            onClick={clearCustomerForm}
            aria-label="Limpar"
            title="Limpar"
          >
            ↺
          </button>
          <button className="app-button app-button-primary w-full md:w-auto" type="submit">
            {editingId ? <AppIcon name="refresh" className="h-4 w-4" /> : null}
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
        id="list"
        className={isSpotlightSlot('list') ? 'app-spotlight-slot app-spotlight-slot--active' : 'app-spotlight-slot'}
      >
      <div className="grid gap-3">
        {filteredCustomers.map((customer) => {
          const customerPhoneLabel = formatPhoneBR(customer.phone) || 'Sem telefone';
          const customerPhoneHref = buildWhatsAppUrl(customer.phone);
          const customerOrdersCount = customer.id ? orderCountByCustomerId[customer.id] || 0 : 0;
          return (
            <div
              key={customer.id}
              className="app-panel app-panel--interactive"
              role="button"
              tabIndex={0}
              onClick={() => {
                void openCustomerModal(customer);
              }}
              onKeyDown={(event) => handleCustomerCardKeyDown(event, customer)}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-lg font-semibold">{customer.name}</p>
                    <span className="min-w-0 truncate text-xs font-semibold tracking-[0.12em] text-neutral-500">
                      {customer.address || 'Sem endereco'}
                      {customer.neighborhood ? ` • ${customer.neighborhood}` : ''}
                    </span>
                  </div>
                  <p className="mt-1 flex items-center gap-2 text-sm text-neutral-500">
                    {customerPhoneHref ? (
                      <a
                        href={customerPhoneHref}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-neutral-900"
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`Abrir conversa no WhatsApp para ${customerPhoneLabel}`}
                      >
                        <AppIcon name="whatsapp" className="h-4 w-4 text-[#25D366]" />
                        {customerPhoneLabel}
                      </a>
                    ) : (
                      <span>{customerPhoneLabel}</span>
                    )}
                    <span className="text-xs font-semibold tracking-[0.08em] text-neutral-500">
                      {customerOrdersCount} {customerOrdersCount === 1 ? 'Pedido' : 'Pedidos'}
                    </span>
                  </p>
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

      {isCustomerModalOpen && selectedCustomer ? (
        <div className="order-detail-modal" role="presentation" onClick={closeCustomerModal}>
          <div
            className="order-detail-modal__dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Cliente ${selectedCustomer.name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className="order-detail-modal__close" onClick={closeCustomerModal}>
              <AppIcon name="close" className="h-4 w-4" />
              Fechar
            </button>

            <div className="app-panel order-detail-modal__panel grid gap-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-neutral-900">{selectedCustomer.name}</h3>
                </div>
              </div>

              <section className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold uppercase tracking-[0.14em] text-neutral-600">
                    Ultimos pedidos
                  </h4>
                  <span className="text-xs text-neutral-500">{customerRecentOrders.length} registro(s)</span>
                </div>

                {isLoadingCustomerOrders ? (
                  <div className="app-panel border-dashed text-sm text-neutral-500">
                    Carregando pedidos do cliente...
                  </div>
                ) : customerOrdersError ? (
                  <div className="app-panel border-dashed text-sm text-red-700">{customerOrdersError}</div>
                ) : customerRecentOrders.length === 0 ? (
                  <div className="app-panel border-dashed text-sm text-neutral-500">
                    Nenhum pedido encontrado para este cliente.
                  </div>
                ) : (
                  customerRecentOrders.map((order) => {
                    const isRepeatExpanded = repeatDraftOrderId === order.id;
                    return (
                      <article
                        key={order.id}
                        className="rounded-2xl border border-[color:var(--line-soft)] bg-white/85 p-3 shadow-sm"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-neutral-900">Pedido #{order.id}</p>
                            <p className="mt-1 text-xs text-neutral-600">
                              {formatOrderDateTimeLabel(order.scheduledAt || order.createdAt)}
                            </p>
                            <p className="mt-1 text-xs text-neutral-500">
                              Status: {formatOrderStatusLabel(order.status)}
                            </p>
                            <p className="mt-2 text-xs text-neutral-700">{formatOrderItemsSummary(order.items)}</p>
                            <p className="mt-1 text-xs text-neutral-500">
                              Total:{' '}
                              {typeof order.total === 'number'
                                ? order.total.toLocaleString('pt-BR', {
                                    style: 'currency',
                                    currency: 'BRL'
                                  })
                                : 'Nao calculado'}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="app-button app-button-primary"
                            onClick={() => startRepeatOrder(order)}
                            disabled={isRepeatOrderPending}
                          >
                            REFAZER PEDIDO
                          </button>
                        </div>

                        {isRepeatExpanded ? (
                          <div className="mt-3 grid gap-2 rounded-xl border border-[color:var(--line-soft)] bg-white p-3">
                            <FormField label="Horario de entrega do novo pedido">
                              <input
                                className="app-input"
                                type="datetime-local"
                                value={repeatDraftScheduledAt}
                                step={900}
                                onChange={(event) => setRepeatDraftScheduledAt(event.target.value)}
                              />
                            </FormField>
                            {repeatDraftError ? (
                              <p className="text-xs font-medium text-red-700">{repeatDraftError}</p>
                            ) : null}
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="app-button app-button-primary"
                                onClick={() => {
                                  void confirmRepeatOrder(order);
                                }}
                                disabled={isRepeatOrderPending}
                              >
                                {isRepeatOrderPending ? 'Criando...' : 'Confirmar e criar na agenda'}
                              </button>
                              <button
                                type="button"
                                className="app-button app-button-ghost"
                                onClick={cancelRepeatOrder}
                                disabled={isRepeatOrderPending}
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </article>
                    );
                  })
                )}
              </section>

              <section className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold uppercase tracking-[0.14em] text-neutral-600">
                    Informacoes
                  </h4>
                  <button
                    type="button"
                    className="app-button app-button-ghost min-h-8 px-3 py-1.5 text-[0.7rem] normal-case tracking-[0.02em]"
                    onClick={() => setIsCustomerInfoEditing((current) => !current)}
                  >
                    {isCustomerInfoEditing ? 'Ocultar edição' : 'Editar'}
                  </button>
                </div>

                {!isCustomerInfoEditing ? (
                  <div className="rounded-2xl border border-[color:var(--line-soft)] bg-white/85 p-3 text-sm text-neutral-700">
                    <p>
                      <span className="font-semibold text-neutral-900">Nome:</span> {form.name || 'Sem nome'}
                    </p>
                    <p className="mt-1">
                      <span className="font-semibold text-neutral-900">Telefone:</span>{' '}
                      {formatPhoneBR(form.phone || '') || 'Sem telefone'}
                    </p>
                    <p className="mt-1">
                      <span className="font-semibold text-neutral-900">Endereço:</span>{' '}
                      {[
                        form.address || form.addressLine1 || '',
                        form.addressLine2 || '',
                        form.neighborhood || '',
                        [form.city || '', form.state || ''].filter(Boolean).join(' - '),
                        form.postalCode || ''
                      ]
                        .filter(Boolean)
                        .join(', ') || 'Sem endereço'}
                    </p>
                    <p className="mt-1">
                      <span className="font-semibold text-neutral-900">Entrega:</span>{' '}
                      {form.deliveryNotes || 'Sem instruções'}
                    </p>
                  </div>
                ) : (
                  <form onSubmit={submit} className="grid gap-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <FormField label="Nome completo" error={error}>
                        <input
                          className="app-input"
                          placeholder="Nome completo"
                          value={form.name || ''}
                          onChange={(event) => handleNameChange(event.target.value)}
                          onBlur={(event) => handleNameChange(titleCase(event.target.value))}
                        />
                      </FormField>
                      <FormField label="Telefone">
                        <input
                          className="app-input"
                          placeholder="(11) 99999-9999"
                          value={form.phone || ''}
                          inputMode="tel"
                          autoComplete="tel"
                          onChange={(event) =>
                            setForm((prev) => ({ ...prev, phone: formatPhoneBR(event.target.value) }))
                          }
                        />
                      </FormField>
                      <FormField label="Endereço">
                        <input
                          className="app-input"
                          placeholder="Rua, numero, bairro, cidade"
                          ref={modalAddressInputRef}
                          list="customer-address-recommendations"
                          value={form.address || ''}
                          autoComplete="street-address"
                          onChange={(event) => handleAddressChange(event.target.value)}
                          onBlur={(event) => handleAddressChange(normalizeAddress(event.target.value) || '')}
                        />
                      </FormField>
                      <FormField label="Complemento">
                        <input
                          className="app-input"
                          placeholder="Apto, bloco, andar..."
                          value={form.addressLine2 || ''}
                          onChange={(event) =>
                            setForm((prev) => ({ ...prev, addressLine2: event.target.value }))
                          }
                        />
                      </FormField>
                      <FormField label="Primeiro nome">
                        <input
                          className="app-input"
                          placeholder="Primeiro nome"
                          value={form.firstName || ''}
                          onChange={(event) => setForm((prev) => ({ ...prev, firstName: event.target.value }))}
                        />
                      </FormField>
                      <FormField label="Sobrenome">
                        <input
                          className="app-input"
                          placeholder="Sobrenome"
                          value={form.lastName || ''}
                          onChange={(event) => setForm((prev) => ({ ...prev, lastName: event.target.value }))}
                        />
                      </FormField>
                      <FormField label="Rua e numero">
                        <input
                          className="app-input"
                          placeholder="Ex: Rua X, 123"
                          value={form.addressLine1 || ''}
                          onChange={(event) =>
                            setForm((prev) => ({ ...prev, addressLine1: event.target.value }))
                          }
                        />
                      </FormField>
                      <FormField label="Bairro">
                        <input
                          className="app-input"
                          placeholder="Bairro"
                          value={form.neighborhood || ''}
                          onChange={(event) =>
                            setForm((prev) => ({ ...prev, neighborhood: event.target.value }))
                          }
                        />
                      </FormField>
                      <FormField label="Cidade">
                        <input
                          className="app-input"
                          placeholder="Cidade"
                          value={form.city || ''}
                          onChange={(event) => setForm((prev) => ({ ...prev, city: event.target.value }))}
                        />
                      </FormField>
                      <FormField label="Estado (UF)">
                        <input
                          className="app-input"
                          placeholder="SP"
                          value={form.state || ''}
                          onChange={(event) => setForm((prev) => ({ ...prev, state: event.target.value }))}
                        />
                      </FormField>
                      <FormField label="CEP">
                        <input
                          className="app-input"
                          placeholder="00000-000"
                          value={form.postalCode || ''}
                          inputMode="numeric"
                          autoComplete="postal-code"
                          onChange={(event) => handlePostalCodeChange(event.target.value)}
                        />
                      </FormField>
                      <FormField label="Pais">
                        <input
                          className="app-input"
                          placeholder="Brasil"
                          value={form.country || ''}
                          onChange={(event) => setForm((prev) => ({ ...prev, country: event.target.value }))}
                        />
                      </FormField>
                    </div>
                    <FormField label="Instrucoes de entrega" hint="Portao, referencia, interfone">
                      <input
                        className="app-input"
                        placeholder="Ex: portao preto, tocar 18"
                        value={form.deliveryNotes || ''}
                        onChange={(event) => setForm((prev) => ({ ...prev, deliveryNotes: event.target.value }))}
                      />
                    </FormField>

                    <div className="app-form-actions">
                      <button className="app-button app-button-primary" type="submit">
                        <AppIcon name="refresh" className="h-4 w-4" />
                        Salvar alteracoes
                      </button>
                      <button
                        className="app-button app-button-ghost"
                        type="button"
                        onClick={() => {
                          if (selectedCustomer) {
                            startEdit(selectedCustomer, { focusForm: false });
                          }
                          setIsCustomerInfoEditing(false);
                          setError(null);
                        }}
                      >
                        Cancelar edição
                      </button>
                    </div>
                    {!isOperationMode ? (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          className="app-button app-button-ghost min-h-8 px-3 py-1.5 text-[0.66rem] normal-case tracking-[0.01em] text-red-700 opacity-75 hover:opacity-100"
                          onClick={() => {
                            if (!selectedCustomer.id) return;
                            void remove(selectedCustomer.id);
                          }}
                        >
                          Remover cliente
                        </button>
                      </div>
                    ) : null}
                  </form>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}

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
