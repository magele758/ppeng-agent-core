# Documentation index / 文档目录

**English** · 本页为 `doc/` 手册入口；运行时约定另见仓库根目录 [`AGENTS.md`](../AGENTS.md)。

---

## Start here / 从这里读

| Document | 中文说明 |
|----------|----------|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 模块划分、数据模型、HTTP API、调度器、内置工具（与 `scripts/doc-sync-tools.mjs` 对齐） |
| [`ENV_REFERENCE.md`](ENV_REFERENCE.md) | 环境变量索引（与 `.env.example` 对照） |
| [`TESTING.md`](TESTING.md) | 单测 / 回归 / E2E / 远程冒烟矩阵 |
| [`CI.md`](CI.md) | GitHub Actions、本地 `npm run ci` 对齐 |
| [`ROADMAP.md`](ROADMAP.md) | 长期路线（P0–P4）；与实现以代码为准 |
| [`EMBEDDING_SDK.md`](EMBEDDING_SDK.md) | `@ppeng/agent-core` 作为可嵌入 SDK：稳定 API 面、embed env 最小契约、examples 验收 |

---

## Runtime capabilities / 运行时能力

| Document | Status | 中文说明 |
|----------|--------|----------|
| [`MEMORY_MULTIUSER.md`](MEMORY_MULTIUSER.md) | Implemented (agent backend) | 五层 `agent_memory`、HTTP `/api/memory`、对话回路经 bridge |
| [`TEAMS_SWARM.md`](TEAMS_SWARM.md) | Pipeline MVP | `SwarmExecutor` + `/api/swarm/*` + Lab Ops 面板 |
| [`AGENT_ORCHESTRATOR.md`](AGENT_ORCHESTRATOR.md) | Engine + CRUD | `OrchestrationEngine.tick`、Evolution 可选记账 |
| [`DEEP_RESEARCH.md`](DEEP_RESEARCH.md) | Pipeline MVP | `ResearchPipeline`、`POST .../tasks/:id/run` |
| [`DOMAIN_AGENTS.md`](DOMAIN_AGENTS.md) | Implemented | 领域包挂载（SRE / Stock 等） |
| [`A2UI.md`](A2UI.md) | Implemented | 对话内结构化 UI surface |
| [`AGENTIC_SAFETY_RUNTIME.md`](AGENTIC_SAFETY_RUNTIME.md) | Optional appendix | 失范治理与运行时控件映射 |
| [`PROMPT_CACHE.md`](PROMPT_CACHE.md) | Implemented | 稳定/动态 system 前缀与 KV 缓存 |
| [`EXTERNAL_AI_CLI.md`](EXTERNAL_AI_CLI.md) | Optional | `claude_code` / `codex_exec` / `cursor_agent` |
| [`skill-router-baseline.md`](skill-router-baseline.md) | Implemented | Skills 路由 baseline（legacy / hybrid） |

沙箱实现见 [`ARCHITECTURE.md`](ARCHITECTURE.md) § `packages/core/src/sandbox/`（`RAW_AGENT_SANDBOX_MODE`），不再维护独立调研稿。

---

## Harness 纵向切片 / Vertical slice deep-dives

> **从入口到存储的完整路径**，每条切片讲一个完整故事，而非按代码目录罗列。入口 → [`harness/README.md`](harness/README.md)

**实现路径（必读）**：本仓库 **自建 Agent Loop**（直接调 LLM API），**不使用** `@openai/agents`。专章 → [`harness/00-self-built-agent-loop.md`](harness/00-self-built-agent-loop.md)；学习序 → [`harness/from-zero/`](harness/from-zero/README.md)。

