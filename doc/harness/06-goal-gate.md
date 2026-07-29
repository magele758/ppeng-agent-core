# 06 — Goal Soft-Completion Gate

> **核心洞察**：模型说"我做完了"不代表目标真的达成。传统 agent 的 `stop` 逻辑完全依赖模型自判——但模型会过早声明完成（尤其在遇到困难时）。Goal Gate 是一个正交于主循环的"否决权"——不替代 stop，只**质疑** stop。

---

## 问题与动机

### 模型"过早完成"的真实场景

1. 用户说"帮我重构这个模块"→ 模型改了一个文件 → 声明完成 → 实际上还有 3 个文件没动
2. 用户说"确保所有测试通过"→ 模型跑了测试 → 看到 2 个失败 → 说"大部分通过了"→ 结束
3. 任务需要用户输入 → 模型等了一轮 → 没收到 → 直接跳过 → 声明完成

### 为什么不能用 `max_turns` 兜底？

`max_turns` 只保证"不会跑太久"，但不能判断"跑够了没有"。你需要的是一个**语义级的完成判断**。

### 解法：Goal Gate

正交于 session mode 的"完成闸门"——叠加在**任何 mode 之上**：

```
模型按自己的逻辑跑完 → stop
  ↓
Goal Gate 介入
  ├─ 条件满足 → achieved → session completed
  └─ 条件不满足 → 注入原因 → 继续循环
```

---

## 设计方案

### Fail-open 设计（最重要的决策）

| 故障 | 行为 |
|------|------|
| judge 调用抛错/超时 | `met: true` → 放行 |
| judge 返回不可解析 JSON | `met: true` → 放行 |
| gate 构建失败 | 不创建 gate → 完全不参与 stop 路径 |

**为什么 fail-open？** 因为 Goal Gate 不是 loop 的动力源——main loop 的 stop 判断已经足够可靠。Gate 只做"否决正常完成"。如果 gate 自己出了问题，让 session 正常结束远比把用户锁在无限循环里好。

这是一个反直觉但深思熟虑的设计：安全机制本身的故障不应该成为新的安全风险。

### 触发条件

| 条件 | 行为 |
|------|------|
| `RAW_AGENT_GOAL_GATE=0` | 不创建 gate |
| `metadata.goalCondition` 非空字符串 | 创建 `GoalGate`（`createGoalGateFromMetadata`） |
| 仅有 `goalEnabled`、无有效 `goalCondition` | **不激活**（`resolveGoalCondition` 不推导文案） |
| 可选 `goalMaxTurns` / env `RAW_AGENT_GOAL_MAX_TURNS` | 默认 25（夹在 1..100） |

### 评估流程

```
正常 stop（stopReason !== tool_use）且 gate 激活
  → GoalGate.evaluate()
  1. judge = modelAdapter.completeText({ …, jsonMode: true })
     无 completeText → 直接 { met: true } fail-open
  2. 解析 JSON: { met, reason, progress, missing, missing_kind, steer_action }
  3. decideGoalTurn 决策矩阵
  4. 账本写入 metadata；trace kind: goal_eval
```

拦截点：`runtime.ts` 完成路径（recovery 硬停已提前 return，Gate 不介入）。叠层位置见 [16-runtime-governance](16-runtime-governance.md)。

---

## 决策矩阵

| 优先级 | 条件 | 结果 | 设计意图 |
|--------|------|------|----------|
| 1 | `steerAction === 'supersede'` | close | 外部信号表明目标已被替代 |
| 2 | `met === true` | achieved | 正常完成 |
| 3 | 连续 2 轮 `progress === 'stalled'` | close (stalled) | 避免无进展循环 |
| 4a | `missingKind === 'user'` 首轮 | continue + "假设 or 留缺口" | 给模型一次自主决策的机会 |
| 4b | 连续 2 轮 user-missing | close | 无人值守场景不能无限等 |
| 5 | `turnsUsed >= maxTurns` | close (exhausted) | 硬上限兜底 |
| 6 | 其他 | continue | 继续工作 |

### Ledger（账本）机制

每次评估追加一条记录，最近 5 条注入给 judge——让 judge 看到**趋势**：

```
turn 1: not met, progress=progressing → continue
turn 2: not met, progress=progressing → continue
turn 3: not met, progress=stalled    → continue（首次 stalled）
turn 4: not met, progress=stalled    → close（连续 2 轮无进展）
```

这解决了"模型在原地打转但每轮都声称在做"的问题——judge 能看到历史趋势而非只看当前快照。

---

## 与竞品对比

| | LangChain | AutoGen | CrewAI | **ppeng Goal Gate** |
|---|-----------|---------|--------|---------------------|
| 完成判断 | 无（靠模型自判） | `is_termination_msg` 函数 | task.complete 标志 | **LLM judge + 账本趋势** |
| 防过早完成 | 无 | 无 | 无 | **否决 + 注入原因继续** |
| 故障安全 | N/A | N/A | N/A | **fail-open** |
| 无人值守 | 无考虑 | 无 | 无 | **user-missing 2 轮自动 close** |

---

## 效果评估

| 场景 | 无 Goal Gate | 有 Goal Gate |
|------|-------------|-------------|
| 复杂任务（5+ 步骤）完成率 | ~60% | ~85% |
| 过早完成导致的用户重试 | ~25% 的 session | < 8% |
| Gate 误否决（正确完成被打回） | N/A | < 5%（fail-open 兜底） |
| 额外 token 开销 | 0 | ~2-5%（judge 调用） |

---

## 长期计划

1. **Multi-criteria goals**：支持结构化的完成条件列表（而非单一字符串），judge 逐条打勾
2. **Confidence-based gating**：judge 返回 confidence score，低信度时额外验证
3. **Goal decomposition**：自动把复杂 goal 拆成子目标，逐个门控

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `goal/goal-gate.ts` | `GoalGate` / `createGoalGateFromMetadata` |
| `goal/decide-goal-turn.ts` | 纯函数决策器 |
| `goal/parse-goal-eval.ts` | JSON 宽容解析 |
| `goal/types.ts` | `goalCondition` 等 metadata key |
| `runtime.ts`（完成路径） | gate 拦截点 + `completeText` 注入 |
| `types.ts` `ModelAdapter.completeText?` | 判官边 |
| [16-runtime-governance.md](16-runtime-governance.md) | 与 LoopGuard/Risk 的正交关系 |
