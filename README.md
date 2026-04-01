# Raw Agent SDK

Node.js implementation of a Claude Code style multi-agent runtime with a local daemon, CLI, web console, SQLite state store, task/workspace isolation, approvals, and team orchestration.

## Packages

- `packages/core`（npm: `@ppeng/agent-core`）: runtime, persistence, model adapters, tools, workspace management
- `apps/daemon`: local HTTP API, background scheduler, static web console hosting
- `apps/cli`: terminal client for task creation, inspection, approvals, **self-heal** control (`self-heal start|status|…`, `daemon restart-status|restart-ack`)
- `apps/web-console`: **Agent Lab** 调试台（见下）

## Agent Lab（Web 调试台）

`npm run start:daemon` 后打开 `http://127.0.0.1:7070`。多 Tab：**对话 Playground**（含可选 SSE 流式、Run / Cancel）、**会话与任务**、**Teams 拓扑**（邮箱有向图 + 全局邮件流）、**Trace 时间线**（读 `stateDir/traces/.../events.jsonl`）、**审批 / 后台作业 / 工作区 / 发邮箱**。

相关 HTTP 示例：`GET /api/version`、`GET /api/health`、`GET /api/traces?sessionId=...`、`GET /api/mailbox/all?limit=...`（完整列表以 `apps/daemon/src/server.ts` 为准）。

## npm scripts

| 命令 | 说明 |
|------|------|
| `npm run build` | TypeScript 构建 core + daemon + cli |
| `npm run test` | `build` + `test:unit` |
| `npm run test:unit` | 仅单元测试 |
| `npm run test:regression` | 启动临时 daemon 做 HTTP 黑盒回归 |
| `npm run test:e2e` | 临时 daemon + Playwright（Agent Lab） |
| `npm run test:e2e:install` | 安装 Playwright Chromium（CI / 新环境） |
| `npm run test:remote` | 真模型冒烟（需环境变量；未设 `RAW_AGENT_MODEL_PROVIDER` 时跳过） |
| `npm run ci` | `build` + `test:unit` + `test:regression` + `test:e2e`（与 CI 主 Job 一致） |
| `npm run ai:tools` | 检查是否已安装 `claude` / `codex` / `agent` |
| `npm run ai:claude` / `ai:codex` / `ai:cursor` | 调用外部 AI CLI 按提示跑 CI 并尝试修复（需本机已安装） |
| `npm run evolution:learn` | 按 `gateway.config.json` 的 `learn.feeds` 拉取 RSS/Atom，去重后更新技能摘要与 `doc/evolution/inbox/`（单源失败会跳过，不中断整次任务） |
| `npm run evolution:run-day` | 读取 inbox，在独立 git worktree 中可选 Agent 钩子、构建、单测、可选自动合并；详见下文 **Evolution** |

**自愈（Self-heal）**：`npm run start:daemon` 后可用 `npm run start:cli -- self-heal start '{"testPreset":"unit","autoMerge":false}'` 创建运行项；daemon 调度器在隔离 worktree 里跑白名单 `npm run`、失败则驱动 `self-healer` 会话修复；可选 `autoMerge` / `autoRestartDaemon`（合并后主进程需按 `GET /api/daemon/restart-request` 提示重启并 `POST /api/daemon/restart-request/ack`）。详见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

能力矩阵与 `.env` 分工见 [`docs/TESTING.md`](docs/TESTING.md)。  
可选：本机安装 **Claude Code / Codex / Cursor Agent CLI** 后，用 [`docs/EXTERNAL_AI_CLI.md`](docs/EXTERNAL_AI_CLI.md) 中的 `npm run ai:claude` / `ai:codex` / `ai:cursor`（默认提示词会跑 `npm run ci` 并尝试修复）。

## 持续学习与进化（Evolution）

本仓库把「从外面持续摄入信息」和「在仓库内自动验证（可选 AI 改代码 + 合并）」拆成两条命令，配置集中在 `gateway.config.json` 的 `learn` 段（`feeds` 为 RSS/Atom URL 列表，`maxItemsPerFeed` 控制每源条数）。

### `npm run evolution:pipeline`

