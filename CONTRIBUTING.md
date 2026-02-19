# Contribuindo no QUEROBROAPP

## Objetivo

Manter mudancas pequenas, claras e testaveis.

## Fluxo recomendado

1. Crie branch de trabalho (`feat/*`, `fix/*`, `chore/*`).
2. Faça mudancas focadas em um problema por vez.
3. Rode validacoes locais antes de abrir PR.
4. Atualize documentacao quando mudar comportamento.

## Validacoes minimas

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Se alterar schema Prisma:

```bash
pnpm check:prisma-drift
```

Se alterar auth, tokens, env ou pipeline:

```bash
pnpm security:secrets
pnpm security:policy:diff
```

## Checklist de PR

- Problema e solucao descritos com clareza.
- Arquivos alterados fazem sentido para o escopo.
- Validacoes relevantes executadas.
- Riscos e impactos declarados.

