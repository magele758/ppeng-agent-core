# 17 — 会话上下文 / 压缩 / Memory（实现切片）

> **定位**：把「落库 transcript」与「送给模型的视图」拆开，并说明预算推导、外存 working-log、五层 Memory 与成本侧累计 token 归一如何接进自建 turn loop。  
> **叙事章**：[04-context-economics](04-context-economics.md)（为何压缩）、[02-prompt-assembly](02-prompt-assembly.md)（appendix 与 cache）、[08-memory-and-evolving](08-memory-and-evolving.md)（Evolving）。本章以 **runtime 调用顺序 + env** 为准。

---

## 每轮真实顺序（勿按「先估再压」理解）

`RawAgentRuntime` 单轮开头（简化）：

```
1. autoCompact(context)
     ├─ visibleMessages（episodic）
     ├─ prepareMessagesForModel（末尾 micro-compact）
     ├─ estimateMessageTokens(forModel) 与 threshold 比较
     └─ 若触发：LLM 摘要 → 归档 transcript → session.summary
        → working-log compact_anchor
2. visibleMessages → prepareMessagesForModel（再次，含 micro）
3. buildMemoryAppendix + readWorkingLogTail
     → applyMemoryAppendixToMessages（拼到最近 user，不进 system）
4. buildSystemPrompt（memory / working-log 故意不在此）
5. model turn → splitCumulativePromptTokens（用量归一）
6. turnShapeBySession.set({ systemPromptChars, toolCount })  // 喂下一轮预算
```

要点：

- **autoCompact 在每轮开头先跑**；它内部用「已 micro 的视图」估 token，避免按未压缩量误判。
- **micro-compact 只改模型视图**，SQLite / 落库 transcript 仍是全量。
- Memory + working-log **同走 user-side appendix**（保护 prompt cache）。

---

## 两层压缩：勿混

| | micro-compact | autoCompact |
|--|---------------|-------------|
| 何时 | **每轮**，`prepareMessagesForModel` **末尾** | 过历史预算阈值（且最近 24 条未独占阈值） |
| LLM？ | 否（纯函数） | 是（`summarizeMessages`） |
| 改落库？ | **否** | **是**（归档旧消息 + 写 `session.summary`） |
| 作用对象 | 旧 / 过长 `tool_result` | 整段历史（保留最近 24 条） |
| Trace | `micro_compact` | compact / `compact_skipped` |

### micro-compact 策略

- 保留最近 `keepRecent`（默认 3）条 tool_result 全文；更早且 `> minChars` 的换成一行 placeholder。
- 即使「最近 N 条」也做 head+tail `hardMaxChars`（默认 12k），防单条 bash 炸窗。
- 失败结果一样折叠——重复 stack 也是死重量。

| Env | 默认 | 含义 |
|-----|------|------|
| `RAW_AGENT_MICRO_COMPACT` | on | 总开关 |
| `RAW_AGENT_MICRO_COMPACT_KEEP_RECENT` | 3 | 保留全文条数 |
| `RAW_AGENT_MICRO_COMPACT_MIN_CHARS` | 100 | 短于此时不折叠 |
| `RAW_AGENT_MICRO_COMPACT_HARD_MAX_CHARS` | 12000 | 近期结果硬顶 |

路径：`packages/core/src/session/micro-compact.ts`。

### autoCompact 触发护栏

1. `est(forModel) >= RAW_AGENT_COMPACT_TOKEN_THRESHOLD`（或推导预算）
2. 消息数 > 24
3. 最近 24 条（经 prepare/micro）**未**单独占满阈值——否则摘要也救不了，跳过
4. `pre_compact` lifecycle / `on_compact` extension 可 block（fail-soft 记 `compact_skipped`）

归档：`stateDir/transcripts/<sessionId>/…jsonl`；摘要进 dynamic context 的 `Compressed summary`。

---

## 中间层：Episodic + 认知阶段

在 autoCompact / 送模之前，`visibleMessages` 默认走 episodic（`RAW_AGENT_EPISODIC_SELECTION`，默认 on）：

- 预算：`resolveHistoryTokenBudget('RAW_AGENT_EPISODIC_TOKEN_BUDGET', turnShape)`
- `RAW_AGENT_COGNITIVE_STATE_SELECTION=1`（默认 on）时按 exploration / implementation / verification / stuck 调保留偏好

