# 01 — 目标与边界

> **本阶段目标**：先钉死「这个 agent 是自建循环引擎，不是 openai-agents 薄包装」，再谈包边界。

---

## 实现路径（必须先答）

**自建 Agent Loop，直接调 LLM API。** 不使用 `@openai/agents` / openai-agents-sdk-js。

证据与循环总览见置顶章：[`../00-self-built-agent-loop.md`](../00-self-built-agent-loop.md)。

| 是 | 不是 |
|----|------|
| 自有 `RawAgentRuntime` turn loop | `Runner.run(agent, …)` 一类 SDK 主循环 |
| `fetch` OpenAI-compatible / Anthropic HTTP | 把会话交给 openai-agents 托管 |
| 自有 tool-loop + 审批 + SQLite | 仅 chat completion 无工具环 |
| MCP SDK = 外部工具传输 | MCP ≠ agent runner |

---

## 产品边界

**ppeng-agent-core**：可部署的长跑 Agent 运行时（可靠性 / 上下文经济 / 可进化 / 可观测）。

```
packages/core/     # 循环真相源（唯一写 turn loop 的地方）
apps/daemon/       # HTTP/SSE，调用 runtime，不实现 loop
apps/web-console/  # Next Lab，消费 API
```

**硬规则**：主循环只住在 `packages/core`；Web/daemon 不得复制 tool 编排。

---

## 为何自建（摘要）

长跑引擎要一等公民地做：审批挂起、三层压缩、LoopGuard/Risk、Skills/Domain/Self-heal。绑官方 Agents SDK Runner 反而处处打补丁。协议兼容 OpenAI/Anthropic；**编排层自有**。详表见 [00](../00-self-built-agent-loop.md) §2。

---

## 本阶段验收

- [ ] 能明确回答：没用 openai-agents；循环在 `runtime.ts`。
- [ ] 能指出 tool 配对在 `runtime/tool-loop.ts`，模型 HTTP 在 `model/model-adapters.ts`。

**下一章**：[02-self-built-loop](02-self-built-loop.md)（核心章）
