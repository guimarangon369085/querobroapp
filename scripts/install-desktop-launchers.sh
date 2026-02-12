#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_DIR="$HOME/Desktop"
SUPPORT_DIR="$DESKTOP_DIR/QUEROBROAPP Suporte"
START_COMMAND="$SUPPORT_DIR/@QUEROBROAPP.command"
STOP_COMMAND="$SUPPORT_DIR/Parar QUEROBROAPP.command"
HANDOFF_COMMAND="$SUPPORT_DIR/Salvar Handoff.command"
START_APP="$DESKTOP_DIR/@QUEROBROAPP.app"
STOP_APP="$DESKTOP_DIR/Parar QUEROBROAPP.app"
HANDOFF_APP="$DESKTOP_DIR/Salvar Handoff.app"
LEGACY_START_COMMAND="$DESKTOP_DIR/@QUEROBROAPP.command"
LEGACY_STOP_COMMAND="$DESKTOP_DIR/Parar QUEROBROAPP.command"
LEGACY_HANDOFF_COMMAND="$DESKTOP_DIR/Salvar Handoff.command"

mkdir -p "$DESKTOP_DIR"
mkdir -p "$SUPPORT_DIR"

cat > "$START_COMMAND" <<EOF
#!/bin/zsh
cd "$PROJECT_DIR"
./scripts/start-desktop-app.sh
EOF

cat > "$STOP_COMMAND" <<EOF
#!/bin/zsh
cd "$PROJECT_DIR"
./scripts/stop-desktop-app.sh
EOF

cat > "$HANDOFF_COMMAND" <<EOF
#!/bin/zsh
cd "$PROJECT_DIR"
./scripts/save-handoff-auto.sh
EOF

chmod +x "$START_COMMAND" "$STOP_COMMAND" "$HANDOFF_COMMAND"
chmod +x \
  "$PROJECT_DIR/scripts/start-desktop-app.sh" \
  "$PROJECT_DIR/scripts/stop-desktop-app.sh" \
  "$PROJECT_DIR/scripts/save-handoff-auto.sh"

if command -v osacompile >/dev/null 2>&1; then
  rm -rf "$START_APP" "$STOP_APP" "$HANDOFF_APP"

  osacompile -o "$START_APP" <<EOF
on run
  try
    do shell script "/bin/zsh -lc 'cd \"$PROJECT_DIR\" && ./scripts/start-desktop-app.sh'"
  on error errMsg number errNum
    display dialog "Falha ao iniciar QUEROBROAPP: " & errMsg buttons {"OK"} default button "OK"
  end try
end run
EOF

  osacompile -o "$STOP_APP" <<EOF
on run
  try
    do shell script "/bin/zsh -lc 'cd \"$PROJECT_DIR\" && ./scripts/stop-desktop-app.sh'"
  on error errMsg number errNum
    display dialog "Falha ao encerrar QUEROBROAPP: " & errMsg buttons {"OK"} default button "OK"
  end try
end run
EOF

  osacompile -o "$HANDOFF_APP" <<EOF
on run
  try
    do shell script "/bin/zsh -lc 'cd \"$PROJECT_DIR\" && ./scripts/save-handoff-auto.sh'"
  on error errMsg number errNum
    display dialog "Falha ao salvar handoff: " & errMsg buttons {"OK"} default button "OK"
  end try
end run
EOF
fi

if [ -f "$LEGACY_START_COMMAND" ] && [ "$LEGACY_START_COMMAND" != "$START_COMMAND" ]; then
  rm -f "$LEGACY_START_COMMAND"
fi
if [ -f "$LEGACY_STOP_COMMAND" ] && [ "$LEGACY_STOP_COMMAND" != "$STOP_COMMAND" ]; then
  rm -f "$LEGACY_STOP_COMMAND"
fi
if [ -f "$LEGACY_HANDOFF_COMMAND" ] && [ "$LEGACY_HANDOFF_COMMAND" != "$HANDOFF_COMMAND" ]; then
  rm -f "$LEGACY_HANDOFF_COMMAND"
fi

echo "Atalhos instalados no Desktop:"
echo " - $START_COMMAND"
echo " - $STOP_COMMAND"
echo " - $HANDOFF_COMMAND"
if [ -d "$START_APP" ]; then
  echo " - $START_APP"
fi
if [ -d "$STOP_APP" ]; then
  echo " - $STOP_APP"
fi
if [ -d "$HANDOFF_APP" ]; then
  echo " - $HANDOFF_APP"
fi
