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
      <div>
        <h2 className="text-2xl font-semibold">Clientes</h2>
        <p className="text-neutral-600">Cadastre e organize sua base de clientes.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <p className="text-xs uppercase text-neutral-500">Clientes</p>
          <p className="text-2xl font-semibold">{customers.length}</p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 md:col-span-2">
          <p className="text-xs uppercase text-neutral-500">Busca rapida</p>
          <input
            className="mt-2 w-full rounded-full border border-neutral-200 px-4 py-2 text-sm"
            placeholder="Buscar por nome, telefone ou endereco"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <form onSubmit={submit} className="grid gap-4 rounded-2xl border border-neutral-200 bg-white p-6">
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Nome" error={error}>
            <input
              className="rounded-lg border border-neutral-200 px-3 py-2"
              placeholder="Nome completo"
              value={form.name || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              onBlur={(e) => setForm((prev) => ({ ...prev, name: titleCase(e.target.value) }))}
            />
          </FormField>
          <FormField label="Telefone" hint="DDD + numero (WhatsApp)">
            <input
              className="rounded-lg border border-neutral-200 px-3 py-2"
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
            className="rounded-lg border border-neutral-200 px-3 py-2"
            placeholder="Rua, numero, bairro, cidade"
            ref={addressInputRef}
            value={form.address || ''}
            autoComplete="street-address"
            onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
            onBlur={(e) => setForm((prev) => ({ ...prev, address: normalizeAddress(e.target.value) || '' }))}
          />
        </FormField>
        <div className="flex gap-3">
          <button className="rounded-full bg-neutral-900 px-4 py-2 text-white" type="submit">
            {editingId ? 'Atualizar' : 'Criar'}
          </button>
          {editingId && (
            <button
              className="rounded-full border border-neutral-200 px-4 py-2"
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
            className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-4"
          >
            <div>
              <p className="text-lg font-semibold">{customer.name}</p>
              <p className="text-sm text-neutral-500">
                {formatPhoneBR(customer.phone) || 'Sem telefone'} • {customer.address || 'Sem endereco'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded-full border border-neutral-200 px-3 py-1 text-sm"
                onClick={() => startEdit(customer)}
              >
                Editar
              </button>
              <button
                className="rounded-full border border-red-200 px-3 py-1 text-sm text-red-600"
                onClick={() => remove(customer.id!)}
              >
                Remover
              </button>
            </div>
          </div>
        ))}
        {filteredCustomers.length === 0 && (
          <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 p-6 text-sm text-neutral-500">
            Nenhum cliente encontrado com este filtro.
          </div>
        )}
      </div>
    </section>
  );
}
