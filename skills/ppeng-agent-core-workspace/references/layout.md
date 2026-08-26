# 仓库布局（补充）

## Monorepo 包

- `packages/api-types` — `@ppeng/api-types`；daemon ↔ Lab 共享 HTTP 视图类型与 `filterSessionsByQuery`。
- `packages/core` — 对外包名 `@ppeng/agent-core`；运行时、内置工具、stores、model adapters、A2UI 协议等。
- `packages/capability-gateway` — 与 IM/feed 等集成；Evolution `learn` 可读 `gateway.config.json`。
- `packages/agent-*` — 可选领域包；清单见根目录 `domains.manifest.json`（`RAW_AGENT_DOMAINS`）。

分层约定见 `doc/MONOREPO_LAYERING.md`。

## 应用

- `apps/daemon` — `@ppeng/agent-daemon`；路由与 API；Evolution 观测等。
- `apps/web-console` — Next 控制台；`middleware.ts` 代理 `/api/*`。
- `apps/cli` — `@ppeng/agent-cli`；与 daemon 交互的 CLI。

## 文档与状态

- `doc/` — 架构、测试、CI、外部 CLI、DOMAIN、A2UI 等。
- `doc/evolution/inbox/` — 当日/历史 inbox Markdown。
- `doc/evolution/{success,failure,skip,no-op,superseded}/` — 每条进化任务结果（按 slug 去重已处理）。
- `skills/` — 仓库内置 Skill（本 workspace 指引也在此）。

## 自进化脚本（节选）

- `scripts/evolution/` — inbox 解析、progress、showcase deploy、review-refine 等模块。
- `scripts/evolution-agent-*.sh`、`evolution-research*.sh` — CLI 钩子封装。
