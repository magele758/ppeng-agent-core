# 09 — Model Adapters

> **设计目标**：一套 runtime 代码适配所有主流 LLM provider——OpenAI、Anthropic、DeepSeek、各种兼容网关——而且能正确处理它们各自的 stream 格式、usage 报数怪癖、和 API 语义差异。

---

## 为什么需要 Adapter 层？

表面上看各家 API "差不多"——都是 POST + stream。但实际跑起来会遇到：

| 问题 | 说明 |
|------|------|
| Stream 格式不统一 | OpenAI chat vs responses vs Anthropic，event 名和 payload 结构全不同 |
| Usage 报数不一致 | 有的报增量、有的报累计、有的流式不报 |
| 截断语义不同 | `'length'` / `'max_tokens'` / `'max_output_tokens'` / `'incomplete'` |
| Tool calling 协议差异 | function_call vs tool_use，参数拆分方式不同 |
| Cache 机制不同 | OpenAI prefix cache vs Anthropic explicit cache |

如果在 runtime 里到处写 `if (provider === 'anthropic')` 就是灾难。Adapter 层的意义是**把差异封装在边界层，runtime 只看统一接口**。

---

## Adapter 树

```
ModelAdapter (interface)
  │
  ├─ OpenAICompatibleAdapter     ← 90% 的 provider 走这条
  │    └─ 自动检测: Chat Completions vs Responses API
  │
  ├─ AnthropicCompatibleAdapter  ← Anthropic Messages API
  │
  ├─ HybridModelRouterAdapter    ← 多模型路由（text vs VL）
  │
  └─ HeuristicModelAdapter       ← 测试/mock 用
```

### 协议自动检测

`OpenAICompatibleAdapter` 从 `RAW_AGENT_BASE_URL` 后缀判断走哪个协议：
- URL 含 `/responses` → Responses API（更新、支持内置 tool_use）
- 其他 → Chat Completions（兼容性最广）

### Hybrid Router

当 `RAW_AGENT_VL_MODEL_NAME` 有值时启用：
- 请求含图片（`ImagePart`）→ 走 VL adapter
- 纯文本请求 → 走主 text adapter

这允许用便宜的纯文本模型处理 90% 的请求，只在需要看图时切换到贵的多模态模型。

---

## Stream 消费设计

所有 adapter 输出统一的 `ModelStreamChunk`，runtime 不关心底层是 OpenAI delta 还是 Anthropic event。

### 为什么 watchdog 不在 adapter 内？

复读检测（watchdog）在外层 `runStreamTurnWithRepetitionGuard` 中，用 `AbortSignal` 统一覆盖所有 adapter。

原因：
1. 避免每个 adapter 重复实现相同逻辑
2. watchdog 需要跨 adapter 的统一行为（abort signal 传播）
3. 保持 adapter 职责单一——只负责"把 stream 翻译成统一格式"

---

## 核心创新：累计 Token 修正

### 问题

部分网关（尤其是自建代理）把 `prompt_tokens` 报成**会话运行时累计值**而非本轮值。直接累加会让 totals / 成本按平方增长：

```
轮 1: prompt_tokens = 5000  → 实际本轮 5000
轮 2: prompt_tokens = 10000 → 实际本轮 5000（累计被报成 10000）
轮 3: prompt_tokens = 15000 → 实际本轮 5000
─────
错误累加: 30000    正确累加: 15000    差 2x
10 轮后差距更大
```

### 解法：`splitCumulativePromptTokens`

```
首次检测: incoming.prompt_tokens 比 prev 大 ≥40% 且 ≥+1000 → 标记为 cumulative
之后 sticky: 该 provider 不会中途换报数方式
compact 后回降: prompt 变小 → sticky 让位（避免误判）
```

**效果**：修正后成本估算误差从 2-5x 降到 < 5%。这个问题极其隐蔽——没有 trace 观测根本发现不了。

---

## Usage 归一化

所有 provider 的用量统一为：

```ts
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
  cachedInputTokens?: number;  // prompt cache 命中的 token
}
```

| 来源 | 归一化函数 | 特殊处理 |
|------|-----------|---------|
| OpenAI chat | `normalizeOpenAiUsage` | `prompt_tokens_details.cached_tokens` |
| OpenAI responses | 同上 | `output_tokens` 变体 |
| Anthropic | `normalizeAnthropicUsage` | `cache_read_input_tokens` |

---

## 成本估算

`estimateUsageCostUsd(usage, model, env)` → 实时成本。

定价表匹配策略：精确 → 最长子串包含 → `default`。支持 `RAW_AGENT_TOKEN_PRICE_JSON` env 覆盖（自定义网关的定价）。

每轮成本进 `turn_end` trace；累计成本写 `session.metadata.usageCostUsd`——支持成本预警和预算控制。

---

## Truncation 检测

`isTruncatedFinish(finishReason)` 覆盖所有已知的截断标识。

**设计决策**：截断只发 trace（`turn_truncated`），**不改循环控制**。因为截断可能是合理的（模型 output 太长被 cap），不应该因此改变 stop/continue 的逻辑。

---

## 与竞品对比

| | LangChain | Vercel AI SDK | LiteLLM | **ppeng Adapters** |
|---|-----------|--------------|---------|-------------------|
| Provider 抽象 | ✅ 有 | ✅ 有 | ✅ 有 | ✅ 有 |
| 累计 token 修正 | ❌ | ❌ | ❌ | ✅ |
| Prompt cache 感知 | ❌ | 部分 | ❌ | ✅ |
| Hybrid VL 路由 | ❌ | ❌ | ❌ | ✅ |
| 成本实时估算 | 外挂 | ❌ | ✅ | ✅ |
| Request-id 追溯 | ❌ | ❌ | ❌ | ✅ |

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `model/model-adapters.ts` | 4 个 adapter + stream 消费 |
| `model/usage.ts` | normalize / merge / splitCumulative |
| `model/token-cost.ts` | 定价表 + estimateUsageCostUsd |
| `model/upstream-request-id.ts` | request-id 提取 |
| `model/parse-tool-arguments.ts` | 宽容 JSON 解析 |
