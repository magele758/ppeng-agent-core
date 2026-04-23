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

## Guidance for AI coding agents

If you are an **automated coding agent** (Cursor, Codex, Claude Code, etc.) working in this repo:

1. **Read [`AGENTS.md`](AGENTS.md) first** — workspace conventions, env vars, Evolution/self-heal/web-console notes, and operational gotchas.
2. **Where code lives**: runtime & tools → `packages/core`; HTTP API → `apps/daemon`; Agent Lab (Next.js 15) → `apps/web-console` (`app/`, `components/`, `lib/`); Evolution → `scripts/evolution-cli.mjs`, `scripts/evolution-run-day.mjs`, `scripts/evolution-drain-showcase.sh`, `scripts/evolution/`.
3. **After edits**: `npm run test:unit` for logic; `npm run build` for TypeScript across packages. UI/E2E → `doc/TESTING.md`, `npm run test:e2e` when relevant.
4. **Secrets & config**: follow [`.env.example`](.env.example); **never commit `.env`**. Restart the daemon after changing model or runtime-related env.
5. **Evolution**: `npm run evolution -- --help` for flags (`--learn`, `--agent`, `--review`, `--until-empty`, `--research`, `--test-agent`, …). Optional full drain + showcase: `npm run evolution:drain-showcase -- --help`. Inbox processing defaults to the **「今日新条目」** section (see README Evolution section below).
6. **Spawning / sandbox**: new subprocess code must use `sanitizeSpawnEnv()` and existing sandbox helpers (`packages/core/src/sandbox.ts`, `SandboxManager`) — not raw `spawn` with full parent env.
7. **Skills**: `skills/**/SKILL.md`; optional merge with `~/.agents/**/SKILL.md` (details in `AGENTS.md`).

Deeper architecture: [`doc/ARCHITECTURE.md`](doc/ARCHITECTURE.md).

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
| `npm run evolution -- --help` | unified evolution entry, see all options |
| `npm run evolution -- --learn --agent cursor --review codex` | learn + cursor implement + codex review |
| `npm run evolution -- --learn-only` | pull RSS → inbox only |
| `npm run evolution:pipeline` | learn → run-day → optional post-merge reload (one-shot) |
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

Unified entry: `npm run evolution -- [options]` (run `--help` for all flags).

**Common combinations:**

| Command | Description |
|---------|-------------|
| `npm run evolution -- --learn-only` | Pull RSS → inbox only, no dev |
| `npm run evolution -- --learn --agent claude` | learn + Claude implement (default) |
| `npm run evolution -- --learn --agent cursor` | learn + Cursor composer-2-fast |
| `npm run evolution -- --learn --agent cursor --review codex` | learn + Cursor implement + Codex review |
| `npm run evolution -- --learn --agent cursor --review cursor` | learn + Cursor full pipeline |
| `npm run evolution -- --learn --agent cursor --model claude-opus-4-7-thinking-max --review cursor` | learn + Cursor Opus-Max implement & review |
| `npm run evolution -- --learn --agent full` | learn + research → multi-CLI routing by difficulty |
| `npm run evolution -- --learn --agent cursor --review codex --concurrency 5 --merge` | 5 parallel worktrees + auto-merge |
| `npm run evolution -- --pipeline-build --learn --agent cursor --review codex` | build gateway + learn + dev |

**All flags:**

```
--learn                  pull RSS → inbox first
--learn-only             learn only, skip dev
--pipeline-build         build capability-gateway before learn
--agent cursor|claude|codex|full|multi   implement agent (default: claude)
--model <name>           cursor agent model (default: composer-2-fast)
--review cursor|codex|none   review agent (default: none)
--review-model <name>    review model (default: same as --model)
--concurrency <1-5>      parallel worktrees (default: 3)
--items <n>              max inbox items to process
--merge                  auto-merge on passing tests
--target-branch <b>      merge target branch (default: main)
--skip-rebase            skip post-test rebase
```

**Runtime behavior and troubleshooting:**

- `run-day` now executes the **“今日新条目”** section from the inbox by default; the rolling reference section is display-only and is not re-queued, which avoids duplicate links sharing one worktree under high concurrency.
- When Cursor is selected, the CLI runs `agent --list-models` up front; unsupported model IDs fail fast before learn / research starts.
- The research gate is intentionally conservative now: missing excerpts, unsupported Cursor models, or outputs that clearly contain `SKIP:` will be skipped instead of silently defaulting to `PROCEED`.
- Review / rebase / merge failures try to keep the experiment branch around for manual takeover. Check `doc/evolution/failure/` for the matching record, then inspect the local `exp/evolution-*` branch.
- If `evolution:learn` shows widespread RSS failures, check proxy / DNS / TLS first. A `news.ycombinator.com` certificate mismatch usually points to local network or proxy interception rather than repo code.

`npm run evolution:pipeline` (bash one-shot: build→learn→run-day→optional reload) and the low-level `evolution:learn` / `evolution:run-day` scripts are still available. For advanced fine-grained tuning (plan, test-agent, review rounds, etc.) see `scripts/evolution-quality-pipeline.env.example` and `.env.example`.

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
| [`doc/IM_AGENT_INTEGRATION.md`](doc/IM_AGENT_INTEGRATION.md) | Feishu / WeCom / webhooks vs Agent control |
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
