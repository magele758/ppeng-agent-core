# CI / GitHub Actions 配置指南

## 流水线做什么

仓库根目录 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) 在 **每次 `push` 与 `pull_request`** 时运行：

| Job | 内容 | 是否需要密钥 |
|-----|------|----------------|
| **build-test-regression** | `npm ci` → `build` → `test:unit` → `test:regression` → `test:integration` → `test:e2e`（启发式模型） | 否 |
| **remote-model-smoke** | `npm run test:remote`：真实调用你配置的第三方 API，跑一轮简单对话 | 是（可选） |
| **compact-ab-eval** | `npm run test:compact-ab`：同一条已消费的 bash dump，对比 `keep_recent` vs `after_text_assistant` 能否回想起 `SECRET_TOKEN` | 是（与冒烟同一套 Secrets） |

主 Job 失败会阻塞合并；远程冒烟与压缩 A/B **仅在你配置了 `RAW_AGENT_API_KEY` 时才会执行**，未配置时整 Job 跳过，不影响通过。可在 Actions 里 `workflow_dispatch` 手动重跑。

## 本地与 CI 对齐

```bash
npm run ci
```

等价于：构建 + 单元测试 + HTTP 回归 + 集成测试 + E2E（与 CI 主 Job 一致）。


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

上游返回 **401 Unauthorized** 时，Secrets 已被注入，但中转站拒了这组凭证。请在仓库 **Settings → Secrets and variables → Actions** 核对：

- 名称必须正好是 `RAW_AGENT_API_KEY` / `RAW_AGENT_BASE_URL` / `RAW_AGENT_MODEL_NAME`（仓库 Secrets，不是个人 profile）
- 值不要带引号、不要带 `Bearer ` 前缀、不要多换行；粘贴后重新 Save
- `RAW_AGENT_BASE_URL` 一般要带 `/v1`（如 `https://api.openai.com/v1`）
- 密钥在该中转站仍然有效、有余额；GitHub Actions 出口 IP 未被对方拉黑

CI 日志会打一行 `key_len=… base_has_v1=…`（不打印密钥或主机名），便于对照。

## 压缩 A/B（真模型）

[`scripts/compact-ab-eval.mjs`](../scripts/compact-ab-eval.mjs) 会：

1. 写入与 Lab 相同的 `daemon_control.compact_settings`（不新增功能开关环境变量）；
2. 在 transcript 里植入一条超 `minChars` 的 bash dump（含 `SECRET_TOKEN=AB_EVAL_…`），助手正文默认**不复述**该 token（`silent`）；
3. 对 `keep_recent` 与 `after_text_assistant` 各问一次「token 是什么」；
4. 记录是否召回、`usageTotals`、折叠字符数。报告作为 artifact `compact-ab-report` 上传。

质量回退（基线召回、抽离后召不回）只写进报告的 `quality_regression`，**不单独把 Job 标红**；接口失败或空回复才会失败。默认只跑 `silent`；本地可加 `COMPACT_AB_CASES=silent,restated`。启发式模型下脚本直接 skip。

## Fork 的 Pull Request

来自 **fork** 的 PR **无法读取本仓库 Secrets**，因此 `remote-model-smoke` 不会运行（`RAW_AGENT_API_KEY` 视为空）。主 Job 仍会完整跑通。

## SDK examples（未接入门禁）

`npm run test:examples` 跑 `packages/core/examples/`（`@ppeng/agent-core` 嵌入场景验收，见 [`EMBEDDING_SDK.md`](EMBEDDING_SDK.md)）。目前**不在** `npm run ci` / GitHub Actions 内，需本地或 PR review 时手动跑；后续观察稳定后再考虑纳入。

## 每日 Docker 镜像（GHCR）

[`.github/workflows/docker-nightly.yml`](../.github/workflows/docker-nightly.yml) **每天最多推一组最新镜像**（daemon + web 同一次），**代码没更新则跳过**。

| 项 | 说明 |
|----|------|
| 触发 | 合入 `main` 且触及镜像相关路径；每天 16:00 UTC（北京时间 00:00）；也可 Actions 里 `workflow_dispatch`。**仅合入文档不会打** |
| 跳过 | 现有 `*:nightly` 的 OCI label `org.opencontainers.image.revision` 已等于当前 `HEAD` 则不打。不是「过去 24h 有没有 commit」——昨天没编过的提交第二天仍会打 |
| 强制 | `Run workflow` 勾选 **force**（忽略 SHA 匹配） |
| 分支 | 只在默认分支跑构建；PR 只跑跳过逻辑自测 |
| 不含 | Evolution、真模型调用、macOS DMG |

镜像（仓库名会转小写）：

```text
ghcr.io/<owner>/<repo>/daemon:nightly
ghcr.io/<owner>/<repo>/daemon:latest
ghcr.io/<owner>/<repo>/web:nightly
ghcr.io/<owner>/<repo>/web:latest
```

`nightly` 与 `latest` 指向**同一 digest**，不额外堆日期/SHA tag。首次推送后若包是 private，在 GitHub **Packages** 里把 `daemon` / `web` 改成 Public 即可匿名 pull。

```bash
docker pull ghcr.io/<owner>/<repo>/daemon:nightly
docker pull ghcr.io/<owner>/<repo>/web:nightly
```

用这组镜像跑集群：`deploy/compose/docker-compose.k8s.yml`，或 `kubectl apply -k deploy/k8s/compose`（见 [`deploy/README.md`](../deploy/README.md)）。

跳过判定：`node scripts/docker-nightly-should-build.mjs --self-test`。

## 与本项目环境变量总表

完整变量说明见根目录 [`.env.example`](../.env.example)。Daemon / 本地调试可复制为 `.env`；CI 中仅注入你在 Workflow 里写的 `env` 与 Secrets/Variables。
