# 08 — Memory 与 Evolving

五层持久记忆 + 自进化三件套（ShadowCoach / BackgroundReviewer / CaseGovernance）。

---

## Memory 五层 (`memory/`)

```
作用域            生命周期        场景
────────────────────────────────────────────
session.scratch   仅本次 dispatch  工具之间传递中间值
session.long      跨轮但属本 session 对话内记忆
user.memory       跨 session、属该用户 用户偏好 / 习惯
team.memory       跨 session、属 team  团队共享知识
project.memory    跨 session、属项目   项目级事实
```

### 数据模型 (`memory/types.ts`)

```ts
interface AgentMemory {
  id, scope, key, value,
  confidence, importance,
  accessCount, lastAccessAt,
  source, mergedFromJson,
  createdAt, updatedAt
}
```

### 对话回路

- 工具 `memory_set` / `memory_get`（`tools/memory-tools.ts`）让模型主动读写。
- `PromptBuilder.buildMemoryAppendix` 把 scratch + long-term 注入 user 侧。
- `memory/session-memory-bridge.ts`：旧 `session_memory` 表 → 新 `agent_memory` 表的桥接层（`RAW_AGENT_MEMORY_BACKEND=session` 可回退）。

### HTTP API

`GET/POST /api/memory`（scope / key / value / user / tenant filter）。

---

## Evolving 三件套 (`evolving/`)

### 1. ShadowCoach (`shadow-coach.ts`)

- **何时触发**：recovery advisory 注入时（AdvisoryGrace advise / RiskEngine 告警）。
- **做什么**：从 case store 召回相似历史 case → 用 reviewerLlm 生成改进建议 → 追加到 advisory。
- **开关**：`RAW_AGENT_EVOLVING_COACH=1`。

### 2. BackgroundReviewer (`background-reviewer.ts`)

- **何时触发**：session 正常完成、recovery abort、max_turns 耗尽等终态。
- **做什么**：异步创建 case record（不阻断主流程），用 reviewerLlm 评估本次表现 → 写回 case store + `evolving_case` trace。
- **开关**：`RAW_AGENT_EVOLVING_REVIEWER=1`（与 master `RAW_AGENT_AGENT_LEARNING=1` 配合）。

### 3. Case Governance (`case-governance.ts`)

- **何时触发**：每次 `runSession` 入口 fail-soft。
- **做什么**：
  - 过期 case（`expires_at < now`）标 `expired`
  - 超容量（`RAW_AGENT_CASE_CAPACITY`，默认 200）→ 最老过期 case 淘汰
  - 半衰期（`half_life_days`，默认 30）→ importance 衰减
- **数据表**：`agent_cases`（SQLite，migration v9–v10）。

### Case recall (`case-recall.ts`)

给定当前 session context → 从 case store 召回 top-K 相似 case → 用于 ShadowCoach。相似度由 `evolving/embedding.ts` 计算。

---

## Positive Feedback (`evolving/feedback.ts`)

session 正常完成且无 recovery 事件 → `applyEvolvingPositiveFeedback`：给相关 case 追加 positive signal。

---

## Env

| 变量 | 默认 | 说明 |
|------|------|------|
| `RAW_AGENT_MEMORY_BACKEND` | agent | `agent` 用新表；`session` 回退旧表 |
| `RAW_AGENT_AGENT_LEARNING` | 0 | evolving master 开关 |
| `RAW_AGENT_EVOLVING_REVIEWER` | 0 | background reviewer |
| `RAW_AGENT_EVOLVING_COACH` | 0 | shadow coach |
| `RAW_AGENT_CASE_GOVERNANCE` | 1 | case governance |
| `RAW_AGENT_CASE_CAPACITY` | 200 | 最大 case 数 |
| `RAW_AGENT_CASE_HALF_LIFE_DAYS` | 30 | importance 半衰期 |
