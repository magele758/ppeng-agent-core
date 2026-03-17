# AGENTS.md

## Learned User Preferences

- （暂无）

## Learned Workspace Facts

- 模型通过 `.env` 配置，支持 `openai-compatible`，需 `RAW_AGENT_BASE_URL`、`RAW_AGENT_API_KEY`、`RAW_AGENT_MODEL_NAME`
- 第三方 API 若不支持 `response_format`，可设 `RAW_AGENT_USE_JSON_MODE=0`
- 修改 `.env` 后需重启 daemon 使配置生效
