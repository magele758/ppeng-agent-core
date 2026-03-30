#!/usr/bin/env bash
# evolution-run-day：在 worktree 内把 .evolution 摘录与约束交给 Claude Code CLI。
# 用法：EVOLUTION_AGENT_CMD=bash scripts/evolution-agent-claude.sh
# 需本机已安装并登录 `claude`（见 docs/EXTERNAL_AI_CLI.md）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WT="${EVOLUTION_WORKTREE:-$PWD}"

if ! command -v claude >/dev/null 2>&1; then
  echo "error: 未找到 claude CLI。安装见 docs/EXTERNAL_AI_CLI.md" >&2
  exit 127
fi

EX="${EVOLUTION_SOURCE_EXCERPT_FILE:-}"
CO="${EVOLUTION_AGENT_CONSTRAINTS_FILE:-}"

PROMPT=$(
  printf '%s\n\n' "You are working inside a git worktree of a TypeScript/Node.js project at: $WT

Your task: read the source excerpt below and make MINIMAL, SAFE, targeted improvements to the repository code. Prefer:
- Adding or improving tests
- Small refactors that improve clarity or correctness
- Fixing edge cases suggested by the excerpt

Do NOT add unrelated features, do NOT change build configs, do NOT modify .env or secrets.
After making changes, run: npm run test:unit  to verify they pass.
Only modify source files inside packages/ or apps/. Commit nothing — the pipeline will commit for you."
  if [[ -n "${CO:-}" && -f "$CO" ]]; then printf '\n## Project Constraints\n%s\n' "$(cat "$CO")"; fi
  if [[ -n "${EX:-}" && -f "$EX" ]]; then printf '\n## Source Excerpt (inspiration)\n%s\n' "$(cat "$EX")"; fi
)

cd "$WT"
exec claude --dangerously-skip-permissions -p "$PROMPT"
