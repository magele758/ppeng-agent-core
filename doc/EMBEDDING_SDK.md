# 把 @ppeng/agent-core 作为可嵌入 SDK

**状态**：P0（契约与发布元数据）。本页只描述**第三方嵌入场景**（在自己的 Node.js 进程里 `new RawAgentRuntime(...)`），不涉及 `apps/daemon`（HTTP 服务）、`apps/cli`、`apps/desktop`——那些是 core 的**消费者**，供参考实现，不是嵌入前提。

与 [`ARCHITECTURE.md`](ARCHITECTURE.md)（内部模块划分）和 [`ROADMAP.md`](ROADMAP.md#3-p0基础能力当前仓库主轴)（P0 退出标准：单仓可重复构建/测试/发布，领域包可独立版本化接入且不改 core）对齐。

---

## 1. 安装与构建

仓库内（workspace 依赖）：

```bash
npm install
npx tsc -b packages/core   # 或根目录 npm run build（连带 daemon/cli/web-console）
```

产物：`packages/core/dist/*.js` + `.d.ts`。`package.json` 的 `files` 只打包 `dist/`、`examples/`、`README.md`、`CHANGELOG.md`——发布到 npm 时不含 `src/`、`test/`。

**Node 版本**：`engines.node >= 22`（`packages/core/src/storage.ts` 依赖 `node:sqlite`，Node 22 起可用；Node < 22 无法运行）。

---

## 2. 稳定公开面（Public API surface）

以下符号是**嵌入方应该依赖**的契约；其余一切（`stores/*`、`storage.ts` 内部类如 `SqliteStateStore`、`sandbox/*` 具体实现、`self-heal/*` 执行细节等）视为**内部实现，可能无预警变更**，即使目前从 `src/index.ts` 被 `export *` 出去。判断标准：下表未列出的导出，优先通过 `RawAgentRuntime` 的公开方法访问，不要直接构造/持有内部 store。

### 2.1 运行时入口

| 符号 | 来源 | 说明 |
|------|------|------|
| `RawAgentRuntime` | `runtime.ts` | 唯一入口类；构造后即拥有会话/任务/审批/工具/追踪等全部能力 |
| `RuntimeOptions` | `runtime.ts` | 构造参数：`repoRoot`、`stateDir`（必填）；`modelAdapter`、`agents`/`tools`（整体替换内置集）、`extraAgents`/`extraTools`/`extraSkills`（叠加内置集，**领域包应使用这三个**）、`maxParallelToolCalls`、`extensions`、`eventBufferRepository`、`tieredAssetStorage`、`cloudSkillsLoader` |

### 2.2 会话生命周期（`RawAgentRuntime` 方法）

| 方法 | 说明 |
|------|------|
| `createChatSession({ title?, message?, agentId?, imageAssetIds?, background?, metadata? })` | 创建聊天会话，返回 `SessionRecord` |
| `createTaskSession({ title, description?, message?, agentId?, blockedBy?, metadata? })` | 创建任务会话 + 独立工作区（`git-worktree` / `directory-copy`） |
| `createTeammateSession({ name, role, prompt, ... })` | 创建后台队友会话（配合 `runScheduler()`） |
| `sendUserMessage(sessionId, message, options?)` | 向已有会话追加用户消息 |
| `runSession(sessionId, options?)` | 驱动一轮工具循环直到 `end` / 等待审批 / 出错；返回最新 `SessionRecord` |
| `getLatestAssistantText(sessionId)` | 取最近一条 assistant 文本（便于快速拿结果） |
| `getSession(sessionId)` / `listSessions()` / `getSessionMessages(sessionId)` | 读取会话/消息 |
| `cancelSession(sessionId)` | 中断正在运行的会话 |
| `approve(approvalId, 'approved' \| 'rejected')` | 批准/拒绝待审批工具调用 |
| `listTraceEvents(sessionId, limit?)` | 读取该会话的 trace 事件（观测） |
| `runScheduler()` | 驱动后台队友/自治会话的一次调度 tick |
| `listAgents()` / `ensureBuiltinAgentsSynced()` | 读取当前可用 `AgentSpec` 列表 |
| `destroy()` | 释放底层资源（关闭 store 等），进程退出前建议调用 |

完整方法清单以 `packages/core/src/runtime.ts` 上的公开（非 `private`）方法为准；上表覆盖嵌入方 90% 场景。

### 2.3 扩展契约（写 Domain Bundle / 自定义工具时使用）

| 符号 | 来源 | 说明 |
|------|------|------|
| `AgentSpec` | `types.ts` | 一个 Persona：`id/name/role/instructions/capabilities`；可选 `allowedTools`（最小权限 scoping）、`domainId`、`harnessRole` |
| `ToolContract<Args>` | `types.ts` | 一个工具：`name/description/inputSchema/approvalMode/sideEffectLevel/execute(context, args)` |
| `ModelAdapter` | `types.ts` | 模型抽象：`runTurn` 必需，`runTurnStream`/`completeText` 可选 |
| `DomainBundle` | `domain.ts` | `{ id, label, agents, tools, skills? }`，配合 `mergeDomainBundles()` 挂载；详见 [`DOMAIN_AGENTS.md`](DOMAIN_AGENTS.md) |
| `SkillSpec` | `types.ts` | 技能（可被 skill 路由发现/加载） |
| `createModelAdapterFromEnv(env)` | `model/model-adapters.ts` | 从环境变量构造 `heuristic` / `openai-compatible`（含可选 VL hybrid）/ `anthropic-compatible` 适配器；见下文 §3 |
| `HeuristicModelAdapter` | `model/model-adapters.ts` | 无需任何密钥的规则式适配器，测试/CI/示例默认用它 |

### 2.4 浏览器安全子路径

`@ppeng/agent-core` 主入口是 **Node-only**（依赖 `node:sqlite`/`node:fs` 等），不要在浏览器 / Next.js 客户端组件里 `import`。若只需要 HTTP 视图类型或会话列表过滤，用轻量包 `@ppeng/api-types`（core 仍从主入口 / `./session-query` 再导出以兼容旧代码）：

```ts
import { filterSessionsByQuery, type ApiSessionSummary } from '@ppeng/api-types';
```

该子路径无 Node-only 依赖，`apps/web-console` 的客户端组件即这样使用。

---

## 3. Embed env 契约（最少需要）

嵌入方通常**不需要**产品全集 `.env.example`（daemon 端口、Evolution、Self-heal、部署相关变量与嵌入场景无关）。真正影响 `RawAgentRuntime` 行为、值得关心的最小集合：

| 变量 | 必填 | 说明 |
|------|------|------|
| `RAW_AGENT_MODEL_PROVIDER` | 否（默认 `heuristic`） | `heuristic`（无需密钥，规则式，适合测试）\| `openai-compatible` \| `anthropic-compatible` |
| `RAW_AGENT_BASE_URL` | `openai-compatible` 时必填 | 例如 `https://api.openai.com/v1` |
| `RAW_AGENT_API_KEY` | 非 heuristic 时必填 | |
| `RAW_AGENT_MODEL_NAME` | 非 heuristic 时必填 | 例如 `gpt-4o-mini` |
| `RAW_AGENT_ANTHROPIC_URL` | `anthropic-compatible` 时必填（或用 `RAW_AGENT_BASE_URL` 兜底） | |
| `RAW_AGENT_USE_JSON_MODE` | 否（默认开） | 第三方不支持 `response_format` 时设 `0` |
| `RAW_AGENT_VL_MODEL_NAME` | 否 | 设置后自动启用 hybrid VL 路由（含图消息走 VL） |

> `repoRoot` / `stateDir` **不是**环境变量，是 `RuntimeOptions` 构造参数，由嵌入方显式传入（例如你自己的应用数据目录），SDK 本身不读 `RAW_AGENT_STATE_DIR`（那是 `apps/daemon` 的约定）。

其余以 `RAW_AGENT_*` 为前缀的开关（微压缩、LoopGuard、RiskEngine、Working log、Prompt-cache、Sandbox 模式……）都有安全默认值，**不设置即可正常工作**；需要精调时查完整索引 [`ENV_REFERENCE.md`](ENV_REFERENCE.md) 或 [`.env.example`](../.env.example)。

最小示例：

```ts
import { RawAgentRuntime, createModelAdapterFromEnv } from '@ppeng/agent-core';

const runtime = new RawAgentRuntime({
  repoRoot: '/path/to/your/workspace',
  stateDir: '/path/to/your/app-state',
  modelAdapter: createModelAdapterFromEnv(process.env) // 或直接 new HeuristicModelAdapter()
});

const session = runtime.createChatSession({ message: 'hello' });
await runtime.runSession(session.id);
console.log(runtime.getLatestAssistantText(session.id));
```

---

## 4. Examples

`packages/core/examples/` 是嵌入方的最小可运行参考（全部用 `HeuristicModelAdapter` 或脚本化适配器，不依赖真实 API key）：

| 脚本 | 覆盖场景 |
|------|----------|
| `01-chat-session.mjs` | 最小聊天会话（推荐先看这个） |
| `02-task-workspace.mjs` | 任务会话 + 独立工作区 |
| `03-subagent.mjs` | `spawn_subagent` 同步子代理 |
| `04-teammate-scheduler.mjs` | `spawn_teammate` + `runScheduler()` |
| `05-mailbox.mjs` | 收件箱消息投递 |
| `06-approval.mjs` | 工具审批门禁 |
| `07-custom-agent.mjs` | 自定义 `AgentSpec`（最贴近「接自己业务 Persona」的用法） |

本地验收：

```bash
npx tsc -b packages/core   # 先构建，示例读 dist/
npm run test:examples      # 依次跑全部 7 个示例，任一非 0 退出即失败
```

`test:examples` 未接入 `npm run ci`（避免与其他子进程测试重复拉起临时状态目录），但会在本地/PR review 时按需手动跑；纳入完整门禁前会先观察其稳定性。

---

## 5. 未稳定 / 内部（不要依赖）

- `packages/core/src/stores/*`、`storage.ts`（`SqliteStateStore` 等具体存储类）：通过 `runtime` 的公开方法访问，不要直接实例化或类型引用。
- `sandbox/*` 具体 Provider 实现（`os-sandbox.ts` 等）：通过 `RuntimeOptions` 或环境变量（`RAW_AGENT_SANDBOX_MODE`）配置，不要直接 import 具体类。
- `self-heal/*` 执行细节、`evolving/*`（case governance / shadow coach 内部结构）、`orchestrator/*`、`swarm/*`、`memory/*`、`deepresearch/*` 的存储层：这些子系统的**顶层类型**（见各自 `index.ts` 的导出）可以用，但存储/调度内部实现仍可能重构。
- `apps/daemon` 专属环境变量（端口、CORS、认证 token、限流……）：嵌入方不经过 HTTP，不需要关心。

---

*Last updated: 2026-07-29*
