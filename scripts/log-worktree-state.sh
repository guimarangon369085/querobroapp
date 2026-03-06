#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd -P)"
log_dir="$repo_root/docs/historical-deposits"
log_file="$log_dir/record.md"
mkdir -p "$log_dir"

timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
branch="$(git -C "$repo_root" symbolic-ref --short HEAD 2>/dev/null || git -C "$repo_root" describe --all)"
status="$(
  git -C "$repo_root" status --short --branch
)"
diff_stat="$(git -C "$repo_root" diff --stat || true)"
last_commit="$(git -C "$repo_root" log -1 --oneline --decorate)"
note="${1:-auto snapshot}"

cat <<EOF >>"$log_file"
## $timestamp
- branch: $branch
- note: $note
- status:
\`\`\`
$status
\`\`\`
- last commit:
\`\`\`
$last_commit
\`\`\`
- diff stat:
\`\`\`
$diff_stat
\`\`\`
EOF

printf 'Logged worktree state to %s\n' "$log_file"
