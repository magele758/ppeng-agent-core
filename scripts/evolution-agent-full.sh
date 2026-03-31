#!/usr/bin/env bash
# evolution 研究 + 实现一体化钩子。
# 只需配置一个环境变量：
#
#   EVOLUTION_AGENT_CMD=bash scripts/evolution-agent-full.sh
#
# 流程：
#   [1] 研究阶段：评估文章是否有有价值的能力改进机会
#       → SKIP  : 写 .evolution/agent-skip-reason.txt，exit 0
#                 管线读取后写 doc/evolution/no-op/，删除分支
#       → PROCEED: 继续
#   [2] 实现阶段：按权重/难度路由给多个 AI CLI（evolution-agent-multi.sh）
#
# 选项（继承自 evolution-agent-multi.sh）：
#   EVOLUTION_AGENT_STRATEGY=rotate|difficulty
#   EVOLUTION_AGENT_WEIGHTS=claude:2,codex:1,cursor:1
#   EVOLUTION_AGENT_DIFFICULTY_MAP=simple:codex,medium:cursor,complex:claude
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WT="${EVOLUTION_WORKTREE:-$PWD}"
EX="${EVOLUTION_SOURCE_EXCERPT_FILE:-}"

# ── [1] 研究阶段 ──────────────────────────────────────────────────────────────
echo "evolution-agent-full: [1/2] 研究阶段..." >&2

DECISION_FILE="${WT}/.evolution/research-decision.txt"
export EVOLUTION_RESEARCH_DECISION_FILE="$DECISION_FILE"

bash "${SCRIPT_DIR}/evolution-research.sh" || {
  echo "evolution-agent-full: 研究脚本失败，默认继续" >&2
}

# 解析决策
DECISION_WORD="PROCEED"
DECISION_REASON=""
if [[ -f "$DECISION_FILE" ]]; then
  FIRST_LINE=$(head -1 "$DECISION_FILE" | tr -d '\r')
  DECISION_WORD=$(echo "$FIRST_LINE" | awk '{print toupper($1)}' | tr -d '[:space:]')
  REASON_INLINE=$(echo "$FIRST_LINE" | sed -E 's/^[[:space:]]*(PROCEED|SKIP)[[:space:]:]*//i')
  REASON_REST=$(tail -n +2 "$DECISION_FILE" | head -8)
  DECISION_REASON="${REASON_REST:-$REASON_INLINE}"
fi

if [[ "$DECISION_WORD" == "SKIP" ]]; then
  echo "evolution-agent-full: 研究结论=SKIP → ${DECISION_REASON:-无具体原因}" >&2
  # 写信号文件让管线记录 no-op 并删除分支
  SKIP_SIGNAL="${WT}/.evolution/agent-skip-reason.txt"
  printf '%s\n' "${DECISION_REASON:-研究阶段判断无改进机会}" > "$SKIP_SIGNAL"
  exit 0
fi

echo "evolution-agent-full: 研究结论=PROCEED → ${DECISION_REASON:-有改进机会}" >&2

# ── [2] 实现阶段 ──────────────────────────────────────────────────────────────
echo "evolution-agent-full: [2/2] 实现阶段..." >&2
exec bash "${SCRIPT_DIR}/evolution-agent-multi.sh"
