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

Your task: read the source excerpt below and implement a REAL, MEANINGFUL improvement to the repository
based on what you learn from the excerpt. This must be a functional code change — new capability,
improved behavior, better error handling, or a fixed edge case — in source files under packages/ or apps/.

Rules:
- You MUST modify at least one non-test source file under packages/ or apps/ (e.g. a .ts or .mjs file
  that is NOT *.test.* and NOT inside a test/ or __tests__/ directory).
- You MAY add tests as a companion to the feature change, but tests alone are NOT sufficient.
- Do NOT add unrelated features, do NOT change build configs, do NOT modify .env or secrets.
- The change must be small enough to be safe: prefer adding a useful helper, improving an existing
  function's robustness, or implementing a clearly useful missing feature suggested by the excerpt.
- After making changes, run: npm run test:unit to verify they pass.
- Only commit nothing — the pipeline will commit for you.

If you cannot find a meaningful, safe feature improvement inspired by the excerpt, output a single line:
SKIP: <reason>
and exit 0 without modifying any files."
  if [[ -n "${CO:-}" && -f "$CO" ]]; then printf '\n## Project Constraints\n%s\n' "$(cat "$CO")"; fi
  if [[ -n "${EX:-}" && -f "$EX" ]]; then printf '\n## Source Excerpt (inspiration)\n%s\n' "$(cat "$EX")"; fi
)

cd "$WT"
exec claude --dangerously-skip-permissions -p "$PROMPT"