关闭 episodic 时退化为 `slice(-24)`。

---

## session-budget：按模型窗口推导（非硬编码 24k）

历史曾把 episodic / compact 阈值写死 24k——大窗口浪费、小窗口顶爆。现用：

```
sessionBudgetTokens = max(8000,
  maxContextTokens
  − systemPromptTokens      // 上一轮实际 chars/4
  − toolSchemaTokens        // toolCount×120 或精确值，否则 fallback 4k
  − outputReserveTokens     // 默认 16k（推理模型友好）
  − safetyMargin            // 2k)
```

| Env / 机制 | 作用 |
|------------|------|
| `RAW_AGENT_MODEL_CONTEXT_TOKENS` | 模型窗口（默认 131072）；换大窗主要改这个 |
| `RAW_AGENT_OUTPUT_RESERVE_TOKENS` | 输出预留 |
| `RAW_AGENT_EPISODIC_TOKEN_BUDGET` | **显式则优先**，否则 = 推导预算 |
| `RAW_AGENT_COMPACT_TOKEN_THRESHOLD` | **显式则优先**，否则 = 推导预算 |
| `turnShapeBySession` | 本轮写 `systemPromptChars` + `toolCount`，**下一轮**预算用 |

路径：`packages/core/src/session/session-budget.ts`；runtime 在组完 tools / systemPrompt 后 `turnShapeBySession.set(...)`。

---

## Working log：压缩的 append-only 外存

有损摘要丢的信息永久离开模型视图；working log 用磁盘文件兜高信号：

| Kind | 何时 | 内容 |
|------|------|------|
| `compact_anchor` | autoCompact 成功后 | 归档路径 + 摘要正文 |
| `step_outcome` | session 正常收尾 | 最终 assistant 文本（截断） |
| `artifact_indexed` | 索引类产物 | 工具 / ref（扩展用） |

- 路径：`stateDir/working-logs/<sessionId>/working-memory.md`
- 每轮读尾部（默认 4k chars）与 memory appendix **合并后**注入最近 user
- 文件缺失 → `''`；写失败只 warn——**绝不打断 turn**

| Env | 默认 |
|-----|------|
| `RAW_AGENT_WORKING_LOG` | on |
| `RAW_AGENT_WORKING_LOG_TAIL_CHARS` | 4000 |

路径：`packages/core/src/session/working-log.ts`。

---

## Memory 多层：`AgentMemoryStore`

### 五层 scope

| Scope | 生命周期 | 典型用途 |
|-------|----------|----------|
| `session.scratch` | 本次 dispatch / 短 | 工具间中间值 |
| `session.long` | 本 session 跨轮 | 对话内约定 |
| `user.memory` | 跨 session · 用户 | 偏好 |
| `team.memory` | 跨 session · 租户 | 团队知识 |
| `project.memory` | 跨 session · 项目 | 项目事实 |

Store 侧有每 scope 容量上限（如 scratch 200 / long 500 / user·project 5000）；支持 FTS（表可用时）、importance / recency / access_count 排序。HTTP：`GET/POST /api/memory`（及 users/tenants）。

### 后端切换：`RAW_AGENT_MEMORY_BACKEND`

| 值 | 行为 |
|----|------|
| `agent`（**默认**） | 对话回路经 `SessionMemoryBridge` → `AgentMemoryStore` |
| `session` | **回退**旧 `session_memory` 表（仅 scratch/long） |
| `dual` | 双写 agent + session |

工具 `memory_set` / `memory_get` 与 PromptBuilder 的 session memory 列表统一走 bridge。多用户模型与身份字段见 [`MEMORY_MULTIUSER.md`](../MEMORY_MULTIUSER.md)。

路径：`packages/core/src/memory/{store,types,memory-backend,session-memory-bridge}.ts`。

---

## Memory / working-log user appendix（不进 system）

`PromptBuilder.buildMemoryAppendix`：

- 只拼 session **scratch + long**（各有条数上限）
- **故意不进** `buildDynamicContext` / system——注释写明为保 prefix cache
- runtime 与 working-log tail 拼成 `combinedAppendix`，`applyMemoryAppendixToMessages` 插到**最近一条 user** 的 parts 前面；若无 user 则前置一条 user 消息

与 [02](02-prompt-assembly.md) Layer 4 一致：动态 churn 放 user 侧，stable system 可复用 KV cache。

---

## Case governance（与本切片的交界）

