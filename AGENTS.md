# AGENTS.md

## Learned User Preferences

- Web 控制台（Next.js）：会话列表自动刷新时应保留滚动位置，并减轻整页跳动；发送消息后输入框应清空，且用户消息应立即出现在对话流（等待模型可用占位符如「…」）。
- 对话区：助手侧期望流式输出，若有 thinking 字段应展示；工具调用结果默认折叠、点击展开；助手气泡正文用 Markdown 渲染。
- Python 相关任务优先用 conda 创建独立虚拟环境再执行，避免污染全局。

## Learned Workspace Facts

- 模型通过 `.env` 配置，支持 `openai-compatible`，需 `RAW_AGENT_BASE_URL`、`RAW_AGENT_API_KEY`、`RAW_AGENT_MODEL_NAME`
- 可选 **VL**：`RAW_AGENT_VL_MODEL_NAME`（及可选 `RAW_AGENT_VL_BASE_URL` / `RAW_AGENT_VL_API_KEY`）启用 `hybrid-router`，含图用户轮走 VL；`vision_analyze` 工具亦使用该 VL
- 第三方 API 若不支持 `response_format`，可设 `RAW_AGENT_USE_JSON_MODE=0`
- 修改 `.env` 后需重启 daemon 使配置生效
- 会话支持 `ImagePart`：`POST /api/sessions/:id/images/ingest-base64`、`.../fetch-url`，消息 body 可带 `imageAssetIds`
- 图片资产在 `stateDir/images/`；热图超限时生成 contact sheet 并写入 `session.metadata.imageWarmContactAssetId`
- 设 `RAW_AGENT_EXTERNAL_AI_TOOLS=1` 并重启 daemon 后，运行时向模型暴露 `claude_code` / `codex_exec` / `cursor_agent`（默认每次需审批），供对话中的 Agent 自主调用（需本机 PATH 有对应 CLI）；仓库未集成 `opencode`。本机 CLI 自检与说明见 `docs/EXTERNAL_AI_CLI.md`、`npm run ai:tools` 等脚本
- **Self-heal**：`POST /api/self-heal/start` 或 `npm run start:cli -- self-heal start`；`npm run self-heal:flow`（`scripts/self-heal-flow.sh`）一键 stash→调 daemon 自愈→轮询结束→stash pop（可 `sheal_*` resume、`--new`、`SELF_HEAL_FLOW_NO_STASH=1`）；调度器在 worktree 内跑白名单测试、失败则由 `self-healer` 修；可选自动合并主仓与 `restart-request` 握手（见 `docs/ARCHITECTURE.md`、`.env.example` 中 `RAW_AGENT_SELF_HEAL_*`）；`supervisor.mjs` 自动拉起重启的 daemon（`npm run start:supervised`）
- **前端架构（重构后）**：`apps/web-console` 是 **Next.js 15 App Router** 应用（非旧版 SPA）。入口 `app/page.tsx` → `components/AgentLabApp.tsx`；辅助库在 `lib/`（`api.ts`、`sse.ts`、`chat-utils.ts`、`markdown.ts`、`types.ts`）；组件 `components/ChatTurns.tsx`、`components/TeamGraph.tsx`。Daemon 仅在 `/` 返回 stub 页，业务全走 `/api/*`。Next 通过 `middleware.ts` 按 `DAEMON_PROXY_TARGET` 将 `/api/*` 代理到 daemon；开发：`npm run dev:web-console`（Next 默认 `http://127.0.0.1:13000`；需 `export DAEMON_PROXY_TARGET=http://127.0.0.1:7070`），生产：`npm run build:web-console && npm run start:web-console`
- **E2E 测试**：`npm run test:e2e` 自动启动临时 daemon + Next（随机端口），Playwright 打 Next 的 URL；旧版 `apps/web-console/legacy-vanilla/` 仅做备份，不在测试范围内
- **回归/E2E 子进程**：`scripts/regression-test.mjs` 与 `scripts/e2e-run.mjs` 启动的临时 daemon 会强制 `RAW_AGENT_SELF_HEAL_AUTO_START=0`，避免与本机 `.env` 中 `AUTO_START=1` 叠加导致 self-heal 首次 `start` 返回 409
- **Evolution 管线**：`npm run evolution:learn` 拉 RSS → `doc/evolution/inbox/` + `skills/agent-tech-digest`，终端按 feed 打进度，摘要见 `doc/evolution/runs/latest-learn.md`；`npm run evolution:run-day` 按 inbox 建 worktree、跑 `EVOLUTION_TEST_CMD`（默认 `npm run test:unit`）、写 `doc/evolution/success|failure`，终端与 `doc/evolution/runs/latest-run-day.md` 可看每步耗时；`EVOLUTION_AUTO_MERGE=0` 默认不合并；`EVOLUTION_NO_RUN_LOG=1` 禁用写入 runs 摘要；定时见 `scripts/cron-evolution.example.sh`
