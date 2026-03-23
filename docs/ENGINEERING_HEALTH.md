# ENGINEERING_HEALTH

Ultima atualizacao: 2026-02-19

## Estado atual

Baseline de qualidade e seguranca ativa no repositorio.

## O que esta ativo

1. Lint e typecheck por monorepo (`turbo run`).
2. Teste de drift de schema Prisma.
3. Secret scan local e em CI.
4. Policy gate de diff sensivel.
5. Scripts de hardening para host e GitHub.

## Validacao recente

- `pnpm lint`: OK
- `pnpm test`: OK
- `pnpm --filter @querobroapp/web typecheck`: OK

## Riscos atuais

1. Cobertura de testes de dominio ainda abaixo do ideal.
2. Dependencia de disciplina de time para manter docs sincronizadas.
3. Trilha Prisma prod ainda baseada em `db push`.

## Proximo nivel de saude

1. Aumentar testes de pedido/financeiro/estoque.
2. Definir estrategia final de migracoes Postgres versionadas.
3. Medir erro operacional por fluxo (produto, cliente, pedido, pagamento).