一键编排：`learn` → `run-day` →（可选）`EVOLUTION_POST_MERGE_RELOAD=1` 时执行全量 `npm run build` 并向监听 `RAW_AGENT_DAEMON_PORT` 的进程发 SIGTERM（配合 `npm run start:supervised` 自动拉起新进程）。环境变量见 `.env.example` 中「自进化一键管线」。**Pipeline 默认强制使用 Claude Code**（`scripts/evolution-agent-claude.sh`）；若要在管线中沿用 `.env` 里的 `EVOLUTION_AGENT_CMD`（如 multi），设 **`EVOLUTION_PIPELINE_USE_ENV_AGENT=1`**。定时任务可调用 `scripts/cron-evolution.example.sh`；GitHub 上仅对 `evolution:learn` 提供定时 workflow（`.github/workflows/evolution-scheduled.yml`）。

### `npm run evolution:learn`

（需已编译 `packages/capability-gateway`，例如 `npx tsc -b packages/capability-gateway` 或完整 `npm run build`。）

- 拉取各 feed，合并进 gateway 状态（`.agent-state/.../gateway`），并生成 **`skills/` 下技术摘要技能**（如 `agent-tech-digest`）与当日 **`doc/evolution/inbox/YYYY-MM-DD.md`**。  
- 某一源因网络/TLS 不可达时会跳过该源并继续，全部失败时仍会写本地滚动内容但退出码非 0。  
- 修改配置后无需 daemon；若要在运行中的 gateway 里生效，可按项目说明执行 learn 重载或重启 daemon。

### `npm run evolution:run-day`（自动验证与可选合并）

对 inbox 中每条候选（条数由 `EVOLUTION_MAX_ITEMS` 控制，默认 3）：

```text
┌───────────────────────────┐
│ inbox 一条候选（RSS）     │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ 抓取 URL 正文摘录         │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ git worktree add          │
│ exp/evolution-<UTC>-…     │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ 可选：复制 .env / gateway │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ npm ci                    │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ EVOLUTION_AGENT_CMD       │
│ （可选）写 .evolution     │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ git add + commit          │
│ （有改动时）              │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ 构建 → EVOLUTION_TEST_CMD │
│ （子进程剥离 SELF_HEAL）  │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ 变更分类门禁              │
│ packages/apps 下有非测试  │
│ 源码改动？                │
└─────────────┬─────────────┘
         否   │   是
    ┌─────────┘   └──────────┐
    ▼                        ▼
┌──────────────┐  ┌───────────────────────────┐
│ skip/        │  │ success / failure / runs  │
│ 分支保留供   │  │ latest-run-day.md         │
│ 手动审查     │  └─────────────┬─────────────┘
└──────────────┘               ▼
                        ┌──────┴──────┐
                        │ AUTO_MERGE? │
                        └──────┬──────┘
                     否 ◄──────┼──────► 是
                     ▼         │         ▼
                ┌──────────┐   │   ┌──────────────┐
                │ 保留分支 │   │   │ rebase        │
                │ 或清理wt │   │   │ merge 主仓   │
                └──────────┘   │   │ 冲突 Agent   │
                               │   └──────────────┘
                               │
            （AUTO_MERGE=1 时并发恒为 1，避免多路 merge 竞态）
```

1. **抓取**来源 URL 正文摘录（失败不阻断）。  
2. **`git worktree add`**：分支 `exp/evolution-<YYYY-MM-DD>_<HH-MM>-<slug>`，目录 `.evolution-worktrees/<YYYY-MM-DD>_<HH-MM>-<slug>`（时间戳为 **UTC** 到分钟，避免同日多次运行冲突）。  
3. 可选将主仓 **`.env`**、**`gateway.config.json`**（或 `EVOLUTION_GATEWAY_CONFIG` 指向的文件）复制进 worktree，便于在目录内手动跑命令。  
4. **`npm ci`** →（可选）**`EVOLUTION_AGENT_CMD`**：写入 `worktree/.evolution/source-excerpt.txt` 与 `constraints.txt`，设置 `EVOLUTION_WORKTREE` 等环境变量后执行钩子（示例：`bash scripts/evolution-agent-claude.sh` 在 worktree 内调 `claude`；另有 `evolution-agent-codex.sh`）。  
5. 若有可跟踪代码改动：`git add`（排除 `.evolution/`）+ **`git commit`**（提交说明含 RSS 标题；通过 `spawn` 传参，不经 shell 拼接，避免标题中 `$` / 反引号注入）。  
6. **构建**（默认 `npx tsc -b packages/core packages/capability-gateway`）→ **`EVOLUTION_TEST_CMD`**（默认 `npm run test:unit`）。测试子进程会剥离 `RAW_AGENT_SELF_HEAL_*`，避免主仓 `.env` 影响「默认策略」类断言。  
7. **变更分类门禁**：测试通过后检查分支相对目标分支的变更路径。只有在 `packages/` 或 `apps/` 下存在**非测试源码文件**（非 `*.test.*`、非 `test/` 目录）改动时，才允许进入合并流程；否则记录为 **skip**（写 `doc/evolution/skip/`，分支保留供手动审查，不执行 auto-merge）。  
8. 若开启自动合并：在 worktree 内 **`git rebase <目标分支>`**，再移除 worktree；主仓若**有未提交改动**则先 **auto-commit**，再 **`git merge`** 实验分支。合并冲突时，若已配置 `EVOLUTION_AGENT_CMD`，可尝试用同一 CLI **解决冲突**后再提交 merge。  
9. **`EVOLUTION_AUTO_MERGE=1`** 时仍可按 **`EVOLUTION_CONCURRENCY`（上限 5）** 并行跑 worktree；对主仓的 **`git checkout` / `git merge` 串行（互斥锁）**，避免竞态。

