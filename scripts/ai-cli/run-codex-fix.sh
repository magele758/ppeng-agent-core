#!/usr/bin/env bash
# 使用 OpenAI Codex CLI（需已安装并登录 `codex`）。非交互：codex exec
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

if ! command -v codex >/dev/null 2>&1; then
  echo "error: 未找到 codex。安装见 docs/EXTERNAL_AI_CLI.md" >&2
  exit 127
fi

PROMPT_FILE="${AI_FIX_PROMPT_FILE:-$SCRIPT_DIR/prompts/fix-ci-default.txt}"
if [[ -n "${AI_FIX_PROMPT:-}" ]]; then
  PROMPT="$AI_FIX_PROMPT"
else
  PROMPT="$(cat "$PROMPT_FILE")"
fi

echo "repo: $ROOT"

CODEX_ARGS=(exec --sandbox workspace-write)
if [[ "${AI_CODEX_FULL_AUTO:-}" == 1 ]]; then
  CODEX_ARGS=(exec --full-auto)
  echo "warning: AI_CODEX_FULL_AUTO=1（自动批准写文件与命令，仅在你信任的仓库中使用）" >&2
fi

exec codex "${CODEX_ARGS[@]}" "$@" "$PROMPT"
