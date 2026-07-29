# 02 — 自建 Agent Loop（核心章）

> **本阶段目标**：把「自己搓的 agent 循环」钉死到代码级：turn、模型调用、tool_call↔result、停止条件。  
> 总论与选型见 [`../00-self-built-agent-loop.md`](../00-self-built-agent-loop.md)；本章是实现展开。

**前置**：已确认 **无** `@openai/agents`，循环不在 SDK 里。

---

## 1. 循环伪代码（对应源码）

```ts
// packages/core/src/runtime.ts — RawAgentRuntime
async runSession(sessionId) {
  if (runningSessions.has(sessionId)) return samePromise; // 防重入
  return _runSessionInner(sessionId);
}

async _runSessionInner(sessionId) {
  // 初始化 LoopGuard / RiskEngine / GoalGate / spin watchdog（可关）
  for (let turn = 0; turn < maxTurnsPerRun; turn++) {
    if (signal.aborted) return failed;
    // prepare: autoCompact → visibleMessages → micro-compact → systemPrompt → turnTools
    const turnResult = await runTurnWithRetries(...); // → ModelAdapter.runTurnStream
    // 落库 assistantParts；记 usage / truncated（观测）
    if (turnResult.stopReason !== 'tool_use') {
      return handleCompletion(...); // idle | completed | goal 等
    }
    // stopReason === 'tool_use'
    const outcomes = await executeToolCalls(...); // runtime/tool-loop.ts
    // 每个 tool_callId 必须有 tool_result；或进入 waiting_approval 后 return
  }
  return idle; // max turns 耗尽，可再次 runSession
}
```

---

## 2. 一回合里发生什么

| 步骤 | 做什么 | 代码 |
|------|--------|------|
| 组上下文 | 历史视图、memory/working-log appendix、skill routing | `prepareMessagesForModel`、`prompt-builder` |
| 调模型 | 流式 HTTP，产出 text/reasoning/tool_call chunks | `model/model-adapters.ts` |
| 判停止 | `stopReason: 'end' \| 'tool_use'` | `types.ts` → `ModelTurnResult` |
| 跑工具 | filter → approve → exec → redact → append | `runtime/tool-loop.ts` |
| 再回合 | tool 消息进入下一轮 `messages` | 回到 for 循环 |

Daemon/Web **只触发** `runSession` 并订阅 `onModelStreamChunk`，不实现上表。

---

## 3. tool_call ↔ tool_result（配对不变量）

1. Assistant 消息里每个 `tool_call` 带稳定 `toolCallId`。
2. 随后必须有 role=`tool` 的 result（或同 id 的错误占位）。
3. **未知工具**：结构化 JSON（`did_you_mean` 等），仍配对，见 `recovery/unknown-tool-result.ts`。
4. **需审批**：建 approval、session → `waiting_approval`、**结束本次 dispatch**（不是吞掉 call）。
5. 并行：审批通过后 `executeToolCalls` 按 `maxParallelToolCalls`（默认 8，`RAW_AGENT_MAX_PARALLEL_TOOLS`）分块；块内 `Promise.all` 并行，块间串行。无「顺序敏感工具强制串行」分区。

破坏配对 → 下一轮上游 API 报 messages 非法或模型行为漂移。

---

## 4. 停止条件清单

| 信号 | 会话结果 |
|------|----------|
| `stopReason === 'end'` | 走 completion（chat 常回 `idle`/`completed`） |
| `stopReason === 'tool_use'` | 不结束 session，执行工具后 `continue` |
| `truncated === true` | **仍可能** `stopReason: 'end'`；只打 trace，不改控制流 |
| `AbortSignal`（`POST .../stop`） | `failed` |
| `maxTurnsPerRun` | `idle`（可续） |
| 审批挂起 | `waiting_approval` |
| 复读 watchdog | abort 流 + 至多干净重答一次（在 `runTurnWithRetries`；与 LoopGuard **正交**） |
| 思考空转 watchdog | 不重试，优雅收尾（指纹不重复时 Guard 抓不到） |
| LoopGuard 将 abort | 默认可 AdvisoryGrace 宽限 1 轮（直接 system，非 AdvisoryQueue） |

---

## 5. 关键文件（导航）

```
packages/core/src/
  runtime.ts                 # runSession / _runSessionInner / runTurnWithRetries
  runtime/tool-loop.ts       # 工具执行与审批
  model/model-adapters.ts    # fetch LLM API（非 SDK Runner）
  model/prompt-builder.ts    # system prompt
  types.ts                   # ModelAdapter, stopReason, ModelStreamChunk
  streaming/*-watchdog.ts    # 轮内兜底
  recovery/*                 # 跨轮兜底
```

依赖反证：`packages/core/package.json` → 无 `@openai/agents`。

---

## 6. 最小复现顺序（若从 0 重写）

1. SQLite session/messages  
2. Heuristic `ModelAdapter`（固定 `end`）  
3. `runSession` 单轮  
4. 真 `fetch` chat completions + 解析 `tool_calls`  
5. tool-loop 配对  
6. 再叠压缩 / 审批 / watchdog（后续章）

---

## 本阶段验收

- [ ] 画出 turn 图，并标出三个路径文件：`runtime.ts` / `model-adapters.ts` / `tool-loop.ts`。
- [ ] 说明为何截断不等于换 `stopReason`。
- [ ] 说明审批如何打断 dispatch 而不丢配对义务。

**下一章**：[03-model-adapters](03-model-adapters.md)（循环的模型边）  
**深读**：[../01-request-lifecycle.md](../01-request-lifecycle.md)、[../03-tool-execution.md](../03-tool-execution.md)、治理叠层 [../16-runtime-governance.md](../16-runtime-governance.md)
