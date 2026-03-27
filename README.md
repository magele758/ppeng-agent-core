# Raw Agent SDK

Node.js implementation of a Claude Code style multi-agent runtime with a local daemon, CLI, web console, SQLite state store, task/workspace isolation, approvals, and team orchestration.

## Packages

- `packages/core`: runtime, persistence, model adapters, tools, workspace management
- `apps/daemon`: local HTTP API, background scheduler, static web console hosting
- `apps/cli`: terminal client for task creation, inspection, approvals
- `apps/web-console`: static browser UI for chat/task sessions, approvals, teammates, mailbox, and workspaces

## CI / 回归

本地一键：`npm run ci`（`build` + 单元测试 + daemon HTTP 黑盒探测）。  
GitHub：推送或 PR 到 `main` 时运行 `.github/workflows/ci.yml`（同 ref 并发构建会取消旧任务）。

Daemon 补充：`GET /api/version`（包名与版本）、`GET /api/health` 含 `version`；可选 `RAW_AGENT_CORS_ORIGIN` 允许浏览器直连 API；非法 JSON 体会返回 400；静态资源路径防 `..` 穿越。

## Quick Start

```bash
npm install
npm run build
cp .env.example .env   # 按需编辑 .env 配置模型等
npm run start:daemon
```

In another terminal:

```bash
npm run start:cli -- chat "Plan and implement a new feature in this repository"
```

Open `http://127.0.0.1:7070` for the web console.

## Core Capabilities

- Persistent tasks, sessions, events, approvals, workspaces, and summaries in SQLite
- Main/researcher/implementer/reviewer team model with spawnable teammates
- Background scheduling with task recovery
- Protocol-style delegation events between agents
- Tool approval gates
- Workspace binding with `git worktree` or directory copy fallback
- Context summarization and compression hooks
- Provider abstraction with heuristic, OpenAI-compatible, and Anthropic-compatible adapters

## Environment Variables

- `RAW_AGENT_STATE_DIR`: override state directory, defaults to `.agent-state`
- `RAW_AGENT_DAEMON_HOST`: daemon host, defaults to `127.0.0.1`
- `RAW_AGENT_DAEMON_PORT`: daemon port, defaults to `7070`
- `RAW_AGENT_MODEL_PROVIDER`: `heuristic`, `openai-compatible`, or `anthropic-compatible`
- `RAW_AGENT_MODEL_NAME`: model name for remote adapters
- `RAW_AGENT_API_KEY`: API key for remote adapters
- `RAW_AGENT_BASE_URL`: API base URL for OpenAI-compatible adapters
- `RAW_AGENT_ANTHROPIC_URL`: API base URL for Anthropic-compatible adapters
- `RAW_AGENT_USE_JSON_MODE`: set `0` or `false` if your OpenAI-compatible provider rejects `response_format`

## Notes

The default heuristic adapter keeps the runtime usable without external model credentials. Switch to a remote adapter once you want real model-driven planning.
