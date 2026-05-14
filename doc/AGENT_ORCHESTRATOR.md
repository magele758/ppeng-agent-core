# Agent 调度器 Loop 规划

本文定义“当前 Agent 作为调度器”的目标形态：它不只是完成单次会话，而是把来自用户、RSS、trace、告警、issue 的信号映射到能力地图和 8 个飞轮，再选择合适的 CLI-Agent、SubAgent、Teammate、domain tool 或脚本执行。

## 目标

1. 输入信号先分类，再执行，避免所有事情都直接进入 coding。
2. 每个执行计划都有状态、owner、工件、失败下一跳。
3. 高风险任务默认进入审批、PR 或人工确认。
4. 调度结果可被 Web Console、Evolution、Harness、Self-heal 复用。

## 输入信号

| Signal | 来源 | 例子 | 默认飞轮 |
|--------|------|------|----------|
| `manual_request` | 用户会话 | “实现 K8s 部署能力” | D / B |
| `rss_item` | Evolution learn | arXiv、技术博客 | A / D |
| `trace_event` | daemon trace | tool failure、latency spike | B / F |
| `alert` | SRE / Prom / Loki / PagerDuty | error rate high | C |
| `security_notice` | audit / advisories | CVE、secret leak | E |
| `contract_change` | PR / API diff | SSE chunk 变化 | G |
| `eval_failure` | Harness | wrong tool sequence | H |

## 核心类型

建议先在文档中稳定类型，再落到 `packages/core/src/orchestrator/`。

```ts
type FlywheelType = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

type CapabilityTag =
  | 'runtime'
  | 'web-console'
  | 'evolution'
  | 'domain-agents'
  | 'security'
  | 'cost-capacity'
  | 'contracts'
  | 'deployment'
  | 'agent-quality'
  | 'memory'
  | 'multi-user'
  | 'deepresearch'
  | 'swarm'
  | 'skills'
  | 'subagent';

type OrchestrationStage =
  | 'classify'
  | 'research'
  | 'design'
  | 'implement'
  | 'review'
  | 'test'
  | 'deploy-smoke'
  | 'retrospective'
  | 'done'
  | 'blocked';
```

## 执行计划模型

```ts
interface OrchestrationRun {
  id: string;
  title: string;
  sourceType: string;
  sourceRef: string;
  flywheels: FlywheelType[];
  capabilityTags: CapabilityTag[];
  riskLevel: 'low' | 'medium' | 'high';
  status: 'pending' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'blocked';
  budget?: {
    maxTurns?: number;
    maxCostUsd?: number;
    maxDurationMs?: number;
  };
  createdAt: string;
  updatedAt: string;
}

interface OrchestrationStep {
  id: string;
  runId: string;
  stage: OrchestrationStage;
  executor: string;
  inputArtifact?: string;
  outputArtifact?: string;
  status: string;
  failureType?: string;
  nextAction?: string;
}
```

## 执行者路由

| 场景 | 首选执行者 | 备用执行者 | 产出 |
|------|------------|------------|------|
| 技术源归纳 | `researcher` subagent | Cursor CLI | source summary、capability tags |
| 设计/方案 | `planner` subagent | Codex / Claude | design note、acceptance criteria |
| 实现 | Cursor CLI / `implementer` | Claude Code | branch、diff、test notes |
| 审查 | `reviewer` / Codex | Kieran/TypeScript reviewer | review report、risk level |
| 测试补强 | Gemini / evaluator | local scripts | test patch、eval result |
| SRE 诊断 | `sre-oncall` | Prom/Loki/K8s tools | incident note、fix candidate |
| 安全 | security reviewer | audit scripts | threat note、blocked reason |
| 契约 | contract reviewer | schema scripts | schema diff、breaking flag |
| 发布 | shell scripts | Helm / kubectl | smoke result、rollback note |

## 状态持久化

短期可先写 Markdown/JSONL，长期应进入 SQLite。

建议表：

```text
orchestration_runs
orchestration_steps
orchestration_artifacts
orchestration_events
```

事件字段：

```text
run_id
step_id
kind
actor
payload_json
created_at
```

与现有表关系：

- `sessions.parent_session_id` 可关联 subagent/teammate。
- `tasks` 可作为执行项。
- `task_events` 可追加 orchestration metadata。
- `approvals` 用于高风险 step。
- `traces` 用于观测执行行为。

## 调度流程

```
signal received
  -> classify flywheel and capability
  -> create orchestration run
  -> create steps
  -> assign executor
  -> run or wait for approval
  -> collect artifacts
  -> run harness/release gate if needed
  -> mark done / blocked / failed
  -> feed result to Evolution, Memory, Eval
```

## 失败分类

| failure_type | 下一跳 |
|--------------|--------|
| `infra_network` | retry / F 成本容量 |
| `model_unavailable` | model fallback / budget |
| `test_failed` | implementer / self-heal |
| `contract_failed` | G 契约回路 |
| `security_blocked` | E 安全回路 |
| `cost_exceeded` | F 成本回路 |
| `needs_human` | approval / PR |
| `no_actionable_signal` | A/D source score 降权 |

## Web Console 视图

建议新增 “Flywheel / Orchestration” 视图：

- run 列表：状态、能力标签、飞轮、风险、owner。
- step 时间线：stage、executor、artifact、失败类型。
- artifact 面板：设计、diff、eval、release smoke。
- 手动操作：approve、reject、rerun、convert to backlog、spawn reviewer。

## 调度器运行载体

调度器作为 daemon 内的服务运行，不是独立进程。具体实现为 `packages/core/src/orchestrator/` 模块，由 daemon scheduler（每 1.5s 的 `runScheduler`）驱动。它不新建独立 session，而是在收到 signal 后创建 `OrchestrationRun` 并按 step 分派给 subagent/teammate/CLI。

## OrchestrationRun 与 SwarmRun 的关系

`SwarmRun` 是 `OrchestrationRun` 的一种**执行策略特化**：当 orchestrator 判断一个 run 需要多 agent 协作时，创建一个 SwarmRun 作为子结构挂在 `OrchestrationStep` 下。一个 OrchestrationRun 可以不包含 Swarm（单 agent 即可完成），也可以包含一到多个 SwarmRun（复杂任务拆多个协作阶段）。

## 并发控制

多个 signal 同时到达时：

- 相同 sourceRef 去重（同一 RSS item / issue 不重复创建 run）。
- 不同 signal 可并行创建 run，但受全局并发上限（类似 `EVOLUTION_CONCURRENCY`）限制。
- 高风险 run 自动降为串行（等待人工批准后再执行下一步）。
- 共享资源（如 git 主分支合并）使用互斥锁，复用现有 `createMergeMutex` 模式。

## 与现有能力的落点

| 已有能力 | 调度器如何复用 |
|----------|----------------|
| `spawn_subagent` | 短任务、隔离上下文研究/审查 |
| `spawn_teammate` | 长任务、后台协作 |
| mailbox | handoff 与异步结果回传 |
| self-heal | test_failed 的自动修复执行器 |
| Evolution | A/D 输入与自进化执行器 |
| Skills | 调度器策略、domain playbook |
| Domain agents | SRE/Stock/未来 K8s 等垂直工具 |