| # | Document | 中文摘要 |
|---|----------|----------|
| 0 | [`harness/00-self-built-agent-loop.md`](harness/00-self-built-agent-loop.md) | **自建循环 vs openai-agents**；turn / tool 配对 / 停止条件 / 入口 |
| — | [`harness/from-zero/`](harness/from-zero/README.md) | 从 0 学习序（02 = 循环核心章） |
| 1 | [`harness/01-request-lifecycle.md`](harness/01-request-lifecycle.md) | HTTP → session → turn loop → stream/SSE |
| 2 | [`harness/02-prompt-assembly.md`](harness/02-prompt-assembly.md) | System prompt 四段：stable / dynamic / advisory / user appendix |
| 3 | [`harness/03-tool-execution.md`](harness/03-tool-execution.md) | filter → approve → execute → redact → persist |
| 4 | [`harness/04-context-economics.md`](harness/04-context-economics.md) | micro-compact / episodic / autoCompact / budget / working log |
| 5 | [`harness/05-safety-and-recovery.md`](harness/05-safety-and-recovery.md) | LoopGuard / RiskEngine / AdvisoryGrace / watchdog |
| 6 | [`harness/06-goal-gate.md`](harness/06-goal-gate.md) | soft-completion gate + ledger + stalled/exhausted |
| 7 | [`harness/07-skills-and-routing.md`](harness/07-skills-and-routing.md) | discovery → lexical/hybrid routing → load_skill |
| 8 | [`harness/08-memory-and-evolving.md`](harness/08-memory-and-evolving.md) | 五层记忆 + ShadowCoach + CaseGovernance |
| 9 | [`harness/09-model-adapters.md`](harness/09-model-adapters.md) | OpenAI / Anthropic / Hybrid + usage / cost / truncation |
| 10 | [`harness/10-self-heal.md`](harness/10-self-heal.md) | worktree → test → fix → merge |
| 11 | [`harness/11-subagents-and-swarm.md`](harness/11-subagents-and-swarm.md) | spawn_subagent / Swarm / send_message |
| 12 | [`harness/12-sandbox-and-execution.md`](harness/12-sandbox-and-execution.md) | OS / native / remote-VM / microservice |
| 13 | [`harness/13-storage-and-state.md`](harness/13-storage-and-state.md) | SQLite + disk assets + cloud tiered + migrations |
| 14 | [`harness/14-hooks-extensions-plugins.md`](harness/14-hooks-extensions-plugins.md) | lifecycle hooks + extensions + plugins |
| 15 | [`harness/15-observability.md`](harness/15-observability.md) | trace / OTEL / LLM debug / doctor |
| 16 | [`harness/16-runtime-governance.md`](harness/16-runtime-governance.md) | 运行时治理叠层（watchdog / LoopGuard / Risk / Goal 接线） |
| 17 | [`harness/17-context-memory-compaction.md`](harness/17-context-memory-compaction.md) | 上下文 / 压缩 / Memory / 预算与用量归一 |
| 18 | [`harness/18-model-tools-sandbox.md`](harness/18-model-tools-sandbox.md) | 模型适配 · 工具面 · 沙箱安全合章 |
| 19 | [`harness/19-surfaces-a2ui-domains.md`](harness/19-surfaces-a2ui-domains.md) | Daemon / Lab / A2UI / Domain Agents |
| 20 | [`harness/20-orchestration-evolution-eval.md`](harness/20-orchestration-evolution-eval.md) | Orchestrator / Swarm / Research / Eval / Evolution |

---

## Evolution / 自我进化

| Document | 中文说明 |
|----------|----------|
| [`evolution/README.md`](evolution/README.md) | learn → run-day → 展示站 固定三步 |
| [`SELF_EVOLUTION_V2.md`](SELF_EVOLUTION_V2.md) | 能力打标、merge gate、harness、orchestrator 桥接 |
| [`evolution-flywheel-review.md`](evolution-flywheel-review.md) | 八飞轮能力矩阵与勾选状态 |
| [`product-development-flywheels.md`](product-development-flywheels.md) | 产品研发飞轮概念稿（策略层） |

**产物目录（非手册）**：`doc/evolution/inbox/`、`success/`、`failure/`、`runs/` 等为流水线输出，勿当架构文档编辑。

---

## Deploy & platform / 部署与平台

| Document | 中文说明 |
|----------|----------|
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Docker / Compose / Helm、发布冒烟 |
| [`K8S_CLOUD_RUNTIME.md`](K8S_CLOUD_RUNTIME.md) | K8s / 云上运行时规划 |
| [`HARNESS_EVAL.md`](HARNESS_EVAL.md) | `npm run agent:eval`、fast/nightly cases |
| [`IM_AGENT_INTEGRATION.md`](IM_AGENT_INTEGRATION.md) | 飞书 / 企微 / Webhook 与 Agent 控制 |

---

## Removed / 已移除

| Former path | Reason |
|-------------|--------|
| `doc/PROJECT_REVIEW.md` | 2026-04 快照，数据过时；以 ARCHITECTURE + 测试为准 |
| `doc/sandbox-research.md` | 沙箱已落地，内容与新实现矛盾 |

---

## Contributing to docs / 维护文档

- 改工具数量：运行 `node scripts/doc-sync-tools.mjs`，并更新 [`ARCHITECTURE.md`](ARCHITECTURE.md) §7。
- 改 env：同步 [`.env.example`](../.env.example) 与 [`ENV_REFERENCE.md`](ENV_REFERENCE.md)。
- 新能力：在对应专题文档顶部增加 **Implementation status** 表，并回本目录一行。
