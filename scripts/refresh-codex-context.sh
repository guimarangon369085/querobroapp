#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${CODEX_CONTEXT_REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
STATE_DIR="${CODEX_CONTEXT_STATE_DIR:-$HOME/.querobroapp}"
OUT_FILE="${CODEX_CONTEXT_OUT_FILE:-$STATE_DIR/codex-auto-session-snapshot.md}"

mkdir -p "$STATE_DIR"
cd "$REPO_DIR"

timestamp_now() {
  date '+%Y-%m-%d %H:%M:%S %Z'
}

file_timestamp() {
  local file="$1"
  if [[ ! -e "$file" ]]; then
    printf 'ausente'
    return
  fi
  date -r "$(stat -f %m "$file")" '+%Y-%m-%d %H:%M:%S %Z'
}

safe_first_line() {
  local value="$1"
  if [[ -z "$value" ]]; then
    printf 'indisponivel'
  else
    printf '%s' "$value"
  fi
}

process_label_for_pid() {
  local pid="$1"
  local cmd=""

  if [[ -z "$pid" ]]; then
    printf 'indisponivel'
    return
  fi

  cmd="$(ps -p "$pid" -o command= 2>/dev/null | head -n 1 | sed 's/^[[:space:]]*//')"
  cmd="$(printf '%s' "$cmd" | tr '\n' ' ' | cut -c1-120)"

  if [[ -z "$cmd" ]]; then
    printf 'pid %s' "$pid"
  else
    printf 'pid %s (%s)' "$pid" "$cmd"
  fi
}

branch="$(git branch --show-current 2>/dev/null || true)"
branch="$(safe_first_line "$branch")"
head_sha="$(git rev-parse --short HEAD 2>/dev/null || true)"
head_sha="$(safe_first_line "$head_sha")"

upstream="$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true)"
if [[ -n "$upstream" ]]; then
  read -r behind_count ahead_count < <(git rev-list --left-right --count "${upstream}...HEAD" 2>/dev/null || printf '0 0')
else
  upstream="sem upstream"
  behind_count="n/a"
  ahead_count="n/a"
fi

status_short_raw="$(git status --short --branch 2>/dev/null || true)"
status_porcelain="$(git status --porcelain 2>/dev/null || true)"

status_short="$(printf '%s\n' "$status_short_raw" | sed -n '1,40p')"
if [[ -z "$status_short" ]]; then
  status_short="(sem saida)"
fi

if [[ -n "$status_porcelain" ]]; then
  changed_count="$(printf '%s\n' "$status_porcelain" | wc -l | tr -d ' ')"
  untracked_count="$(printf '%s\n' "$status_porcelain" | awk 'substr($0,1,2)=="??"{c++} END{print c+0}')"
  changed_files="$(printf '%s\n' "$status_porcelain" | sed -n '1,20p')"
else
  changed_count="0"
  untracked_count="0"
  changed_files="nenhuma mudanca local relevante"
fi

recent_commits="$(git log --oneline -n 5 --no-decorate 2>/dev/null || true)"
if [[ -z "$recent_commits" ]]; then
  recent_commits="indisponivel"
fi

web_pid="$(lsof -tiTCP:3000 -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
api_pid="$(lsof -tiTCP:3001 -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
web_pid="$(safe_first_line "$web_pid")"
api_pid="$(safe_first_line "$api_pid")"
if [[ "$web_pid" == "indisponivel" ]]; then
  web_status="indisponivel"
else
  web_status="$(process_label_for_pid "$web_pid")"
fi
if [[ "$api_pid" == "indisponivel" ]]; then
  api_status="indisponivel"
else
  api_status="$(process_label_for_pid "$api_pid")"
fi

last_handoff_entry="$(awk '/^## Entrada /{entry=$0} END{print entry}' docs/HANDOFF_LOG.md 2>/dev/null || true)"
last_handoff_entry="$(safe_first_line "$last_handoff_entry")"
last_handoff_date="$(awk '/^- Data\/hora: /{line=$0} END{sub(/^- Data\/hora: /,"",line); print line}' docs/HANDOFF_LOG.md 2>/dev/null || true)"
last_handoff_date="$(safe_first_line "$last_handoff_date")"
if [[ "$last_handoff_date" == "indisponivel" ]]; then
  last_handoff_date="$(file_timestamp docs/HANDOFF_LOG.md)"
