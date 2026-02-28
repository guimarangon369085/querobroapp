# Security Best Practices Report

Data: 2026-02-25
Escopo: `apps/api`, `apps/web`, dependencias do workspace e fluxo operacional (navegacao/interacoes)

## Executive Summary

A auditoria encontrou riscos relevantes em 3 frentes: (1) exposicao de superficie operacional sensivel, (2) risco de SSRF no modulo de recomendacao de fornecedores, e (3) CVEs em dependencias. Os pontos de codigo de maior impacto foram corrigidos nesta rodada e validados por typecheck/lint/build/test/smoke. Permanecem CVEs altas/criticas restritas a cadeia do app mobile (Expo/React Native CLI), sem impacto direto no fluxo web+api em producao, mas que exigem plano de upgrade dedicado.

## Findings

### Critical

#### SEC-001 (OPEN) - CVE critica em cadeia transiente do mobile (`fast-xml-parser`)
- Severity: Critical
- Location: [apps/mobile/package.json](/Users/gui/querobroapp/apps/mobile/package.json:14)
- Evidence: `expo@^51.0.0` e `react-native@^0.74.1` puxam `@react-native-community/cli*` com `fast-xml-parser@4.5.3` (audit: GHSA-m7jm-9gc2-mpf2 / GHSA-jmr7-xgp7-cmfj).
- Impact: ferramenta mobile/CLI vulneravel a bypass/DoS de parser XML em cenarios de processamento de XML malicioso.
- Fix: atualizar stack Expo/RN para linha que resolva `fast-xml-parser >= 5.3.6`.
- Mitigation: manter deploy de producao segregado (web+api), sem dependencias mobile no runtime de producao.

### High

#### SEC-002 (OPEN) - CVEs altas em `tar` na cadeia Expo CLI (mobile)
- Severity: High
- Location: [apps/mobile/package.json](/Users/gui/querobroapp/apps/mobile/package.json:14)
- Evidence: audit ainda reporta `tar@6.2.1` (GHSA-r6q2-hw4h-h46w, GHSA-34x7-hfp2-rc4v, GHSA-8qq5-rm4j-mr97, GHSA-83g3-92jg-28cx).
- Impact: risco de path traversal/hardlink/symlink poisoning durante extracao de tar em fluxos CLI.
- Fix: upgrade de Expo CLI/deps para cadeia com `tar >= 7.5.8`.
- Mitigation: nao usar pipeline mobile em hosts sensiveis ate upgrade.

#### SEC-003 (FIXED) - Endpoints de automacao sem hardening dedicado de acesso
- Severity: High
- Location: [automations.controller.ts](/Users/gui/querobroapp/apps/api/src/modules/automations/automations.controller.ts:7), [automations.service.ts](/Users/gui/querobroapp/apps/api/src/modules/automations/automations.service.ts:157), [voice.controller.ts](/Users/gui/querobroapp/apps/api/src/modules/voice/voice.controller.ts:7), [voice.service.ts](/Users/gui/querobroapp/apps/api/src/modules/voice/voice.service.ts:56)
- Evidence: adicionados `@Roles('admin','operator')` e validacao de token dedicado (`x-automations-token`/`x-voice-token`) com fallback controlado.
- Impact: reduz abuso de endpoints de alto custo/alto impacto operacional quando auth global estiver permissiva em ambiente de desenvolvimento.
- Fix aplicado: validacao explicita de token para `/automations` e `/voice`.

#### SEC-004 (FIXED) - Risco de SSRF em scraping de precos online
- Severity: High
- Location: [receipts.service.ts](/Users/gui/querobroapp/apps/api/src/modules/receipts/receipts.service.ts:1092), [receipts.service.ts](/Users/gui/querobroapp/apps/api/src/modules/receipts/receipts.service.ts:1301)
- Evidence: introduzidos filtros de protocolo/host/IP privado + controle manual de redirects.
- Impact: evita chamadas para hosts internos/loopback/link-local e redirects maliciosos durante busca de fornecedores.
- Fix aplicado: `normalizeExternalHttpUrl`, `isUnsafeExternalHostname`, validação de redirect chain.

