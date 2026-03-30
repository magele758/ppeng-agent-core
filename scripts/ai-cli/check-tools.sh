#!/usr/bin/env bash
# 检查本机是否已安装各外部 AI CLI（不安装、不修改项目）。
set -euo pipefail

check() {
  local name=$1
  shift
  if command -v "$name" >/dev/null 2>&1; then
    printf '  %-12s OK  (%s)\n' "$name" "$(command -v "$name")"
  else
    printf '  %-12s 未找到  (%s)\n' "$name" "${*:-—}"
  fi
}

echo "External AI CLIs (optional, for ai:* npm scripts):"
check claude "https://docs.anthropic.com/en/docs/claude-code"
check codex "https://developers.openai.com/codex/cli/"
check agent "https://cursor.com/docs/cli/overview (Cursor Agent CLI)"
