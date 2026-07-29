# 05 — 安全与恢复

四级兜底确保 agent loop 不会无限烧 token、陷入死循环或对用户沉默。

---

## 全景

```
            ┌── 轮内 ──┐        ┌────── 跨轮 ──────┐
严重程度 ↓   流式复读     思考空转      LoopGuard        RiskEngine
─────────── ─────────── ────────── ──────────────── ────────────────
检测位点     流消费层     轮末分类     轮末指纹+计数    轮末多信号评估
主信号       tail n-gram  kind分类     fingerprint     tool fail combo
响应         abort HTTP   graceful    advise/abort    advisory 注入
重试？       一次干净重答  不重试       不重试          是(下轮提示)
```

---

## 1. 轮内复读 watchdog (`streaming/repetition-watchdog.ts`)

**检测什么**：单条 assistant 输出里 token 退化——`覆盖覆盖覆盖…` 数百次。

**检测方式**（尾部 256 字符窗口，O(window) per chunk）：
1. 单字符 run-length > 50（`charRunThreshold`）
2. 短 n-gram（2..12 字）尾部连续重复占窗口 > 80%（`ngramRatioThreshold`）且 ≥ 3 次

**白名单**：空白字符（合法的连续缩进 / 空行）。

**流程**：
```
runTurnWithRetries
  └─ runStreamTurnWithRepetitionGuard
       ├─ RepetitionStreamGuard.push(text_delta / reasoning_delta)
       ├─ 命中 → abort inner signal → throw RepetitionLoopAbortError
       └─ outer catch:
            if (isRepetitionAbort):
              重试 1 次（干净重答，污染半截不落库）
              第 2 次命中 → graceful finalize (status: idle)
```

**Trace**: `repetition_abort { reason, retry: bool }`

---

## 2. 思考空转 watchdog (`streaming/reasoning-spin-watchdog.ts`)

**检测什么**：模型连续 N 轮（默认 3）只产出 reasoning 或空输出，无 tool call 无正文。

**分类器** (`classifyAssistantParts`)：
```
tool_call 存在 → 'tool'
text 有非空 → 'message'
reasoning 有非空 → 'reasoning_only'
else → 'empty'
```

**流程**：turn 结束 → `spinWatchdog.noteParts(parts)`，streak ≥ N 时直接 finalize（**不重试**——再问只是重送整套 schema 换同一个非答案）。

**Trace**: `reasoning_spin_abort { reason, streak }`

---

## 3. SessionLoopGuard (`recovery/session-loop-guard.ts`)

跨轮死循环检测，三个子信号：

| 信号 | 检测 | 默认阈值 |
|------|------|----------|
| `toolFailStreak` | 同一工具连续失败 | 3 次 |
| `sameToolHistory` | 连续 turn 调同一工具（含不同参数） | 5 次 |
| `contentHashes` | assistant turn 指纹重复（sha256 前 32 位） | 窗口 8 条中 6 条重复 |

命中 → 返回 `{ abort: true, reason }` → 进入 **AdvisoryGrace** 缓冲。

### AdvisoryGrace (`recovery/advisory-grace.ts`)

Guard 判定 abort 时先消耗 grace budget（默认 1 次）：
- budget > 0 → 降级为 `advise`（注入 `[recovery-advisory]` system 消息）而非直接终止
- budget 耗尽 → 真正 `abort`

---

## 4. RiskEngine (`recovery/risk-engine.ts`)

多信号综合评估器，与 LoopGuard 互补（LoopGuard 是单信号阈值，RiskEngine 是加权多信号）。

| 信号 | 来源 |
|------|------|
| 工具连续失败 | tool loop 回调 |
| 相同工具调用 | tool loop 回调 |
| 上下文增长率 | estimateMessageTokens |
| 用户干预间隔 | user turn 计数器 |

所有信号 → 加权分数 → 超阈值 → `formatRiskAdvisory()` → `AdvisoryQueue`。

### AdvisoryQueue (`recovery/advisory-queue.ts`)

收集多来源 advisory（Risk / Grace / hook），下一轮开始时 `drainCombined()` 合并注入为一条 system message。

---

## Evolving 与 Recovery 的交叉

- **ShadowCoach** (`evolving/shadow-coach.ts`)：在 advisory 时机额外注入改进建议（可选，`RAW_AGENT_EVOLVING_COACH=1`）。
- **BackgroundReviewer** (`evolving/background-reviewer.ts`)：recovery abort 时异步记录 case（`scheduleBackgroundCaseReview`），供 case governance 分析。

---

## Env 全表

| 变量 | 默认 | 作用 |
|------|------|------|
| `RAW_AGENT_STREAM_WATCHDOG` | 1 | 流式复读 watchdog 总开关 |
| `RAW_AGENT_STREAM_WATCHDOG_CHAR_RUN` | 50 | 单字符连续阈值 |
| `RAW_AGENT_STREAM_WATCHDOG_NGRAM_RATIO` | 0.8 | n-gram 占窗口比例阈值 |
| `RAW_AGENT_STREAM_WATCHDOG_NGRAM_MIN_REPEATS` | 3 | 最少连续重复次数 |
| `RAW_AGENT_STREAM_WATCHDOG_WINDOW` | 256 | 检测窗口字符数 |
| `RAW_AGENT_STREAM_WATCHDOG_MIN_LEN` | 80 | 最小总长度门槛 |
| `RAW_AGENT_STREAM_WATCHDOG_MAX_NGRAM` | 12 | n-gram 最大长度 |
| `RAW_AGENT_REASONING_SPIN_WATCHDOG` | 1 | 空转 watchdog 总开关 |
| `RAW_AGENT_REASONING_SPIN_MAX` | 3 | 连续无进展轮次上限 |
| `RAW_AGENT_RECOVERY_POLICY` | 1 | SessionLoopGuard 总开关 |
| `RAW_AGENT_RECOVERY_ADVISORY_GRACE` | 1 | AdvisoryGrace 开关 |
| `RAW_AGENT_RECOVERY_ADVISORY_GRACE_BUDGET` | 1 | grace 次数 |
| `RAW_AGENT_RISK_ENGINE` | 1 | RiskEngine 总开关 |