### Medium

#### SEC-005 (FIXED) - Hardening de remocao de arquivo no Builder
- Severity: Medium
- Location: [builder.service.ts](/Users/gui/querobroapp/apps/api/src/modules/builder/builder.service.ts:54), [builder.service.ts](/Users/gui/querobroapp/apps/api/src/modules/builder/builder.service.ts:170)
- Evidence: validacao de nome gerenciado (`img_<id>.<ext>`) e checagem de `path.relative` antes de `unlink`.
- Impact: reduz risco de path traversal caso `src` de configuracao seja adulterado.
- Fix aplicado: whitelist de filename + boundary check de diretório.

#### SEC-006 (FIXED) - URL externa sem saneamento defensivo no frontend
- Severity: Medium
- Location: [estoque/page.tsx](/Users/gui/querobroapp/apps/web/src/app/estoque/page.tsx:95), [estoque/page.tsx](/Users/gui/querobroapp/apps/web/src/app/estoque/page.tsx:1053)
- Evidence: link de oferta agora passa por `sanitizeExternalHttpUrl`.
- Impact: previne rendering de esquemas nao-http(s) caso payload externo seja comprometido.
- Fix aplicado: sanitizacao de URL antes de renderizar `href`.

#### SEC-007 (FIXED) - OPENAI_BASE_URL sem validacao de transporte
- Severity: Medium
- Location: [receipts.service.ts](/Users/gui/querobroapp/apps/api/src/modules/receipts/receipts.service.ts:2191), [voice.service.ts](/Users/gui/querobroapp/apps/api/src/modules/voice/voice.service.ts:327)
- Evidence: agora exige `http(s)` e bloqueia `http://` para host nao-local.
- Impact: reduz risco de envio de credencial para endpoint inseguro/mal configurado.
- Fix aplicado: `resolveOpenAiBaseUrl()` com validacao estrita.

### Low

#### SEC-008 (OBSERVATION) - Auth global desativada por default em desenvolvimento
- Severity: Low
- Location: [security-config.ts](/Users/gui/querobroapp/apps/api/src/security/security-config.ts:24)
- Evidence: `APP_AUTH_ENABLED` cai para `false` em dev quando nao definido.
- Impact: ambiente local exposto em rede sem cuidado pode aceitar chamadas nao autenticadas.
- Mitigation: usar `.env` local com `APP_AUTH_ENABLED=true` e token configurado em ambientes compartilhados.

## Jornada e Interacao (UX/Operacao)

- Auditoria Playwright navegou `/, /clientes, /produtos, /pedidos, /estoque, /dashboard, /builder` sem erros de console/rede 4xx/5xx apos ajustes.
- Otimizacao aplicada para simplificacao da jornada operacional:
  - modo padrao agora `operation` nas telas de operacao (menos carga cognitiva inicial): [use-surface-mode.ts](/Users/gui/querobroapp/apps/web/src/hooks/use-surface-mode.ts:23)
  - Builder preservado com default `full`: [builder/page.tsx](/Users/gui/querobroapp/apps/web/src/app/builder/page.tsx:120)

## Dependencias - Resultado objetivo

- Melhorias aplicadas:
  - upgrade Next para linha corrigida: [apps/web/package.json](/Users/gui/querobroapp/apps/web/package.json:17)
  - overrides de transientes backend/workspace: [package.json](/Users/gui/querobroapp/package.json:40)
- Estado atual do `pnpm audit --prod`:
  - 6 vulnerabilidades restantes (5 high, 1 critical), todas na cadeia `apps/mobile`.

## Validacao executada

- `pnpm security:secrets` -> OK
- `pnpm audit --prod` -> melhorado; pendencias apenas mobile
- `pnpm --filter @querobroapp/shared build`
- `pnpm --filter @querobroapp/api typecheck && lint && build`
- `pnpm --filter @querobroapp/web lint && build && typecheck`
- `pnpm qa:smoke`
- `pnpm test`
- `OPENAI_RECEIPTS_API_MODE=responses_websocket pnpm eval:receipts` -> 3/3 OK
