# 04 — 上下文预算与压缩

> **核心问题**：在不改写完整 transcript 的前提下，怎样控制每轮送给模型的历史大小。

---

## 问题的严重性

工具输出和长对话都会扩大下一轮输入。若每轮都重发全部历史，单轮输入随历史增长，跨多轮累计输入可能接近二次增长；达到模型窗口后还会截断或拒绝请求。

### 我们的解法：三层渐进压缩

不是一刀切——而是三层各管一段，从零成本到有成本逐级递进：

| 层 | 何时 | LLM 调用？ | 作用域 | 信息损失 |
|----|------|-----------|--------|----------|
| 微压缩 | 每轮 | ❌ | 旧 tool_result | 低（旧输出本就无用） |
| Episodic | 每轮 | ❌ | 消息选择 | 中（但保留关键帧） |
| autoCompact | 过阈值 | ✅ 一次 | 整个历史 | 高（摘要有损） |

**设计哲学**：能用规则解决的不用 LLM，能用零成本解决的不用有成本方案。

---

## 层 1: 微压缩 (micro-compact)

**洞察**：旧的工具输出（3 轮前的 bash stdout）对模型的决策几乎没有价值——模型已经基于那个输出做了决策，现在只需要知道"曾经执行过"。

**策略**：
- 保留最近 3 条 tool_result 全文
- 更早的长输出（>100 chars）替换为 `[previous: used bash — output dropped from context]`
- 即使是"最近 3 条"也受 12k 字符 head+tail 上限——防一条巨型结果独占半窗口

**关键设计约束**：
- ✅ 纯函数，不碰 SQLite（micro-compact 不会进一步改写已落库的 transcript）
- ✅ 只改送给模型的视图
- ✅ 跑在 `prepareMessagesForModel` 末尾；`autoCompact` **内部**用这份已 micro 的视图估 token（见 [17](17-context-memory-compaction.md) 每轮顺序）
- Env：`RAW_AGENT_MICRO_COMPACT*`（keepRecent / minChars / hardMaxChars）

微压缩精确到 `tool_result` part，保留原 tool call 结构。默认保留最近 3 个结果；更老且超过 100 字符的结果折叠，最近结果仍受 12,000 字符 hard cap。默认值以 `DEFAULT_MICRO_COMPACT_CONFIG` 为准。

---

## 层 2: Episodic Selection

**洞察**：并非所有历史消息对当前决策同等重要。探索阶段的"试错"消息在实现阶段可以大幅裁剪。

**策略**：
- 固定保留：初始上下文（第一条 user + 第一条 assistant）+ 最近 24 条消息
- 超出预算时：按重要性评分裁剪中间消息
- **认知阶段适配**（`RAW_AGENT_COGNITIVE_STATE_SELECTION=1`）：
  - 探索阶段 → 保留更多早期消息（模型需要记住已经试过什么）
  - 实现阶段 → 保留更多近期工具结果（模型需要当前状态）

**认知阶段分类器**：基于最近消息的 tool_call 密度和内容模式，将对话分为 exploration / implementation / verification / stuck。

---

## 层 3: autoCompact

**最后的手段**：当前两层都无法将上下文控制在预算内时，用 LLM 生成摘要 + 归档旧消息。

**触发条件**：`estimateMessageTokens >= sessionBudgetTokens`（且最近 24 条未独占整个阈值）

**流程**：
1. `pre_compact` lifecycle hook → `on_compact` extension（任一可 block）
2. 调用 `modelAdapter.summarizeMessages` 生成摘要
3. 旧消息另写一份到 `transcripts/<sessionId>/<timestamp>.jsonl`
4. 摘要写入 `session.summary`，下轮进入 dynamic context

当前实现不会从 SQLite 删除这些旧 message；后续送模范围仍由 `visibleMessages()` 选择。磁盘归档是额外的恢复锚点，不是数据库搬迁操作。

**设计约束**：autoCompact 只在阈值与最近消息护栏同时满足时调用 summarizer，不是每轮调用。

---

## 预算推导

### 之前的问题

阈值硬编码 24k：
- 用 1M 窗口模型 → 浪费 97% 上下文容量
- 用 32k 窗口模型 → 留不下 system prompt + tools + output 余量

### 现在的做法

按**实际模型窗口**动态推导：

```
sessionBudgetTokens = max(8000,
  maxContextTokens
  − systemPromptTokens       (上一轮实际值)
  − toolCount × 120          (每个工具 ~120 token schema)
  − outputReserveTokens      (默认 16k)
  − safetyMargin             (2k))
```

**上一轮形状喂下一轮**：`turnShapeBySession` 缓存上一轮的 prompt size 和 tool count，首轮回退默认值。这意味着——换大窗口模型只改一个 env（`RAW_AGENT_MODEL_CONTEXT_TOKENS`），阈值自动适配。显式 `RAW_AGENT_COMPACT_TOKEN_THRESHOLD` / `RAW_AGENT_EPISODIC_TOKEN_BUDGET` 仍优先。

**成本侧**：网关若把 `prompt_tokens` 报成会话累计，runtime 用 `splitCumulativePromptTokens` 归一为本轮份额（防 totals 平方膨胀）——见 [17](17-context-memory-compaction.md) / [09](09-model-adapters.md)。

---

## Working Log：压缩的保险网

摘要对模型视图是有损的，但原 message 仍在 SQLite，且 compact 时会另写归档。Working log 是 **append-only 磁盘文件**，保存高信号条目和归档位置：

| EntryKind | 何时写 | 保留什么 |
|-----------|--------|----------|
| `compact_anchor` | autoCompact 归档后 | 归档路径 + 摘要正文 |
| `step_outcome` | session 正常完成时 | 最终 assistant 文本（截断） |
| `artifact_indexed` | 索引类产物 | 工具 / ref |

**读取**：每轮取文件尾部（`RAW_AGENT_WORKING_LOG_TAIL_CHARS`，默认 4k），与 memory appendix **同走** user-side。文件缺失降级为空串——零成本。

Working log 是辅助恢复文件，SQLite transcript 仍是会话事实源；文件丢失时读取逻辑降级为空串。

---

## 如何评估

仓库当前能验证的是触发条件、选择结果和“落库 transcript 不被 micro-compact 改写”等不变量。token 节省、信息损失和触发频率取决于模型、工具输出与会话分布，必须从 `turn_end.usage`、`micro_compact`、compact trace 和任务结果中计算，不能写成固定百分比。

---

## 关键文件

| 路径 | 职责 |
|------|------|
| `session/micro-compact.ts` | `microCompactMessages` 纯函数 |
| `session/session-budget.ts` | `calculateSessionBudget` / `resolveHistoryTokenBudget` |
| `session/working-log.ts` | `appendWorkingLogEntry` / `readWorkingLogTail` |
| `model/episodic-selection.ts` | `selectEpisodicMessages` + cognitive state 适配 |
| `model/cognitive-state.ts` | 认知阶段分类器 |
| `model/token-estimate.ts` | `estimateMessageTokens` |
| `runtime.ts` | `autoCompact` / `visibleMessages` / `prepareMessagesForModel` / appendix / `turnShapeBySession` |
| **深读** | [17-context-memory-compaction](17-context-memory-compaction.md)（调用序 + env + Memory 后端） |