运行记录默认写入 **`doc/evolution/success/`**、**`skip/`**、**`failure/`**、**`runs/latest-run-day.md`**；根目录 **`.gitignore`** 可将上述目录排除在版本库外，减少无关合并冲突（本地仍会生成文件）。

默认 **不**自动合并（`EVOLUTION_AUTO_MERGE=0`）；主仓工作区默认需干净（可 `EVOLUTION_ALLOW_DIRTY_WORKTREE=1`）。全部开关见 [`.env.example`](.env.example) 中 `EVOLUTION_*`。

定时任务示例见 [`scripts/cron-evolution.example.sh`](scripts/cron-evolution.example.sh)；目录约定见 [`doc/evolution/README.md`](doc/evolution/README.md)。

## CI / 回归

本地与流水线对齐：`npm run ci`。  
GitHub：**任意分支** 的 `push` / `pull_request` 运行 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)（同 ref 并发会取消旧任务）：主 Job 含构建、单测、HTTP 回归、Playwright E2E；若配置了仓库 Secret `RAW_AGENT_API_KEY` 再跑可选 **真模型远程冒烟**（变量与 Anthropic 分支见 [`docs/CI.md`](docs/CI.md)）。

Daemon 行为摘要：`GET /api/version`；`GET /api/health` 含 `version`；可选 `RAW_AGENT_CORS_ORIGIN`；非法 JSON → 400；请求体过大 → 413；静态资源防 `..` 穿越。

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

浏览器打开 `http://127.0.0.1:7070`（详见上文 **Agent Lab**）。

## Core Capabilities

- Persistent tasks, sessions, events, approvals, workspaces, and summaries in SQLite
- Main/researcher/implementer/reviewer team model with spawnable teammates
- Background scheduling with task recovery
- Protocol-style delegation events between agents
- Tool approval gates
- Workspace binding with `git worktree` or directory copy fallback
- Context summarization and compression hooks
- Provider abstraction with heuristic, OpenAI-compatible, and Anthropic-compatible adapters
- Optional **VL router**: when `RAW_AGENT_VL_MODEL_NAME` is set with `openai-compatible`, turns that include images route to the VL model; **Agent Lab** can upload images or paste image URLs (server-side fetch)
- Image assets + tiered retention (hot / warm contact sheet / cold), tool `vision_analyze` for on-demand VL

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
- **Vision (optional)**：`RAW_AGENT_VL_MODEL_NAME` enables hybrid routing + `vision_analyze`; optional `RAW_AGENT_VL_BASE_URL`, `RAW_AGENT_VL_API_KEY`, `RAW_AGENT_VL_ROUTE_SCOPE`（`any`|`last_user`）, `RAW_AGENT_IMAGE_HOT_LIMIT`, `RAW_AGENT_IMAGE_MAX_BYTES`, 等见 [`.env.example`](.env.example)
- `RAW_AGENT_CORS_ORIGIN`: comma-separated origins (or `*`) for browser clients calling the API from another host
- 更多可选变量（压缩阈值、并行工具、MCP、审批策略、请求体上限等）见 [`.env.example`](.env.example)

## Notes

The default heuristic adapter keeps the runtime usable without external model credentials. Switch to a remote adapter once you want real model-driven planning.
