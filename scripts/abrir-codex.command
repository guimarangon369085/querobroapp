#!/bin/zsh
set -euo pipefail

REPO_DIR="$HOME/querobroapp"
CODEX_BIN="$HOME/.npm-global/bin/codex"
STATE_DIR="$HOME/.querobroapp"
FULL_ACCESS_MARKER="$STATE_DIR/.abrir-codex-full-disk-access-ok"

export PATH="$HOME/.npm-global/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

if [[ ! -x "$CODEX_BIN" ]]; then
  CODEX_BIN="$(command -v codex 2>/dev/null || true)"
fi

if [[ -z "$CODEX_BIN" || ! -x "$CODEX_BIN" ]]; then
  echo "Codex CLI nao encontrado."
  echo "Caminho esperado: $HOME/.npm-global/bin/codex"
  echo "Instale/ajuste o caminho e tente novamente."
  read -r "?Pressione Enter para fechar..."
  exit 1
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  mkdir -p "$STATE_DIR"
  if [[ ! -f "$FULL_ACCESS_MARKER" ]]; then
    echo "Preflight do Abrir Codex: conferindo Acesso Total ao Disco do Terminal."
    echo "Abrindo Ajustes > Privacidade > Acesso Total ao Disco."
    if command -v open >/dev/null 2>&1; then
      open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" >/dev/null 2>&1 || true
    fi
    : > "$FULL_ACCESS_MARKER"
  fi
fi

cd "$REPO_DIR"

BOOTSTRAP_PROMPT=$(cat <<'EOF'
Projeto: QUEROBROAPP.

Bootstrap minimo inicial:
1) Leia apenas:
- docs/PROJECT_SNAPSHOT.md
- docs/NEXT_STEP_PLAN.md
- as ultimas 80 linhas de docs/HANDOFF_LOG.md
2) Rode `git status --short --branch`.
3) Entregue:
- 3 bullets com o estado atual real,
- 3 riscos ativos,
- confirme se o plano atual ainda vale ou cite apenas desvios visiveis.
4) Nao faca perguntas iniciais.
5) So leia README.md e docs/TEST_RESET_PROTOCOL.md se a tarefa realmente envolver reboot, subida local, QA ou teste manual.

Diretriz operacional:
- Evite pedir comando manual para o usuario quando voce mesmo puder executar.
- Trate docs/HANDOFF_LOG.md como historico, nao como snapshot atual.
- Se precisar validar o web com o next dev aberto, prefira pnpm qa:browser-smoke e pnpm qa:critical-e2e.
- Nao rode next build manual de apps/web concorrente ao next dev sem necessidade; os scripts de QA ja usam dist dirs isolados para evitar corromper o .next do dev.
EOF
)

exec "$CODEX_BIN" --cd "$REPO_DIR" "$BOOTSTRAP_PROMPT"
