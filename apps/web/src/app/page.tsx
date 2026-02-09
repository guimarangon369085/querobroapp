import { Button } from '@querobroapp/ui';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-16">
      <div>
        <p className="text-sm uppercase tracking-[0.3em] text-neutral-500">QuerobroApp</p>
        <h1 className="mt-4 text-4xl font-semibold text-neutral-900">
          Stack unificada para vendas, pedidos e pagamentos
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-neutral-600">
          Este monorepo conecta API, web e mobile em uma base compartilhada com tipos e
          componentes reutilizaveis.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button>Entrar</Button>
        <Button variant="outline">Ver pedidos</Button>
      </div>
    </main>
  );
}
