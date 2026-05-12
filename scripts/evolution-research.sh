#!/usr/bin/env bash
# evolution-run-day：深度研究评估阶段。
# 读取来源摘录，判断文章是否对当前 Agent 仓库有**实际可落地的能力提升**。
# 输出 PROCEED（继续研发）或 SKIP（无改进机会）到 $EVOLUTION_RESEARCH_DECISION_FILE。
#
# 跳过类型（SKIP 的细分）：
#   SUPERSEDED   — 当前项目已有更优实现
#   DUPLICATE    — 已有类似实现，无需重复
#   IRRELEVANT   — 与项目无关或不适用
#   OUTDATED     — 资料内容已过时
#   TOO_COMPLEX  — 改动过大，不适合自动进化
#
# 用法（.env 中）：
#   EVOLUTION_RESEARCH_CMD=bash scripts/evolution-research.sh
#
# 可调：EVOLUTION_RESEARCH_STRICTNESS=strict|balanced|recall（默认 balanced）
#       EVOLUTION_RESEARCH_UNPARSED_DEFAULT=proceed|skip（无法解析模型输出时）
#       EVOLUTION_RESEARCH_FULL_EXCERPT_MIN_CHARS（判定「长摘录」阈值，默认 500）
# 决策解析与 Cursor 路径统一走 scripts/evolution/research-gate.mjs（由 research-write-decision.mjs 调用）。
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WT="${EVOLUTION_WORKTREE:-$PWD}"
EX="${EVOLUTION_SOURCE_EXCERPT_FILE:-}"
CO="${EVOLUTION_AGENT_CONSTRAINTS_FILE:-}"
DECISION_FILE="${EVOLUTION_RESEARCH_DECISION_FILE:-}"
SOURCE_URL="${EVOLUTION_SOURCE_URL:-}"

export EVOLUTION_WORKTREE="$WT"

if [[ -n "${EX:-}" ]]; then
  export EVOLUTION_SOURCE_EXCERPT_FILE="${EVOLUTION_SOURCE_EXCERPT_FILE:-$EX}"
fi
if [[ -n "${CO:-}" ]]; then
  export EVOLUTION_AGENT_CONSTRAINTS_FILE="${EVOLUTION_AGENT_CONSTRAINTS_FILE:-$CO}"
fi

if [[ -z "$DECISION_FILE" ]]; then
  DECISION_FILE="${WT}/.evolution/research-decision.txt"
  export EVOLUTION_RESEARCH_DECISION_FILE="$DECISION_FILE"
  echo "evolution-research: EVOLUTION_RESEARCH_DECISION_FILE 未设置 → 默认 ${DECISION_FILE}" >&2
fi
mkdir -p "$(dirname "$DECISION_FILE")"

PROMPT="$(node "$ROOT/scripts/evolution/research-eval-prompt.mjs")"

cd "$WT"

run_research() {
  if command -v claude >/dev/null 2>&1; then
    echo "evolution-research: 使用 claude" >&2
    claude --dangerously-skip-permissions -p "$PROMPT" --output-format text 2>&1
  elif command -v gemini >/dev/null 2>&1; then
    echo "evolution-research: 使用 gemini" >&2
    gemini -p "$PROMPT" --yolo 2>&1
  elif command -v codex >/dev/null 2>&1; then
    echo "evolution-research: 使用 codex (read-only)" >&2
    codex exec --sandbox read-only "$PROMPT" 2>&1
  else
    echo "evolution-research: 无可用 AI CLI，默认 PROCEED" >&2
    printf 'PROCEED\n无可用 AI CLI（claude/gemini/codex），默认继续研发阶段。\n'
    return 0
  fi
}

OUTPUT="$(run_research || true)"

RAWF="$(mktemp "${TMPDIR:-/tmp}/evolution-research.XXXXXX")"
trap 'rm -f "$RAWF"' EXIT
printf '%s' "$OUTPUT" >"$RAWF"
export EVOLUTION_RESEARCH_RAW_FILE="$RAWF"
export EVOLUTION_RESEARCH_DELETE_RAW_FILE=1
node "$ROOT/scripts/evolution/research-write-decision.mjs"
echo "evolution-research: 已写入决策文件（见 research-write-decision / research-gate 解析）" >&2
