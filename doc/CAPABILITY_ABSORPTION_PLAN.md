# 能力吸收计划：从 ai-agent-node 借鉴并补强 ppeng-agent-core

> 状态：轮次 1–4 已全部落地（含原「后续候选」五项）。

## 已落地

| 轮次 | 能力 | 落点 |
|---|---|---|
| 1 | LLM usage / truncation | `model/usage.ts` |
| 2 | upstream request-id / optional groups 并集 / `STABLE_SYSTEM_VERSION` | `upstream-request-id` / `optional-tool-groups` / `prompt-builder` |
| 3 | tool-result 回流脱敏 / unknown-tool 自愈 / AdvisoryGrace | `result-redaction` / `unknown-tool-result` / `advisory-grace` |
| 4 | **Goal soft-gate** | `goal/` + runtime soft-complete |
| 4 | **RiskEngine + AdvisoryQueue** | `recovery/risk-engine` + `advisory-queue` |
| 4 | **Case governance** | `evolving/case-governance` + migration v10 |
| 4 | **Memory → user appendix** | `PromptBuilder.buildMemoryAppendix` |
| 4 | **Token→$ 成本估算** | `model/token-cost.ts` → `usageCostUsd` / `turn_end.costUsd` |

## 用法摘要

- **Goal**：会话 `metadata.goalCondition`（或 `goalEnabled`+条件）+ 可选 `goalMaxTurns`；软完成时判官 `completeText` JSON；fail-open。
- **Risk**：`RAW_AGENT_RISK_ENGINE=1`（默认开）；多信号 → `AdvisoryQueue` → 下轮 system。
- **Case governance**：`runCaseGovernance` 在每次 `runSession` 入口 fail-soft 执行；`status`/`half_life_days`/`expires_at`。
- **Memory appendix**：不再进 system dynamic；拼到最近一条 user 消息前。
- **成本**：`session.metadata.usageCostUsd`；定价表可被 `RAW_AGENT_TOKEN_PRICE_JSON` 覆盖。

## 仍可选深化（非阻塞）

- Goal 完整实体 store / teams 续轮 / steer 插话（node 全量）
- RiskEngine 与 LoopGuard 信号完全合流（same-tool streak 透传）
- Case supersede 冲突检测 / cron 周期治理
- 前端展示 `usageCostUsd` / goal 状态
