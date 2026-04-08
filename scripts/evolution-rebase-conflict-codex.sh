#!/usr/bin/env bash
# evolution-run-day：在 worktree 根目录用 OpenAI Codex CLI 解决 rebase 冲突（非交互）。
# 由 Node 注入 AI_FIX_PROMPT、EVOLUTION_WORKTREE；需 PATH 有 codex。
set -euo pipefail
WT="${EVOLUTION_WORKTREE:-${EVOLUTION_WT_ROOT:-}}"
if [[ -z "${WT}" || ! -e "${WT}/.git" ]]; then
  echo "error: 需要有效的 EVOLUTION_WORKTREE（git worktree 根目录）" >&2
  exit 2
fi
cd "$WT"
if ! command -v codex >/dev/null 2>&1; then
  echo "error: 未找到 codex。安装见 doc/EXTERNAL_AI_CLI.md" >&2
  exit 127
fi
PROMPT="${AI_FIX_PROMPT:?missing AI_FIX_PROMPT}"
if [[ "${AI_CODEX_FULL_AUTO:-}" == "1" ]]; then
  exec codex exec --dangerously-bypass-approvals-and-sandbox "$PROMPT"
else
  exec codex exec --full-auto "$PROMPT"
fi
