#!/usr/bin/env bash
# evolution-run-day：在 worktree 内把 .evolution 摘录与约束交给 Claude Code CLI（npm run ai:claude）。
# 需本机已安装并登录 `claude`（见 docs/EXTERNAL_AI_CLI.md）。
set -euo pipefail
EX="${EVOLUTION_SOURCE_EXCERPT_FILE:-}"
CO="${EVOLUTION_AGENT_CONSTRAINTS_FILE:-}"
PROMPT=$(
  printf '%s\n\n' "Based on the following constraints and source excerpt, make minimal, safe improvements to this repository. Prefer tests and small refactors; do not add unrelated features."
  if [[ -n "${CO:-}" && -f "$CO" ]]; then printf '## Constraints\n%s\n\n' "$(cat "$CO")"; fi
  if [[ -n "${EX:-}" && -f "$EX" ]]; then printf '## Source excerpt\n%s\n' "$(cat "$EX")"; fi
)
export AI_FIX_PROMPT="$PROMPT"
exec npm run ai:claude
