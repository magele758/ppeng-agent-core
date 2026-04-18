#!/usr/bin/env bash
# evolution-run-day：实现/精炼阶段 — cursor-agent CLI（默认 composer-2-fast）。
# 用法：EVOLUTION_AGENT_CMD=bash scripts/evolution-agent-cursor.sh
#       EVOLUTION_REFINE_CMD=bash scripts/evolution-agent-cursor.sh
#
# 行为：
#   - 若 run-day 注入了 AI_FIX_PROMPT（rebase/merge 冲突修复 或 review 精炼），直接执行该提示词。
#   - 否则按 EVOLUTION_SOURCE_EXCERPT_FILE/EVOLUTION_AGENT_CONSTRAINTS_FILE/EVOLUTION_PLAN_FILE
#     拼装实现阶段的 prompt（与 evolution-agent-claude.sh 同语义），交给 cursor-agent。
#
# 环境变量：
#   EVOLUTION_CURSOR_AGENT_MODEL — 默认 composer-2-fast
#   EVOLUTION_CLI_SKIP_UPDATE=1  — 跳过更新检测
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WT="${EVOLUTION_WORKTREE:-$PWD}"
CURSOR_MODEL="${EVOLUTION_CURSOR_AGENT_MODEL:-composer-2-fast}"

if ! command -v agent >/dev/null 2>&1; then
  echo "error: 未找到 cursor-agent CLI（命令名 \`agent\`）。安装见 doc/EXTERNAL_AI_CLI.md" >&2
  exit 127
fi

if [[ "${EVOLUTION_CLI_SKIP_UPDATE:-0}" != "1" ]] && [[ -f "$SCRIPT_DIR/cli-update-check.sh" ]]; then
  source "$SCRIPT_DIR/cli-update-check.sh"
  check_cli_update "cursor" || true
fi

cd "$WT"

# run-day 在解决冲突 / refine 阶段注入 AI_FIX_PROMPT，优先级最高
if [[ -n "${AI_FIX_PROMPT:-}" ]]; then
  exec agent --print --yolo --model "$CURSOR_MODEL" "$AI_FIX_PROMPT"
fi

EX="${EVOLUTION_SOURCE_EXCERPT_FILE:-}"
CO="${EVOLUTION_AGENT_CONSTRAINTS_FILE:-}"
PL="${EVOLUTION_PLAN_FILE:-}"

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
- Do NOT commit — the pipeline will commit for you.

If you cannot find a meaningful, safe feature improvement inspired by the excerpt, output a single line:
SKIP: <reason>
and exit 0 without modifying any files."
  if [[ -n "${CO:-}" && -f "$CO" ]]; then printf '\n## Project Constraints\n%s\n' "$(cat "$CO")"; fi
  if [[ -n "${EX:-}" && -f "$EX" ]]; then printf '\n## Source Excerpt (inspiration)\n%s\n' "$(cat "$EX")"; fi
  if [[ -n "${PL:-}" && -f "$PL" ]]; then printf '\n## Development plan (follow this)\n%s\n' "$(cat "$PL")"; fi
)

exec agent --print --yolo --model "$CURSOR_MODEL" "$PROMPT"
