# Raw Agent SDK

**English** | [README 中文](README.zh.md)

Node.js multi-agent runtime in the spirit of Claude Code: **local daemon** (HTTP API), **CLI**, **Agent Lab** (Next.js web console), **SQLite** state, task/workspace isolation, approvals, team orchestration, **self-heal**, **Evolution** (RSS → inbox → worktree → tests → optional merge), and **optional** vision routing, MCP (stdio), and capability gateway integrations.

---

## Highlights

| Area | What you get |
|------|----------------|
| **Runtime** | `RawAgentRuntime`: sessions, tasks, tools, approvals, workspaces (`git worktree` or directory copy), background jobs, mailbox (teammates), trace events, prompt-cache–friendly system prefixes |
| **Models** | `heuristic` (no keys), `openai-compatible`, `anthropic-compatible`; optional **hybrid VL router** + `vision_analyze`; optional `RAW_AGENT_USE_JSON_MODE=0` for picky providers |
| **Tools** | File read/write/edit, `bash`, todos, harness specs, subagents/teammates, mailbox, `bg_run`, skills, optional **glob** / **web_fetch** / **MCP stdio** / hooks / LSP / OpenTelemetry hooks |
| **Skills** | Repo `skills/**/SKILL.md` + optional `~/.agents/**/SKILL.md` merge; **skill router** (`legacy` / `hybrid`); **Guided learning** (coaching mode) |
| **Self-heal** | Isolated worktree, whitelist tests, optional merge + daemon restart handshake |
| **Evolution** | `evolution:learn` (RSS → inbox + digest skill) + `evolution:run-day` (research → agent → build → test; merge with mutex when `AUTO_MERGE=1`) |
| **Web** | Next.js 15 App Router: playground (SSE, thinking, tools, Markdown), teams graph, traces, mailbox, approvals; `/api/*` proxied to daemon |

---

## Packages & apps

| Path | Role |
|------|------|
| `packages/core` (`@ppeng/agent-core`) | Runtime, storage, adapters, tools, workspaces, self-heal policy, traces, skills |
| `packages/capability-gateway` | Optional bridge (e.g. IM channels, config); used by `evolution:learn` feeds |
| `apps/daemon` | HTTP API, scheduler, static stub for `/`; **use Next for UI** |
| `apps/cli` | `chat`, `send`, tasks, approvals, **self-heal**, daemon restart ack |
| `apps/web-console` | Agent Lab (Next.js) |

---

## Quick start

```bash
npm install
npm run build
cp .env.example .env   # configure model + keys; never commit .env
npm run start:daemon
```

In another terminal:

```bash
npm run start:cli -- chat "Plan a small change in this repo"
```

Browser: **Next** dev (`npm run dev:lab` or `npm run dev:web-console` with `DAEMON_PROXY_TARGET=http://127.0.0.1:7070`) → Agent Lab. Production: `npm run build:web-console` && `npm run start:web-console`.

---

## npm scripts (reference)

| Script | Description |
|--------|-------------|
| `npm run build` | `tsc` core + gateway + daemon + cli + web-console |
| `npm run test` | build + unit tests |
| `npm run test:unit` | unit tests only |
| `npm run test:regression` | temp daemon HTTP regression |
| `npm run test:e2e` | temp daemon + Playwright (Agent Lab) |
| `npm run test:e2e:install` | Playwright Chromium |
| `npm run test:remote` | real-model smoke (needs env; skipped if unset) |
| `npm run ci` | build + unit + regression + e2e |
| `npm run start:daemon` / `start:supervised` | daemon / supervisor |
| `npm run start:cli` | CLI (`self-heal`, `chat`, …) |
| `npm run dev:lab` | dev helper (Next + daemon proxy) |
| `npm run evolution:learn` | RSS → inbox + digest skill |
| `npm run evolution:run-day` | inbox → worktrees → tests → optional merge |
| `npm run evolution:pipeline` | learn → run-day → optional post-merge reload |
| `npm run evolution:run-full` | full research agent script |
| `npm run ai:tools` | check external CLIs (`claude`, `codex`, …) |

See [`doc/TESTING.md`](doc/TESTING.md), [`doc/CI.md`](doc/CI.md), [`.env.example`](.env.example).

---

## Agent Lab (web console)

- **Playground**: streaming (SSE), thinking blocks, tool results, Markdown
- **Sessions / tasks / teams**: mailbox graph, mail flow
- **Traces**: reads `stateDir/traces/.../events.jsonl`
- **Approvals / background jobs / workspaces**

Daemon API examples: `GET /api/version`, `GET /api/health`, `GET /api/traces?sessionId=...` — full list in `apps/daemon/src/server.ts`.

---

## Evolution (continuous learning)

Two main commands:

