# 02：沿着自建 Agent Loop 走一遍

本章只追一条路径：session 已经有 user message，`runSession(sessionId)` 接下来做什么。

## 入口与并发保护

`RawAgentRuntime.runSession` 位于 `packages/core/src/runtime.ts`。它用 `runningSessions` 复用同一 session 的在途 Promise，避免两个调用同时推进同一份 transcript；真正的实现位于 `_runSessionInner`。

## 一次 dispatch 的主循环

默认上限来自 `RAW_AGENT_MAX_TURNS`，`runtime-env.ts` 当前默认值为 24。每轮大致执行：

```text
刷新 session / agent / task
  → autoCompact
  → visibleMessages + prepareMessagesForModel
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
| `cancelSession` | AbortController 中止模型 / 工具工作，属于 best effort |
| 达到 turn 上限 | 记录可选 evolving review，session 回到 `idle` |

## 自己核对

在 `runtime.ts` 中依次搜索：`runningSessions`、`for (let turn`、`runTurnWithRetries`、`waiting_approval`、`handleTurnCompletion`。能解释这五处的先后关系后，继续 [03 模型适配器](03-model-adapters.md)。
