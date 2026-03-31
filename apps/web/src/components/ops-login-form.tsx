'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function resolveSafeNextPath(value?: string | null) {
  const normalized = String(value || '').trim();
  if (!normalized.startsWith('/')) return '/pedidos';
  if (normalized.startsWith('//')) return '/pedidos';
  return normalized;
}

type OpsLoginFormProps = {
  authEnabled: boolean;
  authReady: boolean;
};

export function OpsLoginForm({ authEnabled, authReady }: OpsLoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isPending, setIsPending] = useState(false);

  const nextPath = useMemo(() => resolveSafeNextPath(searchParams.get('next')), [searchParams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authEnabled) {
      router.replace(nextPath);
      return;
    }
    if (!authReady) {
      setErrorMessage('Acesso operacional indisponivel neste ambiente.');
      return;
    }

    setErrorMessage('');
    setIsPending(true);
    try {
      const response = await fetch('/api/ops-auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          password,
          next: nextPath
        }),
        cache: 'no-store'
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setErrorMessage(String(payload?.message || 'Nao foi possivel autenticar agora.'));
        return;
      }

      setPassword('');
      router.replace(resolveSafeNextPath(payload?.next || nextPath));
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Nao foi possivel autenticar agora.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      <label className="grid gap-2">
        <span className="text-sm font-semibold text-[color:var(--ink-strong)]">Senha operacional</span>
        <input
          type="password"
          autoComplete="current-password"
          enterKeyHint="go"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-12 rounded-[18px] border border-[rgba(126,79,45,0.16)] bg-white px-4 text-[15px] text-[color:var(--ink-strong)] outline-none transition focus:border-[rgba(161,84,39,0.45)] focus:ring-2 focus:ring-[rgba(161,84,39,0.14)]"
          placeholder="Digite a senha"
          disabled={isPending || !authEnabled || !authReady}
          required
        />
      </label>

      {errorMessage ? (
        <p className="rounded-[16px] border border-[rgba(161,84,39,0.14)] bg-[rgba(251,239,234,0.8)] px-4 py-3 text-sm text-[color:var(--tone-roast-ink)]">
          {errorMessage}
        </p>
      ) : null}

      <button
        type="submit"
        className="h-12 rounded-[18px] bg-[color:var(--ink-strong)] px-4 text-sm font-semibold uppercase tracking-[0.14em] text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPending || !authEnabled || !authReady}
      >
        {authEnabled ? (isPending ? 'Entrando...' : 'Entrar') : 'Continuar'}
      </button>
    </form>
  );
}
