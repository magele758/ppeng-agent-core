# 11 — Subagents 与 Swarm

> 本章解释三种已实现的协作粒度。是否值得并行取决于任务能否独立拆分。

---

## 三种粒度

| 模式 | 粒度 | 生命周期 | 适用场景 |
|------|------|----------|----------|
| `spawn_subagent` | 轻量 | 父 tool call 同步等待；child session 持久化 | "帮我查一下这个函数的用法" |
| `spawn_teammate` | 中等 | 有持久化任务状态 | "你负责写测试，我负责写实现" |
| Swarm | 重量 | 完整 run 生命周期 + review | "5 个 agent 并行处理 5 个模块" |

---

## spawn_subagent（轻量委托）

**设计意图**：父 agent 遇到子任务，不想占用自己的上下文 → 开一个子 session 去做 → 拿回结果继续。

```
parent session (running)
  └─ spawn_subagent(prompt, role, opts?)
       ├─ 创建 child session (mode='subagent')
       ├─ 可选 allowedTools 白名单
       ├─ runtime.runSession(childId) ← 同步等待
       ├─ 返回 child 最终文本作为 tool result
       └─ parent 继续
```

**关键设计约束**：
- 子 session 有独立 `session_messages`，parent 只接收汇总结果；若共享 workspace，文件副作用仍可能相互影响
- 结果通过 `formatSubagentSummary` 压缩后才返回——避免把子 session 的大量工具调用全灌回 parent
- 子 session 有独立的 `subagent_stop` hook

## spawn_teammate（Swarm 成员）

比 subagent 重——teammate 有持久化的任务状态和可选的 review 流程：

```
parent → spawn_teammate(name, instructions, taskDescription)
  └─ SwarmExecutor 接管
       ├─ 创建 SwarmTask（持久化）
       ├─ 创建 session (专属 agent)
       ├─ runtime.runSession
       └─ 结果 → SwarmReview (可选)
```

---

## SwarmExecutor

### 为什么不直接用 subagent？

| | subagent | Swarm |
|---|---------|-------|
| 状态持久化 | 无 | ✅ (swarm_tasks 表) |
| Review 流程 | 无 | ✅ (reviews + scores/passed) |
| 超时管理 | 无 | ✅ (`getTimedOutRuns`：`createdAt + maxDurationMs`) |
| 跨 session 可见 | 无 | ✅ (HTTP API 查询) |
| 通信方式 | 只返回结果 | 信箱（send_message/read_inbox） |
| 策略落地 | — | **仅 `pipeline` MVP**；其它 strategy fail-closed |

HTTP（`/api/swarm/runs|tasks|reviews`）、与 Orchestrator 的 `orchestrationRunId`、DeepResearch 接缝 → **[20-orchestration-evolution-eval.md](20-orchestration-evolution-eval.md) §2–3**。

### 状态机

```
SwarmRun:  pending → running → [completed | failed | timed_out]
SwarmTask: pending → running → [completed | failed | needs_review → approved/rejected]
```

### 信箱通信

```
list_team    → 列出 teammate 及其状态
send_message → 写入 mailbox 表
read_inbox   → 读取未读消息
```

这模拟了真实团队的"异步沟通"模式——agent 之间不需要实时同步，通过信箱交换信息。

---

## 为什么使用信箱而不是共享 transcript？

共享状态的问题：
1. 并发写冲突
2. 一个 agent 的脏数据污染所有人
3. 难以审计"谁告诉了谁什么"

信箱的优势：
1. 无并发冲突（append-only）
2. 自然审计（每条消息有 sender + receiver + timestamp）
3. agent 选择性读取（不被无关信息淹没）

---

## 如何评估

对同一任务固定拆分方案，比较总 wall time、重复修改、冲突数、失败隔离和 review 返工。并行 session 不自动带来加速，任务耦合和工具资源竞争可能抵消收益。

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `swarm/executor.ts` | SwarmExecutor |
| `swarm/store.ts` | CRUD (runs/tasks/reviews) |
| `session/subagent-contract.ts` | subagent 接口约定 |
| `tools/builtin-tools.ts` | spawn_subagent / spawn_teammate / list_team / send_message |
