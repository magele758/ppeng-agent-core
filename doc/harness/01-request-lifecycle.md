# 01 — 请求生命周期

> **设计目标**：从 HTTP 请求进入到 SSE 流式输出，整个路径必须满足三个约束——零框架依赖（无 Express/Koa）、流式优先（首 token 延迟 < 网关到模型的 RTT）、防并发安全（同一 session 不会被重入）。
>
> **前提**：会话编排是**自建** `RawAgentRuntime` 循环（不是 openai-agents）。总论见 [00-self-built-agent-loop](00-self-built-agent-loop.md)。

---

## 为什么不用 Web 框架？

选型决策：node:http 裸建 server。

**考虑过的方案**：
| 方案 | 优势 | 否决原因 |
|------|------|----------|
| Express | 生态丰富 | 中间件链对 SSE 长连接不友好；依赖膨胀 |
| Fastify | 性能好 | schema validation 对动态 payload 过于刚性 |
| Hono | 轻量 | 还是多一层抽象；对 node stream 控制不够直接 |
| **node:http 裸写** | **零依赖、完全控制 stream backpressure** | 路由手写（100 行解决） |

关键洞察：Agent daemon 不是传统 REST 服务——它 90% 的流量是 SSE 长连接，需要精确控制每个 chunk 的推送时机。框架的中间件模型反而是累赘。

---

## 入口层设计

```
client → HTTP → daemon server.ts → Router.dispatch → route handler
```

### Router 设计亮点

- **Path param 自动抽取**：`/api/sessions/:id/messages` → `ctx.params.id`，不需要 express-style 中间件
- **Body 懒加载**：`ctx.readBody()` 只在需要时读取——SSE endpoint 根本不需要 body parsing
- **统一 Auth**：`RAW_AGENT_AUTH_TOKEN` → Bearer 校验，空 token = 无鉴权（开发模式纯粹为了减少本地启动摩擦）；豁免 `/api/health`、`/api/readiness`、`/api/version`

### 核心路由

| Path | 职责 | 设计考量 |
|------|------|----------|
| `POST /api/sessions` | 创建 session + 可选 autoRun | autoRun 让客户端一次 HTTP 完成"建 + 跑"，减少交互轮次 |
| `POST /api/sessions/:id/messages` | 追加 user message + autoRun | 分离"存消息"和"触发运行"，但合并为一次调用减少延迟 |
| `POST /api/sessions/:id/stream` | SSE 模式 runSession | wire：`event: model\|result\|error`；chunk 见下表 |
| `POST /api/chat` / `/api/chat/stream` | 便捷对话 | 自动建/复用 session——给不想管 session 生命周期的客户端用 |
| `POST /api/sessions/:id/cancel` | abort 正在跑的 session | `runtime.cancelSession` → AbortController 传到 adapter |

---

## SSE 流设计

### 为什么是 SSE 而不是 WebSocket？

| | SSE | WebSocket |
|---|-----|-----------|
| 方向 | 服务端→客户端（够用） | 双向 |
| 重连 | 浏览器原生 | 需手写 |
| 代理友好 | Nginx/CDN 原生支持 | 需 upgrade |
| 复杂度 | 低 | 高 |

Agent 对话本质是"客户端发一条 → 服务端流式回复"，不需要双向实时。SSE 的简单性和重连能力是更好的选择。

### Chunk 类型设计

```ts
| { type: 'text_delta'; text }           // 正文增量
| { type: 'reasoning_delta'; text }      // 思考过程增量
| { type: 'tool_call_start'; toolCallId; name }    // 工具调用开始
| { type: 'tool_call_delta'; toolCallId; argumentsFragment }  // 工具参数增量
| { type: 'a2ui_message'; surfaceId; envelope }    // UI 渲染指令
| { type: 'done'; stopReason: 'end' | 'tool_use' } // 轮次结束
```

**设计决策**：把 reasoning 和 text 分开流——客户端可以选择折叠思考过程、只展示正文，而不需要解析混合文本。

---

## Runtime 主循环

