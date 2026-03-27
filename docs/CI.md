# CI / GitHub Actions 配置指南

## 流水线做什么

仓库根目录 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) 在 **每次 `push` 与 `pull_request`** 时运行：

| Job | 内容 | 是否需要密钥 |
|-----|------|----------------|
| **build-test-regression** | `npm ci` → `build` → `test:unit` → `test:regression`（启动 daemon，启发式模型） | 否 |
| **remote-model-smoke** | `npm run test:remote`：真实调用你配置的第三方 API，跑一轮简单对话 | 是（可选） |

主 Job 失败会阻塞合并；远程冒烟 Job **仅在你配置了 `RAW_AGENT_API_KEY` 时才会执行**，未配置时整 Job 跳过，不影响通过。

## 本地与 CI 对齐

```bash
npm run ci
```

等价于：构建 + 单元测试 + Daemon HTTP 回归（与 CI 主 Job 一致）。

## 配置第三方模型（Repository secrets）

在 GitHub：**Settings → Secrets and variables → Actions → New repository secret**。

### OpenAI 兼容（默认远程冒烟）

| Secret 名称 | 说明 |
|-------------|------|
| `RAW_AGENT_API_KEY` | API Key（**有此项才会跑 remote-model-smoke**） |
| `RAW_AGENT_BASE_URL` | 例如 `https://api.openai.com/v1` 或你的中转 `https://xxx/v1` |
| `RAW_AGENT_MODEL_NAME` | 模型名，如 `gpt-4o-mini` |

可选 **Variables**（Settings → Secrets and variables → Actions → **Variables**）：

| Variable 名称 | 说明 |
|---------------|------|
| `RAW_AGENT_USE_JSON_MODE` | 第三方不支持 `response_format` 时设为 `0`（会传给远程冒烟） |
| `RAW_AGENT_CI_PROVIDER` | 设为 **`anthropic-compatible`** 时走 Anthropic 冒烟步骤；否则走 OpenAI 兼容步骤 |

### Anthropic 兼容

1. 将 **Variable** `RAW_AGENT_CI_PROVIDER` 设为 **`anthropic-compatible`**。  
2. 配置 **Secrets**：

| Secret | 说明 |
|--------|------|
| `RAW_AGENT_API_KEY` | Anthropic API Key |
| `RAW_AGENT_ANTHROPIC_URL` | 如 `https://api.anthropic.com/v1` |
| `RAW_AGENT_MODEL_NAME` | 如 `claude-3-5-haiku-20241022` |

（`RAW_AGENT_BASE_URL` 在 Anthropic 分支里可作为备用，适配器优先读 `RAW_AGENT_ANTHROPIC_URL`。）

## 远程冒烟脚本在测什么

[`scripts/remote-smoke.mjs`](../scripts/remote-smoke.mjs) 会：

1. 用环境变量创建 `RawAgentRuntime`（与 daemon 相同适配器逻辑）；  
2. 创建一条 Chat，要求模型回复包含 `OK`；  
3. 不满足则退出码非 0，CI 失败。

便于确认 **密钥、BASE_URL、模型名** 在 CI 环境中可用。

## Fork 的 Pull Request

来自 **fork** 的 PR **无法读取本仓库 Secrets**，因此 `remote-model-smoke` 不会运行（`RAW_AGENT_API_KEY` 视为空）。主 Job 仍会完整跑通。

## 与本项目环境变量总表

完整变量说明见根目录 [`.env.example`](../.env.example)。Daemon / 本地调试可复制为 `.env`；CI 中仅注入你在 Workflow 里写的 `env` 与 Secrets/Variables。
