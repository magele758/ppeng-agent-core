#!/usr/bin/env bash
# evolution-run-day：研究阶段 — cursor-agent CLI（默认 composer-2-fast）。
# 读取摘录，判断是否对当前仓库有可落地的能力提升，写入 PROCEED/SKIP 决策。
# 用法：EVOLUTION_RESEARCH_CMD=bash scripts/evolution-research-cursor.sh
#
# 与 scripts/evolution-research.sh 的差异：强制使用 cursor-agent + composer-2-fast，
# 用于「全 cursor 链路」的 evolution 管线。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WT="${EVOLUTION_WORKTREE:-$PWD}"
EX="${EVOLUTION_SOURCE_EXCERPT_FILE:-}"
CO="${EVOLUTION_AGENT_CONSTRAINTS_FILE:-}"
DECISION_FILE="${EVOLUTION_RESEARCH_DECISION_FILE:-}"
SOURCE_URL="${EVOLUTION_SOURCE_URL:-}"
CURSOR_MODEL="${EVOLUTION_CURSOR_AGENT_MODEL:-composer-2-fast}"

if [[ -z "$DECISION_FILE" ]]; then
  DECISION_FILE="${WT}/.evolution/research-decision.txt"
  export EVOLUTION_RESEARCH_DECISION_FILE="$DECISION_FILE"
fi
mkdir -p "$(dirname "$DECISION_FILE")"

if ! command -v agent >/dev/null 2>&1; then
  echo "evolution-research-cursor: 未找到 cursor agent，默认 PROCEED" >&2
  printf 'PROCEED\n无 cursor agent CLI，默认继续。\n' > "$DECISION_FILE"
  exit 0
fi

# arXiv 论文额外抓元数据
ARXIV_CONTENT=""
if [[ -n "$SOURCE_URL" && "$SOURCE_URL" == *"arxiv.org"* ]]; then
  ARXIV_JSON=$(node "$ROOT/scripts/arxiv-fetch.mjs" "$SOURCE_URL" 2>/dev/null || echo "")
  if [[ -n "$ARXIV_JSON" ]]; then
    ARXIV_TITLE=$(echo "$ARXIV_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.title||'')" 2>/dev/null || echo "")
    ARXIV_ABSTRACT=$(echo "$ARXIV_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.abstract||'')" 2>/dev/null || echo "")
    if [[ -n "$ARXIV_TITLE" && -n "$ARXIV_ABSTRACT" ]]; then
      ARXIV_CONTENT=$(printf '\n\n## arXiv\n**标题:** %s\n\n### Abstract\n%s\n' "$ARXIV_TITLE" "$ARXIV_ABSTRACT")
    fi
  fi
fi

PROMPT=$(
  printf '%s\n' "You are a senior architect evaluating whether a source article offers a REAL, IMPLEMENTABLE
capability improvement for a TypeScript/Node.js multi-agent runtime repository at: $WT

The repo provides: multi-agent runtime (sessions/tools/MCP), Capability Gateway (HTTP/SSE/RSS learn),
Web console (Next.js), Self-heal subsystem (autonomous test-fix-merge).

Read the source excerpt and compare against the current codebase. Output EXACTLY in this format:

For a valuable NEW improvement:
  PROCEED
  <which file/function to change and why>

For SKIP, use one category:
  SKIP: SUPERSEDED   — current implementation is already better
  SKIP: DUPLICATE    — already implemented equivalently
  SKIP: IRRELEVANT   — not applicable to this codebase
  SKIP: OUTDATED     — article describes deprecated approach
  SKIP: TOO_COMPLEX  — would require major refactor

Be VERY SELECTIVE. Most articles should be SKIP."
  if [[ -n "${CO:-}" && -f "$CO" ]]; then printf '\n## Project Constraints\n%s\n' "$(cat "$CO")"; fi
  if [[ -n "${EX:-}" && -f "$EX" ]]; then printf '\n## Source Excerpt\n%s\n' "$(cat "$EX")"; fi
  printf '%s' "$ARXIV_CONTENT"
)

cd "$WT"
echo "evolution-research-cursor: 使用 cursor agent --model $CURSOR_MODEL" >&2
OUTPUT=$(agent --print --yolo --model "$CURSOR_MODEL" "$PROMPT" 2>&1 || true)

DECISION_LINE=$(printf '%s\n' "$OUTPUT" | grep -m1 -iE '^\s*(PROCEED|SKIP)' || echo "")

if [[ -z "$DECISION_LINE" ]]; then
  printf 'PROCEED\n（无法解析 PROCEED/SKIP，默认继续）\n原始输出：\n%s\n' \
    "$(printf '%s' "$OUTPUT" | head -20)" > "$DECISION_FILE"
  exit 0
fi

FIRST_WORD=$(printf '%s' "$DECISION_LINE" | awk '{print toupper($1)}')
SKIP_TYPE=""
if [[ "$FIRST_WORD" == "SKIP" ]]; then
  SKIP_TYPE=$(printf '%s' "$DECISION_LINE" | grep -oE 'SUPERSEDED|DUPLICATE|IRRELEVANT|OUTDATED|TOO_COMPLEX' || echo "IRRELEVANT")
fi

REASON_INLINE=$(printf '%s' "$DECISION_LINE" | sed -E 's/^[[:space:]]*(PROCEED|SKIP)[[:space:]:]*//i' | sed -E 's/^(SUPERSEDED|DUPLICATE|IRRELEVANT|OUTDATED|TOO_COMPLEX)[[:space:]:]*//i')
REASON_LINES=$(printf '%s\n' "$OUTPUT" | grep -A8 -m1 -iE '^\s*(PROCEED|SKIP)' | tail -n +2 | head -8)
REASON="${REASON_INLINE}${REASON_INLINE:+$'\n'}${REASON_LINES}"

if [[ -n "$SKIP_TYPE" ]]; then
  printf '%s\n%s\n%s\n' "$FIRST_WORD" "$SKIP_TYPE" "$REASON" > "$DECISION_FILE"
else
  printf '%s\n%s\n' "$FIRST_WORD" "$REASON" > "$DECISION_FILE"
fi
echo "evolution-research-cursor: 决策=$FIRST_WORD ${SKIP_TYPE:+($SKIP_TYPE)}" >&2
