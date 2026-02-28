# OPENAI_DEV_NEWS_2026-02-25_ACTION_REPORT

Data do email analisado: 2026-02-25 (OpenAI Dev News: Codex app, tips from OpenAI devs)

## Objetivo

Transformar todas as recomendacoes do email em acoes concretas no QUEROBROAPP, priorizando:

- ganho operacional imediato,
- robustez tecnica,
- aderencia a praticas atuais da plataforma OpenAI.

## Inventario completo de links do email (30)

### Links OpenAI/Developers/Cookbook (base principal)

1. https://openai.com/index/introducing-the-codex-app/
2. https://openai.com/codex/
3. https://openai.com/index/introducing-gpt-5-3-codex/
4. https://openai.com/index/introducing-gpt-5-3-codex-spark/
5. https://developers.openai.com/api/docs/guides/websocket-mode
6. https://developers.openai.com/api/docs/guides/tools-shell
7. https://developers.openai.com/api/docs/guides/tools-skills
8. https://developers.openai.com/api/docs/guides/compaction
9. https://developers.openai.com/api/docs/guides/realtime/
10. https://developers.openai.com/api/docs/guides/batch
11. https://developers.openai.com/api/docs/guides/image-generation
12. https://developers.openai.com/blog/skills-shell-tips
13. https://developers.openai.com/blog/eval-skills
14. https://developers.openai.com/blog/skyscanner-codex-jetbrains-mcp
15. https://cookbook.openai.com/examples/gpt-5/prompt_personalities
16. https://cookbook.openai.com/examples/agents_sdk/context_personalization
17. https://openai.com/index/harness-engineering/
18. https://openai.com/index/scaling-postgresql/
19. https://openai.com/index/unrolling-the-codex-agent-loop/
20. https://openai.com/policies/privacy-policy/

### Links comunidade e demos (referencia complementar)

21. http://discord.gg/openai
22. https://www.youtube.com/watch?v=xHnlzAPD9QI
23. https://www.youtube.com/watch?v=9ohXlkbXiM4
24. https://www.youtube.com/watch?v=tECAkJAI_Vk
25. https://www.youtube.com/watch?v=1XkVsE9-ZK4
26. https://x.com/agrimsingh/status/2022028612770443385
27. https://x.com/_lopopolo
28. https://x.com/BohanZhangOT
29. https://www.threads.com/@bolinfest/post/DT3cVLlkubK

### Link transacional do email

30. http://url3243.email.openai.com/asm/unsubscribe/...

## Recomendacoes do email e decisao tecnica

1. Codex app para multitarefa com agentes  
Decisao: aplicado como diretriz de engenharia do time (nao feature de produto).  
Status: adotado no fluxo de trabalho.

2. GPT-5.3-Codex em todas as superficies + Responses API  
Decisao: aplicacao direta no app via modernizacao do backend de IA para `Responses API` com fallback seguro.  
Status: implementado.

3. GPT-5.3-Codex-Spark para execucao mais rapida  
Decisao: expor override de modelo no Builder para permitir troca rapida de modelo sem deploy.  
Status: implementado (`receiptsModelOverride`).

4. WebSocket mode na Responses API (20-40% em runs tool-heavy)  
Decisao: aplicar no receipts como modo opcional para reduzir latencia e manter fallback seguro.  
Status: implementado (modo `responses_websocket` com fallback para HTTP e chat/completions).

5. OpenAI-hosted container + shell + skills + compaction para agentes longos  
Decisao: alta relevancia para automacoes de backoffice e operacoes futuras, baixa relevancia para OCR direto atual.  
Status: implementado em versao pragmatica no app (modulo `automations` com runs longos, skills, compaction e shell allowlist).

6. Realtime voice stack (gpt-realtime-1.5)  
Decisao: util para comando de voz operacional, mas fora do fluxo core atual de cupom/estoque.  
Status: implementado em API (`/voice/realtime/session` + `/voice/command`) com gatilho opcional de automations.

7. Batch API para imagem em lote com menor custo  
Decisao: inspirou endpoint de ingestao em lote no proprio app para operacao real com varios cupons.  
Status: implementado (`/receipts/ingest-batch`).

8. Automations (tarefas repetitivas)  
Decisao: traduzido para script de evals e pipeline de validacao de receipts.  
Status: implementado (`scripts/receipts-eval.mjs`).

9. Worktrees paralelos para desenvolvimento sem caos  
Decisao: pratica de engenharia adotada no fluxo do repo.  
Status: adotado como padrao de trabalho.

10. Prompt structure / prompt personalities  
Decisao: aplicado diretamente no Builder + runtime de OCR com perfis de comportamento.  
Status: implementado (`receiptsPromptPersonality`).

11. Context engineering (o que reter/descartar)  
Decisao: aplicado com campo dedicado de contexto operacional por ambiente.  
Status: implementado (`receiptsContextHints`).

12. Evals para validar melhora real vs mudanca superficial  
Decisao: aplicado com grader deterministico por cenario de cupom.  
Status: implementado (`pnpm eval:receipts`).

13. Prompt caching  
Decisao: habilitar cache de inferencia de OCR com TTL configuravel no Builder e telemetria de cache hit/miss.  
Status: implementado.

14. Case Skyscanner (MCP + contexto de IDE)  
Decisao: reforca estrategia de dar contexto rico ao agente e trilha de ferramentas.  
Status: adotado como referencia de arquitetura de dev.

15. Harness engineering (consistencia via padroes codificados no repo)  
Decisao: reforco de governanca por scripts/checks/docs no repositorio.  
Status: alinhado com praticas atuais do projeto.