Case 不是会话上下文本身，但是 **跨 session 经验池** 的容量治理，与「外存不无限膨胀」同一哲学：

| 机制 | Env / 默认 | 行为 |
|------|------------|------|
| 总开关 | `RAW_AGENT_CASE_GOVERNANCE`（on） | fail-soft，永不抛 |
| 半衰期衰减 | `RAW_AGENT_CASE_HALF_LIFE_DAYS`（30） | `confidence × 0.5^(age/halfLife)` |
| 衰减归档 | 有效 confidence &lt; 0.05 | `status → archived` |
| 过期归档 | `expires_at` | 同上 |
| 容量归档 | `RAW_AGENT_CASE_CAPACITY`（**2000**） | 按有效 confidence 升序、再按旧→新 archive 溢出 |

Schema：`agent_cases.status`（migration v10）。召回 / ShadowCoach 见 [08](08-memory-and-evolving.md)。路径：`packages/core/src/evolving/case-governance.ts`。

---

## 累计 prompt token 归一（上下文成本侧）

部分网关把 `prompt_tokens` 报成**会话 running total**。runtime 若每轮直接累加 → totals / `usageCostUsd` **平方膨胀**。

`splitCumulativePromptTokens`（`packages/core/src/model/usage.ts`）：

1. 相对上一累计值大跳（≥ +40% 且 ≥ +1000）→ 判为 cumulative，本轮份额 = `incoming - prev`
2. 一旦判定，session 内 sticky；compact 后数值回降则让位，避免误拆
3. 发 `usage_cumulative_split` trace；再交给成本估算与 `session.metadata.usageTotals`

详述与 adapter 归一化见 [09-model-adapters](09-model-adapters.md)。本章强调：它落在 **上下文成本可观测**，不改循环 stopReason。

---

## Env 速查（本切片）

```
# 窗口与预算
RAW_AGENT_MODEL_CONTEXT_TOKENS=131072
# RAW_AGENT_OUTPUT_RESERVE_TOKENS=16000
# RAW_AGENT_EPISODIC_TOKEN_BUDGET=   # 显式覆盖推导
# RAW_AGENT_COMPACT_TOKEN_THRESHOLD=

# 微压缩
RAW_AGENT_MICRO_COMPACT=1
RAW_AGENT_MICRO_COMPACT_KEEP_RECENT=3
RAW_AGENT_MICRO_COMPACT_MIN_CHARS=100
RAW_AGENT_MICRO_COMPACT_HARD_MAX_CHARS=12000

# Working log
RAW_AGENT_WORKING_LOG=1
RAW_AGENT_WORKING_LOG_TAIL_CHARS=4000

# Memory 后端
RAW_AGENT_MEMORY_BACKEND=agent   # session | dual

# Case 池（跨会话）
RAW_AGENT_CASE_GOVERNANCE=1
RAW_AGENT_CASE_CAPACITY=2000
RAW_AGENT_CASE_HALF_LIFE_DAYS=30
```

---

## 关键文件

| 路径 | 职责 |
|------|------|
| `runtime.ts` | autoCompact → prepare → appendix → turnShape → usage split |
| `session/micro-compact.ts` | 每轮模型视图折叠 |
| `session/session-budget.ts` | 窗口推导 + env 覆盖 |
| `session/working-log.ts` | append-only 外存 |
| `model/prompt-builder.ts` | `buildMemoryAppendix`（user 侧） |
| `model/episodic-selection.ts` / `cognitive-state.ts` | 可见历史子集 |
| `model/usage.ts` | `splitCumulativePromptTokens` |
| `memory/*` | AgentMemoryStore + bridge + backend |
| `evolving/case-governance.ts` | case decay / archive / capacity |

---

## 验收清单

- [ ] 超大 tool_result：落库完整，送模被折叠 / trim；有 `micro_compact` trace
- [ ] 只改 `RAW_AGENT_MODEL_CONTEXT_TOKENS`，compact/episodic 阈值随之变（未设显式覆盖时）
- [ ] working-log 文件删掉仍能跑 turn（appendix 为空）
- [ ] Memory appendix 出现在 user 消息侧，system stable 不含 memory
- [ ] `RAW_AGENT_MEMORY_BACKEND=session` 时回路仍可用旧表
- [ ] 累计报数网关下 `usage_cumulative_split` 出现，totals 不再按平方涨
