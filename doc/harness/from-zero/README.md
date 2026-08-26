# 从零理解并跑通 Agent Runtime

这是一条代码导读教程。读完后，你应该能从一个 HTTP 请求追到模型调用和工具结果落库，并能在本地跑起 daemon、Web Console 与 fast eval。

## 前置条件

- Node.js 22 或更高版本；版本约束见根 `package.json`。
- 已执行 `npm install`。
- 若调用真实模型，根目录 `.env` 已配置 provider；只跑单元测试和 fast eval 不需要真实模型。

## 先建立一张地图

```text
apps/daemon                 HTTP / SSE / auth / scheduler
        │
        ▼
packages/core
  RawAgentRuntime           会话与 turn loop
  PromptBuilder             stable system + dynamic context
  ModelAdapter              OpenAI-compatible / Responses / Anthropic / hybrid VL
  runtime/tool-loop         filter / approval / execute / persist
  storage + stores          SQLite 与文件资产
        │
        ▼
apps/web-console            Next.js Agent Lab，只消费 daemon API
```

## 学习顺序

| 章 | 读完能回答的问题 | 建议验证 |
|---|---|---|
| [01 目标与边界](01-goals-and-boundaries.md) | 哪一层负责什么？“Harness”有哪些含义？ | 找到各入口文件 |
| [02 自建循环](02-self-built-loop.md) | 一个 dispatch 为什么可能包含多个 model turn？ | 追 `runSession` |
| [03 模型适配器](03-model-adapters.md) | runtime 如何屏蔽不同模型协议？ | 查看 adapter factory |
| [04 工具与审批](04-tools-and-approval.md) | tool_call 如何保证有配对结果？ | 追 tool-loop 五阶段 |
| [05 会话与压缩](05-session-and-compact.md) | 落库历史和送模历史有什么区别？ | 跑 micro-compact 单测 |
| [06 Skills 路由](06-skills-routing.md) | 为什么先 shortlist 再 load？ | 查看 routing trace |
| [07 沙箱与恢复](07-sandbox-and-safety.md) | 执行隔离和循环治理分别在哪？ | 跑 sandbox / recovery 单测 |
| [08 Daemon API](08-daemon-and-api.md) | 如何建会话、发消息、流式运行？ | 用 curl 跑通 |
| [09 Web Console](09-web-console.md) | 浏览器如何在不拿 token 的情况下访问 daemon？ | `npm run dev` |
| [10 Eval Harness](10-eval-harness.md) | fast eval 实际验证什么、退出码是什么？ | `npm run agent:eval:fast` |
| [11 Evolution / Self-Heal](11-evolution-and-self-heal.md) | 哪些能力会改代码，哪些只编排会话？ | 查看入口与状态文件 |

## 最短实践路径

```bash
npm run build
npm run test:unit
npm run agent:eval:fast
```

`agent:eval:fast` 会拉起一个临时 daemon，强制使用 heuristic adapter，写入临时 state 目录，结束后清理进程和 state。结果追加到 `doc/eval-results/YYYY-MM-DD.jsonl`。

要看真实 UI：

```bash
npm run dev
```

默认情况下，daemon 监听 `127.0.0.1:37070`，Next Web Console 监听 `127.0.0.1:33815`；实际端口可由环境变量覆盖。

## 完成标准

不要以“读完文件”为完成。至少确认：

- 能指出 `apps/daemon/src/routes/sessions.ts` 调用 `RawAgentRuntime.runSession` 的位置。
- 能说明 assistant 没有 tool call、等待审批、超过 turn 上限时的不同结果。
- 能说明 micro-compact 为什么不会删 SQLite 中的原始 tool result。
- 能说出 fast eval 默认失败是否会返回非零退出码，以及 CI 应加哪个参数。
- 能区分 runtime、long-running harness 交接文件与 agent eval harness。

更细的专题参考见 [Harness 实现指南](../README.md)。
