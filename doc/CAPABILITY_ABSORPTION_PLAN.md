# 能力吸收计划：从 ai-agent-node 借鉴并补强 ppeng-agent-core

> 目标：对照成熟的 **ai-agent-node**（多渠道 Agent 编排服务，OpenAI Agents SDK）梳理 ppeng-agent-core 可吸收/补强的能力点，并落地首个高价值缺口。
>
> 状态：本轮落地「LLM 轮次用量与截断可观测性」（LLM turn usage & truncation observability）。

## 1. 对照结论（差距分析）

ppeng-agent-core 已相当完整，ai-agent-node 的多数标志性子系统在此仓库已有对应实现：

| ai-agent-node 能力 | ppeng-agent-core 现状 | 差距 |
|---|---|---|
| Self-Evolving（cases / RiskEngine / ShadowCoach / BackgroundReviewer） | `evolving/`（background-reviewer / shadow-coach / case-recall / semantic-sampling / feature-flags） | 已覆盖 |
| Recovery pipeline / 死循环防护 | `recovery/session-loop-guard.ts`（失败连击 / 同工具连击 / 输出指纹重复） | 已覆盖 |
| Optional Tool Groups（按 group 启用） | `tools/optional-tool-groups.ts` | 已覆盖 |
| 沙箱 env 准入 / 净化（保留名、注入向量剥离） | `sandbox/env-sanitizer.ts` + `sandbox/os-sandbox.ts` | 已覆盖 |
| 稳定 prompt 分层 + 前缀缓存 | `model/prompt-builder.ts` + `session/prompt-cache.ts`（toolset lock + 漂移拒绝） | 已覆盖 |
| 多层记忆 / recall-compact | `memory/`（五层 scope）+ `runtime.autoCompact` | 已覆盖 |
| Teams / Swarm 编排 | `swarm/` + `orchestrator/` | 已覆盖 |
| MCP 客户端 | `mcp/`（jsonrpc / stdio / manager） | 已覆盖 |
| 模型路由（文本/VL） | `model/model-adapters.ts`（hybrid-router） | 已覆盖 |
| **LLM 用量 / finishReason / 截断可观测性** | `ModelTurnResult` 仅 `{ assistantParts, stopReason }` | **缺口（本轮落地）** |

## 2. 选定缺口：LLM 轮次用量与截断可观测性

### 现象与因果（对齐 ai-agent-node AGENTS.md 的排查纪律）

- **观测字段丢失**：ppeng 的 `ModelTurnResult` 只回传 `assistantParts` + `stopReason`，provider 返回的 `usage`（prompt/completion/cache token）被整块丢弃。无 token 计量 → 无成本基线、无 KV-cache 命中观测。
- **截断被静默吞掉（正确性问题）**：`finish_reason === 'length'`（OpenAI chat）、Responses API `status: incomplete`、Anthropic `stop_reason: 'max_tokens'` 目前统一被映射成 `stopReason: 'end'`。**被截断的轮次和干净完成的轮次外观完全一致**——正是 ai-agent-node「finishReason/usage 缺失就不要据此断言归属」告诫的失真场景。

ai-agent-node 对照实现：`entry/openai-agent-runner/core/agent-loop.ts` 的 `TurnResult.usage = { inputTokens, outputTokens, totalTokens, requests }`，半截流写入 `status: 'incomplete'`。

### 落地范围（observability-only，不改循环控制）

1. **新增纯函数模块** `packages/core/src/model/usage.ts`
   - `TokenUsage` 类型：`{ inputTokens, outputTokens, totalTokens, cachedInputTokens?, requests }`。
   - `normalizeOpenAiUsage(raw)` / `normalizeAnthropicUsage(raw)`：把两家不同字段（`prompt_tokens`/`input_tokens`、`prompt_tokens_details.cached_tokens`/`cache_read_input_tokens` 等）归一。
   - `isTruncatedFinish(finishReason)`：识别 `length` / `max_tokens` / `incomplete`。
   - `mergeUsage(a, b)`：会话级累加。
2. **扩展类型** `ModelTurnResult`：可选 `usage?`、`finishReason?`、`truncated?`；`trace.ts` 增加 `turn_truncated` 事件类型。
3. **填充 5 处 adapter parse 点**：Responses（非流/流）、Chat（非流/流）、Anthropic 非流。
4. **runtime 观测接线**：`turn_end` 事件带 `usage`/`finishReason`/`truncated`；截断时另发 `turn_truncated`；会话 `metadata.usageTotals` 累加。
5. **单测 + 文档**：`model-usage.test.js`（纯函数）；更新 `ARCHITECTURE.md` §6 与根 `AGENTS.md`。

### 非目标（本轮不做）

- 不因截断改写 `stopReason` 或强行续写（避免引入循环风险）；仅暴露信号供上层/人审。
- 不接成本币种换算（token→$）——留待后续按 model-registry 定价表叠加。

## 3. 验证

- `npm run build`（tsc 全量）+ `npm run test:unit`（含新增 `model-usage.test.js`）。
- 回归：既有 `model-adapters.test.js` / `prompt-cache.test.js` / `runtime*.test.js` 保持绿。
