# AGENTS.md

## Learned User Preferences

- Web 控制台：会话列表自动刷新时应保留滚动位置，并减轻整页跳动；发送消息后输入框应清空，且用户消息应立即出现在对话流（等待模型可用占位符如「…」）。
- 对话区：助手侧期望流式输出，若有 thinking 字段应展示；工具调用结果默认折叠、点击展开；助手气泡正文用 Markdown 渲染。

## Learned Workspace Facts

- 模型通过 `.env` 配置，支持 `openai-compatible`，需 `RAW_AGENT_BASE_URL`、`RAW_AGENT_API_KEY`、`RAW_AGENT_MODEL_NAME`
- 可选 **VL**：`RAW_AGENT_VL_MODEL_NAME`（及可选 `RAW_AGENT_VL_BASE_URL` / `RAW_AGENT_VL_API_KEY`）启用 `hybrid-router`，含图用户轮走 VL；`vision_analyze` 工具亦使用该 VL
- 第三方 API 若不支持 `response_format`，可设 `RAW_AGENT_USE_JSON_MODE=0`
- 修改 `.env` 后需重启 daemon 使配置生效
- 会话支持 `ImagePart`：`POST /api/sessions/:id/images/ingest-base64`、`.../fetch-url`，消息 body 可带 `imageAssetIds`
- 图片资产在 `stateDir/images/`；热图超限时生成 contact sheet 并写入 `session.metadata.imageWarmContactAssetId`
- 设 `RAW_AGENT_EXTERNAL_AI_TOOLS=1` 并重启 daemon 后，运行时向模型暴露 `claude_code` / `codex_exec` / `cursor_agent`（默认每次需审批），供对话中的 Agent 自主调用（需本机 PATH 有对应 CLI）；仓库未集成 `opencode`。本机 CLI 自检与说明见 `docs/EXTERNAL_AI_CLI.md`、`npm run ai:tools` 等脚本
- **Self-heal**：`POST /api/self-heal/start` 或 `npm run start:cli -- self-heal start`；调度器在 worktree 内跑白名单测试、失败则由 `self-healer` 修；可选自动合并主仓与 `restart-request` 握手（见 `docs/ARCHITECTURE.md`、`.env.example` 中 `RAW_AGENT_SELF_HEAL_*`）
