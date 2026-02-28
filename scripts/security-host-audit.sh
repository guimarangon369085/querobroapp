#!/usr/bin/env bash
set -euo pipefail

pass_count=0
warn_count=0
fail_count=0

pass() {
  echo "[PASS] $1"
  pass_count=$((pass_count + 1))
}

warn() {
  echo "[WARN] $1"
  warn_count=$((warn_count + 1))
}

fail() {
  echo "[FAIL] $1"
  fail_count=$((fail_count + 1))
}

matches_ci() {
  local content="$1"
  local pattern="$2"
  printf '%s\n' "$content" | grep -Eiq "$pattern"
}

echo "=== macOS Security Audit ==="
echo "Host: $(scutil --get ComputerName 2>/dev/null || hostname)"
echo "Date: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo

filevault_status="$(fdesetup status 2>/dev/null || true)"
if matches_ci "$filevault_status" "on"; then
  pass "FileVault ativo"
else
  fail "FileVault inativo"
fi

fw_state="$(/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null || true)"
if matches_ci "$fw_state" "enabled"; then
  pass "Firewall ativo"
else
  fail "Firewall inativo"
fi

fw_stealth="$(/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode 2>/dev/null || true)"
if matches_ci "$fw_stealth" "enabled"; then
  pass "Stealth mode ativo"
else
  fail "Stealth mode inativo"
fi

gatekeeper="$(spctl --status 2>/dev/null || true)"
if matches_ci "$gatekeeper" "assessments enabled"; then
  pass "Gatekeeper ativo"
else
  fail "Gatekeeper inativo"
fi

updates_status="$(softwareupdate --schedule 2>/dev/null || true)"
if matches_ci "$updates_status" "on|turned on"; then
  pass "Atualizacao automatica ativa"
else
  warn "Atualizacao automatica nao confirmada"
fi

remote_login="$(systemsetup -getremotelogin 2>/dev/null || true)"
if matches_ci "$remote_login" "off"; then
  pass "Remote Login (SSH) desativado"
elif matches_ci "$remote_login" "on"; then
  warn "Remote Login (SSH) ativo"
else
  warn "Nao foi possivel validar Remote Login sem privilegio admin"
fi

echo
echo "=== Summary ==="
echo "PASS: $pass_count"
echo "WARN: $warn_count"
echo "FAIL: $fail_count"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
