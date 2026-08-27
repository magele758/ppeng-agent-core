# Monorepo layering

Official layout for this npm-workspaces repo. Prefer directory conventions over new packages.

| Layer | Path | Role |
|-------|------|------|
| Apps | `apps/*` | Processes / UI (daemon, CLI, Lab web, desktop shell) |
| Packages | `packages/*` | Reusable libraries published or linked as workspace packages |
| Scripts | `scripts/*` | Ops pipelines (evolution, eval, release). **Not** a workspace package |
| Skills | `skills/` | Runtime skill docs loaded by the agent |
| Docs | `doc/` | Handbooks + evolution artifacts (`doc/evolution/`) |

## Package naming

Workspace libraries and apps use the `@ppeng/*` scope (e.g. `@ppeng/agent-core`, `@ppeng/agent-daemon`). Env vars stay `RAW_AGENT_*`.

## When to add a package vs a core directory

| Default | Put new capability in `packages/core/src/<area>/` |
|---------|--------------------------------------------------|
| New package (`packages/*`) | Only if it is **independently publishable** or **optionally mounted by the daemon** (domain bundles, shared API types, gateway, clients) |

Do **not** split strongly coupled runtime pieces (storage / memory / swarm / orchestrator / self-heal) into separate npm packages without a clear publish or CI boundary.

Domain bundles follow `DomainBundle` + `domains.manifest.json` (see [`DOMAIN_AGENTS.md`](DOMAIN_AGENTS.md)).

## Backlog

Hygiene 1→4（分层文档、`@ppeng/*` 命名、`@ppeng/api-types`、domain manifest）已落地。循环分层见第 4 条。以下 1–3 仍刻意延后：

1. **`scripts/` 轻量 package 化** — evolution / agent-eval / release 用 workspace 依赖替代硬编码 `packages/*/dist`；需要独立版本或 CI 边界时再升为 `packages/*`。
2. **yarn.lock 维护** — 日常以 npm / `package-lock.json` 为准；若团队仍用 yarn，改 workspace 包名后记得同步 `yarn.lock`。
3. **core 远期拆包（勿大爆炸）** — 仅在有独立发布/CI 需求时按序考虑：`sandbox` → `a2ui` 协议 → `mcp`；memory / swarm / orchestrator / self-heal 保持在 core 内。
4. **L0–L6 循环分层（已合入 main，不拆新 npm 包）** — 已按目录 + `package.json` `exports` 子路径拆分（`@ppeng/agent-core/{types,session,turn,loop}`），**不**新增 `@ppeng/session` / `@ppeng/agent-loop`。后续只瘦 `runtime.ts` L5 门面，**不为循环分层拆 `@ppeng/session`**。仍暂缓：多仓拆分、强制 Turbo/Nx。详见 [`AGENT_LOOP_LAYERING_PLAN.md`](AGENT_LOOP_LAYERING_PLAN.md)。
