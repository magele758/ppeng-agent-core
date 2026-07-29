# 00 — 自建 Agent Loop（不用 openai-agents）

> **一句话结论**：本仓库 **不依赖** `@openai/agents` / openai-agents-sdk-js。  
> Agent 循环由 `packages/core` **自行实现**：直接 `fetch` 调 LLM HTTP API（OpenAI-compatible chat/completions 或 `/responses`、Anthropic 等），再在 `RawAgentRuntime` 里跑 **turn → model → tool_call ↔ tool_result → 再 turn**。

这是 Harness 文档的**主叙事起点**。后面所有切片（压缩、审批、Skills、自愈…）都是叠在这条自建循环上的层，而不是 SDK 插件。

---

## 1. 代码事实：SDK 还是自建？

| 检查项 | 结果 |
|--------|------|
| `packages/core/package.json` 依赖 | **无** `@openai/agents`；有 `@modelcontextprotocol/sdk`（MCP 客户端，不是 agent runner） |
| 根 / workspaces `package.json` | **无** openai-agents 相关包 |
| 模型调用 | `packages/core/src/model/model-adapters.ts` 内 `fetch(.../chat/completions)` 或 `fetch(.../responses)` |
| 主循环 | `packages/core/src/runtime.ts` → `runSession` / `_runSessionInner` 的 `for (turn…)` |
| 工具环 | `packages/core/src/runtime/tool-loop.ts`（filter → approve → execute → redact → persist） |
| 停止语义 | 自有 `ModelTurnResult.stopReason: 'end' \| 'tool_use'`（`types.ts`） |

仓库内唯一命中 “openai-agents” 字样的是无关 digest/链接，**不是运行时依赖**。

**混合吗？** 否。MCP SDK 只用来挂外部工具；可选 `claude_code` / `codex_exec` / `cursor_agent` 是**本机 CLI 工具**，同样走自建 tool-loop，不是把会话交给 openai-agents Runner。

---

## 2. 为何不用 openai-agents-js？

官方 SDK 适合「在应用里快速挂 Agent + tools」。本仓库要的是**可部署的长跑引擎**，自建循环才能直接掌控：

| 能力 | 自建循环中的落点 | 若绑 SDK Runner 的摩擦 |
|------|------------------|------------------------|
| SQLite 会话 / 审批挂起 `waiting_approval` | runtime + approval store | 状态机与 SDK run 生命周期难对齐 |
| 三层上下文压缩 + prompt cache 四段 | session/* + prompt-builder | 难插入「只改送模视图、不改落库」 |
| LoopGuard / RiskEngine / 复读·空转 watchdog | recovery/* + streaming/* | 需包一层或 fork Runner |
| Domain / Skills / Self-heal / Swarm | 同进程叠层 | 多套编排语义冲突 |
| 多协议适配（chat / responses / Anthropic / hybrid VL） | 统一 `ModelAdapter` | 仍要自己做适配，循环收益有限 |

因此选型是：**协议层兼容 OpenAI/Anthropic HTTP，编排层 100% 自有**。

---

## 3. 自建循环如何工作

```
POST 消息 / runSession(sessionId)
        │
        ▼
┌──────────────── _runSessionInner ────────────────┐
│  for turn in 0 .. maxTurnsPerRun                 │
│    prepare context / systemPrompt                │
│    ModelAdapter.runTurnStream(messages, tools)   │
│         │                                        │
│         ├─ stopReason === 'tool_use'             │
│         │     → tool-loop 配对执行 tool_call     │
│         │     → append tool_result → 下一 turn   │
│         │                                        │
│         └─ stopReason === 'end'                  │
│               → hooks / goal gate / idle|done    │
│               → break                            │
│  maxTurns 耗尽 → idle（可再次 run，非 failed）     │
└──────────────────────────────────────────────────┘
```

### 3.1 与模型的边界

- Runtime **只**认 `ModelAdapter` + `ModelStreamChunk` + `ModelTurnResult`。
- Adapter 负责把历史/工具 schema 编成上游 JSON、解析 SSE/`tool_calls`，映射为内部 parts。
- `truncated` / `usage` / `requestId` 为**观测字段**；截断仍可 `stopReason: 'end'`，**不**因截断改写控制流。

### 3.2 tool_call ↔ tool_result 配对

- 模型产出 `ToolCallPart`（含 `toolCallId`）。
- tool-loop 必须为**每一个** call 写回结果（成功、失败、未知工具 `did_you_mean`、审批等待），避免下一轮 prompt 破损。
- 未知工具名：**不抛崩循环**，结构化错误进 result。

### 3.3 停止条件（控制面）

| 条件 | 行为 |
|------|------|
| `stopReason === 'end'` | 本轮无工具；走完成路径（chat → idle/completed；task/goal 另有逻辑） |
| `stopReason === 'tool_use'` | 执行工具后继续 turn |
| `signal.aborted`（stop API） | session → `failed` |
| `maxTurnsPerRun` 用尽 | → `idle`，可续跑 |
| `waiting_approval` | **退出**本次 dispatch，审批后再 `runSession` |
| LoopGuard / spin watchdog 等 | 视开关 abort 或 advisory 后收尾（fail-open 倾向） |

---

## 4. 关键代码入口

| 层级 | 路径 | 符号 / 说明 |
|------|------|-------------|
| 循环心脏 | `packages/core/src/runtime.ts` | `RawAgentRuntime.runSession`、`_runSessionInner`、`runTurnWithRetries` |
| 工具环 | `packages/core/src/runtime/tool-loop.ts` | 审批、分块并行（`maxParallelToolCalls`）、脱敏、落库 |
| 模型适配 | `packages/core/src/model/model-adapters.ts` | `fetch` → chat/completions 或 `/responses`；Anthropic；hybrid VL |
| 契约类型 | `packages/core/src/types.ts` | `ModelAdapter`、`ModelTurnResult.stopReason`、`ModelStreamChunk` |
| Prompt | `packages/core/src/model/prompt-builder.ts` | stable/dynamic 等 |
| HTTP 暴露 | `apps/daemon/src/routes/sessions.ts` 等 | 调 runtime，**不含** turn loop |
| 依赖声明 | `packages/core/package.json` | 可核对无 `@openai/agents` |

---

## 5. 与官方 Agents SDK 的差异边界

| 维度 | openai-agents-js（典型） | ppeng-agent-core |
|------|-------------------------|------------------|
| 循环所有权 | SDK `Runner` | 自有 `RawAgentRuntime` |
| 模型访问 | SDK provider 抽象 | 自有 adapter + 裸 `fetch` |
| 会话持久化 | 常由应用自管 | 一等公民 SQLite + parts |
| 人机审批 | 需自接 | `waiting_approval` + approval store |
| 扩展 | Agent/Tool 装饰器风格 | ToolContract + DomainBundle + Skills + hooks |
| 包名 | `@openai/agents` | `@ppeng/agent-core` |

**不会发生的事**：`import { Agent, run } from '@openai/agents'` 驱动主会话。

---

## 6. 接下来读什么

| 目的 | 文档 |
|------|------|
| 按实现顺序学（from-zero） | [`from-zero/README.md`](from-zero/README.md)（第 2 章即本循环展开） |
| HTTP→循环→SSE | [01-request-lifecycle](01-request-lifecycle.md) |
| 工具管线细节 | [03-tool-execution](03-tool-execution.md) |
| **运行时治理叠层**（watchdog / LoopGuard / Risk / Goal / turn_end） | [16-runtime-governance](16-runtime-governance.md) |
| 多模型/usage | [09-model-adapters](09-model-adapters.md) |

返回总纲：[`README.md`](README.md)。