1. **`npm run evolution:learn`** — pulls feeds from `gateway.config.json` (`learn.feeds`), updates `doc/evolution/inbox/YYYY-MM-DD.md` and digest skills (e.g. `agent-tech-digest`).
2. **`npm run evolution:run-day`** — for each inbox link: fetch excerpt → `git worktree` → `npm ci` → optional `EVOLUTION_RESEARCH_CMD` + `EVOLUTION_AGENT_CMD` → build → `EVOLUTION_TEST_CMD` → classify changes → optional merge to `EVOLUTION_TARGET_BRANCH` (merge serialized when `EVOLUTION_AUTO_MERGE=1`; parallel worktrees up to `EVOLUTION_CONCURRENCY`).

- **`EVOLUTION_MAX_ITEMS`**: optional cap (unset = all unprocessed slugs in that run).
- **`EVOLUTION_AUTO_MERGE=1`**: main-repo `git merge` runs under a mutex; worktrees can still run in parallel.

Details: [`doc/evolution/README.md`](doc/evolution/README.md), [`scripts/cron-evolution.example.sh`](scripts/cron-evolution.example.sh).

---

## Self-heal

After `npm run start:daemon` (or supervised flow):

```bash
npm run start:cli -- self-heal start '{"testPreset":"unit","autoMerge":false}'
```

Scheduler runs whitelist tests in an isolated worktree; failures can drive a **self-healer** session. Optional `autoMerge` / `autoRestartDaemon` with `GET /api/daemon/restart-request` + `POST .../ack`. See [`doc/ARCHITECTURE.md`](doc/ARCHITECTURE.md).

---

## Core capabilities (summary)

- SQLite persistence: agents, sessions, messages, tasks, events, approvals, workspaces, mailbox, background jobs, self-heal runs, daemon control
- Team model: main / planner / researcher / implementer / reviewer / **self-healer** + spawnable teammates
- **Stable vs dynamic system prompt** split for KV cache (see `doc/PROMPT_CACHE.md`)
- **Image assets**: hot/warm/cold, contact sheet, `vision_analyze`
- **Optional external AI tools** (`RAW_AGENT_EXTERNAL_AI_TOOLS=1`): `claude_code`, `codex_exec`, `cursor_agent` with approval — see [`doc/EXTERNAL_AI_CLI.md`](doc/EXTERNAL_AI_CLI.md)

---

## Environment variables

- **Core**: `RAW_AGENT_STATE_DIR`, `RAW_AGENT_DAEMON_HOST`, `RAW_AGENT_DAEMON_PORT`, `RAW_AGENT_MODEL_PROVIDER`, `RAW_AGENT_MODEL_NAME`, `RAW_AGENT_API_KEY`, `RAW_AGENT_BASE_URL`, `RAW_AGENT_ANTHROPIC_URL`, `RAW_AGENT_USE_JSON_MODE`
- **Vision**: `RAW_AGENT_VL_*`, image limits — see `doc/ARCHITECTURE.md` and `.env.example`
- **Evolution / self-heal / skills / gateway**: see `AGENTS.md` and `.env.example`

---

## Documentation

| Doc | Content |
|-----|---------|
| [`doc/ARCHITECTURE.md`](doc/ARCHITECTURE.md) | Modules, data model, APIs, tools list |
| [`doc/TESTING.md`](doc/TESTING.md) | Test matrix |
| [`doc/CI.md`](doc/CI.md) | GitHub Actions, optional remote smoke secrets |
| [`doc/PROMPT_CACHE.md`](doc/PROMPT_CACHE.md) | Prompt caching behavior |
| [`doc/EXTERNAL_AI_CLI.md`](doc/EXTERNAL_AI_CLI.md) | External CLI tools |
| [`AGENTS.md`](AGENTS.md) | Workspace conventions for agents |

---

## CI

`npm run ci` matches the main GitHub Actions job (`.github/workflows/ci.yml`): build, unit, regression, E2E. Optional **remote model smoke** runs only when `RAW_AGENT_API_KEY` is configured as a repository secret (fork PRs do not receive secrets).

---

## Security & privacy

- **`.env` is listed in `.gitignore`** — do not commit API keys, tokens, or Feishu secrets. Use `.env.example` as a template only.
- **Rotate keys** if they were ever committed, pasted in issues, or shared in logs.
- **Gateway** (`gateway.config.json`): keep `bridgeSecret` and any channel tokens out of Git; use `gateway.config.example.json` as reference.
- **CI**: fork PRs cannot read upstream secrets; remote smoke is skipped safely.
- **Daemon**: configure `RAW_AGENT_CORS_ORIGIN` for browser clients; avoid exposing the daemon to untrusted networks without a reverse proxy and auth.

---

## License

This project is **private** (`package.json`). Add a SPDX license file if you open-source it later.
