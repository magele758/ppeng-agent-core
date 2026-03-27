# @ppeng/agent-core 示例

在仓库根目录先执行 `npm run build`，再运行下方命令（工作目录可为任意路径；示例使用临时目录作为 `repoRoot` / `stateDir`）。

| 脚本 | 说明 |
|------|------|
| `node packages/core/examples/01-chat-session.mjs` | 聊天会话 + 启发式模型 |
| `node packages/core/examples/02-task-workspace.mjs` | 任务会话与独立工作区 |
| `node packages/core/examples/03-subagent.mjs` | `spawn_subagent` 同步子代理 |
| `node packages/core/examples/04-teammate-scheduler.mjs` | `spawn_teammate` + `runScheduler` |
| `node packages/core/examples/05-mailbox.mjs` | `sendMailboxMessage` 与收件箱 |
| `node packages/core/examples/06-approval.mjs` | 工具审批门禁 |
| `node packages/core/examples/07-custom-agent.mjs` | 自定义 `AgentSpec` |

远程模型：配置环境变量（见仓库根目录 `.env.example`）并将示例中的 `HeuristicModelAdapter` 换为 `createModelAdapterFromEnv(process.env)`。
