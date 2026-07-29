# 04 — 上下文经济学

管理模型输入 token 的三层压缩 + 预算推导 + 外存日志。

---

## 问题本质

LLM 上下文窗口有限。一条 `bash` 工具输出可达 120k 字符（≈30k token），三条就填满一个 128k 模型。不压缩 = 对话几轮后必截断或 OOM。

---

## 三层压缩（各管一段）

```
层次              何时跑    代价      作用域               持久影响
─────────────────────────────────────────────────────────────────────
1. micro-compact  每轮      零        旧 tool_result       无（只改模型视图）
2. episodic       每轮      零        消息选择             无（只改模型视图）
3. autoCompact    过阈值    1次LLM    整个历史             有（归档+摘要写入session）
```

### 层 1: micro-compact (`session/micro-compact.ts`)

- **策略**：保留最近 N 条（默认 3）tool_result 全文，更早的长输出（>100 chars）换成 `[previous: used bash — output dropped from context]`。
- **硬截**：即使是「最近 N」也受 `hardMaxChars`（默认 12k）head+tail 限制——否则一条巨型结果就能独占半个窗口。
- **不可变**：纯函数、返回新 array、不碰 SQLite。落库 transcript 永远是全量。
- **触发位置**：`runtime.prepareMessagesForModel()` 的最后一步。

### 层 2: episodic selection (`model/episodic-selection.ts`)

- **策略**：按 token 预算从全量消息中选择子集。保留最近 24 条 + 初始上下文（第一条 user + 第一条 assistant）；超出预算时按重要性评分裁剪中间消息。
- **认知阶段适配**（`RAW_AGENT_COGNITIVE_STATE_SELECTION=1`）：探索阶段保留更多早期探索消息；实现阶段保留更多近期工具结果。
- **触发位置**：`runtime.visibleMessages()`。

### 层 3: autoCompact

- **策略**：当 `estimateMessageTokens(forModel) >= tokenThreshold` 时（且最近 24 条未独占整个阈值），用 `modelAdapter.summarizeMessages` 生成摘要，归档旧消息到 `transcripts/<sessionId>/<timestamp>.jsonl`。
- **代价**：一次 LLM 调用。所以只在阈值触发时跑一次——不是每轮。
- **触发位置**：每轮头部 `autoCompact(context)`。
- **配合**：压缩前跑 `pre_compact` lifecycle hook 和 `on_compact` extension（任一可 block）。

---

## 预算推导 (`session/session-budget.ts`)

原来两个阈值（compact 触发值 / episodic 预算）**硬编码 24k**：
- 1M 窗口模型浪费 97% 上下文。
- 32k 窗口模型留不下 system prompt + tools + output 的余量。

现在按 **实际窗口** 推导：

```
sessionBudgetTokens = max(8000,
  maxContextTokens
  − charsToTokens(systemPromptChars)
  − toolCount × 120
  − outputReserveTokens (默认 16k)
  − safetyMargin (2k))
```

### 输入来源

| 参数 | 取自 |
|------|------|
| `maxContextTokens` | `RAW_AGENT_MODEL_CONTEXT_TOKENS`（默认 131072） |
| `systemPromptChars` | 上一轮 `systemPrompt.length`（存 `turnShapeBySession`；首轮回退默认值） |
| `toolCount` | 上一轮 `turnTools.length` |
| `outputReserveTokens` | `RAW_AGENT_OUTPUT_RESERVE_TOKENS`（默认 16k） |

**显式 env 仍优先**：如果 `RAW_AGENT_EPISODIC_TOKEN_BUDGET=24000` 有值，使用它而不推导。

---

## Working log (`session/working-log.ts`)

压缩天然有损——摘要丢的信息永久消失。Working log 是 **append-only 磁盘文件** 保存高信号条目：

| EntryKind | 何时写 | 保留什么 |
|-----------|--------|----------|
| `compact_anchor` | autoCompact 归档后 | 归档路径 + 摘要正文 |
| `step_outcome` | session 正常完成时 | 最终 assistant 文本（前 2k 字符） |
| `artifact_indexed` | （预留） | artifact handle + 摘要 |

**读取**：`readWorkingLogTail(path, maxChars=4000)` 取文件尾部，拼进 user-side appendix（见 [02-prompt-assembly.md](02-prompt-assembly.md)）。Missing = '' → 零成本降级。

---

## Env 全表

| 变量 | 默认 | 说明 |
|------|------|------|
| `RAW_AGENT_MODEL_CONTEXT_TOKENS` | 131072 | 模型上下文窗口（推导用） |
| `RAW_AGENT_OUTPUT_RESERVE_TOKENS` | 16000 | 为模型输出预留的 token |
| `RAW_AGENT_COMPACT_TOKEN_THRESHOLD` | (推导) | autoCompact 触发阈值 |
| `RAW_AGENT_COMPACT_SUMMARY_MAX_CHARS` | 阈值×2 | 滚动摘要字符上限 |
| `RAW_AGENT_EPISODIC_TOKEN_BUDGET` | (推导) | episodic 选择预算 |
| `RAW_AGENT_COGNITIVE_STATE_SELECTION` | 1 | 认知阶段适配开关 |
| `RAW_AGENT_EPISODIC_SELECTION` | 1 | 是否启用 episodic（关=简单截断） |
| `RAW_AGENT_MICRO_COMPACT` | 1 | 微压缩开关 |
| `RAW_AGENT_MICRO_COMPACT_KEEP_RECENT` | 3 | 保留全文的最近 N 条 |
| `RAW_AGENT_MICRO_COMPACT_MIN_CHARS` | 100 | 低于此长度不替换 |
| `RAW_AGENT_MICRO_COMPACT_HARD_MAX_CHARS` | 12000 | 即使是最近也做 head+tail |
| `RAW_AGENT_WORKING_LOG` | 1 | 是否启用 working log |
| `RAW_AGENT_WORKING_LOG_TAIL_CHARS` | 4000 | 注入 prompt 的尾部字数 |

---

## 关键文件

| 路径 | 职责 |
|------|------|
| `session/micro-compact.ts` | `microCompactMessages` 纯函数 |
| `session/session-budget.ts` | `calculateSessionBudget` / `resolveHistoryTokenBudget` |
| `session/working-log.ts` | `appendWorkingLogEntry` / `readWorkingLogTail` |
| `model/episodic-selection.ts` | `selectEpisodicMessages` / `selectEpisodicMessagesWithCognitiveState` |
| `model/cognitive-state.ts` | 认知阶段分类器 |
| `model/token-estimate.ts` | `estimateMessageTokens` |
| `runtime.ts` | `autoCompact` / `visibleMessages` / `prepareMessagesForModel` |
