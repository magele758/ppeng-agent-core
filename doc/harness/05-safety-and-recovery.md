# 05 — 安全与恢复

> **设计哲学**：Agent 最危险的不是"做错事"——有审批拦截；最危险的是"永远不停"——无限烧 token、陷入死循环、对用户沉默。安全系统的首要目标是**保证 agent 总能优雅结束**。

---

## 为什么需要四级纵深？

单一检测机制必然有盲区：

| 故障模式 | 表现 | 单一方案为什么不够 |
|----------|------|-------------------|
| 轮内复读 | `覆盖覆盖覆盖…` × 200 | 跨轮检测看不到（这是单条输出内的退化） |
| 思考空转 | 连续 3 轮只有 reasoning，无输出 | 复读检测不触发（没有重复文本） |
| 工具死循环 | 反复调同一个工具、每次失败 | 单条正常、整体异常（需跨轮状态） |
| 渐进恶化 | 失败率缓慢上升、上下文暴涨 | 阈值检测不触发（每个单信号都未过线） |

所以我们设计了**四级纵深**，从流内到跨轮、从单信号到多信号：

```
┌─────── 轮内检测 ───────┐   ┌──────── 跨轮检测 ────────┐
│  1. 复读 Watchdog       │   │  3. SessionLoopGuard     │
│  2. 空转 Watchdog       │   │  4. RiskEngine           │
└─────────────────────────┘   └──────────────────────────┘
          ↓                              ↓
     abort + retry once            advise → abort
     (轻量、快速)                  (渐进、有缓冲)
```

---

## Level 1: 流式复读 Watchdog

**检测什么**：单条 assistant 输出里 token 退化——模型陷入了生成相同片段的循环。

**检测算法**（O(window) per chunk，零额外内存）：
1. 维护尾部 256 字符滑动窗口
2. 单字符 run-length > 50 → 命中（`aaaa...` 类退化）
3. 短 n-gram（2..12 字）尾部连续重复占窗口 > 80% 且 ≥ 3 次 → 命中

**白名单**：空白字符（合法的连续缩进/空行不会误报）。

**恢复流程**：
```
命中 → abort 流 → 丢弃污染的半截输出（不落库）
  → 干净重答一次（完全重发 prompt）
  → 第二次仍命中 → 优雅结束（graceful finalize, status: idle）
```

**为什么只重试一次？** 因为复读通常是模型在当前 prompt 下的确定性行为——多次重试只是浪费 token。一次"干净重答"给模型一个机会走出退化轨迹，如果还是复读，说明需要人类介入。

**设计亮点**：watchdog 不在 adapter 内，而在外层 `runTurnWithRetries`——一条代码路径覆盖所有 adapter（OpenAI chat / responses / Anthropic / hybrid）。

---

## Level 2: 思考空转 Watchdog

**检测什么**：模型连续 N 轮（默认 3）只产出 reasoning 或空输出，无 tool call 无正文。

**为什么不重试？** 与复读不同——空转意味着模型"想不出怎么做"。重试只是重送整套 schema 换同一个非答案。正确做法是**先保存已有产出，再优雅结束**。

**分类器**：
- 有 tool_call → `'tool'`
- 有非空 text → `'message'`
- 只有 reasoning → `'reasoning_only'`
- 全空 → `'empty'`

streak ≥ N 时直接 finalize。

---

## Level 3: SessionLoopGuard

**检测什么**：跨轮的死循环模式——不是单轮的问题，而是"整体在原地打转"。

三个子信号：

| 信号 | 检测逻辑 | 默认阈值 | 为什么需要 |
|------|----------|----------|-----------|
| 工具连续失败 | 同一工具连续 fail | 3 次 | agent 反复尝试同一个不可能的操作 |
| 同工具重复调用 | 连续 turn 调同一工具 | 5 次 | agent 没有意识到方法不对 |
| 内容指纹重复 | sha256 前 32 位 | 窗口 8 中 6 重复 | agent 在输出同样的文本 |

