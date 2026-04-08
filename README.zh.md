# Raw Agent SDK

[English README](README.md) | **中文**

类 Claude Code 风格的 **Node.js 多智能体运行时**：本地 **Daemon**（HTTP API）、**CLI**、**Agent Lab**（Next.js 调试台）、**SQLite** 状态、任务/工作区隔离、审批、**Teams 编排**、**自愈（Self-heal）**、**Evolution**（RSS → inbox → worktree → 测试 → 可选合并），以及可选的 **视觉路由**、**MCP（stdio）**、**能力网关** 等集成。

---

## 能力一览

| 领域 | 说明 |
|------|------|
| **运行时** | `RawAgentRuntime`：会话、任务、工具、审批、工作区（`git worktree` 或目录复制）、后台任务、Mailbox（Teammate）、Trace、为 **KV 缓存** 优化的稳定/动态 system 前缀 |
| **模型** | `heuristic`（无密钥）、`openai-compatible`、`anthropic-compatible`；可选 **混合 VL 路由** + `vision_analyze`；不兼容 `response_format` 时可设 `RAW_AGENT_USE_JSON_MODE=0` |
| **工具** | 读写/编辑文件、`bash`、Todo、harness 规格、子 Agent/Teammate、Mailbox、`bg_run`、Skills；可选 **glob** / **web_fetch** / **MCP stdio** / **工具钩子** / **LSP** / **OpenTelemetry** 等 |
| **Skills** | 仓库 `skills/**/SKILL.md` + 可选 `~/.agents/**/SKILL.md` 合并；**技能路由**（`legacy` / `hybrid`） |
| **自愈** | 隔离 worktree、白名单测试、可选合并与 **daemon 重启握手** |
| **Evolution** | `evolution:learn`（RSS → inbox + 摘要技能）+ `evolution:run-day`（研究 → Agent → 构建 → 测试；`AUTO_MERGE=1` 时主仓 **merge 串行互斥**） |
| **Web** | Next.js 15 App Router：Playground（SSE、thinking、工具、Markdown）、Teams 图、Trace、Mailbox、审批；`/api/*` 代理到 Daemon |

---

## 包与应用

| 路径 | 职责 |
|------|------|
| `packages/core`（`@ppeng/agent-core`） | 运行时、存储、适配器、工具、工作区、自愈策略、Trace、Skills |
| `packages/capability-gateway` | 可选网关/桥接（如 IM、配置）；`evolution:learn` 拉 feed 会用到 |
| `apps/daemon` | HTTP API、调度器、`/` 仅 stub；**日常 UI 请用 Next** |
| `apps/cli` | `chat`、`send`、任务、审批、**self-heal**、daemon 重启确认 |
| `apps/web-console` | Agent Lab（Next.js） |

---

## 快速开始

```bash
npm install
npm run build
cp .env.example .env   # 配置模型与密钥；切勿提交 .env
npm run start:daemon
```

另一终端：

```bash
npm run start:cli -- chat "在本仓库里规划一个小改动"
```

浏览器：使用 **Next** 开发（`npm run dev:lab` 或设好 `DAEMON_PROXY_TARGET` 后 `npm run dev:web-console`）打开 Agent Lab。生产：`npm run build:web-console` && `npm run start:web-console`。

---

## npm 脚本（参考）

| 命令 | 说明 |
|------|------|
| `npm run build` | 编译 core、gateway、daemon、cli、web-console |
| `npm run test` | build + 单测 |
| `npm run test:unit` | 仅单测 |
| `npm run test:regression` | 临时 daemon HTTP 回归 |
| `npm run test:e2e` | 临时 daemon + Playwright |
| `npm run test:e2e:install` | 安装 Playwright Chromium |
| `npm run test:remote` | 真模型冒烟（需环境变量） |
| `npm run ci` | 与 CI 主 Job 一致：build + unit + regression + e2e |
| `npm run start:daemon` / `start:supervised` | 守护进程 / 监督拉起 |
| `npm run start:cli` | CLI（含 `self-heal`、`chat` 等） |
| `npm run dev:lab` | 开发辅助（Next + 代理） |
| `npm run evolution:learn` | RSS → inbox + 摘要技能 |
| `npm run evolution:run-day` | inbox → worktree → 测试 → 可选合并 |
| `npm run evolution:pipeline` | learn → run-day → 可选合并后重载 |
| `npm run evolution:run-full` | 完整研究 Agent 脚本 |
| `npm run ai:tools` | 检测本机 `claude` / `codex` 等 CLI |

详见 [`doc/TESTING.md`](doc/TESTING.md)、[`doc/CI.md`](doc/CI.md)、[`.env.example`](.env.example)。

---

## Agent Lab（Web 调试台）

- **Playground**：流式（SSE）、thinking、工具结果、Markdown
- **会话 / 任务 / Teams**：Mailbox 有向图、邮件流
- **Trace**：读 `stateDir/traces/.../events.jsonl`
- **审批 / 后台任务 / 工作区**

Daemon API 示例：`GET /api/version`、`GET /api/health`、`GET /api/traces?sessionId=...` — 完整列表见 `apps/daemon/src/server.ts`。

