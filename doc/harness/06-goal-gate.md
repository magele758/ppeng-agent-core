# 06 — Goal Soft-Completion Gate

正交于 session mode 的「完成闸门」：模型说完了不代表目标达成——再问一道。

---

## 概念

```
普通 stop  ──────────────→ handleTurnCompletion ──→ session idle/completed
普通 stop + Goal active ──→ GoalGate.evaluate ──→ met?
                                                   ├─ yes → achieved → complete
                                                   └─ no  → continue (inject reason)
                                                            或 close (stalled/exhausted/user-missing)
```

Goal 不是第 N 种 `task_run_mode`——它**叠加在**任何 mode 之上：模型按自己的 mode 跑完后，goal gate 才介入判断「结果是否满足条件」。

---

## 触发

会话 `metadata` 中三选一：
- `goalCondition`（字符串显式条件）
- `goalEnabled: true`（开启推导/复用）
- 两者皆无 → gate 不激活、零开销

辅助字段：`goalMaxTurns`（默认 25，env `RAW_AGENT_GOAL_MAX_TURNS`）。

---

## 评估流程

```ts
GoalGate.evaluate({ snapshot, judge, signal, steerTexts? })
  1. turnsUsed += 1
  2. judge({ system: JUDGE_SYSTEM, user: condition + ledger + snapshot })
     → JSON: { met, reason, progress?, missing?, missing_kind?, steer_action? }
  3. parseGoalEvalJson → GoalEvalResult
  4. decideGoalTurn(evalResult, steerTexts, ledger, turnsUsed, maxTurns)
     → GoalTurnDecision
  5. append ledger entry
```

### Judge 系统提示（精简）

```
You are a goal completion judge. Given a goal condition and a conversation snapshot,
decide if the goal is met based ONLY on what is already surfaced in the dialogue.
Return JSON only: {"met":boolean,"reason":string,...}
```

---

## 决策矩阵 (`decide-goal-turn.ts`)

| 优先级 | 条件 | 结果 |
|--------|------|------|
| 1 | `steerAction === 'supersede'` | close (superseded) |
| 2 | `met === true` | achieved |
| 3 | 连续 2 轮 `progress === 'stalled'` | close (stalled) |
| 4 | `missingKind === 'user'` 首轮 | continue + 注入「假设 or 留缺口」指令 |
| 4b | 连续 2 轮 user-missing | close (needs_user_unattended) |
| 5 | `turnsUsed >= maxTurns` | close (exhausted) |
| 6 | 其他 | continue |

---

## Ledger（账本）

每次评估追加一条 `GoalLedgerEntry { turn, met, reason, progress, missingKind, at }`。

- 最近 5 条注入到 judge user prompt（让 judge 看到趋势）。
- 上限 40 条（丢最早的）。
- 持久化在 `session.metadata.goalLedger`。

---

## Fail-open 设计

| 故障 | 行为 |
|------|------|
| judge 调用抛错 / 超时 | `met: true, source: 'fail-open-error'` → 放行 |
| judge 返回不可解析 JSON | `met: true, source: 'fail-open-parse'` → 放行 |
| goal gate 构建失败 | 不创建 gate → 完全不参与 stop 路径 |

**设计原则**：goal gate 不是 loop 的唯一动力源。main loop 的 stop 判断已够可靠，gate 只做「否决正常完成」——所以 fail-open 是正确的默认。

---

## 状态持久化

所有 goal 状态通过 `goalGate.metadataPatch()` 写回 session metadata：

```ts
{
  goalCondition,
  goalMaxTurns,
  goalTurnsUsed,
  goalLedger,
  goalEnabled: true
}
```

跨 dispatch 恢复：`createGoalGateFromMetadata(session.metadata, env)` 从 metadata 重建 gate（含 ledger 和 turnsUsed）。

---

## Trace

`goal_eval { met, reason, source, decision, turnsUsed }`

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `goal/goal-gate.ts` | `GoalGate` class（evaluate / metadataPatch） |
| `goal/decide-goal-turn.ts` | 纯函数决策器（共享于 runtime + 单测） |
| `goal/parse-goal-eval.ts` | JSON 宽容解析 |
| `goal/types.ts` | `GoalEvalResult` / `GoalLedgerEntry` / `GoalTurnDecision` |
| `runtime.ts` (line ~1490-1520) | gate 拦截点（stop hook 之后、handleTurnCompletion 之前） |
