#!/usr/bin/env bash
# evolution-run-day：测试补强阶段，在 worktree 内用 Gemini CLI 执行 AI_FIX_PROMPT（非交互）。
# 用法：EVOLUTION_TEST_AGENT_CMD='bash scripts/evolution-test-agent-gemini.sh'
set -euo pipefail
WT="${EVOLUTION_WORKTREE:-${EVOLUTION_WT_ROOT:-}}"
if [[ -z "${WT}" || ! -e "${WT}/.git" ]]; then
  echo "error: 需要有效的 EVOLUTION_WORKTREE" >&2
  exit 2
fi
cd "$WT"
if ! command -v gemini >/dev/null 2>&1; then
  echo "error: 未找到 gemini CLI。见 scripts/ai-cli/check-tools.sh" >&2
  exit 127
fi
PROMPT="${AI_FIX_PROMPT:?missing AI_FIX_PROMPT}"
exec gemini -p "$PROMPT" --yolo