---

## Evolution（持续学习）

两条主命令：

1. **`npm run evolution:learn`** — 从 `gateway.config.json` 的 `learn.feeds` 拉取，更新 `doc/evolution/inbox/YYYY-MM-DD.md` 与技术摘要技能等。
2. **`npm run evolution:run-day`** — 对 inbox 每条：抓取摘录 → `git worktree` → `npm ci` → 可选 `EVOLUTION_RESEARCH_CMD` / `EVOLUTION_AGENT_CMD` → 构建 → `EVOLUTION_TEST_CMD` → 变更分类 → 可选合并到 `EVOLUTION_TARGET_BRANCH`（`EVOLUTION_AUTO_MERGE=1` 时主仓 **merge 互斥串行**；worktree 可并行，上限见 `EVOLUTION_CONCURRENCY`）。

- **`EVOLUTION_MAX_ITEMS`**：可选安全帽（不设则处理本轮所有未处理 slug）。
- 进度与目录约定见 [`doc/evolution/README.md`](doc/evolution/README.md)、[`scripts/cron-evolution.example.sh`](scripts/cron-evolution.example.sh)。

---

## 自愈（Self-heal）

`npm run start:daemon`（或 supervised）后：

```bash
npm run start:cli -- self-heal start '{"testPreset":"unit","autoMerge":false}'
```

调度器在隔离 worktree 跑白名单测试；失败可驱动 **self-healer** 会话。可选 `autoMerge` / `autoRestartDaemon`，配合 `GET /api/daemon/restart-request` 与 `POST .../ack`。详见 [`doc/ARCHITECTURE.md`](doc/ARCHITECTURE.md)。

---

## 核心能力（摘要）

- SQLite：agents、sessions、messages、tasks、events、approvals、workspaces、mailbox、background_jobs、self_heal_*、daemon 控制等
- 团队模型：main / planner / researcher / implementer / reviewer / **self-healer** + 可spawn 的 Teammate
- **稳定 / 动态 system 提示** 拆分以利于 KV 缓存（见 `doc/PROMPT_CACHE.md`）
- **图片资产**：热/温/冷、contact sheet、`vision_analyze`
- **可选外部 AI 工具**（`RAW_AGENT_EXTERNAL_AI_TOOLS=1`）：`claude_code`、`codex_exec`、`cursor_agent`（默认需审批）— 见 [`doc/EXTERNAL_AI_CLI.md`](doc/EXTERNAL_AI_CLI.md)

---

## 环境变量

- **核心**：`RAW_AGENT_STATE_DIR`、`RAW_AGENT_DAEMON_*`、`RAW_AGENT_MODEL_*`、`RAW_AGENT_API_KEY`、`RAW_AGENT_BASE_URL`、`RAW_AGENT_ANTHROPIC_URL`、`RAW_AGENT_USE_JSON_MODE`
- **视觉**：`RAW_AGENT_VL_*`、图片上限等 — 见 `doc/ARCHITECTURE.md` 与 `.env.example`
- **Evolution / 自愈 / Skills / 网关**：见 `AGENTS.md` 与 `.env.example`

---

## 文档索引

| 文档 | 内容 |
|------|------|
| [`doc/ARCHITECTURE.md`](doc/ARCHITECTURE.md) | 模块、数据模型、API、工具表 |
| [`doc/TESTING.md`](doc/TESTING.md) | 测试矩阵 |
| [`doc/CI.md`](doc/CI.md) | GitHub Actions、可选远程冒烟 Secret |
| [`doc/PROMPT_CACHE.md`](doc/PROMPT_CACHE.md) | 提示缓存策略 |
| [`doc/EXTERNAL_AI_CLI.md`](doc/EXTERNAL_AI_CLI.md) | 外部 CLI |
| [`AGENTS.md`](AGENTS.md) | 本仓库 Agent 使用约定 |

---

## CI

`npm run ci` 与 [`.github/workflows/ci.yml`](.github/workflows/ci.yml) 主 Job 对齐：构建、单测、HTTP 回归、E2E。仅当配置了仓库 Secret `RAW_AGENT_API_KEY` 时才跑可选 **真模型远程冒烟**；**来自 fork 的 PR 无法读取上游 Secret**，远程冒烟会安全跳过。

---

## 安全与隐私

- **`.env` 已在 `.gitignore` 中** — 勿将 API Key、飞书 Secret、网关 token 等提交到 Git；仅以 `.env.example` 为模板。
- 若密钥曾误提交、贴在 Issue 或打进日志，请 **轮换密钥**。
- **网关**（`gateway.config.json`）：`bridgeSecret` 与各通道凭证勿入库；可参考 `gateway.config.example.json`。
- **CI**：fork PR 无 Secret，设计为无法窃取上游密钥。
- **Daemon**：跨域请配置 `RAW_AGENT_CORS_ORIGIN`；勿在未鉴权情况下把 Daemon 暴露到不可信网络。

---

## 许可证

`package.json` 标记为 **private**。若日后开源请补充 SPDX 许可证文件。
