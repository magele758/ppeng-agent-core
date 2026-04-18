#!/usr/bin/env bash
# CLI 更新检测：检查 claude、codex 等 CLI 是否有新版本，可选自动更新。
# 用法：source scripts/cli-update-check.sh && check_cli_update "claude"
#
# 环境变量：
#   EVOLUTION_CLI_AUTO_UPDATE=1  — 有更新时自动执行更新（默认仅提示）
#   EVOLUTION_CLI_SKIP_UPDATE=1  — 跳过更新检测

# 注意：本脚本会被其他脚本 source；不要开启 `set -u`，否则会传染调用方。
set -eo pipefail

# 检测单个 CLI 是否有更新
# 参数：$1 = CLI 名称 (claude | codex | cursor | gemini)
# 返回：0=无更新或已更新，1=有更新但未更新
check_cli_update() {
  local cli_name="${1:-claude}"

  # 跳过检测
  if [[ "${EVOLUTION_CLI_SKIP_UPDATE:-0}" == "1" ]]; then
    return 0
  fi

  case "$cli_name" in
    claude)
      _check_claude_update
      ;;
    codex)
      _check_codex_update
      ;;
    *)
      echo "[cli-update] 未知 CLI: ${cli_name} - 跳过检测"
      return 0
      ;;
  esac
}

_check_claude_update() {
  if ! command -v claude >/dev/null 2>&1; then
    echo "[cli-update] claude CLI 未安装，跳过检测"
    return 0
  fi

  local current_version
  current_version=$(claude --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1) || current_version="unknown"

  echo "[cli-update] 当前 claude 版本: ${current_version:-unknown}"

  # 检测是否有更新（npm 方式安装）
  if command -v npm >/dev/null 2>&1; then
    local latest_version
    latest_version=$(npm view @anthropic-ai/claude-code version 2>/dev/null || echo "")

    if [[ -n "$latest_version" && "$latest_version" != "$current_version" ]]; then
      echo "[cli-update] 发现新版本: $latest_version (当前: ${current_version:-unknown})"

      if [[ "${EVOLUTION_CLI_AUTO_UPDATE:-0}" == "1" ]]; then
        echo "[cli-update] 正在更新 claude CLI..."
        npm update -g @anthropic-ai/claude-code
        echo "[cli-update] claude CLI 已更新到最新版本"
      else
        echo "[cli-update] 提示：设置 EVOLUTION_CLI_AUTO_UPDATE=1 可自动更新"
        return 1
      fi
    else
      echo "[cli-update] claude CLI 已是最新版本"
    fi
  fi

  return 0
}

_check_codex_update() {
  if ! command -v codex >/dev/null 2>&1; then
    echo "[cli-update] codex CLI 未安装，跳过检测"
    return 0
  fi

  local current_version
  current_version=$(codex --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1) || current_version="unknown"

  echo "[cli-update] 当前 codex 版本: ${current_version:-unknown}"

  # codex 通常通过 npm 安装
  if command -v npm >/dev/null 2>&1; then
    local latest_version
    latest_version=$(npm view @openai/codex version 2>/dev/null || echo "")

    if [[ -n "$latest_version" && "$latest_version" != "$current_version" ]]; then
      echo "[cli-update] 发现新版本: $latest_version (当前: ${current_version:-unknown})"

      if [[ "${EVOLUTION_CLI_AUTO_UPDATE:-0}" == "1" ]]; then
        echo "[cli-update] 正在更新 codex CLI..."
        npm update -g @openai/codex 2>/dev/null || npm update -g codex 2>/dev/null || true
        echo "[cli-update] codex CLI 更新完成"
      else
        echo "[cli-update] 提示：设置 EVOLUTION_CLI_AUTO_UPDATE=1 可自动更新"
        return 1
      fi
    else
      echo "[cli-update] codex CLI 已是最新版本"
    fi
  fi

  return 0
}

# 如果直接执行此脚本，运行检测
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  check_cli_update "${1:-claude}"
fi
