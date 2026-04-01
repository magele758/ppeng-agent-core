#!/usr/bin/env bash
# evolution-run-day：深度研究评估阶段。
# 读取来源摘录，判断文章是否对当前 Agent 仓库有**实际可落地的能力提升**。
# 输出 PROCEED（继续研发）或 SKIP（无改进机会）到 $EVOLUTION_RESEARCH_DECISION_FILE。
#
# 跳过类型（SKIP 的细分）：
#   SUPERSeded   — 当前项目已有更优实现
#   DUPLICATE    — 已有类似实现，无需重复
#   IRRELEVANT   — 与项目无关或不适用
#   OUTDATED     — 资料内容已过时
#   TOO_COMPLEX  — 改动过大，不适合自动进化
#
# 用法（.env 中）：
#   EVOLUTION_RESEARCH_CMD=bash scripts/evolution-research.sh
#   EVOLUTION_AGENT_CMD=bash scripts/evolution-agent-multi.sh   # 研究通过后再执行
#
# 决策文件格式（写入 $EVOLUTION_RESEARCH_DECISION_FILE）：
#   第一行：PROCEED 或 SKIP
#   第二行（仅 SKIP）：跳过类型（SUPERSeded|DUPLICATE|IRRELEVANT|OUTDATED|TOO_COMPLEX）
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

# ── 构建深度研究评估 Prompt ────────────────────────────────────────────────────────
PROMPT=$(
  printf '%s\n' "You are a senior architect evaluating whether a source article offers a REAL, IMPLEMENTABLE capability improvement for a TypeScript/Node.js agent runtime repository.

The repository provides:
- A multi-agent runtime: sessions, tool calls, approval policies, MCP client integration
- Capability Gateway: HTTP/SSE routing, RSS-based learning (evolution pipeline)
- Web console (Next.js): chat UI, streaming, tool call display
- Self-heal subsystem: autonomous test-fix-merge loop

Your task: carefully read the source excerpt AND compare against the current codebase implementation.

## Step 1: Analyze the source
- What specific technique, pattern, API, or feature does it describe?
- Is it concrete (code-level) or conceptual (marketing/overview)?

## Step 2: Check current implementation
- Search the codebase for similar functionality
- Compare: does the current implementation already cover this?
- Is the current implementation BETTER than what the article suggests?

## Step 3: Decision
Output EXACTLY in this format:

For a valuable NEW improvement:
  PROCEED
  <which file/function to change and why>

For SKIP, use one of these categories:
  SKIP: SUPERSEDED
  <current implementation is better; describe what we already have>

  SKIP: DUPLICATE
  <already implemented equivalently; cite the existing code>

  SKIP: IRRELEVANT
  <not applicable to this codebase; explain why>

  SKIP: OUTDATED
  <article describes old/deprecated approach>

  SKIP: TOO_COMPLEX
  <would require major refactor; not suitable for auto-evolution>

Be VERY SELECTIVE. Most articles should be SKIP.
Only PROCEED when you can name a SPECIFIC improvement that is CLEARLY MISSING and SAFE to add.
Avoid PROCEED for: documentation, marketing, announcements without API detail, or features we already have."
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

# 提取跳过类型（如果有）
SKIP_TYPE=""
if [[ "$FIRST_WORD" == "SKIP" ]]; then
  SKIP_TYPE=$(printf '%s' "$DECISION_LINE" | grep -oE 'SUPERSEDED|DUPLICATE|IRRELEVANT|OUTDATED|TOO_COMPLEX' || echo "IRRELEVANT")
fi

# 提取理由：DECISION_LINE 后的内容 + 后续最多 8 行
REASON_INLINE=$(printf '%s' "$DECISION_LINE" | sed -E 's/^[[:space:]]*(PROCEED|SKIP)[[:space:]:]*//i' | sed -E 's/^(SUPERSEDED|DUPLICATE|IRRELEVANT|OUTDATED|TOO_COMPLEX)[[:space:]:]*//i')
REASON_LINES=$(printf '%s\n' "$OUTPUT" | grep -A8 -m1 -iE '^\s*(PROCEED|SKIP)' | tail -n +2 | head -8)
REASON="${REASON_INLINE}${REASON_INLINE:+$'\n'}${REASON_LINES}"

# 写入决策文件
if [[ -n "$SKIP_TYPE" ]]; then
  printf '%s\n%s\n%s\n' "$FIRST_WORD" "$SKIP_TYPE" "$REASON" > "$DECISION_FILE"
  echo "evolution-research: 决策=$FIRST_WORD 类型=$SKIP_TYPE" >&2
else
  printf '%s\n%s\n' "$FIRST_WORD" "$REASON" > "$DECISION_FILE"
  echo "evolution-research: 决策=$FIRST_WORD" >&2
fi
