#!/usr/bin/env bash
# 使用 Cursor Agent CLI（安装后命令一般为 `agent`，与编辑器自带的 `cursor` 不同）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

if ! command -v agent >/dev/null 2>&1; then
  echo "error: 未找到 agent。安装见 doc/EXTERNAL_AI_CLI.md" >&2
  exit 127
fi

PROMPT_FILE="${AI_FIX_PROMPT_FILE:-$SCRIPT_DIR/prompts/fix-ci-default.txt}"
if [[ -n "${AI_FIX_PROMPT:-}" ]]; then
  PROMPT="$AI_FIX_PROMPT"
else
  PROMPT="$(cat "$PROMPT_FILE")"
fi

echo "repo: $ROOT"
# 常见为 --print 或 -p，若报错请执行 agent --help 后自行调整本脚本
exec agent --print "$@" "$PROMPT"