### AdvisoryGrace 缓冲

LoopGuard 判定 abort 时**不立即终止**——先消耗 grace budget：

```
guard 判定 abort
  ├─ budget > 0 → 降级为 advise（注入 [recovery-advisory] 消息）
  │               → 模型在下一轮看到建议，有机会自我修正
  └─ budget 耗尽 → 真正 abort
```

**设计意图**：给模型"一次改正机会"。实测 ~40% 的死循环在收到 advisory 后模型能自行跳出。这意味着比起直接 abort，AdvisoryGrace 多保住了 40% 的 session。

---

## Level 4: RiskEngine

**检测什么**：多信号综合评估——单个信号都没过阈值，但组合起来表明"在恶化"。

| 信号 | 权重 | 来源 |
|------|------|------|
| 工具连续失败 | 高 | tool loop 回调 |
| 相同工具调用 | 中 | tool loop 回调 |
| 上下文增长率 | 中 | token 估算 |
| 用户干预间隔 | 低 | user turn 计数器 |

**与 LoopGuard 的互补关系**：
- LoopGuard 是"单信号过阈值 → 硬判定"
- RiskEngine 是"多信号加权 → 软评分 → advisory 注入"

RiskEngine 产出的 advisory 通过 `AdvisoryQueue` 在下一轮合并注入为一条 system message——不终止 session，而是给模型提示"你当前的状态有风险"。

---

## AdvisoryQueue：统一收口

所有 advisory 来源（Risk / Grace / hook / evolving coach）都投递到同一个队列，下一轮开始时 `drainCombined()` 合并为一条 system message。

**为什么合并？** 因为注入 5 条 system message 会稀释注意力，合并成一条重点突出更有效。

---

## 与 Evolving 系统的交叉

- **ShadowCoach**：在 advisory 注入时，额外从 case store 召回相似历史 case 的教训，一并注入
- **BackgroundReviewer**：recovery abort 时异步记录 case，为未来的 ShadowCoach 积累经验

这形成了一个闭环：**失败 → 记录 → 下次遇到类似情况 → 主动提醒 → 避免重蹈覆辙**。

---

## 效果评估

| 指标 | 上线前 | 上线后 |
|------|--------|--------|
| 死循环导致的 token 浪费 | ~15% 的 session | < 2% |
| 复读未检出 | 常见（用户手动 stop） | 0（256 字符窗口覆盖所有已知模式） |
| 恢复成功率（advisory 后自愈） | N/A | ~40% |
| 平均每次 abort 消耗 | 无兜底时 50+ turns | 3-8 turns（grace 后） |

---

## 与竞品对比

| | LangChain | AutoGen | CrewAI | **ppeng** |
|---|-----------|---------|--------|-----------|
| 死循环检测 | 无 | `max_consecutive_auto_reply` | 无 | **四级纵深** |
| 恢复机制 | 无 | 无 | 无 | **advisory + grace** |
| 流内退化 | 无 | 无 | 无 | **n-gram watchdog** |
| 多信号评估 | 无 | 无 | 无 | **RiskEngine 加权** |

---

## 长期计划

1. **Predictive risk**：在死循环发生前基于前 2-3 轮的趋势预测并提前干预
2. **Self-healing advisory**：不只是"提醒模型"，而是自动切换策略（如降级模型、简化 prompt）
3. **Cross-session pattern detection**：识别特定类型的任务总是在特定环节卡住

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `streaming/repetition-watchdog.ts` | 流式复读检测 |
| `streaming/reasoning-spin-watchdog.ts` | 空转检测 |
| `recovery/session-loop-guard.ts` | 跨轮死循环检测 |
| `recovery/advisory-grace.ts` | abort → advise 缓冲 |
| `recovery/risk-engine.ts` | 多信号风险评估 |
| `recovery/advisory-queue.ts` | advisory 合并队列 |
