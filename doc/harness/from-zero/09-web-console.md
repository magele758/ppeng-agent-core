# 09 — Web Console（Agent Lab）（暴露面）

> **要点**：Lab 只消费自建循环经 daemon 暴露的 REST/SSE；前端无 agent runner。  
> **本阶段目标**：Next.js 15 App Router；同源 `/api/*` 代理到 daemon。
---

## 架构事实

```
浏览器 → Next (apps/web-console) → middleware 代理 /api/*
                              → DAEMON_PROXY_TARGET (默认 http://127.0.0.1:37070)
```

- 入口：`app/page.tsx` → `components/AgentLabApp.tsx`
- 库：`lib/api.ts`、`sse.ts`、`chat-utils.ts`、`markdown.ts`、`types.ts`
- 组件：`ChatTurns.tsx`、`TeamGraph.tsx`、`a2ui/*` 等
- 若 Next 进程设与 daemon **相同**的 `RAW_AGENT_AUTH_TOKEN`，middleware **服务端**补 `Authorization: Bearer`（浏览器不暴露）

开发端口：Next 默认 `http://127.0.0.1:33815`；`npm run dev:lab` 会先加载根 `.env` 再并行起两端。

---

## UI 约定（本仓库已形成的产品行为）

实现 Lab 时应对齐（见根 `AGENTS.md`）：

- 默认流式 `useStream=true`（`components/usePlayChat.ts`）
- 发送：先乐观用户气泡 + 助手占位 `…` 并滚动 → `clearComposerOnly()` → 再 await 请求
- 会话列表自动刷新保留滚动、减轻整页跳动（`AgentLabApp` scroll snapshot）
- thinking 历史默认折叠、流式展开；工具结果默认折叠（`ChatTurns.tsx`）
- 助手正文 Markdown 渲染（`lib/markdown.ts`）
- SSE：`lib/sse.ts` 的 `feedSseBuffer` + fetch POST（非 EventSource）

---

## 从 0 实现顺序

1. Next 脚手架 + middleware 代理 `/api/*`。
2. 会话列表 + 选中会话拉 messages。
3. Composer + 乐观更新 + SSE 消费（text / reasoning / tool / a2ui_message）。
4. Ops / Trace / 审批等面板按 API 增量加。
5. A2UI surface 渲染（若启用 `RAW_AGENT_A2UI_ENABLED`）。

E2E：`npm run test:e2e`（临时 daemon+Next、随机 token；断言直连 daemon 401 / 经 Lab 200）。

---

## 本阶段验收

- [ ] 浏览器只请求 Lab 源，不直连 daemon 带 token。
- [ ] 发送后输入清空，用户消息立即可见，流式增量更新助手气泡。
- [ ] 刷新列表不丢侧栏滚动位置。

**相关**：[`ARCHITECTURE.md`](../../ARCHITECTURE.md) §3.2、[`A2UI.md`](../../A2UI.md)、[19-surfaces-a2ui-domains](../19-surfaces-a2ui-domains.md)  
**下一章**：[10-eval-harness](10-eval-harness.md)