`RawAgentRuntime.runSession(sessionId)` 是整个 Harness 的心脏。

### 防并发设计

```ts
// runningSessions: Map<sessionId, AbortController>
if (runningSessions.has(id)) throw ConcurrentSessionError;
runningSessions.set(id, controller);
try { ... } finally { runningSessions.delete(id); }
```

为什么不用锁？因为 Node.js 单线程——Map 的 has/set 是原子的。分布式场景下，session 绑定单个 daemon 实例（由上层负载均衡保证 sticky）。

### 一次 dispatch 的完整流程

```
runSession(id)
  ├─ 防并发检查
  └─ _runSessionInner
       ├─ 初始化 per-session 守护（6 个独立组件）
       │   ├─ SessionLoopGuard     — 跨轮死循环检测
       │   ├─ AdvisoryGrace        — abort → advise 降级缓冲
       │   ├─ AdvisoryQueue        — 多信号 advisory 合并队列
       │   ├─ RiskEngine           — 多信号风险评估器
       │   ├─ GoalGate             — 目标完成软闸门
       │   └─ ReasoningSpinWatchdog — 思考空转检测
       │
       ├─ for turn = 0..maxTurnsPerRun
       │   ├─ autoCompact（阈值触发，压缩历史）
       │   ├─ visibleMessages（episodic 选择可见子集）
       │   ├─ prepareMessagesForModel（图片 + refusal + 微压缩）
       │   ├─ buildSystemPrompt + appendix
       │   ├─ 工具面组装（external gate → allowlist → optional groups）
       │   ├─ runTurnWithRetries → ModelAdapter.runTurnStream
       │   ├─ [token split → cost → watchdog → loop guard]
       │   ├─ 处理 stopReason
       │   │   ├─ 'end' → hooks → goal gate → completion
       │   │   └─ 'tool_use' → tool loop → next turn
       │   └─ RiskEngine + advisory → AdvisoryQueue
       │
       └─ 超出 maxTurnsPerRun → status 'idle'（不是 failed）
```

### 为什么超时是 'idle' 而不是 'failed'？

因为 maxTurnsPerRun 只是"单次 dispatch 的预算"，不代表任务失败。客户端可以再次触发 runSession 继续——这支持"分段执行"模式（比如 CI 中每次只给 10 个 turn 的 budget）。

---

## 会话状态机

```
created → running → [idle | completed | failed | waiting_approval]
                      ↑         ↑
                  超出预算    goal achieved / mode=task complete
                  可恢复      终态

waiting_approval → running（审批后继续）
```

`background` 会话额外有 `autonomousScheduler` 唤醒逻辑——支持"agent 自己决定何时醒来执行下一步"的自主模式。

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

**关键设计约束**：SSE 和 store 写入是并行的——stream chunk 先推客户端，再异步落库。这保证了首 token 延迟不被数据库 IO 拖慢。

---

## 可验证行为

- `runningSessions` 让同一 session 的并发 `runSession` 调用复用在途 Promise。
- SSE 只负责传输当前运行的增量；断线后的消息补全来自持久化 session，而不是 SSE replay。
- daemon 重启后可读取 SQLite 中的 session，但不会自动恢复已中断的 provider stream。

这些行为分别由 `runtime.ts`、`routes/sessions.ts` 和 Web Console 的 session reload 逻辑验证；本文不提供没有基准结果支撑的延迟或可靠性数字。

暴露面（Next 代理、Lab UX、A2UI、Domain Agents）见 [19-surfaces-a2ui-domains](19-surfaces-a2ui-domains.md)。

---

## 关键文件

| 路径 | 职责 |
|------|------|
| `apps/daemon/src/server.ts` | HTTP server + 入口 |
| `apps/daemon/src/routing.ts` | 路由表 + path param |
| `apps/daemon/src/auth.ts` | Bearer 校验 |
| `apps/daemon/src/routes/sessions.ts` | stream / cancel / a2ui action |
| `apps/daemon/src/http-utils.ts` | SSE `sseInit` / `sseSend` |
| `packages/core/src/runtime.ts` | `runSession` 主循环 |
