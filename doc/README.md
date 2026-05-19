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
