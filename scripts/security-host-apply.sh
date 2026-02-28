#!/usr/bin/env bash
set -euo pipefail

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo nao encontrado."
  exit 1
fi

if ! sudo -n true 2>/dev/null; then
  echo "Este hardening requer privilegio admin."
  echo "Execute primeiro: sudo -v"
  echo "Depois rode novamente: bash scripts/security-host-apply.sh"
  exit 1
fi

echo "Aplicando hardening local (macOS)..."

sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on >/dev/null
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on >/dev/null
sudo softwareupdate --schedule on >/dev/null || true
sudo systemsetup -setremotelogin off >/dev/null || true

echo "Hardening aplicado. Rodando auditoria..."
bash scripts/security-host-audit.sh
