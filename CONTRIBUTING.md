# Contribuindo com o Quero Bro App

Obrigado por considerar contribuir com o projeto 🎉

## Como abrir uma issue

1. Verifique se já existe uma issue parecida aberta.
2. Abra uma nova issue com título claro e objetivo.
3. Descreva o problema/comportamento esperado.
4. Inclua contexto técnico útil:
   - ambiente (Node/pnpm/SO),
   - passos para reproduzir,
   - logs/prints quando aplicável.

## Como contribuir com funcionalidades ou correções

1. Faça um fork e crie uma branch descritiva:
   - `feat/nome-curto-da-feature`
   - `fix/nome-curto-do-bug`
2. Instale dependências:

```bash
pnpm install
```

3. Rode validações locais antes de enviar:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

4. Abra um Pull Request com:
   - contexto da mudança,
   - motivação,
   - impacto esperado,
   - evidências de teste.

## Boas práticas

- Prefira mudanças pequenas e focadas.
- Mantenha consistência de estilo e nomes.
- Atualize documentação quando alterar comportamento.
