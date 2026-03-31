#!/usr/bin/env bash
# evolution-run-day：研究评估阶段。
# 读取来源摘录，判断文章是否对当前 Agent 仓库有**实际可落地的能力提升**。
# 输出 PROCEED（继续研发）或 SKIP（无改进机会）到 $EVOLUTION_RESEARCH_DECISION_FILE。
#
# 用法（.env 中）：
#   EVOLUTION_RESEARCH_CMD=bash scripts/evolution-research.sh
#   EVOLUTION_AGENT_CMD=bash scripts/evolution-agent-multi.sh   # 研究通过后再执行
#
# 决策文件格式（写入 $EVOLUTION_RESEARCH_DECISION_FILE）：
#   第一行：PROCEED 或 SKIP
#   后续行：理由（2-4 句）
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

WT="${EVOLUTION_WORKTREE:-$PWD}"
EX="${EVOLUTION_SOURCE_EXCERPT_FILE:-}"
CO="${EVOLUTION_AGENT_CONSTRAINTS_FILE:-}"
DECISION_FILE="${EVOLUTION_RESEARCH_DECISION_FILE:-}"

if [[ -z "$DECISION_FILE" ]]; then
  echo "error: EVOLUTION_RESEARCH_DECISION_FILE 未设置" >&2
  exit 1
fi

# ── 构建研究评估 Prompt ────────────────────────────────────────────────────────
PROMPT=$(
  printf '%s\n' "You are evaluating whether a source article offers a REAL, IMPLEMENTABLE capability improvement for a TypeScript/Node.js agent runtime repository.

The repository provides:
- A multi-agent runtime: sessions, tool calls, approval policies, MCP client integration
- Capability Gateway: HTTP/SSE routing, RSS-based learning (evolution pipeline)
- Web console (Next.js): chat UI, streaming, tool call display
- Self-heal subsystem: autonomous test-fix-merge loop

Your task: carefully read the source excerpt and decide:
1. Does it describe a specific technique, pattern, API behaviour, or feature that is MISSING
   from this repository and could be directly implemented in packages/ or apps/?
2. Is the improvement SAFE to add (small, focused, doesn't require external credentials)?
3. Would it meaningfully improve agent capability, reliability, or MCP compatibility?

Output EXACTLY in this format — first line is the decision, rest is your reasoning:

  PROCEED
  <2-4 sentences explaining which specific improvement you identified and where in the codebase>

or:

  SKIP
  <2-4 sentences explaining why this article does not offer an applicable improvement>

Be SELECTIVE. Output PROCEED only when you can name a SPECIFIC file or function to change.
If the article is general/conceptual with no code-level implication, output SKIP.
If the article covers topics already well-implemented in the codebase, output SKIP.
Avoid PROCEED for: documentation, marketing content, tool announcements without API detail."
  if [[ -n "${CO:-}" && -f "$CO" ]]; then printf '\n## Project Constraints\n%s\n' "$(cat "$CO")"; fi
  if [[ -n "${EX:-}" && -f "$EX" ]]; then printf '\n## Source Excerpt\n%s\n' "$(cat "$EX")"; fi
)

cd "$WT"

# ── 选择最快可用的 CLI 做轻量推理（只分析，不改代码）──────────────────────────
run_research() {
  if command -v claude >/dev/null 2>&1; then
    echo "evolution-research: 使用 claude" >&2
    # --output-format text 只输出助手文本，便于解析
    claude --dangerously-skip-permissions -p "$PROMPT" --output-format text 2>&1
  elif command -v gemini >/dev/null 2>&1; then
    echo "evolution-research: 使用 gemini" >&2
    gemini -p "$PROMPT" --yolo 2>&1
  elif command -v codex >/dev/null 2>&1; then
    echo "evolution-research: 使用 codex (read-only)" >&2
    # read-only sandbox：可读文件但不写，适合纯分析
    codex exec --sandbox read-only "$PROMPT" 2>&1
  else
    echo "evolution-research: 无可用 AI CLI，默认 PROCEED" >&2
    printf 'PROCEED\n无可用 AI CLI（claude/gemini/codex），默认继续研发阶段。\n'
    return 0
  fi
}

OUTPUT=$(run_research || true)

# ── 从输出中提取决策 ──────────────────────────────────────────────────────────
# 模型可能在 PROCEED/SKIP 前有少量 preamble，取第一个匹配行
DECISION_LINE=$(printf '%s\n' "$OUTPUT" | grep -m1 -iE '^\s*(PROCEED|SKIP)' || echo "")

if [[ -z "$DECISION_LINE" ]]; then
  # 无法解析 → 默认 PROCEED，不阻断管线，但记录原始输出
  printf 'PROCEED\n（无法从研究输出中解析 PROCEED/SKIP，默认继续）\n原始输出：\n%s\n' \
    "$(printf '%s' "$OUTPUT" | head -20)" > "$DECISION_FILE"
  echo "evolution-research: 无法解析决策，默认 PROCEED" >&2
  exit 0
fi

FIRST_WORD=$(printf '%s' "$DECISION_LINE" | awk '{print toupper($1)}')

# 提取理由：DECISION_LINE 后的内容 + 后续最多 8 行
REASON_INLINE=$(printf '%s' "$DECISION_LINE" | sed -E 's/^[[:space:]]*(PROCEED|SKIP)[[:space:]:]*//i')
REASON_LINES=$(printf '%s\n' "$OUTPUT" | grep -A8 -m1 -iE '^\s*(PROCEED|SKIP)' | tail -n +2 | head -8)
REASON="${REASON_INLINE}${REASON_INLINE:+$'\n'}${REASON_LINES}"

printf '%s\n%s\n' "$FIRST_WORD" "$REASON" > "$DECISION_FILE"
echo "evolution-research: 决策=$FIRST_WORD" >&2
