---
name: agent-loop
description: Embeddable agent loop core SDK (@ppeng/agent-loop / @mage-ai-lab/agent-loop) providing turn kernel, model adapters, streaming watchdogs, loop guards, session state, and assembly presets (mini, normal, full, max). Use when: (1) Integrating or embedding the agent loop into an application or service, (2) Developing, modifying, or testing packages/agent-loop, (3) Assembling an agent loop using createAssembledLoop or createMiniAssembledLoop, (4) Managing mid-run steering, step-level control, or event folding via AgentLoopHandle, (5) Adding or configuring loop modules, watchdogs, or model adapters.
---

# @ppeng/agent-loop SDK 指南

`@ppeng/agent-loop`（公开发布名 `@mage-ai-lab/agent-loop`）是无外部服务端依赖的可嵌入 Agent 循环内核，提供**单轮 Turn 推进、模型适配器调用、流式退化守卫（Watchdog）、故障自愈与人工审批（HITL）、以及会话步进转向（Steering）**。

源码目录：[`packages/agent-loop`](file:///Users/penglei/developer/self-test-grounding/ppeng-agent-core/packages/agent-loop)

---

## 1. 装配档位与分层规范

SDK 提供 4 个组装档位（高档位包含所有低档位模块）：

| 档位 | 运行平台 | 模块包含 | 入口子路径 |
|:---|:---|:---|:---|
| **`mini`** | 浏览器 / WebWorker / 插件 / Node | **纯静态、零 Node 内置依赖**。含 kernel、内存 store、故障恢复、HITL 门闩、上下文打包。 | `@ppeng/agent-loop/mini` |
| **`normal`** | Node.js | + 默认工具循环、权限模式、脏输入拦截、内存补偿、模型适配器、自动微压缩。 | `@ppeng/agent-loop/normal` |
| **`full`** | Node.js | + 审计事件流（event-log/stepTx）、working-log、富文本视图裁剪（prepare-view）、上下文附录、L4 句柄。 | `@ppeng/agent-loop/full` |
| **`max`** | Node.js (产品默认) | + PTC（动态代码编排/vm）、Shell 策略守护、超长工具结果拦截归档（guardian）、Vault/OTel/CBOM。 | `@ppeng/agent-loop/max` |

> 完整 26 个模块矩阵与 `AssembledLoopIo` 注入端口定义见 [modules-and-ports.md](references/modules-and-ports.md)。

### 开发者红线（Hard Constraints）
- **Mini 纯净性**：`src/mini.ts` 及其依赖链路中**绝对禁止引入任何 Node 内置模块**（`node:fs`、`node:sqlite`、`node:child_process`、`node:vm` 等）。所有 Node 重模块必须标记 `nodeOnly: true` 并使用动态 `import()` 加载。
- **类型单一切实来源（SSOT）**：循环层的类型以 `src/types.ts` 为唯一真源，上层（如 `packages/core`）只做 re-export，禁止重复声明导致类型分叉。
- **Watchdog 守卫正交性**：轮内复读（repetition）与思考空转（reasoning-spin）Watchdog 统一包裹在 `runtime/tool-loop.ts` 的 `runTurnWithRetries` 外层，**严禁将 Watchdog 逻辑塞进各具体的 ModelAdapter 中**。
  - `runTurnWithRetries(host, adapter, input, onStream, opts?)` 的可选 `opts.maxRetries` 只能**下调**（取 `min(RAW_AGENT_MODEL_MAX_RETRIES, opts.maxRetries)`，可为 0）；产品层的模型备选链用它限制备选前的叠加重试，不传则行为不变。

---

## 2. 嵌入使用范式（Consumer Usage）

### 2.1 组装式调用（`createAssembledLoop`）

```ts
import { createAssembledLoop } from '@ppeng/agent-loop/assembly';
import { OpenAiChatAdapter } from '@ppeng/agent-loop/model';

// 1. 根据需求选择档位组装
const loop = await createAssembledLoop({
  preset: 'normal', // 'mini' | 'normal' | 'full' | 'max'
  io: {
    model: new OpenAiChatAdapter({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'gpt-4o'
    }),
    tools: [
      {
        name: 'fetch_weather',
        description: 'Query weather for a city',
        inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
        execute: async (_ctx, args) => ({ ok: true, content: `${args.city}: Sunny, 22°C` })
      }
    ]
  }
});

// 2. 创建并运行会话句柄（L4）
const handle = loop.createAgentLoop('session-101');

// 3. 异步迭代驱动，支持事件监控与中途转向（Mid-run steering）
for await (const event of handle) {
  if (event.type === 'model_done') {
    // 可选：在模型产出后动态注入修正指令
    // await handle.steer('注意：优先输出摄氏度');
  }
}

// 4. 获取折叠后的完整结构化消息
const messages = await handle.fold();
```

### 2.2 浏览器 / 扩展轻量级嵌入（`createMiniAssembledLoop`）

```ts
import { createMiniAssembledLoop } from '@ppeng/agent-loop/mini';

const miniLoop = createMiniAssembledLoop({
  io: {
    model: customWebWorkerModelAdapter,
    tools: [inBrowserTool]
  }
});

const runInfo = await miniLoop.runSession('session-web-1');
```

### 2.3 可选宿主钩子

- `checkToolApprovals` / `resolveTurnTools` 可以返回同步结果，也可以返回 `Promise`。内核会 `await`。
- `buildMemoryAppendix` 也可以返回 `string | Promise<string>`（附录编译含异步 I/O 时）。
- `beforeModelTurn?`（mini 可不实现）：主模型调用前；返回 `skip_goal_done` 时跳过深模型并以目标已完成收尾（不伪造 assistant 正文）。
- `chooseRecovery?`（mini 可不实现）：在内核已有的离散恢复动作中择一；返回 `null`/非法 id 则保持硬编码路径。
- **PTC `resolveJevHooks?`（`createPtcExecTool` 依赖，仅 max/`node:vm` 路径）**：宿主可在每次 `ptc_exec` 时返回 `{ noul(instructions), choice(instructions, options) }`，注入到沙箱全局 `jev`；返回 `undefined` 则**完全不注入** `jev`。SDK **禁止**静态 import Jev HTTP 客户端（尤其 mini 链路）。产品侧仅在 Jev `profile=custom` 且勾选 `ptcDecide`、已保存 baseUrl 时由 `packages/core` 提供实现（复用 `askJev`）。

Jev 不是 SDK 模块：未配置入口时宿主不调用它，SDK 接入参数里也不出现 Jev 客户端。

### Responses 流终止与回归契约

- `OpenAiResponsesAdapter.runTurnStream` 接受 `response.completed` / `response.done` / `response.incomplete`；不完整响应保留已有文本、`usage`、`finishReason` 与 `truncated`。兼容网关终止帧省略 `output` 时，继续使用累计分片，不能丢掉终止帧的用量与截断信息。
- `response.failed` / `response.cancelled`（以及终止帧中的对应 status）必须抛错，不能伪装成成功的空回答。重试仍由上层 tool-loop 负责，不在 adapter 内新增重试。
- 与共享适配器重构合并后，上述处理集中在 SDK 的 Responses 事件 handler / `finishResponsesStream`；core 保持薄 shim。终止帧有实际内容（含兼容字段 `output_text`）时优先采用，否则保留累计分片并合并终止元数据。
- `rewindUncommittedTail` 以带 `seq` 的折叠可见消息判断是否仍有尾部；不能把 `hideRange` 自己追加的 WAL 控制行当成新尾部，重复恢复必须幂等。不提供消息 `seq` 的自定义宿主保留物理 WAL head 的保守回退。
- SDK 单测包含 `src/model/responses-terminal.test.ts`。跨 SDK/core 的分片、工具参数、重复终止帧、HTTP 错误和取消契约由根目录 `scripts/test/responses-protocol.test.mjs` 检查（先构建，随后 `npm run test:unit`）。
- 公开 npm 包另跑 `npm run test:package`：改 scope 后打 tarball、隔离安装、校验所有 exports/类型解析、mini 静态依赖闭包和实际 mini 会话。发布脚本只发布同一批验证过的 tarball；不以 workspace 内导入成功代替产物验收。

观测也在宿主侧。内核只调用 `emitTrace`。`packages/core` 把这些事件镜像到 Langfuse（Lab「更多 → Langfuse」；没保存入口不会上报），并把真正发出的 Jev HTTP 记成 `jev_call`，在 Langfuse 里是当前轮下面的 `jev.<切入点>`。没发出 HTTP 的切入点不会出现。不要为了 Langfuse 或 Jev 在 mini 里静态 import Node。

### 2.4 L4 句柄控制契约（`AgentLoopHandle`）
- `loop.step()`：执行单个细粒度步骤（单步调试或受控推演）。
- `loop.run()`：连续循环运行直到会话挂起（waiting_approval / ended / error）。
- `for await (const event of loop)`：流式消费生命周期事件（`turn_prepared` -> `model_done` -> `tool_executed` -> `ended`）。
- `loop.steer(message, options)`：向正在运行或即将运行的轮次注入用户修正指令。返回状态：`started`（已新建轮次）、`steered`（已合并到下一轮）、`rejected`（已结束被拒）。
- `loop.abort()`：软中断当前轮次。
- `loop.fold()`：获取经过投影和折叠处理后的结构化消息历史。

### 2.5 模型适配器、重试与流重置（`@ppeng/agent-loop/model`、`streaming`）

- **唯一实现**：OpenAI Chat / Responses（`OpenAICompatibleAdapter`，`httpKind`）与 Anthropic（`AnthropicMessagesAdapter`）只在本包实现。`packages/core/src/model/model-adapters.ts` 只是薄 shim（继承并默认 `env: process.env`），**不要**在 core 里再复制一份解析逻辑。
- **失败要响亮**：非 2xx 抛 `UpstreamHttpError`（`status`、`retryAfterMs`、`requestId`）；流内 `error` 事件、`response.failed`、无终止事件的 EOF、连接重置抛 `UpstreamStreamError`。不要把半截流当成正常结束返回。
- **重试**：`runTurnWithRetries` 用 `retryDelayMs(error, attempt)`：优先尊重 `Retry-After`（`parseRetryAfterMs` / `retryAfterMsOf`），上限 `MAX_RETRY_AFTER_MS`（20s），否则指数退避；等待可被 `signal` 中断。
- **`stream_reset` 契约**：同一轮重新开始出流（重试、或宿主切到 fallback 模型）前，内核先发 `{ type: 'stream_reset', reason: 'retry' | 'fallback' }`。消费者必须丢弃**上一个 `done` 之后**累积的增量文本 / 推理 / 工具参数，再接收新流，否则会出现半截答案 + 完整答案的重复。宿主自己做 fallback 时用 `createStreamResetTracker(onStream)`：把增量交给 `tracker.onChunk(chunk)`，换下一个模型前调 `tracker.resetIfDirty('fallback')`（上一次尝试没出过字就不发）。core 的 `l5-bindings.ts` 中 `fallbackStream().forAttempt(i)` 就是这样接的。
- **取消**：`ModelTurnInput.signal` 一路传到 `fetch`；宿主（如 daemon SSE）在客户端断开时 abort，即可同时放弃上游请求。

### 2.6 上游回放测试工具（`src/testing/upstream-replay.ts`）

- 用随机端口的 `node:http` 服务器按 JSON fixture 回放真实上游的 SSE / JSON 响应，驱动**真实**适配器（不 mock fetch）。fixture 字段：`provider`（`openai-chat|openai-responses|anthropic`）、`mode`（`stream|json`）、`responses[]`（`status`、`headers`、`events[]`（`event`/`data`/`raw`）、`split`（`event|whole|{bytes}`，用于切断 JSON / UTF-8）、`delayMs`、`end`（`end|destroy|hang`））、`abortAfterMs`（轮次超时，模拟上游卡死）、`expect`（文本、推理、工具调用、`stopReason`、`usage`、`requestId`、错误正则与字段、命中次数、请求体等）。
- fixture 在 `src/testing/upstream-fixtures/*.json`；vitest 回放全部 fixture，`packages/core/test/upstream-replay.test.js` 再经 core shim 回放一遍并核对错误分类。新增上游异常时**先加 fixture 复现**，再改适配器。
- 测试里的假 key 用 `replayApiKey()`（运行时拼接），不要在 fixture 里写像真实格式的密钥。

---

## 3. SDK 开发者开发与扩展规范

当修改 `packages/agent-loop` 时，遵循以下 7 步标准开发流程：

1. **实现功能**：在子目录（`turn/`、`session/`、`model/`、`streaming/`、`recovery/` 等）中实现纯逻辑。
2. **注册模块元数据**：若新增了模块，必须在 [`src/assembly/presets.ts`](file:///Users/penglei/developer/self-test-grounding/ppeng-agent-core/packages/agent-loop/src/assembly/presets.ts) 的 `LOOP_MODULES` 中登记最低档位与 Node 依赖标志：
   ```ts
   { id: 'my-feature', minPreset: 'normal', nodeOnly: false, load: 'static' }
   ```
3. **装配挂载**：在对应档位的 host 文件（`mini-host.ts`、`normal-host.ts`、`full-host.ts`、`max-host.ts`）中接入该模块。
4. **导出接口**：在 `src/index.ts` 以及 `package.json` 的 `exports` 中暴露对应的子路径。
5. **单测覆盖**：在同级目录建立 `*.test.ts`，覆盖典型分支与边界条件。
6. **验证构建与测试**：
   ```bash
   cd packages/agent-loop
   npm run build   # tsc -b 检查
   npm run test    # vitest 测试
   ```
7. **同步更新 Skill**：**核心指令——任何对 API 导出、档位或核心契约的改动，必须同步更新本文件（`skills/agent-loop/SKILL.md`）与 `references/`**。
