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

## 给 AI 编码 Agent 的指引

若你是 **自动化编码 Agent**（Cursor、Codex、Claude Code 等）在本仓库中改代码：

1. **先读 [`AGENTS.md`](AGENTS.md)** — 工作区约定、环境变量、Evolution/自愈/前端行为与常见坑。
2. **代码位置**：运行时与工具 → `packages/core`；HTTP API → `apps/daemon`；Agent Lab（Next.js 15）→ `apps/web-console`（`app/`、`components/`、`lib/`）；Evolution → `scripts/evolution-cli.mjs`、`scripts/evolution-run-day.mjs`、`scripts/evolution-drain-showcase.sh`、`scripts/evolution/`。
3. **改完怎么验**：逻辑改动跑 `npm run test:unit`；全量 TS 编译用 `npm run build`。界面/E2E 见 [`doc/TESTING.md`](doc/TESTING.md)、必要时 `npm run test:e2e`。
4. **配置与密钥**：对照 [`.env.example`](.env.example)；**切勿提交 `.env`**。修改模型或运行相关环境变量后需重启 daemon。
5. **Evolution**：`npm run evolution -- --help` 查看参数（`--learn`、`--agent`、`--review`、`--until-empty`、`--research`、`--test-agent` 等）。一键 drain + 展示站：`npm run evolution:drain-showcase -- --help`。`run-day` 默认只处理 inbox **「今日新条目」** 分段（下文 Evolution 一节）。
6. **子进程 / 沙箱**：新增 `spawn` 须走 `sanitizeSpawnEnv()` 与现有沙箱封装（`packages/core/src/sandbox.ts`、`SandboxManager`），勿在完整父进程环境下裸调 `spawn`。
7. **Skills**：仓库内 `skills/**/SKILL.md`；可与 `~/.agents/**/SKILL.md` 合并（见 `AGENTS.md`）。

架构与 API 全貌：[`doc/ARCHITECTURE.md`](doc/ARCHITECTURE.md)。

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
| `npm run evolution -- --help` | 统一进化入口，查看全部参数 |
| `npm run evolution -- --learn --agent cursor --review codex` | learn + cursor 开发 + codex review |
| `npm run evolution -- --learn-only` | 仅拉 RSS → inbox |
| `npm run evolution:pipeline` | learn → run-day → 可选合并后重载（一键） |
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

统一入口：`npm run evolution -- [options]`（`--help` 查看全部参数）。

**常用组合：**

| 命令 | 说明 |
|------|------|
| `npm run evolution -- --learn-only` | 仅拉 RSS → inbox，不跑开发 |
| `npm run evolution -- --learn --agent claude` | learn + Claude 实现（默认） |
| `npm run evolution -- --learn --agent cursor` | learn + Cursor composer-2-fast 实现 |
| `npm run evolution -- --learn --agent cursor --review codex` | learn + Cursor 实现 + Codex review |
| `npm run evolution -- --learn --agent cursor --review cursor` | learn + Cursor 全链路 |
| `npm run evolution -- --learn --agent cursor --model claude-opus-4-7-thinking-max --review cursor` | learn + Cursor Opus-Max 实现与 review |
| `npm run evolution -- --learn --agent full` | learn + 研究→多CLI路由实现（自动按难度分配） |
| `npm run evolution -- --learn --agent cursor --review codex --concurrency 5 --merge` | 5 路并发 + 自动合并 |
| `npm run evolution -- --pipeline-build --learn --agent cursor --review codex` | 先编译 gateway + learn + 开发 |

**完整参数列表：**

```
--learn                  先拉 RSS → inbox
--learn-only             仅 learn，不跑开发
--pipeline-build         learn 前先编译 capability-gateway
--agent cursor|claude|codex|full|multi   实现 agent（默认 claude）
--model <name>           cursor agent 模型（默认 composer-2-fast）
--review cursor|codex|none   review agent（默认 none）
--review-model <name>    review 用模型（默认同 --model）
--concurrency <1-5>      并发 worktree 数（默认 3）
--items <n>              最多处理条目数
--merge                  测试通过后自动合并
--target-branch <b>      合并目标分支（默认 main）
--skip-rebase            跳过 rebase 步骤
```

**运行规则与排障：**

- `run-day` 默认只执行 inbox 里的 **“今日新条目”** 分段；“近期滚动（参考）”仅展示，不重复调度，避免同一链接在高并发下共用 worktree。
- 选择 Cursor 时，CLI 会先执行 `agent --list-models` 预检；若模型不可用会在开跑前直接报错，而不是跑到 research 阶段才失败。
- research 阶段现在更保守：正文抓取为空、模型不可用、或输出里明确出现 `SKIP:` 时，会直接跳过，不再默认 `PROCEED`。
- review / rebase / merge 等失败时，实验分支会尽量保留，便于人工接管；可在 `doc/evolution/failure/` 中查看对应条目，再到本地 `exp/evolution-*` 分支检查。
- `evolution:learn` 若大量 RSS 失败，优先检查代理 / DNS / TLS；`news.ycombinator.com` 证书异常通常是本机网络或代理链路问题，不是仓库代码问题。

底层仍可直接使用 `npm run evolution:pipeline`（bash 一键：build→learn→run-day→可选重载），或 `npm run evolution:learn` / `npm run evolution:run-day` 单独执行。高级细粒度调参（plan、test-agent、review rounds 等）见 `scripts/evolution-quality-pipeline.env.example` 与 `.env.example`。

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
| [`doc/IM_AGENT_INTEGRATION.md`](doc/IM_AGENT_INTEGRATION.md) | 飞书 / 企微 / Webhook 与 Agent 控制能力 |
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
