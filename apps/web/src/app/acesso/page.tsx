import { Suspense } from 'react';
import { OpsLoginForm } from '@/components/ops-login-form';
import { getOpsAccessConfig } from '@/lib/ops-access';

export const dynamic = 'force-dynamic';

export default function AcessoPage() {
  const config = getOpsAccessConfig();
  const authReady = !config.enabled || (config.credentialsBySecret.size > 0 && Boolean(config.signingSecret));

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[760px] items-center px-5 py-10 sm:px-8 lg:px-10">
      <section className="w-full rounded-[30px] border border-white/70 bg-[linear-gradient(160deg,rgba(248,239,229,0.96),rgba(242,247,243,0.92))] p-6 shadow-[0_28px_80px_rgba(57,39,24,0.08)] sm:p-8 lg:p-10">
        <h1 className="text-center text-3xl font-semibold tracking-[-0.04em] text-[color:var(--ink-strong)] sm:text-4xl">
          QUEROBROAPP
        </h1>
        {authReady ? (
          <Suspense fallback={null}>
            <OpsLoginForm authEnabled={config.enabled} authReady={authReady} />
          </Suspense>
        ) : (
          <div className="mt-6 rounded-[18px] border border-[rgba(161,84,39,0.14)] bg-[rgba(251,239,234,0.82)] px-4 py-4 text-sm leading-6 text-[color:var(--tone-roast-ink)]">
            O acesso operacional está ativo, mas faltam credenciais no runtime do web. Configure `APP_AUTH_TOKEN`,
            `APP_AUTH_TOKENS` ou `APP_API_BRIDGE_TOKEN` neste serviço.
          </div>
        )}
      </section>
    </div>
  );
}
