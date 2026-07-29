# 从 0 理解 / 复现 ppeng-agent-core

## 先看结论（用户常问）

| 问题 | 答案 |
|------|------|
| 用了 `@openai/agents` / openai-agents-sdk-js 吗？ | **没有。** `packages/core/package.json` 无此依赖。 |
| Agent 怎么跑起来的？ | **自建循环**：直接 `fetch` LLM API + `RawAgentRuntime` turn loop + `tool-loop`。 |
| Harness 里哪章讲这个？ | 置顶 **[`../00-self-built-agent-loop.md`](../00-self-built-agent-loop.md)**，本系列第 2 章展开实现细节。 |

其余章节都是这条自建循环上的叠层（压缩、Skills、沙箱、daemon、Lab、eval、演进），不是另一套 SDK 教程。

---

## 阅读顺序

| # | 章节 | 主线角色 | 深读（纵向切片） |
|---|------|----------|------------------|
| — | [**00 自建 Agent Loop（总入口）**](../00-self-built-agent-loop.md) | **必读**：SDK vs 自建、循环图、停止条件、关键路径 | — |
| 1 | [01-goals-and-boundaries](01-goals-and-boundaries.md) | 引擎边界；为何自建而非绑 SDK | — |
| 2 | [02-self-built-loop](02-self-built-loop.md) | **核心章**：turn / tool_call↔result / 停止条件 / 入口 | [16](../16-runtime-governance.md) |
| 3 | [03-model-adapters](03-model-adapters.md) | 自建循环的「模型边」：裸 HTTP 适配 | [18](../18-model-tools-sandbox.md) |
| 4 | [04-tools-and-approval](04-tools-and-approval.md) | 自建循环的「工具边」：审批与配对 | [16](../16-runtime-governance.md) / [18](../18-model-tools-sandbox.md) |
| 5 | [05-session-and-compact](05-session-and-compact.md) | 叠层：会话与压缩 | [17](../17-context-memory-compaction.md) |
| 6 | [06-skills-routing](06-skills-routing.md) | 叠层：Skills | [18](../18-model-tools-sandbox.md)（工具面） |
| 7 | [07-sandbox-and-safety](07-sandbox-and-safety.md) | 叠层：沙箱与兜底 | [16](../16-runtime-governance.md) / [18](../18-model-tools-sandbox.md) |
| 8 | [08-daemon-and-api](08-daemon-and-api.md) | 暴露面：HTTP/SSE（不含 loop） | [19](../19-surfaces-a2ui-domains.md) |
| 9 | [09-web-console](09-web-console.md) | 暴露面：Next Lab | [19](../19-surfaces-a2ui-domains.md) |
| 10 | [10-eval-harness](10-eval-harness.md) | 质量：`agent:eval` | [20](../20-orchestration-evolution-eval.md) |
| 11 | [11-evolution-and-self-heal](11-evolution-and-self-heal.md) | 演进：Evolution / Self-heal | [20](../20-orchestration-evolution-eval.md) |

合章速链：治理 [16](../16-runtime-governance.md) · 上下文/Memory [17](../17-context-memory-compaction.md) · 模型/工具/沙箱 [18](../18-model-tools-sandbox.md) · 暴露面 [19](../19-surfaces-a2ui-domains.md) · 编排/Eval [20](../20-orchestration-evolution-eval.md)。

**最少路径**：`00` → `01` → `02` → `03` → `04`。读完即掌握「自己搓 agent」主线。

纵向切片（按能力深挖）见 [`../README.md`](../README.md)；总手册 [`../../README.md`](../../README.md)。
