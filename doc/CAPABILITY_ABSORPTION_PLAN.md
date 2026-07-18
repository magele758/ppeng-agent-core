# 能力吸收计划：从 ai-agent-node 借鉴并补强 ppeng-agent-core

> 目标：对照成熟的 **ai-agent-node** 梳理 ppeng-agent-core 可吸收/补强的能力点，并分轮落地。
>
> 状态：
> - ✅ 轮次 1：LLM 轮次用量与截断可观测性
> - ✅ 轮次 2：upstream request-id + optional groups 服务端默认并集 + `STABLE_SYSTEM_VERSION` 指纹
> - ✅ 轮次 3（本轮）：tool-result env 回流脱敏 + unknown-tool 协议自愈增强 + recovery AdvisoryGrace

## 1. 对照结论（差距分析）

| ai-agent-node 能力 | ppeng-agent-core 现状 | 差距 | 优先级 |
|---|---|---|---|
| Self-Evolving（完整 RiskEngine→AdvisoryInjector） | `evolving/` + **AdvisoryGrace**（宽限 1 轮） | 轻量宽限已补；完整多信号 RiskEngine 仍可选 | P2 |
| Recovery / 死循环防护 | `SessionLoopGuard` + AdvisoryGrace | 已覆盖 | — |
| Optional Tool Groups 并集 | `optional-tool-groups.ts` | ✅ 轮次 2 | — |
| 沙箱 env 净化 + **回流脱敏** | `env-sanitizer` + **`result-redaction`** | ✅ 本轮 | — |
| Stable prompt 版本指纹 | `STABLE_SYSTEM_VERSION` → `turn_end` | ✅ 轮次 2 | — |
| LLM usage / truncation | `model/usage.ts` | ✅ 轮次 1 | — |
| Upstream request-id | `model/upstream-request-id.ts` | ✅ 轮次 2 | — |
| Protocol self-heal（未知 tool → 合成 result） | 已有 UNKNOWN_TOOL；**本轮加 did_you_mean JSON** | ✅ 本轮增强 | — |
| Goal completion gate | 无 | 整子系统缺失 | P1（后续，中→大） |
| Case governance | recall 有；无 archive/decay job | 缺口 | P2 |
| Session per-user isolation | daemon 单 Bearer | 产品形态不同 | P2 |
| Memory 进 user appendix（保 prefix cache） | memory 在 dynamic | 部分 | P2 |

## 2. 本轮落地（轮次 3）

### 2.1 Tool result env 回流脱敏（P0）

- `packages/core/src/sandbox/result-redaction.ts`：`collectRedactionTargets` / `redactEnvValues` / `redactToolContent`
- 敏感名：精确表 + `_*API_KEY|TOKEN|SECRET|PASSWORD|COOKIE…` 后缀；值长 ≥ 6；`PATH/HOME` 等豁免
- 接线：`shellOutput`（bash）+ `executeSingleTool`（bash/bg_*/work_evidence）

### 2.2 Unknown-tool 协议自愈增强（P1）

- `find-similar-tool-name.ts` + `unknown-tool-result.ts`
- 未知工具返回结构化 JSON：`error` / `did_you_mean` / `available_tools_sample` / `hint`（保持 tool_call↔result 配对）

### 2.3 Recovery AdvisoryGrace（P1）

- `recovery/advisory-grace.ts`：LoopGuard 将 abort 时先宽限 `RAW_AGENT_RECOVERY_ADVISORY_GRACE_BUDGET`（默认 1）轮，注入 `[recovery-advisory]` system 消息并 `continue`；耗尽后硬 abort
- Trace：`recovery_advisory` / `recovery_abort`
- 默认开：`RAW_AGENT_RECOVERY_ADVISORY_GRACE=1`（设 `0` 关闭）

### 非目标

- 完整 Goal gate / Case governance cron / 多用户 owner 闸
- 不因脱敏失败阻断工具；无敏感值时 no-op

## 3. 验证

- `npm run build` + `npm run test:unit`（含 `result-redaction` / `unknown-tool-result` / `advisory-grace`）
- `npm run test:regression`

## 4. 后续仍可提升（按价值）

1. **Goal completion soft-gate** — 判官 `met` + soft-complete 汇合（中→大，产品价值高）
2. **完整 RiskEngine 多信号** — 失败模式分类 → 入队 advisory（超出单次宽限）
3. **Case governance** — confidence decay / archive / capacity
4. **Prompt 分层** — memory 挪到 user appendix，强化 prefix cache
5. **成本换算** — token→$ 叠加 model-registry 定价（观测层）
