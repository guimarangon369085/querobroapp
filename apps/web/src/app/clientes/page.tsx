'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Customer } from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';
import { formatPhoneBR, normalizeAddress, normalizePhone, titleCase } from '@/lib/format';
import { loadGoogleMaps } from '@/lib/googleMaps';
import { FormField } from '@/components/form/FormField';

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
  placeId: '',
  lat: undefined,
  lng: undefined,
  deliveryNotes: ''
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form, setForm] = useState<Partial<Customer>>(emptyCustomer);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const addressInputRef = useRef<HTMLInputElement | null>(null);

  const load = () => apiFetch<Customer[]>('/customers').then(setCustomers);

  useEffect(() => {
    load().catch(console.error);
  }, []);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey || !addressInputRef.current) return;

    let autocomplete: google.maps.places.Autocomplete | null = null;
    loadGoogleMaps(apiKey)
      .then(() => {
        if (!addressInputRef.current) return;
        autocomplete = new google.maps.places.Autocomplete(addressInputRef.current, {
          fields: ['formatted_address', 'address_components', 'geometry', 'place_id'],
          types: ['address']
        });
        autocomplete.addListener('place_changed', () => {
          const place = autocomplete?.getPlace();
          if (!place) return;
          const findComponent = (type: string) =>
            place.address_components?.find((component) => component.types.includes(type));

          const streetNumber = findComponent('street_number')?.long_name ?? '';
          const route = findComponent('route')?.long_name ?? '';
          const neighborhood =
            findComponent('sublocality')?.long_name ||
            findComponent('sublocality_level_1')?.long_name ||
            findComponent('neighborhood')?.long_name ||
            '';
          const city =
            findComponent('locality')?.long_name ||
            findComponent('administrative_area_level_2')?.long_name ||
            '';
          const state = findComponent('administrative_area_level_1')?.short_name ?? '';
          const postalCode = findComponent('postal_code')?.long_name ?? '';
          const country = findComponent('country')?.long_name ?? '';
          const addressLine1 = [route, streetNumber].filter(Boolean).join(', ');

          setForm((prev) => ({
            ...prev,
            address: place.formatted_address || prev.address || '',
            addressLine1: addressLine1 || prev.addressLine1 || '',
            neighborhood: neighborhood || prev.neighborhood || '',
            city: city || prev.city || '',
            state: state || prev.state || '',
            postalCode: postalCode || prev.postalCode || '',
            country: country || prev.country || '',
            placeId: place.place_id || prev.placeId || '',
            lat: place.geometry?.location?.lat?.() ?? prev.lat,
            lng: place.geometry?.location?.lng?.() ?? prev.lng
          }));
        });
      })
      .catch(console.error);

    return () => {
      if (autocomplete) {
        google.maps.event.clearInstanceListeners(autocomplete);
      }
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name || form.name.trim().length < 2) {
      setError('Informe um nome valido.');
      return;
    }
    if (!form.phone || normalizePhone(form.phone || '').length < 10) {
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

    const payload = {
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
      placeId: form.placeId?.trim() || undefined,
      lat: form.lat ?? undefined,
      lng: form.lng ?? undefined,
      deliveryNotes: form.deliveryNotes?.trim() || undefined
    };

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

    setForm(emptyCustomer);
    setEditingId(null);
    await load();
  };

  const startEdit = (customer: Customer) => {
    setEditingId(customer.id!);
    setForm({
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
      placeId: customer.placeId ?? '',
      lat: customer.lat ?? undefined,
      lng: customer.lng ?? undefined,
      deliveryNotes: customer.deliveryNotes ?? ''
    });
  };

  const remove = async (id: number) => {
    if (!confirm('Remover este cliente?')) return;
    try {
      await apiFetch(`/customers/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Nao foi possivel remover o cliente.');
    }
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
    <section className="grid gap-8">
      <div className="app-section-title">
        <div>
          <span className="app-chip">Relacionamento</span>
          <h2 className="mt-3 text-3xl font-semibold">Clientes</h2>
          <p className="text-neutral-600">Cadastre e organize sua base de clientes.</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="app-kpi">
          <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Clientes</p>
          <p className="mt-2 text-3xl font-semibold">{customers.length}</p>
        </div>
        <div className="app-panel md:col-span-2">
          <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Busca rapida</p>
          <input
            className="app-input mt-2"
            placeholder="Buscar por nome, telefone ou endereco"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <form onSubmit={submit} className="app-panel grid gap-5">
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Nome completo" error={error}>
            <input
              className="app-input"
              placeholder="Nome completo"
              value={form.name || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              onBlur={(e) => setForm((prev) => ({ ...prev, name: titleCase(e.target.value) }))}
            />
          </FormField>
          <FormField label="Telefone" hint="DDD + numero (WhatsApp)">
            <input
              className="app-input"
              placeholder="(11) 99999-9999"
              value={form.phone || ''}
              inputMode="tel"
              autoComplete="tel"
              onChange={(e) => setForm((prev) => ({ ...prev, phone: formatPhoneBR(e.target.value) }))}
            />
          </FormField>
          <FormField label="Primeiro nome" hint="Obrigatorio para Uber Direct">
            <input
              className="app-input"
              placeholder="Primeiro nome"
              value={form.firstName || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
            />
          </FormField>
          <FormField label="Sobrenome" hint="Obrigatorio para Uber Direct">
            <input
              className="app-input"
              placeholder="Sobrenome"
              value={form.lastName || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, lastName: e.target.value }))}
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
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Endereco completo" hint="Autocomplete do Google">
            <input
              className="app-input"
              placeholder="Rua, numero, bairro, cidade"
              ref={addressInputRef}
              value={form.address || ''}
              autoComplete="street-address"
              onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
              onBlur={(e) => setForm((prev) => ({ ...prev, address: normalizeAddress(e.target.value) || '' }))}
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
              onChange={(e) => setForm((prev) => ({ ...prev, postalCode: e.target.value }))}
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
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Instrucoes de entrega" hint="Portao, referencia, interfone">
            <input
              className="app-input"
              placeholder="Ex: portao preto, tocar 18"
              value={form.deliveryNotes || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, deliveryNotes: e.target.value }))}
            />
          </FormField>
          <FormField label="Uber Direct (Place ID)">
            <input className="app-input" value={form.placeId || ''} readOnly />
          </FormField>
          <FormField label="Latitude">
            <input className="app-input" value={form.lat ?? ''} readOnly />
          </FormField>
          <FormField label="Longitude">
            <input className="app-input" value={form.lng ?? ''} readOnly />
          </FormField>
        </div>
        <div className="flex gap-3">
          <button className="app-button app-button-primary" type="submit">
            {editingId ? 'Atualizar' : 'Criar'}
          </button>
          {editingId && (
            <button
              className="app-button app-button-ghost"
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(emptyCustomer);
              }}
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

      <div className="grid gap-3">
        {filteredCustomers.map((customer) => (
          <div
            key={customer.id}
            className="app-panel flex flex-wrap items-center justify-between gap-4"
          >
            <div>
              <p className="text-lg font-semibold">{customer.name}</p>
              <p className="text-sm text-neutral-500">
                {formatPhoneBR(customer.phone) || 'Sem telefone'} • {customer.address || 'Sem endereco'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className="app-button app-button-ghost"
                onClick={() => startEdit(customer)}
              >
                Editar
              </button>
              <button
                className="app-button app-button-danger"
                onClick={() => remove(customer.id!)}
              >
                Remover
              </button>
            </div>
          </div>
        ))}
        {filteredCustomers.length === 0 && (
          <div className="app-panel border-dashed text-sm text-neutral-500">
            Nenhum cliente encontrado com este filtro.
          </div>
        )}
      </div>
    </section>
  );
}
