#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_DIR="$HOME/Desktop"
SUPPORT_DIR="$DESKTOP_DIR/QUEROBROAPP Suporte"
CODEX_COMMAND="$DESKTOP_DIR/Abrir Codex.command"
START_APP="$DESKTOP_DIR/@QUEROBROAPP.app"
STOP_APP="$DESKTOP_DIR/Parar QUEROBROAPP.app"
HANDOFF_APP="$DESKTOP_DIR/Salvar Handoff.app"
LEGACY_START_COMMAND="$DESKTOP_DIR/@QUEROBROAPP.command"
LEGACY_STOP_COMMAND="$DESKTOP_DIR/Parar QUEROBROAPP.command"
LEGACY_HANDOFF_COMMAND="$DESKTOP_DIR/Salvar Handoff.command"
REPO_LAUNCHER="$PROJECT_DIR/scripts/abrir-codex.command"

mkdir -p "$DESKTOP_DIR"

rm -rf "$START_APP" "$STOP_APP" "$HANDOFF_APP" "$SUPPORT_DIR"
rm -f "$LEGACY_START_COMMAND" "$LEGACY_STOP_COMMAND" "$LEGACY_HANDOFF_COMMAND"

cat > "$CODEX_COMMAND" <<EOF
#!/bin/zsh
set -euo pipefail

REPO_LAUNCHER="$REPO_LAUNCHER"

if [[ ! -f "\$REPO_LAUNCHER" ]]; then
  echo "Launcher versionado nao encontrado: \$REPO_LAUNCHER"
  read -r "?Pressione Enter para fechar..."
  exit 1
fi

exec /bin/zsh "\$REPO_LAUNCHER" "\$@"
EOF

chmod +x "$CODEX_COMMAND"

echo "Atalhos legados do QUEROBROAPP removidos do Desktop."
echo "Atalho '$CODEX_COMMAND' atualizado."
echo "Os comandos operacionais continuam no repo em '$PROJECT_DIR/scripts/'."
