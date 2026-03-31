'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function OpsLogoutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleLogout() {
    if (isPending) return;
    setIsPending(true);
    try {
      await fetch('/api/ops-auth/logout', {
        method: 'POST',
        cache: 'no-store'
      });
    } finally {
      router.replace('/acesso');
      router.refresh();
      setIsPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="rounded-[16px] border border-[rgba(126,79,45,0.14)] bg-white/88 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-strong)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isPending}
    >
      {isPending ? 'Saindo...' : 'Sair'}
    </button>
  );
}
