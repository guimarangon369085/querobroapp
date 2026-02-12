# QUEROBROAPP CONTEXTO VIVO

Ultima atualizacao: 2026-02-12
Fonte de verdade: este arquivo + codigo no repositorio

## Objetivo

Manter continuidade entre:
- Codex Terminal
- Codex Online/Cloud
- ChatGPT Online
- ChatGPT Mobile

Sem depender de historico automatico entre produtos.

## Estado atual (resumo rapido)

- Repo principal: `$HOME/querobroapp`
- Branch de referencia: `main`
- Stack: NestJS (API) + Next.js (Web) + Expo (Mobile) + Prisma
- Documentacao tecnica base:
  - `docs/PROJECT_SNAPSHOT.md`
  - `docs/NEXT_STEP_PLAN.md`
  - `docs/DELIVERY_BACKLOG.md`
  - `docs/ARCHITECTURE.md`

## Decisoes em vigor

- Repositorio git e a fonte canonica de codigo.
- Este arquivo e a fonte canonica de contexto de conversa.
- Toda sessao deve terminar com handoff preenchido (usar `docs/HANDOFF_TEMPLATE.md`).
- Nao confiar em memoria de conversa entre canais; sempre reenviar contexto minimo.

## Prioridades correntes

1. Consolidar fluxo `Pedido + Itens + Calculo + Estados`.
2. Fechar regras de `Financeiro` (saldo, parcial, quitacao).
3. Evoluir `D+1` operacional com base em pedidos + BOM.
4. Manter docs e codigo sincronizados no `main`.

## Bloqueios/atencao

- Pode haver divergencia entre schema Prisma dev e prod.
- Worktree local pode ficar suja durante iteracoes; nao apagar mudancas sem validacao.

## Prompt curto de retomada (ChatGPT Online/Mobile)

Use este prompt ao abrir conversa em outro canal:

```txt
Projeto: querobroapp.
Leia e use como contexto principal:
- docs/querobroapp-context.md
- docs/PROJECT_SNAPSHOT.md
- docs/NEXT_STEP_PLAN.md

Objetivo desta sessao: [descreva em 1 linha].
Estado atual: [branch/commit ou mudancas locais].
Entregavel esperado: [resultado concreto].
```

## Prompt curto de retomada (Codex Terminal/Cloud)

```txt
Antes de qualquer mudanca, leia:
- docs/querobroapp-context.md
- docs/HANDOFF_TEMPLATE.md
- docs/NEXT_STEP_PLAN.md

Depois continue a partir deste objetivo:
[descreva em 1 linha]
```

## Checklist de encerramento de sessao

- Atualizei este arquivo se houve mudanca de prioridade/decisao.
- Registrei handoff com contexto minimo (template padrao).
- Informei branch e arquivos alterados.
- Listei proximo passo objetivo para a proxima sessao.
