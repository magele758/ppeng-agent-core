# 02：沿着自建 Agent Loop 走一遍

本章只追一条路径：session 已经有 user message，`runSession(sessionId)` 接下来做什么。

## 入口与并发保护

`RawAgentRuntime.runSession` 位于 `packages/core/src/runtime.ts`。普通调用通过 `runningSessions` 复用同一 session 的在途 Promise；带 latch 的调用会等待已有运行结束。

当前默认链路是：

```text
RawAgentRuntime.runSession
  → 读取 loop_settings（默认 agent-loop / max）
  → l5ToAssembledIo：注入产品 I/O
  → createAssembledLoop({ preset, io, hooks, config })
  → assembled.run(sessionId, options)
  → packages/agent-loop/src/turn/kernel.ts
```

显式选择 `kernelVariant=ppeng` 才运行 core 内的参考内核。产品默认 max，不代表 SDK 工厂默认 max：直接调用工厂而不指定 preset 时为 mini。装配契约见 [SDK 指南](../../../skills/agent-loop/SKILL.md)。

## 一次 dispatch 的主循环

产品通过 `resolveSessionMaxTurns` 结合会话 metadata 与运行时默认值确定本次上限，传给内核。每轮概念上执行：

```text
刷新 session / agent / task
  → autoCompact
  → prepareTurnInput：inbox / fold / 送模视图
  → 组装 system prompt、memory / working-log appendix
  → 计算本轮可见工具
  → modelAdapter.runTurn[Stream]
  → 保存 assistant message 与 usage trace
  → 检查 reasoning 空转、跨轮恢复信号
  → 有 tool_call ?
       否：Goal Gate（若启用）→ 完成
       是：筛选 → 审批 → 执行 → 保存 tool_result → 下一轮
```

工具调用不是一次新的 HTTP 请求。它是同一次 `runSession` dispatch 内的下一轮模型输入。

## 必须保持的配对不变量

assistant 的每个 `ToolCallPart.toolCallId` 最终都应对应一个 `ToolResultPart.toolCallId`。未知工具也不会被简单丢掉：`recovery/unknown-tool-result.ts` 会生成失败结果和相近工具建议，下一轮模型仍能看到完整轨迹。

## 停止与返回

| 情况 | 行为 |
|---|---|
| assistant 没有工具调用 | chat session 回到 `idle`；task session 进入 `completed` |
| Goal Gate 判定未完成 | 写入 system 指令并继续下一轮 |
| 工具需要审批 | session 进入 `waiting_approval`，当前 dispatch 返回 |
| 审批拒绝或已有处理结果 | tool-loop 生成相应结果，再继续或返回 |
| `cancelSession` | AbortController 中止模型 / 工具工作，属于 best effort；状态与结束原因须结合内核分支判断 |
| 达到 turn 上限 | 记录可选 evolving review，session 回到 `idle` |

## 自己核对

先在 core `runtime.ts` 找 `runningSessions`、`kernelVariant` 和 `createAssembledLoop`，再到 SDK `turn/kernel.ts` 追实际推进，不再在 `runtime.ts` 搜索 `_runSessionInner`。

```bash
rg -n 'runningSessions|kernelVariant|createAssembledLoop' packages/core/src/runtime.ts
rg -n 'prepareTurnInput|waiting_approval|beginStep|commitStep' packages/agent-loop/src/turn/kernel.ts
```

插话不是修改已经发出的模型请求：它通过 inbox 与消费/中断策略影响后续推进。具体区分 `queue / steer / disabled`，见 SDK `session/steer-interrupt.ts`；产品配置入口为 `GET/PATCH /api/loop/settings`。

能解释宿主与内核的分工后，继续 [03 模型适配器](03-model-adapters.md)。