fi

cat > "$OUT_FILE" <<EOF
# AUTO_SESSION_SNAPSHOT

Gerado automaticamente por \`scripts/refresh-codex-context.sh\`.
Atualizado em: $(timestamp_now)

## Resumo Executivo

- Repo: \`$REPO_DIR\`
- Branch atual: \`$branch\`
- HEAD atual: \`$head_sha\`
- Upstream: \`$upstream\`
- Divergencia vs upstream: ahead \`$ahead_count\`, behind \`$behind_count\`
- Mudancas locais detectadas: \`$changed_count\`
- Arquivos nao rastreados: \`$untracked_count\`
- Web local em :3000: \`$web_status\`
- API local em :3001: \`$api_status\`

## Worktree Atual

\`\`\`txt
$status_short
\`\`\`

## Arquivos Locais Mais Relevantes

\`\`\`txt
$changed_files
\`\`\`

## Commits Mais Recentes

\`\`\`txt
$recent_commits
\`\`\`

## Handoff Mais Recente

- Ultima entrada: $last_handoff_entry
- Ultima data registrada: $last_handoff_date

## Arquivos E Entrypoints Canonicos

- Launcher do repo: \`scripts/abrir-codex.command\`
- Refresh factual: \`scripts/refresh-codex-context.sh\`
- Prompt quick: \`docs/prompts/codex-bootstrap-quick.txt\`
- Prompt reboot/qa: \`docs/prompts/codex-bootstrap-reboot.txt\`
- Prompt ux: \`docs/prompts/codex-bootstrap-ux.txt\`
- Snapshot factual atual: \`$OUT_FILE\`
- Estado vivo: \`docs/PROJECT_SNAPSHOT.md\`
- Plano atual: \`docs/NEXT_STEP_PLAN.md\`
- Handoff historico: \`docs/HANDOFF_LOG.md\`
- Contexto ampliado: \`docs/MEMORY_VAULT.md\` e \`docs/querobroapp-context.md\`
- Runbook/QA: \`README.md\` e \`docs/TEST_RESET_PROTOCOL.md\`

## Portas Observadas Agora

- Web local: \`http://127.0.0.1:3000\` -> \`$web_status\`
- API local: \`http://127.0.0.1:3001/health\` -> \`$api_status\`

## Comandos Rapidos

- Abrir sessao rapida: \`./scripts/abrir-codex.command\`
- Abrir sessao de reboot/qa: \`./scripts/abrir-codex.command reboot\`
- Subir ambiente: \`./scripts/dev-all.sh\`
- Parar ambiente: \`./scripts/stop-all.sh\`
- Smoke do web: \`pnpm qa:browser-smoke\`
- E2E critico: \`pnpm qa:critical-e2e\`

## Frescor Das Fontes De Verdade

- \`docs/PROJECT_SNAPSHOT.md\`: $(file_timestamp docs/PROJECT_SNAPSHOT.md)
- \`docs/NEXT_STEP_PLAN.md\`: $(file_timestamp docs/NEXT_STEP_PLAN.md)
- \`docs/HANDOFF_LOG.md\`: $(file_timestamp docs/HANDOFF_LOG.md)
- \`docs/MEMORY_VAULT.md\`: $(file_timestamp docs/MEMORY_VAULT.md)
- \`docs/querobroapp-context.md\`: $(file_timestamp docs/querobroapp-context.md)
- \`README.md\`: $(file_timestamp README.md)
- \`docs/TEST_RESET_PROTOCOL.md\`: $(file_timestamp docs/TEST_RESET_PROTOCOL.md)

## Como Usar Este Snapshot

- Trate este arquivo como fonte factual e deterministica do estado local agora.
- Use este snapshot para branch, worktree, commits recentes, servicos locais, arquivos canonicos, comandos rapidos e frescor dos docs.
- Para continuidade sem ruido, combine este snapshot com \`docs/NEXT_STEP_PLAN.md\` e apenas as ultimas 80 linhas de \`docs/HANDOFF_LOG.md\`.
- Leia \`docs/MEMORY_VAULT.md\`, \`docs/querobroapp-context.md\`, \`README.md\` ou \`docs/TEST_RESET_PROTOCOL.md\` somente se houver ambiguidade real ou se a tarefa exigir.
EOF

printf '%s\n' "$OUT_FILE"
