# 01：目标、术语与边界

本章先确认系统边界，避免把 daemon、runtime、Web Console 和 eval 混成一层。

## 你要理解的对象

核心对象是 `RawAgentRuntime`。它接受一个已持久化的 session id，循环调用模型和工具，直到完成、等待审批、被取消或达到本次运行上限。

它不是 HTTP 服务。HTTP 服务在 `apps/daemon`，UI 在 `apps/web-console`，Evolution 在 `scripts/evolution*`。

## 包的职责

| 目录 | 负责 | 不负责 |
|---|---|---|
| `packages/core` | runtime、模型适配、工具、审批、会话、存储、恢复 | HTTP 路由、React UI |
| `apps/daemon` | runtime 初始化、HTTP、SSE、鉴权、周期调度 | 自己实现 model/tool loop |
| `apps/web-console` | 会话操作、流式展示、审批与运维界面 | 持有 daemon token、执行工具 |
| `scripts/agent-eval` | 启动隔离 daemon、执行 JSON case、写结果 | 真实模型质量评判 |
| `scripts/evolution*` | 研究、worktree、实现、测试、评审与合并门 | 单个对话 turn 的执行 |

## 三个同名概念

1. 日常所说的 Harness，多数指 `RawAgentRuntime` 周围的运行时能力。
2. `HARNESS_ARTIFACT_DIR` 指 `.raw-agent-harness/`，用于长任务角色交接。
3. `agent:eval` 是能力回归 harness，当前 fast cases 主要检查 HTTP 合约。

## 代码检查

打开这些文件并找到对应定义：

- `packages/core/src/runtime.ts`：`RawAgentRuntime`。
- `packages/core/src/types.ts`：`SessionMode`、`SessionStatus`、`HARNESS_ARTIFACT_FILES`。
- `apps/daemon/src/server.ts`：`new RawAgentRuntime(...)`。
- `apps/daemon/src/routes/sessions.ts`：`runtime.runSession(...)`。

完成后继续 [02 自建循环](02-self-built-loop.md)。
