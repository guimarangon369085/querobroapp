import Link from 'next/link';

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#fbf4ea_0%,#f7efe3_100%)] px-6 py-12">
      <section className="w-full max-w-[32rem] rounded-[28px] border border-[rgba(126,79,45,0.1)] bg-white px-6 py-8 text-center shadow-[0_24px_60px_rgba(70,44,26,0.12)]">
        <p className="text-[0.74rem] font-semibold uppercase tracking-[0.22em] text-[color:var(--ink-muted)]">
          QUEROBROA
        </p>
        <h1 className="mt-3 text-[1.8rem] font-semibold text-[color:var(--ink-strong)]">Página não encontrada</h1>
        <p className="mt-3 text-sm leading-6 text-[color:var(--ink-muted)]">
          O link pode estar desatualizado ou essa rota não existe mais nesta versão do app.
        </p>
        <div className="mt-6 flex justify-center">
          <Link className="app-button app-button-primary" href="/">
            Voltar para a home
          </Link>
        </div>
      </section>
    </main>
  );
}
