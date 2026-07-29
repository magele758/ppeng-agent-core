# 03 — 模型适配（自建循环的模型边）

> **挂在哪**：第 2 章 `runTurnWithRetries` → 这里的 `ModelAdapter.runTurnStream`。  
> **不是** openai-agents 的 provider 插件；是自建循环里对 **LLM HTTP API** 的适配层。

---

## 职责

把内部消息/工具契约 ↔ 上游协议；**不拥有** turn 循环。

- OpenAI-compatible：`POST {base}/chat/completions`（流式 + `stream_options.include_usage`）
- 可选：`POST {base}/responses`
- Anthropic 兼容路径
- Hybrid：含图用户轮走 VL（`RAW_AGENT_VL_*`）

实现：`packages/core/src/model/model-adapters.ts`（内部 `fetch`）。

返回必须填：

- `assistantParts` + `stopReason: 'end' | 'tool_use'`
- 可选 `usage` / `finishReason` / `truncated` / `requestId`（观测；截断不改写控制流）

流式 chunk：`text_delta` / `reasoning_delta` / `tool_call_*` / `done`（`types.ts`）。

---

## 配置

`RAW_AGENT_BASE_URL` / `RAW_AGENT_API_KEY` / `RAW_AGENT_MODEL_NAME`；第三方无 `response_format` 时 `RAW_AGENT_USE_JSON_MODE=0`。

Prompt 四段（cache）：`prompt-builder.ts`；`STABLE_SYSTEM_VERSION` 见 `model/AGENTS.md`。

复读检测在 **runtime** `runTurnWithRetries`，不在各 adapter 内复制。

---

## 验收

- [ ] 指出模型边只有 adapter，循环在 `runtime.ts`。
- [ ] 真实 key 下流式 text；tool_calls 映射为 `stopReason: 'tool_use'`。

**深读**：[../09-model-adapters.md](../09-model-adapters.md)、[../02-prompt-assembly.md](../02-prompt-assembly.md)、合章 [../18-model-tools-sandbox.md](../18-model-tools-sandbox.md)  
**下一章**：[04-tools-and-approval](04-tools-and-approval.md)
