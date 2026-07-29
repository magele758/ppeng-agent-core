# 11 — Subagents 与 Swarm

单 session 内委托子任务 + 多 agent 协作图。

---

## spawn_subagent（轻量委托）

`spawn_subagent` 工具让当前 agent 在同一 runtime 内创建一个**子会话**：

```
parent session (running)
  └─ spawn_subagent(prompt, role, opts?)
       ├─ 创建 child session (mode='subagent', agentId=resolveSubagentAgentId)
       ├─ 可选 allowedTools 白名单（pin 在 child session metadata）
       ├─ runtime.runSession(childId)
       ├─ 返回 child 最终 assistant text 作为 tool result
       └─ parent 继续下一轮
```

### 注意
- 子会话独立 `session_messages`，不污染 parent 上下文。
- `subagent_stop` lifecycle hook 单独于 parent 的 `stop` hook。
- `formatSubagentSummary`：包装 child 结果为 parent 可消费的摘要格式。

---

## spawn_teammate（Swarm 成员）

比 subagent 重——teammate 是 Swarm 图的节点，有持久化任务状态和 review 流程：

```
parent → spawn_teammate(name, instructions, taskDescription)
  └─ SwarmExecutor 接管
       ├─ 创建 SwarmTask
       ├─ 创建 session (mode='subagent', 专属 agent)
       ├─ runtime.runSession
       └─ 结果 → SwarmReview (可选)
```

---

## SwarmExecutor (`swarm/executor.ts`)

```ts
class SwarmExecutor {
  async runSwarm(opts): SwarmRun
  async tick(runId): void    // 推进一步
  async checkTimeout(run)
}
```

### 数据模型

| 表 | 字段摘要 |
|----|----------|
| `swarm_runs` | id, parentSessionId, status, config, startedAt, completedAt |
| `swarm_tasks` | id, runId, name, instructions, status, assigneeSessionId |
| `swarm_reviews` | id, taskId, reviewer, verdict, feedback |

### 状态机

```
SwarmRun:  pending → running → [completed | failed | timed_out]
SwarmTask: pending → running → [completed | failed | needs_review → approved/rejected]
```

---

## list_team / send_message / read_inbox

协作三工具，实现进程内「信箱」模式：
- `list_team`：列出当前 swarm 的 teammate 及其状态
- `send_message`：parent/teammate 之间发消息（写 `mailbox` 表）
- `read_inbox`：读取自己信箱里的未读消息

---

## HTTP API

| Path | 说明 |
|------|------|
| `GET /api/swarm/runs` | 列出 swarm 运行 |
| `POST /api/swarm/runs` | 创建 swarm 运行 |
| `GET /api/swarm/runs/:id/tasks` | 该 run 下的任务列表 |
| `GET /api/swarm/runs/:id/reviews` | review 列表 |

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `swarm/executor.ts` | SwarmExecutor |
| `swarm/store.ts` | SwarmRunStore / SwarmTaskStore / SwarmReviewStore |
| `swarm/types.ts` | 类型定义 |
| `session/subagent-contract.ts` | `formatSubagentSummary` / `resolveSubagentAgentId` |
| `tools/builtin-tools.ts` | spawn_subagent / spawn_teammate / list_team / send_message |
| `runtime.ts:spawnSubagent` | 实际执行子会话 |
