# 09 — Model Adapters

抹平 OpenAI / Anthropic / 自定义网关差异，统一 stream + usage + truncation 语义。

---

## 适配器树

```
ModelAdapter (interface: runTurn / runTurnStream / summarizeMessages / completeText?)
  │
  ├─ HeuristicModelAdapter        按规则选工具，无 LLM（测试/mock）
  ├─ OpenAICompatibleAdapter      chat.completions + responses 双协议
  ├─ AnthropicCompatibleAdapter   messages API
  └─ HybridModelRouterAdapter     按消息内容选 text vs VL adapter
```

### 协议二选一 (`httpKind`)

`OpenAICompatibleAdapter` 自动从 `RAW_AGENT_BASE_URL` 后缀判断：
- 含 `/responses` → Responses API（单请求多输出、内置 tool_use 协议）
- 其他 → Chat Completions（`stream_options.include_usage` 取流式 usage）

### Hybrid Router (`HybridModelRouterAdapter`)

当 `RAW_AGENT_VL_MODEL_NAME` 有值时启用。请求含 `ImagePart` → 走 VL adapter；否则走 text adapter。

---

## Stream 消费

`runTurnStream(input, onChunk)` 读取 SSE event stream：

1. 逐行 buffer → `flushLine(line)` 解析 `data: {…}`
2. 按 event type 累积 text / reasoning / tool_call slots
3. 完成时组装 `ModelTurnResult`

### Responses API stream events

`response.output_text.delta` / `response.output_item.delta` / `response.reasoning_text.delta` / `response.function_call_arguments.delta` / `response.completed`

### Chat Completions stream events

`choices[0].delta.content` / `.reasoning_content` / `.tool_calls[n].function.arguments`

---

## Repetition Guard 在流层

stream 消费**不在 adapter 内**做 watchdog——它在外层 `runStreamTurnWithRepetitionGuard`（`runtime/tool-loop.ts`）中，用 `input.signal` 统一覆盖所有 adapter。详见 [05-safety-and-recovery.md](05-safety-and-recovery.md)。

---

## Usage 归一化 (`model/usage.ts`)

| 来源 | 函数 | 字段映射 |
|------|------|----------|
| OpenAI chat | `normalizeOpenAiUsage` | `prompt_tokens` → `inputTokens` / `completion_tokens` → `outputTokens` / `prompt_tokens_details.cached_tokens` → `cachedInputTokens` |
| OpenAI responses | `normalizeOpenAiUsage` | 同上（`output_tokens` 变体） |
| Anthropic | `normalizeAnthropicUsage` | `input_tokens` / `output_tokens` / `cache_read_input_tokens` |

输出统一 `TokenUsage { inputTokens, outputTokens, totalTokens, requests, cachedInputTokens? }`。

### 累计 token 拆分

部分网关把 `prompt_tokens` 报成会话累计值。`splitCumulativePromptTokens(incoming, prev, sticky)` 检测并修正：
- 首次靠大跳变（≥+40% 且 ≥+1000）
- 之后 sticky（provider 不换报数方式）
- 报数下降（compact 后 prompt 变小）→ sticky 让位

---

## 成本估算 (`model/token-cost.ts`)

`estimateUsageCostUsd(usage, model, env)` → `{ usd, model, price }`。

定价表 = `DEFAULT_MODEL_PRICES` + env `RAW_AGENT_TOKEN_PRICE_JSON` 覆盖。匹配策略：精确 → 最长子串包含 → `default`。

每轮成本写进 `turn_end` trace；累计成本写 `session.metadata.usageCostUsd`。

---

## Truncation 检测

`isTruncatedFinish(finishReason)` 覆盖：`'length'` / `'max_tokens'` / `'max_output_tokens'` / `'incomplete'`。

命中时 `ModelTurnResult.truncated = true`——runtime 不改 loop 控制，只发 `turn_truncated` trace。

---

## Upstream Request ID (`model/upstream-request-id.ts`)

从 response headers / body / SSE 中提取 provider request-id → `ModelTurnResult.requestId`。写进 `turn_end` trace 用于与 provider 日志关联。

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `model/model-adapters.ts` | 4 个 adapter class + stream 消费 + request build |
| `model/usage.ts` | normalize / merge / isTruncated / splitCumulative |
| `model/token-cost.ts` | 定价表 + estimateUsageCostUsd |
| `model/upstream-request-id.ts` | provider request-id 提取 |
| `model/parse-tool-arguments.ts` | 宽容 JSON 解析（工具参数） |
