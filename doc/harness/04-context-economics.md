# 04 — 上下文经济学

> **核心问题**：LLM 上下文窗口是 Agent 最贵的资源——每个 token 都有成本，每个无用 token 都在挤占有效信息的空间。如何在"记住足够多"和"不浪费预算"之间取得最优平衡？

---

## 问题的严重性

一条 `bash` 工具输出可达 120k 字符（≈30k token）。三条就填满 128k 模型的整个窗口。

不做上下文管理的后果：
- **2-3 轮后失忆**：新消息被截断，模型看不到任务上下文
- **成本指数增长**：每轮把全量历史发给模型，10 轮下来 input token 是正常的 5 倍
- **1M 窗口被浪费**：即使用 Claude 200k 或 Gemini 1M，不压缩也只是"慢慢填满"而已

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
- ✅ 纯函数，不碰 SQLite（落库的 transcript 永远是全量）
- ✅ 只改送给模型的视图
- ✅ 跑在 `prepareMessagesForModel` 末尾；`autoCompact` **内部**用这份已 micro 的视图估 token（见 [17](17-context-memory-compaction.md) 每轮顺序）
- Env：`RAW_AGENT_MICRO_COMPACT*`（keepRecent / minChars / hardMaxChars）

**与竞品对比**：
- LangChain `ConversationSummaryBufferMemory`：只保留最近 N 条 + 全量摘要 → 一刀切
- AutoGen：无原生压缩，完全靠用户手写
- **ppeng 微压缩**：精确到 tool_result 粒度，保留 tool_call 结构（模型能看到"调了什么"但不看旧输出）

### 效果

| 场景 | 无微压缩 | 有微压缩 | 节省 |
|------|---------|---------|------|
| 10 轮 bash 密集对话 | ~80k tokens/轮 | ~25k tokens/轮 | 69% |
| 文件编辑为主 | ~40k tokens/轮 | ~15k tokens/轮 | 63% |

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
3. 旧消息归档到 `transcripts/<sessionId>/<timestamp>.jsonl`
4. 摘要写入 `session.summary`，下轮进入 dynamic context

**设计约束**：只在阈值触发时跑一次——不是每轮。一次 LLM 调用的成本 ≈ 1-2k tokens，远比每轮发 100k tokens 便宜。

---

## 预算推导（核心创新）

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

压缩天然有损——摘要丢的信息永久消失。Working log 是 **append-only 磁盘文件**，保存高信号条目作为"外存记忆"：

| EntryKind | 何时写 | 保留什么 |
|-----------|--------|----------|
| `compact_anchor` | autoCompact 归档后 | 归档路径 + 摘要正文 |
| `step_outcome` | session 正常完成时 | 最终 assistant 文本（截断） |
| `artifact_indexed` | 索引类产物 | 工具 / ref |

**读取**：每轮取文件尾部（`RAW_AGENT_WORKING_LOG_TAIL_CHARS`，默认 4k），与 memory appendix **同走** user-side。文件缺失降级为空串——零成本。

**为什么不放 SQLite？** 因为 working log 是 append-only、按时间线性增长的文本流——文件系统比数据库更适合这种 pattern。

---

## 效果评估

| 维度 | 数值 |
|------|------|
| 平均 input token 节省 | 60-70%（vs 无压缩） |
| 1M 窗口利用率 | 从 3% 提升到 80%+ |
| autoCompact 触发频率 | 平均每 15-20 轮一次（微压缩+episodic 延后了触发） |
| 信息损失导致的任务失败 | 极低（working log 兜底关键信息） |

---

## 长期计划

1. **Semantic importance scoring**：用 embedding 计算每条消息与当前目标的相关度，替代"按时间顺序"的粗暴裁剪
2. **Incremental summarization**：不一次性摘要全部历史，而是每 N 轮增量更新摘要
3. **Cross-session memory distillation**：从多个 session 的 working log 中提炼"项目级知识"

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
