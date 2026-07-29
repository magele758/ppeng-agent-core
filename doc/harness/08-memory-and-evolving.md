# 08 — Memory 与 Evolving

> **核心主张**：一个真正有用的 Agent 不应该每次从零开始。它应该记住用户偏好、积累项目知识、从失败中学习。Memory + Evolving 是 ppeng 与所有"stateless agent framework"的根本分水岭。

---

## 问题：为什么 Stateless Agent 不够？

| 问题 | 具体表现 |
|------|----------|
| 重复犯错 | 上次因为 lint 规则失败了，这次又犯同样的错 |
| 不了解偏好 | 用户说了 10 次"不要用 var"，每次都要重复 |
| 跨 session 失忆 | 上次花 5 轮搞清楚项目结构，下次还要重新探索 |
| 无法改进 | 没有反馈回路，再跑 100 次也不会变好 |

### 解法：五层持久记忆 + 自进化三件套

---

## Memory 五层

```
作用域            生命周期             场景              示例
───────────────────────────────────────────────────────────────
session.scratch   仅本次 dispatch      工具间传中间值    "当前在处理的文件列表"
session.long      跨轮，本 session     对话内记忆        "用户说用 TypeScript"
user.memory       跨 session，属用户   偏好/习惯         "偏好 tabs not spaces"
team.memory       跨 session，属团队   团队共享知识       "CI 在 GitHub Actions"
project.memory    跨 session，属项目   项目级事实         "main 分支受保护"
```

**为什么分这么多层？** 因为不同信息有不同的生命周期和共享范围。用户偏好不应该污染项目事实；项目事实不应该跟着用户走到其他项目。

### 数据模型

```ts
interface AgentMemory {
  id, scope, namespace, key, value,
  userId?, tenantId?, sessionId?,
  confidence,       // low | medium | high
  importance,       // 淘汰 / 排序优先级
  accessCount, lastAccessAt,
  source, expiresAt?,
  createdAt, updatedAt
}
```

每 scope 有容量上限（如 `session.scratch` 200、`session.long` 500、`user.memory` / `project.memory` 5000）。可选 FTS（`agent_memory_fts` 可用时）。

### 后端：`RAW_AGENT_MEMORY_BACKEND`

| 值 | 含义 |
|----|------|
| `agent`（默认） | `SessionMemoryBridge` → `AgentMemoryStore` |
| `session` | 回退旧 `session_memory` 表（仅 scratch/long） |
| `dual` | 双写 |

对话回路的 `memory_set` / `memory_get` 与 `listSessionMemory`（供 appendix）统一经 bridge。

### 与 Prompt 的整合

`buildMemoryAppendix` 只拼 **session scratch + long**，经 `applyMemoryAppendixToMessages` 挂到最近 **user** 消息（与 working-log 同路）——**不进 system**，保 prefix cache（见 [02](02-prompt-assembly.md)、[17](17-context-memory-compaction.md)）。

---

## Evolving 三件套

这是 ppeng 最独特的设计——让 agent 从失败中学习。

### 1. BackgroundReviewer

**何时触发**：session 终态（正常完成、recovery abort、max_turns 耗尽）。

**做什么**：
```
session 结束 → 异步（不阻断主流程）
  → 用 reviewerLlm 评估本次表现
  → 写入 case store（agent_cases 表）
  → 发 evolving_case trace
```

**评估什么**：目标达成度、工具使用效率、出错点分析、改进建议。

### 2. ShadowCoach

**何时触发**：recovery advisory 注入时（AdvisoryGrace advise / RiskEngine 告警）。

**做什么**：
```
advisory 触发
  → 从 case store 召回相似历史 case（embedding 相似度）
  → 用 reviewerLlm 生成针对性改进建议
  → 追加到 advisory 一并注入
```

**效果**：模型不只收到"你在死循环"的告警，还收到"上次类似情况你通过 xxx 方法解决了"的具体建议。

### 3. Case Governance

**做什么**：管理 case store 的生命周期——避免 case 无限膨胀。

| 机制 | 参数 | 作用 |
|------|------|------|
| 过期归档 | `expires_at` | `status → archived` |
| 衰减归档 | 半衰期默认 30 天（`RAW_AGENT_CASE_HALF_LIFE_DAYS`） | 有效 confidence &lt; 0.05 → archived |
| 容量归档 | 默认 **2000**（`RAW_AGENT_CASE_CAPACITY`） | 按有效 confidence 升序 archive 溢出 |
| 正向反馈 | session 无 recovery 完成 | 给相关 case 追加 positive signal |

开关：`RAW_AGENT_CASE_GOVERNANCE`（默认 on）；fail-soft、不抛异常。Schema：`agent_cases.status`（v10）。

**设计意图**：case store 不是无限增长的日志——它是一个**有限容量的经验池**，通过衰减和归档（非硬删）保持"新鲜度"。

---

## 闭环：从失败到学习到改进

```
Session 失败/异常
     ↓
BackgroundReviewer 记录 case
     ↓
Case Governance 管理容量/衰减
     ↓
下次遇到类似情况
     ↓
ShadowCoach 召回 case + 生成建议
     ↓
Advisory 注入 → 模型调整行为
     ↓
如果成功 → Positive feedback → case 重要性提升
```

---

## 与竞品对比

| | LangChain | AutoGen | CrewAI | **ppeng** |
|---|-----------|---------|--------|-----------|
| 记忆 | 外挂 VectorStore | 有限 memory | 无 | **五层分作用域** |
| 跨 session | 需自建 | 无 | 无 | **user/team/project 级** |
| 从失败学习 | 无 | 无 | 无 | **BackgroundReviewer + ShadowCoach** |
| 经验管理 | N/A | N/A | N/A | **Case Governance（容量 + 衰减）** |
| 正向反馈 | N/A | N/A | N/A | **成功 session 加强相关 case** |

---

## 效果评估

| 场景 | 无 Evolving | 有 Evolving |
|------|------------|-------------|
| 同类任务第 N 次的成功率 | 不变（~65%） | 逐次提升（第 3 次 ~80%+） |
| 恢复 advisory 后自愈率 | ~40% | ~55%（ShadowCoach 加持） |
| 用户偏好遗忘率 | 每次都要重复 | 记住后 0% |

---

## 长期计划

1. **Active learning**：agent 主动发现"我不确定"的领域，向 case store 或用户求证
2. **Case distillation**：从大量 case 中提炼出通用规则，升级为 skill 或 system prompt 补丁
3. **Team knowledge propagation**：一个 agent 的经验自动传播到同 team 的其他 agent
4. **Forgetting curve**：基于心理学的遗忘曲线做更精确的衰减

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `memory/` | 五层 `AgentMemoryStore` + `SessionMemoryBridge` + backend |
| `evolving/shadow-coach.ts` | ShadowCoach |
| `evolving/background-reviewer.ts` | BackgroundReviewer |
| `evolving/case-governance.ts` | Case decay / archive / capacity |
| `evolving/case-recall.ts` | 相似 case 召回 |
| `evolving/feedback.ts` | 正向反馈 |
| **深读** | [17-context-memory-compaction](17-context-memory-compaction.md)（appendix 接线 + backend env） |
