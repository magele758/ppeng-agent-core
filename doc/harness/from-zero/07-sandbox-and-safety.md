# 07 — 沙箱与运行时安全（循环叠层）

> **挂在哪**：tool-loop 执行边（沙箱/脱敏）+ `_runSessionInner` 跨轮/轮内 watchdog。仍是自建循环上的开关层。  
> **本阶段目标**：命令可跑但可控；不死循环烧钱。
---

## A. 执行沙箱（两正交旋钮）

| Env | 作用 |
|-----|------|
| `RAW_AGENT_AGENT_SANDBOX_KIND` | `native`（默认）/ `remote_vm` / `microservice` — agent 执行后端 |
| `RAW_AGENT_SANDBOX_MODE` | 仅影响 Native：`auto\|direct\|os\|container` — OS 级隔离策略 |

工厂：`packages/core/src/sandbox/create-agent-sandbox.ts`。

**Tier 0（必做）**：所有 `spawn` 经 `sanitizeSpawnEnv()`（`sandbox/env-sanitizer.ts`）剥离 `LD_PRELOAD` / `NODE_OPTIONS` / `DYLD_INSERT_LIBRARIES` 等。

**Tier 1（Native + os）**：macOS `sandbox-exec` 挡 `~/.ssh` 等；Linux `bwrap`；不支持则降级 Tier 0。`bash` / `bg_run` 走 `SandboxManager`（`os-sandbox.ts`）。

**结果回流脱敏**：`sandbox/result-redaction.ts` → 敏感 env 值变 `[REDACTED:NAME]`。

---

## B. 运行时兜底（与 LoopGuard 正交的两层）

| 层 | 模块 | 行为 |
|----|------|------|
| 轮内复读 | `streaming/repetition-watchdog.ts` | abort 流 + 干净重答一次；挂在 `runTurnWithRetries` |
| 思考空转 | `streaming/reasoning-spin-watchdog.ts` | 连续 N 轮仅 reasoning/空输出 → **不重试**，优雅收尾 |
| 跨轮循环 | `recovery/session-loop-guard.ts` | 工具中心死循环检测 |
| 宽限 | `recovery/advisory-grace.ts` | abort 前默认宽限 1 轮 + `[recovery-advisory]` |
| 多信号风险 | `recovery/risk-engine.ts` + `advisory-queue.ts` | 入队 → 下轮 system advisory |
| 软完成 | `goal/goal-gate.ts` | `metadata.goalCondition`；fail-open |

失范治理（审批/沙箱/附录）见 [`AGENTIC_SAFETY_RUNTIME.md`](../../AGENTIC_SAFETY_RUNTIME.md)。

---

## 从 0 实现顺序

1. `sanitizeSpawnEnv` 覆盖全部 spawn（含自愈/子进程）。
2. bash 走统一 sandbox 入口；结果脱敏。
3. LoopGuard（跨轮）→ AdvisoryGrace。
4. 复读 / 空转 watchdog（轮内）。
5. RiskEngine + GoalGate（可选 env）。

---

## 本阶段验收

- [ ] `printenv` 类输出不会把 API key 原样进会话库/trace。
- [ ] 故意让模型重复同一工具调用：LoopGuard 或 advisory 介入（视开关）。
- [ ] 复读流被 abort 后至多干净重答一轮。

**深读**：

- 叠层时间线 / env / 与 LoopGuard 正交：[16-runtime-governance](../16-runtime-governance.md)（推荐）
- 模型 · 工具 · 沙箱合章：[18-model-tools-sandbox](../18-model-tools-sandbox.md)
- [05-safety-and-recovery](../05-safety-and-recovery.md)、[06-goal-gate](../06-goal-gate.md)、[12-sandbox-and-execution](../12-sandbox-and-execution.md)

**下一章**：[08-daemon-and-api](08-daemon-and-api.md)
