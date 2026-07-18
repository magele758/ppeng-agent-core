# 能力吸收计划：从 ai-agent-node 借鉴并补强 ppeng-agent-core

> 目标：对照成熟的 **ai-agent-node**（多渠道 Agent 编排服务，OpenAI Agents SDK）梳理 ppeng-agent-core 可吸收/补强的能力点，并分轮落地。
>
> 状态：
> - ✅ 轮次 1：LLM 轮次用量与截断可观测性
> - ✅ 轮次 2（本轮）：upstream request-id + optional groups 服务端默认并集 + `STABLE_SYSTEM_VERSION` 指纹

## 1. 对照结论（差距分析）

ppeng-agent-core 已相当完整；下列为对照源码后的真实缺口（「已覆盖」= 有等价机制，不必照搬）。

| ai-agent-node 能力 | ppeng-agent-core 现状 | 差距 | 优先级 |
|---|---|---|---|
| Self-Evolving（cases / RiskEngine / ShadowCoach / BackgroundReviewer） | `evolving/`（background-reviewer / shadow-coach / case-recall / semantic-sampling） | 已有子集；无完整 RiskEngine→AdvisoryInjector 入队续轮 | P1（后续） |
| Recovery pipeline / 死循环防护 | `recovery/session-loop-guard.ts` | 硬 abort 已覆盖 | — |
| Optional Tool Groups（解析 + **服务端默认 ∪ 客户端**） | `tools/optional-tool-groups.ts` | ✅ 本轮补 `RAW_AGENT_DEFAULT_ENABLED_OPTIONAL_GROUPS` 并集 | — |
| 沙箱 env 准入 / 净化 | `sandbox/env-sanitizer.ts` + `os-sandbox.ts` | 已覆盖；工具结果回流脱敏仍弱 | P0/P1（后续） |
| 稳定 prompt 分层 + **版本指纹** | `prompt-builder` + `prompt-cache` | ✅ 本轮补 `STABLE_SYSTEM_VERSION` → `turn_end` | — |
| 多层记忆 / recall-compact | `memory/` + `runtime.autoCompact` | 已覆盖（memory 仍在 dynamic 层） | P2 |
| Teams / Swarm | `swarm/` + `orchestrator/` | 已覆盖 | — |
| MCP 客户端 | `mcp/` | 已覆盖 | — |
| Goal completion gate（判官 `met`） | 无等价子系统 | 整子系统缺失 | P1（后续，范围大） |
| **LLM 用量 / finishReason / 截断** | `model/usage.ts` + adapter/runtime | ✅ 轮次 1 | — |
| **Upstream request-id** | `model/upstream-request-id.ts` | ✅ 本轮 | — |
| Protocol self-heal（悬空 tool_call 合成 result） | 自管配对；无 SDK 悬空恢复 | 部分缺口 | P1（后续） |
| Session per-user isolation | daemon 单 Bearer | 产品形态不同 | P2 |

## 2. 本轮落地（轮次 2）

### 2.1 Upstream request-id 观测

- 新增 `packages/core/src/model/upstream-request-id.ts`：header / JSON / SSE / 嵌套 error 提取（对齐 ai-agent-node `extract-upstream-request-id`）。
- `ModelTurnResult.requestId?`；`postJson` / 流式 adapter 填充；`turn_end` 透传。
- **纯观测，不改循环控制**。

### 2.2 Optional groups：服务端默认 ∪ 客户端

- `parseDefaultEnabledOptionalGroups(env)` ← `RAW_AGENT_DEFAULT_ENABLED_OPTIONAL_GROUPS`（CSV）。
- `mergeEnabledOptionalToolGroups(defaults, client)`。
- runtime：feature on 且（会话显式选择 **或** 服务端有默认）时按并集过滤。

### 2.3 `STABLE_SYSTEM_VERSION` 指纹

- `prompt-builder.ts` 常量 `STABLE_SYSTEM_VERSION = 'v1'`（**不进 prompt / cache key**）。
- `turn_end` 带 `stableSystemVersion`；纪律见 `packages/core/src/model/AGENTS.md` + 契约单测。

### 非目标（本轮不做）

- Goal gate / 完整 RiskEngine+AdvisoryInjector / case governance / tool-result redaction / protocol self-heal。
- 不因 request-id 缺失阻断请求；不因截断改写 `stopReason`。

## 3. 验证

- `npm run build` + `npm run test:unit`（含 `upstream-request-id` / `optional-tool-groups` / `stable-system-version` / 既有 `model-usage`）。
- 回归：`npm run test:regression`。

## 4. 后续候选（按价值）

1. **Tool result redaction**（对 bash/bg_run 注入 env 回流脱敏）— P0 安全。
2. **轻量 AdvisoryQueue**（SessionLoopGuard 旁宽限 1 轮）— P1。
3. **Goal completion soft-gate**（纯函数判官 + soft-complete 汇合）— P1，中→大。
4. **Protocol self-heal**（未知 tool_call → 合成 error result 续轮）— P1。
