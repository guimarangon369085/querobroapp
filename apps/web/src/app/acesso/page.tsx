import { Suspense } from 'react';
import { OpsLoginForm } from '@/components/ops-login-form';
import { getOpsAccessConfig } from '@/lib/ops-access';

export const dynamic = 'force-dynamic';

export default function AcessoPage() {
  const config = getOpsAccessConfig();
  const authReady = !config.enabled || (config.credentialsBySecret.size > 0 && Boolean(config.signingSecret));

  return (
    <div className="mx-auto grid min-h-screen w-full max-w-[1120px] items-center gap-8 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,1.05fr)_420px] lg:px-10">
      <section className="rounded-[30px] border border-white/70 bg-[linear-gradient(160deg,rgba(248,239,229,0.96),rgba(242,247,243,0.9))] p-6 shadow-[0_28px_80px_rgba(57,39,24,0.08)] sm:p-8 lg:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--ink-muted)]">QUEROBROAPP</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-[color:var(--ink-strong)] sm:text-4xl">
          Acesso protegido da operação
        </h1>
        <p className="mt-4 max-w-[52ch] text-sm leading-6 text-[color:var(--ink-muted)] sm:text-[15px]">
          Pedidos, clientes, estoque e dashboard agora exigem autenticação persistente no navegador. Depois do
          primeiro acesso, a sessão continua válida até logout explícito ou limpeza de cookies/cache.
        </p>
      </section>

      <section className="rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_28px_80px_rgba(57,39,24,0.08)] sm:p-8">
        <div className="mb-5 grid gap-2">
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-[color:var(--ink-strong)]">Entrar na operação</h2>
          <p className="text-sm leading-6 text-[color:var(--ink-muted)]">
            Use a senha operacional configurada no ambiente de produção.
          </p>
        </div>

        {authReady ? (
          <Suspense fallback={null}>
            <OpsLoginForm authEnabled={config.enabled} authReady={authReady} />
          </Suspense>
        ) : (
          <div className="rounded-[18px] border border-[rgba(161,84,39,0.14)] bg-[rgba(251,239,234,0.82)] px-4 py-4 text-sm leading-6 text-[color:var(--tone-roast-ink)]">
            O acesso operacional está ativo, mas faltam credenciais no runtime do web. Configure `APP_AUTH_TOKEN`,
            `APP_AUTH_TOKENS` ou `APP_API_BRIDGE_TOKEN` neste serviço.
          </div>
        )}
      </section>
    </div>
  );
}
