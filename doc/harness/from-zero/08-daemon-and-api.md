# 08 — Daemon 与 HTTP/SSE API（暴露面）

> **要点**：Daemon **调用**自建 `RawAgentRuntime.runSession`，**不**引入 openai-agents，也**不**在路由里实现 turn loop。  
> **本阶段目标**：鉴权、会话 CRUD、SSE、调度。
---

## 职责边界

| 做 | 不做 |
|----|------|
| `node:http` 路由 + SSE | Express/Koa 中间件栈（刻意裸写，控 stream） |
| Bearer：`RAW_AGENT_AUTH_TOKEN`（空=开发无鉴权） | 在浏览器暴露 token |
| 周期调度（~1.5s `runScheduler`） | 在路由里复制工具执行逻辑 |
| `/` stub 页 | 托管完整 Lab UI（已迁 Next） |

入口：`apps/daemon/src/server.ts`、`routing.ts`、`routes/*`。鉴权：`auth.ts`（仅 `/api/*`；豁免 `/api/health`、`/api/readiness`、`/api/version`）。

---

## 核心路由（实现时优先）

| Path | 职责 |
|------|------|
| `POST /api/sessions` | 建会话，可选 autoRun |
| `POST /api/sessions/:id/messages` | 追加 user + 可选 autoRun |
| `POST /api/sessions/:id/stream` | SSE `runSession`（wire：`model` / `result` / `error`） |
| `POST /api/chat` / `/api/chat/stream` | 便捷对话（自动建/复用 session） |
| `POST /api/sessions/:id/cancel` | `runtime.cancelSession`（AbortController） |
| `GET /api/health` / `/api/readiness` | 存活 vs 就绪（sqlite/写探测） |
| 审批 / tasks / mailbox / self-heal / evolution / orchestration / research / memory / swarm | 按能力挂载 |

图片：`.../images/ingest-base64`、`.../fetch-url`；A2UI action：`.../a2ui/action`。

Domain 加载：`apps/daemon/src/domain-loader.ts` + `RAW_AGENT_DOMAINS`（无独立 domain HTTP 资源）。

表面层深读（SSE wire、A2UI、Domain、Lab 代理）：[19-surfaces-a2ui-domains](../19-surfaces-a2ui-domains.md)。

---

## 从 0 实现顺序

1. 健康检查 + 鉴权中间层。
2. sessions CRUD + messages。
3. 非流式 `runSession` → 再 SSE（chunk 映射到 event stream）。
4. stop / approvals。
5. scheduler（background / self-heal tick 等）。
6. 其余资源路由按需加。

本地：`npm run dev:daemon`；改 `packages/core` 后需 `npx tsc -b packages/core`。推荐 `npm run dev` / `dev:lab` 并行起 daemon+Next。

---

## 本阶段验收

- [ ] curl 建 session、发消息、收到 assistant 文本。
- [ ] SSE 能看到 text_delta；stop 能中断进行中的 run。
- [ ] 设置 `RAW_AGENT_AUTH_TOKEN` 后无 Bearer 返回 401。

**深读**：[01-request-lifecycle](../01-request-lifecycle.md)、[15-observability](../15-observability.md)、[`ARCHITECTURE.md`](../../ARCHITECTURE.md)  
**下一章**：[09-web-console](09-web-console.md)
