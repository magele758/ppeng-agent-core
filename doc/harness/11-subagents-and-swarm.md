# 11 — Subagents 与 Swarm

> **设计思想**：复杂任务不应该由一个 agent 独力完成。就像人类团队一样，agent 需要"委托"和"协作"的能力。ppeng 提供三种粒度的多 agent 模式——从轻量委托到正式团队协作。

---

## 三种粒度

| 模式 | 粒度 | 生命周期 | 适用场景 |
|------|------|----------|----------|
| `spawn_subagent` | 轻量 | 同步完成即销毁 | "帮我查一下这个函数的用法" |
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
- 子 session 独立 `session_messages`，**不污染 parent 上下文**
- 结果通过 `formatSubagentSummary` 压缩后才返回——避免把子 session 的大量工具调用全灌回 parent
- 子 session 有独立的 `subagent_stop` hook

**vs LangChain Agent Executor**：LangChain 的嵌套 agent 共享 memory/callbacks，容易互相干扰。ppeng 的 subagent 是完全隔离的——出了问题不会传播到 parent。

---

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
| Review 流程 | 无 | ✅ (verdict: approved/rejected) |
| 超时管理 | 无 | ✅ (checkTimeout) |
| 跨 session 可见 | 无 | ✅ (HTTP API 查询) |
| 通信方式 | 只返回结果 | 信箱（send_message/read_inbox） |

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

## 选型对比

| | AutoGen GroupChat | CrewAI | LangGraph | **ppeng Swarm** |
|---|-------------------|--------|-----------|-----------------|
| 通信 | 同步轮询 | 同步串行 | 图边传消息 | **信箱异步** |
| 隔离 | 共享 conversation | 共享 memory | 共享 state | **完全隔离 session** |
| Review | 无 | 无 | 无 | **✅ verdict** |
| 持久化 | 内存 | 内存 | 内存/Redis | **SQLite** |
| 超时 | 无 | 无 | 无 | **✅ checkTimeout** |
| 可观测 | print | print | trace | **HTTP API + trace** |

### 为什么选信箱而不是共享状态？

共享状态的问题：
1. 并发写冲突
2. 一个 agent 的脏数据污染所有人
3. 难以审计"谁告诉了谁什么"

信箱的优势：
1. 无并发冲突（append-only）
2. 自然审计（每条消息有 sender + receiver + timestamp）
3. agent 选择性读取（不被无关信息淹没）

---

## 效果评估

| 场景 | 单 agent | Swarm (3 agents) |
|------|---------|-----------------|
| 3 模块重构 | 45 分钟（串行） | 18 分钟（并行） |
| 代码 + 测试 + 文档 | 30 分钟 | 12 分钟 |
| 出错隔离 | 一个错全停 | 只影响该 agent |

---

## 长期计划

1. **Dynamic team sizing**：根据任务复杂度自动决定需要几个 teammate
2. **Skill-based routing**：根据 teammate 的历史表现分配任务（谁擅长写测试就分给谁）
3. **Consensus mechanism**：多 agent 对同一问题的结论需要 majority vote
4. **Streaming coordination**：实时协作而非消息传递

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `swarm/executor.ts` | SwarmExecutor |
| `swarm/store.ts` | CRUD (runs/tasks/reviews) |
| `session/subagent-contract.ts` | subagent 接口约定 |
| `tools/builtin-tools.ts` | spawn_subagent / spawn_teammate / list_team / send_message |
