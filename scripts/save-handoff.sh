#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${HANDOFF_REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
LOG_FILE="${HANDOFF_LOG_FILE:-$REPO_DIR/docs/HANDOFF_LOG.md}"

if [[ ! -f "$LOG_FILE" ]]; then
  echo "Arquivo nao encontrado: $LOG_FILE"
  exit 1
fi

cd "$REPO_DIR"

prompt_default() {
  local __var="$1"
  local __label="$2"
  local __default="$3"
  local __value=""

  if [[ -t 0 ]]; then
    read -r "__value?$__label [$__default]: "
    if [[ -z "$__value" ]]; then
      __value="$__default"
    fi
  else
    __value="$__default"
  fi

  printf -v "$__var" '%s' "$__value"
}

prompt_required() {
  local __var="$1"
  local __label="$2"
  local __seed="${3:-}"
  local __value="$__seed"

  if [[ -t 0 ]]; then
    read -r "__value?$__label: "
    if [[ -z "${__value:-}" ]]; then
      __value="$__seed"
    fi
  fi

  if [[ -z "${__value:-}" ]]; then
    __value="nao informado"
  fi

  printf -v "$__var" '%s' "$__value"
}

get_next_entry() {
  local last
  local entries

  if command -v rg >/dev/null 2>&1; then
    entries=$(rg -N "^## Entrada [0-9]{3}$" "$LOG_FILE" 2>/dev/null || true)
  else
    entries=$(grep -E "^## Entrada [0-9]{3}$" "$LOG_FILE" 2>/dev/null || true)
  fi

  last=$(printf '%s\n' "$entries" | awk '{print $3}' | sort -n | tail -n 1 || true)
  if [[ -z "${last:-}" ]]; then
    printf '001'
  else
    printf '%03d' "$((10#$last + 1))"
  fi
}

collect_changed_files() {
  local lines
  lines=$(git status --short)
  if [[ -z "$lines" ]]; then
    echo "- nenhum arquivo alterado no momento"
    return
  fi

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    echo "- \`$line\`"
  done <<< "$lines"
}

ENTRY_ID=$(get_next_entry)
NOW=$(date '+%Y-%m-%d %H:%M %Z')
BRANCH=$(git branch --show-current 2>/dev/null || echo "desconhecida")
COMMIT_BASE=$(git rev-parse --short HEAD 2>/dev/null || echo "n/a")

DEFAULT_ORIGEM="${HANDOFF_ORIGEM:-Codex Terminal}"
DEFAULT_DESTINO="${HANDOFF_DESTINO:-ChatGPT Online/Mobile e Codex Terminal/Cloud}"

prompt_default ORIGEM "Canal origem" "$DEFAULT_ORIGEM"
prompt_default DESTINO "Canal destino" "$DEFAULT_DESTINO"
prompt_required OBJETIVO "Objetivo da sessao encerrada" "${HANDOFF_OBJETIVO:-}"
prompt_required RESULTADO "Resultado entregue" "${HANDOFF_RESULTADO:-}"
prompt_required PENDENTE "O que ficou pendente" "${HANDOFF_PENDENTE:-}"
prompt_required DECISOES "Decisoes importantes" "${HANDOFF_DECISOES:-}"
prompt_required BLOQUEIOS "Bloqueios" "${HANDOFF_BLOQUEIOS:-}"
prompt_required PROXIMO_PASSO "Proximo passo recomendado (1 acao objetiva)" "${HANDOFF_PROXIMO_PASSO:-}"
prompt_required COMPORTAMENTO "Comportamento novo" "${HANDOFF_COMPORTAMENTO:-sem alteracao funcional registrada}"
prompt_required RISCOS "Riscos/regressoes" "${HANDOFF_RISCOS:-baixo risco}"
prompt_required COMANDOS "Comandos executados" "${HANDOFF_COMANDOS:-scripts/save-handoff.sh}"
prompt_required TESTES_OK "Testes que passaram" "${HANDOFF_TESTES_OK:-nao aplicavel}"
prompt_required TESTES_NAO_EXEC "Testes nao executados (e motivo)" "${HANDOFF_TESTES_NAO_EXEC:-nao aplicavel}"
prompt_required SUPOSICOES "Suposicoes feitas" "${HANDOFF_SUPOSICOES:-nao informado}"

CHANGED_FILES=$(collect_changed_files)

cat >> "$LOG_FILE" <<EOF

## Entrada $ENTRY_ID

### 1) Metadados

- Data/hora: $NOW
- Canal origem: $ORIGEM
- Canal destino: $DESTINO
- Repo path: \`$REPO_DIR\`
- Branch: \`$BRANCH\`
- Commit base (opcional): \`$COMMIT_BASE\`

### 2) Objetivo da sessao encerrada

- Objetivo: $OBJETIVO
- Resultado entregue: $RESULTADO
- O que ficou pendente: $PENDENTE

### 3) Mudancas tecnicas

- Arquivos alterados:
$CHANGED_FILES
- Comportamento novo: $COMPORTAMENTO
- Riscos/regressoes: $RISCOS

### 4) Validacao

- Comandos executados: $COMANDOS
- Testes que passaram: $TESTES_OK
- Testes nao executados (e motivo): $TESTES_NAO_EXEC

### 5) Contexto para retomada

- Decisoes importantes: $DECISOES
- Suposicoes feitas: $SUPOSICOES
- Bloqueios: $BLOQUEIOS
- Proximo passo recomendado (1 acao objetiva): $PROXIMO_PASSO

### 6) Prompt pronto para proximo canal

\`\`\`txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
\`\`\`
EOF

echo "Handoff salvo com sucesso em: $LOG_FILE"
echo "Entrada criada: $ENTRY_ID"
