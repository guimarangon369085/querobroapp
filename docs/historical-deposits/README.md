# Historical Deposits

This folder keeps a hardened chronological ledger of the worktree so no stray dirty state gets lost.

## `scripts/log-worktree-state.sh`

- Captures the current branch, working tree status, latest commit, and diff summary.
- Appends a markdown entry to `record.md`.
- Accepts an optional note (e.g. `./scripts/log-worktree-state.sh "typecheck + smoke done"`).
- Run before switching context, rebasing, or starting a new UX sprint.

## `record.md`

- Treat it as the “hard log”: every entry is time stamped, identifies what was happening, and links back to the latest commit.
- Keep it near the top of PR descriptions so reviewers see the context of dirty files.
