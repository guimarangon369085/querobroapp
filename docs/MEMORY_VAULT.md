# MEMORY_VAULT

Ultima atualizacao: 2026-02-19

## Para que serve

Manter continuidade entre sessoes sem depender de memoria de chat.

## Fonte de verdade

1. Codigo no repositorio.
2. `docs/PROJECT_SNAPSHOT.md`.
3. `docs/NEXT_STEP_PLAN.md`.
4. `docs/HANDOFF_LOG.md`.

## Contexto tecnico estavel

- Repo principal: `$HOME/querobroapp`
- Stack: NestJS + Next.js + Expo + Prisma
- Fluxo principal: Produtos -> Clientes -> Pedidos -> Estoque

## Regras de continuidade

1. Toda sessao comeca lendo snapshot + plano + handoff.
2. Toda sessao termina com handoff novo.
3. Se comportamento mudar, atualizar docs no mesmo ciclo.

## Riscos que devem ficar visiveis

- Drift entre schema dev/prod.
- Cobertura de testes de dominio ainda parcial.
- Worktree pode conter mudancas em andamento.

