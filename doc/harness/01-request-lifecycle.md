# 01 — 请求生命周期

从 HTTP 进入到 SSE 流式输出的完整路径。

---

## 入口层 (`apps/daemon/`)

```
client → HTTP → daemon server.ts → Router.dispatch → route handler
```

- **`server.ts`**：`node:http` 直接建 server，不依赖框架。CORS / body-size / auth 由 `Router` 统一处理。
- **`routing.ts`**：`/api/:pattern` 风格路由表，path param 自动抽取，`RouteContext` 提供 `readBody()` / `requireParam()`。
- **Auth**：`RAW_AGENT_AUTH_TOKEN` → Bearer 校验（`auth.ts`），空 token = 无鉴权（开发模式）。

### 关键 route

| Path | 说明 |
|------|------|
| `POST /api/sessions` | 创建 session + 可选 autoRun |
| `POST /api/sessions/:id/messages` | 追加 user message + autoRun |
| `POST /api/sessions/:id/stream` | SSE 模式 runSession |
| `POST /api/chat` / `/api/chat/stream` | 便捷对话（自动建/复用 session） |
| `POST /api/sessions/:id/stop` | abort 正在跑的 session |

### SSE 流

`streamRun()` 调 `runtime.runSession(id, { onModelStreamChunk })` 并把每个 `ModelStreamChunk` 经 `sseSend(response, 'model', chunk)` 推送。Chunk 类型：

```ts
| { type: 'text_delta'; text }
| { type: 'reasoning_delta'; text }
| { type: 'tool_call_start'; toolCallId; name }
| { type: 'tool_call_delta'; toolCallId; argumentsFragment }
| { type: 'a2ui_message'; surfaceId; envelope }
| { type: 'done'; stopReason: 'end' | 'tool_use' }
```

---

## Runtime 主循环 (`packages/core/src/runtime.ts`)

`RawAgentRuntime.runSession(sessionId)` 是整个 Harness 的心脏。

### 一次 dispatch 内做什么

```
  runSession(id)
    ├─ 防并发（runningSessions Map）
    └─ _runSessionInner
         ├─ 初始化每一个 per-session 守护
         │   ├─ SessionLoopGuard (repetition / tool-fail streak)
         │   ├─ AdvisoryGrace (abort → advise 降级)
         │   ├─ AdvisoryQueue (multi-signal queue → next-turn system msg)
         │   ├─ RiskEngine (multi-signal risk scorer)
         │   ├─ GoalGate (soft completion gate)
         │   └─ ReasoningSpinWatchdog (reasoning-only streak)
         │
         ├─ for turn = 0..maxTurnsPerRun
         │   ├─ autoCompact (threshold-driven summary + archive)
         │   ├─ visibleMessages (episodic / cognitive selection)
         │   ├─ prepareMessagesForModel (images + refusal + micro-compact)
         │   ├─ buildSystemPrompt + appendix
         │   ├─ tool-face assembly (external gate → agent allowlist → optional groups → toolset lock)
         │   ├─ runTurnWithRetries → ModelAdapter.runTurnStream
         │   ├─ [cumulative token split → cost → spin watchdog → loop guard]
         │   ├─ 处理 stopReason
         │   │   ├─ 'end' → hooks → goal gate → handleTurnCompletion
         │   │   └─ 'tool_use' → tool loop (→ next turn)
         │   └─ RiskEngine + evolving advisory → AdvisoryQueue
         │
         └─ 超出 maxTurnsPerRun → status 'idle'
```

### 会话状态机

```
created → running → [idle | completed | failed | waiting_approval]
                      ↑         ↑
                  tool approve   goal achieved / mode=task complete
```

`background` 会话额外有 `autonomousScheduler` 唤醒逻辑。

---

## 数据流方向

```
        ┌─ HTTP req ─┐
        │            ▼
 client ←── SSE ←── runtime.runSession
                       │
          ┌────────────┼──────────┐
          ▼            ▼          ▼
    SQLite store   Trace events  Working log (fs)
    (messages,     (trace.ts     (working-log.ts
     sessions,      → JSONL       → md file)
     tasks…)        or cloud)
```
