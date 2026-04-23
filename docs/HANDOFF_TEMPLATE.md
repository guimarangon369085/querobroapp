# HANDOFF_TEMPLATE

Use este modelo no fim de cada sessao.

Regras:

- `docs/HANDOFF_LOG.md` e historico, nao snapshot atual.
- Se comportamento mudou, atualizar tambem `docs/querobroapp-context.md`, `docs/PROJECT_SNAPSHOT.md` e/ou `docs/NEXT_STEP_PLAN.md` no mesmo ciclo.
- Se mudou reboot, subida local, QA ou fluxo de teste, atualizar tambem `README.md` e `docs/TEST_RESET_PROTOCOL.md` no mesmo ciclo.
- Se mudou launcher, bootstrap, snapshot ou retomada de contexto, atualizar tambem `docs/BOOTSTRAP_PROMPTS.md`, `docs/prompts/*.txt` e/ou `docs/MEMORY_VAULT.md` no mesmo ciclo.
- Se mudou deploy publico, dominio, Google Forms, preview/intake externo ou validacao remota, atualizar tambem `docs/RAILWAY_DEPLOY.md` no mesmo ciclo.
- Registre apenas fatos verificados: nao inventar testes, comandos ou estados.
- Preferir `pnpm qa:trust` como validacao padrao antes de encerrar a sessao; se rodar um subset, justificar.
- Se mexer em fluxo operacional critico, considerar registrar tambem se rodou `qa:browser-smoke` e `qa:critical-e2e`.

## 1) Metadados

- Data/hora:
- Branch:
- Objetivo da sessao:

## 2) O que foi entregue

- Resultado principal:
- Arquivos alterados:
- Comandos de validacao executados:
- Testes que passaram:
- Testes nao executados (e motivo):

## 3) Estado tecnico

- O que esta estavel:
- Riscos ou pendencias abertas:
- Suposicoes feitas:
- Comandos atuais de reboot/teste (se houve mudanca):

## 4) Proximo passo

- Proxima acao objetiva (1 linha):
