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
