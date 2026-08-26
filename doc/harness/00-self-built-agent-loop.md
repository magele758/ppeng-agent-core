# 00 — Agent Loop 的所有权与执行路径

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

MCP SDK 用于接入外部工具。可选 `claude_code` / `codex_exec` / `cursor_agent` 也是 ToolContract，仍通过本项目的 tool-loop 执行。

---

## 2. 所有权边界

从当前代码能确认的是实现边界，而不是当初没有记录下来的选型过程：

| 能力 | 本仓库中的所有者 |
|---|---|
| Session 状态与 transcript | `SqliteStateStore` / stores |
| Turn 上限、停止与取消 | `RawAgentRuntime` |
| 工具筛选、审批与配对 | `runtime/tool-loop.ts` |
| 协议转换与 streaming | `ModelAdapter` 实现 |
| 压缩、恢复与 Goal Gate | `session/*`、`recovery/*`、`goal/*` |

如果未来引入第三方 runner，这些状态机仍需要明确由谁拥有，不能同时推进同一 session。

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
- tool-loop 最终必须为**每一个** call 写回成功或失败结果。等待审批时当前 dispatch 先退出，assistant tool call 暂时没有结果；批准或拒绝后续跑，才补齐配对。
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

## 5. 快速核验

不要靠文档标题判断依赖关系。运行 `rg '"@openai/agents"' --glob package.json` 核对依赖，再从 `apps/daemon/src/routes/sessions.ts` 的 `runtime.runSession` 跳到 `packages/core/src/runtime.ts`。这两步可以直接证明当前主会话由谁驱动。

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
