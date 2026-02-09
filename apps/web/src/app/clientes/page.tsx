'use client';

import { useEffect, useState } from 'react';
import type { Customer } from '@querobroapp/shared';
import { apiFetch } from '@/lib/api';

const emptyCustomer: Partial<Customer> = {
  name: '',
  phone: '',
  address: ''
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form, setForm] = useState<Partial<Customer>>(emptyCustomer);
  const [editingId, setEditingId] = useState<number | null>(null);

  const load = () => apiFetch<Customer[]>('/customers').then(setCustomers);

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name) return;

    if (editingId) {
      await apiFetch(`/customers/${editingId}`, {
        method: 'PUT',
        body: JSON.stringify(form)
      });
    } else {
      await apiFetch('/customers', {
        method: 'POST',
        body: JSON.stringify(form)
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
      phone: customer.phone ?? '',
      address: customer.address ?? ''
    });
  };

  const remove = async (id: number) => {
    await apiFetch(`/customers/${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <section className="grid gap-8">
      <div>
        <h2 className="text-2xl font-semibold">Clientes</h2>
        <p className="text-neutral-600">Cadastre e organize sua base de clientes.</p>
      </div>

      <form onSubmit={submit} className="grid gap-4 rounded-2xl border border-neutral-200 bg-white p-6">
        <div className="grid gap-3 md:grid-cols-2">
          <input
            className="rounded-lg border border-neutral-200 px-3 py-2"
            placeholder="Nome"
            value={form.name || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          />
          <input
            className="rounded-lg border border-neutral-200 px-3 py-2"
            placeholder="Telefone"
            value={form.phone || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
          />
        </div>
        <input
          className="rounded-lg border border-neutral-200 px-3 py-2"
          placeholder="Endereco"
          value={form.address || ''}
          onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
        />
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
        {customers.map((customer) => (
          <div
            key={customer.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-4"
          >
            <div>
              <p className="text-lg font-semibold">{customer.name}</p>
              <p className="text-sm text-neutral-500">
                {customer.phone || 'Sem telefone'} • {customer.address || 'Sem endereco'}
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
      </div>
    </section>
  );
}
