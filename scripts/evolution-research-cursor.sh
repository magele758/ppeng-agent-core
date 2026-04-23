#!/usr/bin/env bash
# evolution-run-day：研究阶段 — cursor-agent CLI（默认 composer-2-fast）。
# 读取摘录，判断是否对当前仓库有可落地的能力提升，写入 PROCEED/SKIP 决策。
# 用法：EVOLUTION_RESEARCH_CMD=bash scripts/evolution-research-cursor.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/evolution/research-cursor.mjs"
