'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Customer } from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';
import { formatPhoneBR, normalizeAddress, normalizePhone, titleCase } from '@/lib/format';
import { loadGoogleMaps } from '@/lib/googleMaps';
import { FormField } from '@/components/form/FormField';

const emptyCustomer: Partial<Customer> = {
  name: '',
  phone: '',
  address: ''
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
          fields: ['formatted_address'],
          types: ['address']
        });
        autocomplete.addListener('place_changed', () => {
          const place = autocomplete?.getPlace();
          if (place?.formatted_address) {
            setForm((prev) => ({ ...prev, address: place.formatted_address || '' }));
          }
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
    setError(null);

    const payload = {
      ...form,
      name: titleCase(form.name || ''),
      phone: normalizePhone(form.phone || ''),
      address: normalizeAddress(form.address || '')
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
      phone: formatPhoneBR(customer.phone ?? ''),
      address: customer.address ?? ''
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
      return (
        name.includes(query) ||
        phone.includes(query) ||
        address.toLowerCase().includes(query) ||
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
          <FormField label="Nome" error={error}>
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
        </div>
        <FormField label="Endereco" hint="Digite e selecione do autocomplete">
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
