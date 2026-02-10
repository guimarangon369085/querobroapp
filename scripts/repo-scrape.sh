#!/usr/bin/env bash
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 0

CACHE_ROOT="$ROOT/docs/.cache"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="$CACHE_ROOT/$STAMP"
mkdir -p "$RUN_DIR"

FAIL_LOG="$RUN_DIR/FAILURES.log"
SUMMARY_LOG="$RUN_DIR/SUMMARY.md"
: > "$FAIL_LOG"

failure_count=0

log_failure() {
  failure_count=$((failure_count + 1))
  echo "- $1" >> "$FAIL_LOG"
}

run_shell() {
  local name="$1"
  shift
  local cmd="$*"
  local out="$RUN_DIR/${name}.log"

  {
    echo "# name: $name"
    echo "# cmd: $cmd"
    echo "# at: $(date -u +%FT%TZ)"
    echo
    bash -lc "$cmd"
  } > "$out" 2>&1

  local rc=$?
  if [ $rc -ne 0 ]; then
    log_failure "$name (rc=$rc) :: $cmd"
  fi
}

run_with_fallback() {
  local primary_name="$1"
  local primary_cmd="$2"
  local fallback_name="$3"
  local fallback_cmd="$4"

  local out_primary="$RUN_DIR/${primary_name}.log"
  {
    echo "# name: $primary_name"
    echo "# cmd: $primary_cmd"
    echo "# at: $(date -u +%FT%TZ)"
    echo
    bash -lc "$primary_cmd"
  } > "$out_primary" 2>&1

  local rc=$?
  if [ $rc -eq 0 ]; then
    return 0
  fi

  echo "" >> "$out_primary"
  echo "# primary failed (rc=$rc), running fallback..." >> "$out_primary"

  local out_fallback="$RUN_DIR/${fallback_name}.log"
  {
    echo "# name: $fallback_name"
    echo "# cmd: $fallback_cmd"
    echo "# at: $(date -u +%FT%TZ)"
    echo
    bash -lc "$fallback_cmd"
  } > "$out_fallback" 2>&1

  local rc_fallback=$?
  if [ $rc_fallback -ne 0 ]; then
    log_failure "$primary_name failed (rc=$rc) and fallback $fallback_name failed (rc=$rc_fallback)"
  fi
}

# 1) Inventario base
run_shell "01-ls-la" "ls -la"
run_shell "02-find-manifests" "find . -maxdepth 4 -type f \( -name 'package.json' -o -name 'turbo.json' -o -name 'pnpm-workspace.yaml' -o -name 'docker-compose.yml' \)"
run_with_fallback "03-pnpm-list" "pnpm -r list --depth 1" "03b-pnpm-list-fallback" "pnpm -r -w list --depth 1"
run_shell "04-node-pnpm-versions" "node -v ; pnpm -v"
run_shell "05-git-log" "git log -n 20 --oneline --decorate"
run_shell "06-git-grep-todo" "git grep -nE 'TODO|FIXME|HACK|XXX' || true"
run_shell "07-git-grep-secret-refs" "git grep -nE 'JWT_PRIVATE_KEY|DATABASE_URL|VITE_|NEXT_PUBLIC_|SECRET|TOKEN' || true"

# 2) Scraping estrutural web
run_shell "10-web-route-files" "find apps/web/src/app -type f | sort"
run_shell "11-web-route-map" "find apps/web/src/app -type f -name 'page.tsx' | sort | sed -E 's#apps/web/src/app##; s#/page.tsx##' | awk 'NF { print } !NF { print \"/\" }'"
run_shell "12-web-core-components" "find apps/web/src/components -maxdepth 3 -type f | sort"
run_shell "13-web-lib" "find apps/web/src/lib -maxdepth 3 -type f | sort"
run_shell "14-web-api-usage" "rg -n 'apiFetch<|apiFetch\\(' apps/web/src"
run_shell "15-web-layout-nav-topbar" "sed -n '1,220p' apps/web/src/app/layout.tsx; echo; sed -n '1,220p' apps/web/src/components/nav.tsx; echo; sed -n '1,260p' apps/web/src/components/topbar.tsx"

# 3) Scraping estrutural API
run_shell "20-api-src-files" "find apps/api/src -maxdepth 5 -type f | sort"
run_shell "21-api-modules-files" "find apps/api/src/modules -maxdepth 3 -type f \( -name '*.controller.ts' -o -name '*.service.ts' -o -name '*.module.ts' \) | sort"
run_shell "22-api-route-decorators" "rg -n '@Controller\\(|@Get\\(|@Post\\(|@Put\\(|@Patch\\(|@Delete\\(' apps/api/src"
run_shell "23-api-validation-usage" "rg -n 'parseWithSchema|z\\.object|Zod|schema' apps/api/src"
run_shell "24-api-main-appmodule" "sed -n '1,260p' apps/api/src/main.ts; echo; sed -n '1,220p' apps/api/src/app.module.ts"

# 4) Prisma e dominio
run_shell "30-prisma-files" "find apps/api/prisma -maxdepth 4 -type f | sort"
run_shell "31-prisma-models" "rg -n '^model ' apps/api/prisma/schema.prisma apps/api/prisma/schema.prod.prisma"
run_shell "32-prisma-enums-prod" "rg -n '^enum ' apps/api/prisma/schema.prod.prisma"
run_shell "33-prisma-seed" "sed -n '1,320p' apps/api/prisma/seed.ts"
run_shell "34-prisma-migrations-lock" "cat apps/api/prisma/migrations/migration_lock.toml"

# 5) Checagens leves
run_shell "40-check-lint" "pnpm -r lint"
run_shell "41-check-test" "pnpm -r test"
run_shell "42-check-prisma-validate" "pnpm --filter @querobroapp/api exec prisma validate"
run_shell "43-check-prisma-generate-dev" "pnpm --filter @querobroapp/api prisma:generate:dev"

# 6) Validacao de docs obrigatorios
required_docs=(
  "docs/PROJECT_SNAPSHOT.md"
  "docs/REPO_SCRAPE_REPORT.md"
  "docs/DELIVERY_BACKLOG.md"
)

for doc in "${required_docs[@]}"; do
  if [ ! -f "$doc" ]; then
    log_failure "missing required doc: $doc"
  fi
done

# opcional
if [ ! -f "docs/ARCHITECTURE.md" ]; then
  echo "- optional doc missing: docs/ARCHITECTURE.md" >> "$FAIL_LOG"
fi

ln -sfn "$STAMP" "$CACHE_ROOT/latest" 2>/dev/null || true

{
  echo "# Repo Scrape Summary"
  echo
  echo "- generated_at_utc: $(date -u +%FT%TZ)"
  echo "- run_dir: docs/.cache/$STAMP"
  echo "- failures: $failure_count"
  echo
  if [ -s "$FAIL_LOG" ]; then
    echo "## Failure Log"
    cat "$FAIL_LOG"
  else
    echo "## Failure Log"
    echo "- none"
  fi
} > "$SUMMARY_LOG"

cat "$SUMMARY_LOG"

# Requisito: sair 0 mesmo com falhas
exit 0
