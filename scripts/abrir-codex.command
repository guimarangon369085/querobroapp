#!/bin/zsh
set -euo pipefail

REPO_DIR="$HOME/querobroapp"
CODEX_BIN="$HOME/.npm-global/bin/codex"
STATE_DIR="$HOME/.querobroapp"
FULL_ACCESS_MARKER="$STATE_DIR/.abrir-codex-full-disk-access-ok"
PROMPTS_DIR="$REPO_DIR/docs/prompts"

export PATH="$HOME/.npm-global/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

usage() {
  cat <<'EOF'
Uso: abrir-codex.command [quick|reboot|qa|ux]

Modos:
- quick  : bootstrap minimo padrao
- reboot : reboot, subida local e validacao manual
- qa     : alias de reboot
- ux     : foco em simplificacao de UX
EOF
}

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

MODE="${1:-quick}"

case "$MODE" in
  quick)
    PROMPT_FILE="$PROMPTS_DIR/codex-bootstrap-quick.txt"
    ;;
  reboot | qa)
    PROMPT_FILE="$PROMPTS_DIR/codex-bootstrap-reboot.txt"
    ;;
  ux)
    PROMPT_FILE="$PROMPTS_DIR/codex-bootstrap-ux.txt"
    ;;
  -h | --help | help)
    usage
    exit 0
    ;;
  *)
    echo "Modo invalido: $MODE"
    usage
    exit 1
    ;;
esac

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Template de bootstrap nao encontrado: $PROMPT_FILE"
  exit 1
fi

BOOTSTRAP_PROMPT="$(<"$PROMPT_FILE")"

exec "$CODEX_BIN" --cd "$REPO_DIR" "$BOOTSTRAP_PROMPT"
