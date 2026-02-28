#!/usr/bin/env bash

ensure_runtime_path_entry() {
  local entry="$1"

  if [ ! -d "$entry" ]; then
    return 0
  fi

  case ":${PATH:-}:" in
    *":$entry:"*) ;;
    *)
      if [ -n "${PATH:-}" ]; then
        PATH="$entry:$PATH"
      else
        PATH="$entry"
      fi
      ;;
  esac
}

setup_runtime_path() {
  local entry

  for entry in \
    "$HOME/.npm-global/bin" \
    "$HOME/Library/pnpm" \
    "/usr/local/bin" \
    "/opt/homebrew/bin" \
    "/usr/bin" \
    "/bin" \
    "/usr/sbin" \
    "/sbin"
  do
    ensure_runtime_path_entry "$entry"
  done

  export PATH
}

resolve_pnpm_bin() {
  setup_runtime_path
  command -v pnpm 2>/dev/null || return 1
}
