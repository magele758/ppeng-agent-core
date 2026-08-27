# @ppeng/agent-core 示例

嵌入方从这里开始最快；稳定 API 面与 env 契约见 [`doc/EMBEDDING_SDK.md`](../../../doc/EMBEDDING_SDK.md)。

在仓库根目录先执行 `npm run build`（或至少 `npx tsc -b packages/core`），再运行下方命令（工作目录可为任意路径；示例使用临时目录作为 `repoRoot` / `stateDir`）。也可一次跑完全部：`npm run test:examples`。

| 脚本 | 说明 |
|------|------|
| `node packages/core/examples/01-chat-session.mjs` | 聊天会话 + 启发式模型 |
| `node packages/core/examples/02-task-workspace.mjs` | 任务会话与独立工作区 |
| `node packages/core/examples/03-subagent.mjs` | `spawn_subagent` 同步子代理 |
| `node packages/core/examples/04-teammate-scheduler.mjs` | `spawn_teammate` + `runScheduler` |
| `node packages/core/examples/05-mailbox.mjs` | `sendMailboxMessage` 与收件箱 |
| `node packages/core/examples/06-approval.mjs` | 工具审批门禁 |
| `node packages/core/examples/07-custom-agent.mjs` | 自定义 `AgentSpec` |
| `node packages/core/examples/08-agent-loop.mjs` | 无 daemon：`@ppeng/agent-core/loop` 的 `createAgentLoop` + `step()` / `for await` / `steer()` / `fold()` |
| `node packages/core/examples/09-custom-wal-store.mjs` | 只用 L1：`@ppeng/agent-core/session` 的 `createMemorySurfaceStore` + `foldSurface` |
| `node packages/core/examples/10-turn-kernel-custom-store.mjs` | 只用 L3：自备 `createMemorySurfaceStore` + `runTurnKernel`（`@ppeng/agent-core/turn`），不 `new RawAgentRuntime` |

远程模型：配置环境变量（见仓库根目录 `.env.example`）并将示例中的 `HeuristicModelAdapter` 换为 `createModelAdapterFromEnv(process.env)`。
