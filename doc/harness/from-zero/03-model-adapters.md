# 03：模型适配器

runtime 只依赖 `ModelAdapter` 接口，不直接拼某一家 provider 的请求。实现集中在 `packages/core/src/model/model-adapters.ts`。

## Adapter 选择

`createModelAdapterFromEnv` 读取 `RAW_AGENT_MODEL_PROVIDER`：

| 值 | 实现 | 用途 |
|---|---|---|
| 未设置或 `heuristic` | `HeuristicModelAdapter` | 本地测试和隔离回归，不调用远程模型 |
| `openai-compatible` | `OpenAICompatibleAdapter` | Chat Completions 或 Responses HTTP 协议 |
| `anthropic-compatible` | `AnthropicCompatibleAdapter` | Anthropic Messages 协议 |

配置 `RAW_AGENT_VL_MODEL_NAME` 后，factory 会在适用 provider 外包一层 `HybridModelRouterAdapter`，把含图片的输入路由到 VL 配置。它仍返回统一的 `ModelTurnResult`。

## 统一输出

适配器把 provider 差异归一成：

- assistant `parts`：text、reasoning、tool_call 等；
- `usage`：input / output / total token；
- `finishReason` 与 `truncated`；
- 可选 `requestId`。

runtime 因此不需要知道 tool call 来自 Chat Completions、Responses 还是 Anthropic。

## Streaming 的边界

adapter 负责把 wire event 转成 `ModelStreamChunk`；复读 watchdog 不放在各 adapter 内，而包在 `runtime/tool-loop.ts` 的 `runTurnWithRetries` 周围，所以所有 streaming adapter 共用一条保护路径。

## 配置最小集

OpenAI-compatible 通常需要：

```dotenv
RAW_AGENT_MODEL_PROVIDER=openai-compatible
RAW_AGENT_BASE_URL=https://example.invalid/v1
RAW_AGENT_API_KEY=replace-me
RAW_AGENT_MODEL_NAME=replace-me
```

`RAW_AGENT_OPENAI_HTTP_KIND=responses` 才选择 Responses；默认是 Chat Completions。第三方服务不接受 JSON mode 时，设置 `RAW_AGENT_USE_JSON_MODE=0`。

继续 [04 工具与审批](04-tools-and-approval.md)。