16. Scaling PostgreSQL / simplicidade com disciplina  
Decisao: manter simplicidade operacional e evitar overengineering no backend.  
Status: alinhado com diretriz de arquitetura.

17. Unrolling the agent loop (compreender ciclo interno do agente)  
Decisao: usar como referencia para melhorias futuras de observabilidade de agentes.  
Status: planejado.

18. Links de videos e threads (YouTube/X/Threads)  
Decisao: usados como referencia complementar, sem dependencia funcional no produto.  
Status: analisados para inspiracao de fluxo, nao exigem alteracao direta de codigo.

## Implementacoes feitas neste ciclo

1. Migracao de OCR de cupom para Responses API com fallback resiliente  
Arquivo: `apps/api/src/modules/receipts/receipts.service.ts`  
Detalhes:
- novo modo `responses` como padrao,
- fallback opcional para `chat/completions`,
- extracao robusta de payload estruturado.

2. Novas configuracoes de prompt engineering no Builder  
Arquivos:
- `packages/shared/src/index.ts`
- `apps/web/src/app/builder/page.tsx`
- `apps/api/src/modules/receipts/receipts.service.ts`
Detalhes:
- `receiptsPromptPersonality`,
- `receiptsContextHints`,
- `receiptsModelOverride`.

3. Ingestao em lote de cupons  
Arquivos:
- `apps/api/src/modules/receipts/receipts.controller.ts`
- `apps/api/src/modules/receipts/receipts.service.ts`
Detalhes:
- endpoint `POST /receipts/ingest-batch`,
- processamento com resumo por item e opcao `continueOnError`.

4. Evals de receipts com grader deterministico  
Arquivos:
- `scripts/receipts-eval.mjs`
- `tests/fixtures/receipts-evals.json`
- `package.json`
Detalhes:
- valida schema, item oficial, quantidade/preco positivos,
- suporta regras por cenario (`minItems`, `requireItems`, `forbidItems`).

5. Configuracao de ambiente para novo modo de API  
Arquivo: `apps/api/.env.example`  
Detalhes:
- `OPENAI_RECEIPTS_API_MODE=responses`
- `OPENAI_RECEIPTS_FALLBACK_TO_CHAT_COMPLETIONS=true`

6. Modo WebSocket opcional para receipts  
Arquivo: `apps/api/src/modules/receipts/receipts.service.ts`  
Detalhes:
- `OPENAI_RECEIPTS_API_MODE=responses_websocket`,
- usa `wss://.../v1/responses`,
- fallback em cascata: websocket -> responses HTTP -> chat/completions.

7. Camada agentica long-running para automacoes de backoffice  
Arquivos:
- `apps/api/src/modules/automations/automations.controller.ts`
- `apps/api/src/modules/automations/automations.service.ts`
- `apps/api/src/modules/automations/automations.module.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/modules/production/production.module.ts`
- `apps/api/src/modules/receipts/receipts.module.ts`
Detalhes:
- endpoint de runs: `POST /automations/runs`, `POST /automations/runs/:id/start`, `GET /automations/runs`, `GET /automations/runs/:id`,
- skills prontas: `D1_PURCHASE_PLAN`, `SUPPLIER_PRICE_SYNC`, `RECEIPTS_BATCH_INGEST`, `RUNBOOK_SHELL`,
- compaction de eventos para runs longos,
- persistencia local de runs em `data/automations/runs.json`,
- shell skill desabilitada por padrao e protegida por token dedicado.

8. Prompt cache + compaction configuravel no OCR  
Arquivos:
- `apps/api/src/modules/receipts/receipts.service.ts`
- `packages/shared/src/index.ts`
- `apps/web/src/app/builder/page.tsx`
Detalhes:
- cache de inferencia por hash (modelo + prompt + imagem) com TTL configuravel,
- compaction de contexto operacional com limite de caracteres no Builder,
- telemetria de chamada IA em log estruturado (`event: receipts_ai_call`).

9. Variaveis de ambiente para automations shell  
Arquivo: `apps/api/.env.example`  
Detalhes:
- `AUTOMATIONS_RUNBOOK_SHELL_ENABLED=false`
- `AUTOMATIONS_RUNBOOK_SHELL_TOKEN=`

10. Voice ops com Realtime + parser de comando operacional  
Arquivos:
- `apps/api/src/modules/voice/voice.controller.ts`
- `apps/api/src/modules/voice/voice.service.ts`
- `apps/api/src/modules/voice/voice.module.ts`
- `apps/api/src/app.module.ts`
- `apps/api/.env.example`
Detalhes:
- `POST /voice/realtime/session` cria sessao Realtime com token efemero para cliente de voz,
- `POST /voice/command` interpreta transcricao em acao operacional estruturada,
- opcao `autoExecute` para disparar automations (`SUPPLIER_PRICE_SYNC`, `D1_PURCHASE_PLAN`, `RECEIPTS_BATCH_INGEST`),
- modelos configuraveis por ambiente:
  `OPENAI_VOICE_REALTIME_MODEL`, `OPENAI_VOICE_COMMAND_MODEL`, `OPENAI_VOICE_DEFAULT`.

## Proxima onda recomendada (apos este ciclo)

1. Dashboard web para acompanhar/acionar runs de automations e voice sem uso manual de API.
2. Observabilidade de agentes (metricas de run, SLA, custo e alertas de falha).
3. Playbooks de operacao (biblioteca de skills por rotina da equipe).
