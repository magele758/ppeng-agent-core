# CI / GitHub Actions 配置指南

## 流水线做什么

仓库根目录 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) 在 **每次 `push` 与 `pull_request`** 时运行：

| Job | 内容 | 是否需要密钥 |
|-----|------|----------------|
| **Release gate**（[`release-gate.yml`](../.github/workflows/release-gate.yml)） | 两个并行 Job + 汇总：① `npm ci` → `build` → `test:unit` → `test:formal` → `agent:eval:fast -- --exit-on-fail` → `test:regression` → `test:integration` → `test:e2e`（启发式模型）；② 工具链预检后带覆盖率跑 `test:unit` 与 SDK vitest → [CRAP 门禁](CRAP_GATE.md)；③ **Main release gate** 汇总，仅全部成功才通过 | 否 |
| **remote-model-smoke** | `npm run test:remote`：真实调用你配置的第三方 API，跑一轮简单对话 | 是（可选） |

远程冒烟 **仅在你配置了 `RAW_AGENT_API_KEY` 时才会执行**，未配置时整 Job 跳过，不影响通过。真模型压缩 A/B 不在这条流水线里，见下方「压缩 A/B」。

## main 发布卡点

`release-gate.yml` 是可复用 workflow，三处调用。**npm 与 Docker 发布改为强制阻断**：只有同一工作流 revision 的门禁成功才允许发布；失败、取消、跳过均不放行。这不等同于已配置 GitHub main 分支保护，也不覆盖桌面发布或本地直接发布命令。

| 调用方 | 时机 | 当前策略 | 边界 |
|---|---|---|---|
| `ci.yml` | 每次 push / PR | PR 上显示门禁结果 | 合并是否被阻止仍取决于分支保护 |
| `publish-npm.yml` | `npm-v*` tag / 手动 | publish 必须等待 release-gate 成功 | dry run 也不绕过门禁 |
| `docker-nightly.yml` | main / 定时，且需要重打镜像 | build 与 gate 并行，push 必须等待两者成功 | PR 只构建冒烟；force 只绕过 SHA 去重，不绕过测试 |

`scripts/test/release-workflow-policy.test.mjs` 校验这些依赖与成功条件，并执行真实汇总 shell 的 25 种状态组合。失败时仍上传 `release-test-evidence`（已有的 Playwright / fast eval 结果）与 `crap-report`，保留 14 天；不保证测试中断前尚未生成的报告存在。

**让合并真正被卡住**：GitHub → Settings → Branches（或 Rules → Rulesets）→ `main` →
勾选 *Require status checks to pass before merging*，把 **`Release gate / Main release gate`** 加为 required check
（建议同时勾选 *Require branches to be up to date before merging*）。未配置时 CI 失败只是红叉，不会阻止合并。

## 本地与 CI 对齐

```bash
nvm use                    # .nvmrc 与发布门禁统一使用 Node 22
npm ci                     # 恢复锁定依赖；不要靠放宽版本/基线解决工具冲突
npm run ci
```

等价于：构建 + 单元测试 + formal 不变量/MockLLM + fast eval（失败退出）+ 能力评估引擎 simulation 自检 + npm tarball 安装/运行自检 + CRAP 门禁 + HTTP 回归 + 集成测试 + E2E。Playwright 输出到 `test-results/playwright`，保留其他测试证据，flaky 重试成功仍失败。发布边界见 [发布可靠性计划](RELEASE_RELIABILITY_PLAN.md)，真实模型 A/B 与提示词回归见 [Harness 评估](HARNESS_EVALUATION.md)。


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
- `RAW_AGENT_MODEL_NAME` 必须是这把 key **有权调用**的模型；中转站对未授权模型常直接 401
- 密钥在该中转站仍然有效、有余额；GitHub Actions 出口 IP 未被对方拉黑

CI 日志会打一行 `key_len=… base_has_v1=…`（不打印密钥或主机名），便于对照。

## 压缩 A/B（真模型，仅手动）

独立 workflow [`.github/workflows/compact-ab.yml`](../.github/workflows/compact-ab.yml)，**不跟 push / PR**。在 Actions 选 **Compact A/B → Run workflow**。

[`scripts/compact-ab-eval.mjs`](../scripts/compact-ab-eval.mjs) 会：

1. 写入与 Lab 相同的 `daemon_control.compact_settings`（不新增功能开关环境变量）；
2. 在 transcript 里植入三条超 `minChars` 的真实 bash stdout（`ls -la` 目录、`git status`、一段 node:test 失败栈）。探针是 listing 里的 tarball 文件名，只出现在 `ls` stdout，不出现在 user 指令或命令行参数里；助手正文默认**不复述**该文件名（`silent`）；
3. 对 `keep_recent` 与 `after_text_assistant` 各问一次「listing 里的 tarball 文件名是什么」；
4. 报告写清 tool 名、stdout 摘要、silent/restated 召回、token、折叠字数，作为 artifact `compact-ab-report` 上传。

质量回退只写进报告的 `quality_regression`；接口失败或空回复才会失败。默认 `silent`；Run workflow 时可填 `silent,restated`。本地：`npm run test:compact-ab`。启发式模型下脚本直接 skip。分析结论见 [`doc/harness/04-context-economics.md`](harness/04-context-economics.md)。

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
| 分支 | 只在默认分支推送；PR（改到 Dockerfile / 本 workflow / 部署冒烟脚本时）只构建 + 部署冒烟，不登录 GHCR、不推 |
| 冒烟 | 推送前先在 runner 上跑镜像，见下方「推送前部署冒烟」 |
| 卡点 | 部署冒烟、镜像验证和 release gate 必须全部成功，否则不推送 |
| 不含 | Evolution、真模型调用、桌面安装包（见下方「桌面产物」） |

镜像（仓库名会转小写）：

```text
ghcr.io/<owner>/<repo>/daemon:nightly
ghcr.io/<owner>/<repo>/daemon:latest
ghcr.io/<owner>/<repo>/web:nightly
ghcr.io/<owner>/<repo>/web:latest
```

先构建并加载两个镜像，按实际 image ID 完成隔离容器冒烟，再推送 `sha-<SHA>`、`nightly` 与 `latest`（单个镜像指向同一 digest）。测试后不重新构建；证据记录 exact image IDs。两个镜像标签更新不是原子事务。首次推送后若包是 private，在 GitHub **Packages** 里把 `daemon` / `web` 改成 Public 即可匿名 pull。

```bash
docker pull ghcr.io/<owner>/<repo>/daemon:nightly
docker pull ghcr.io/<owner>/<repo>/web:nightly
```

用这组镜像跑集群：`deploy/compose/docker-compose.k8s.yml`，或 `kubectl apply -k deploy/k8s/compose`（见 [`deploy/README.md`](../deploy/README.md)）。

跳过判定：`node scripts/docker-nightly-should-build.mjs --self-test`。

### 推送前部署冒烟

`docker-nightly.yml` 的 job 顺序：

1. **self-test**：跳过逻辑自测 + `scripts/test/deploy-smoke-lib.test.mjs`。
2. **decide**：nightly 已是当前 SHA 则整条跳过（PR 不跑）。
3. **build**（`Build images + deploy smoke`）：用 buildx 构建 daemon / web 并 `load` 到 runner（**不推**，GHA 缓存照旧）；
   建 docker network，daemon 用 `RAW_AGENT_MODEL_PROVIDER=heuristic`、临时 state、随机 `RAW_AGENT_AUTH_TOKEN`，web 用同一 token 且
   `DAEMON_PROXY_TARGET=http://daemon:37070`；然后跑 [`scripts/deploy-smoke.mjs`](../scripts/deploy-smoke.mjs)（检查项见
   [`DEPLOYMENT.md`](DEPLOYMENT.md)「部署冒烟」）。结果写 step summary，JSON 作为 artifact `deploy-smoke` 上传；失败时打印容器日志。
   另跑 `scripts/release/image-smoke.mjs` 检查同一对镜像的鉴权、SSE 与重启持久化，上传 `image-smoke-evidence`。
   任一检查失败则 build 红；非 PR 且检查通过时把镜像 `docker save` 成 artifact `nightly-images`（保留 1 天）。
4. **release-gate**：与 build 并行。
5. **push**：gate 与 build 均成功才运行；下载第 3 步的 tar 与镜像证据，`docker load` 后比对实际 image ID，再按该 ID 推送 SHA 标签与别名，不重新构建。

| 场景 | 结果 |
|---|---|
| 冒烟失败（main / 定时 / PR） | build 红，`push` 跳过 |
| gate 失败、取消或跳过 | `push` 跳过 |

## 桌面产物（mac / Windows / Linux × x64 / arm64）

[`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml) 打 **6 套** Electron 安装包。每套在对应 arch 的 runner 上编译 Next standalone 和 `server-bundle`，避免交叉编译 `sharp` / `@next/swc`。

| 产物 id | Runner | 文件 |
|---------|--------|------|
| `mac-arm64` | `macos-14` | `RawAgent-<ver>-mac-arm64.dmg` |
| `mac-x64` | `macos-14` + Node x64（Rosetta） | `RawAgent-<ver>-mac-x64.dmg` |
| `win-x64` | `windows-latest` | `RawAgent-<ver>-win-x64.exe` |
| `win-arm64` | `windows-11-arm` | `RawAgent-<ver>-win-arm64.exe` |
| `linux-x64` | `ubuntu-latest` | `RawAgent-<ver>-linux-x64.AppImage` |
| `linux-arm64` | `ubuntu-24.04-arm` | `RawAgent-<ver>-linux-arm64.AppImage` |

| 项 | 说明 |
|----|------|
| 触发 | 每天 17:00 UTC（北京时间 01:00）打齐 6 套；Actions → **Desktop artifacts** → Run workflow（可只打一套）；推送 `desktop-v*`（agent 可用，不发版；`desktop-v0.1.0-mac-arm64` 只打一套）；推送 `v*` 打齐并挂到 GitHub Release。定时仅在默认分支生效 |
| 不含 | Docker nightly、Evolution、真模型、Apple 公证（CI 不签名，仅 ad-hoc） |
| Mac 打开 | 未公证时系统会报「已损坏」。M 系列用 `mac-arm64` DMG，先 `xattr -cr` 再打开，见 [`apps/desktop/README.md`](../apps/desktop/README.md) |
| 本地 | `npm run build:desktop`（当前机器）；或 `--platform mac\|win\|linux --arch x64\|arm64` |

本地交叉打别的 OS/arch 不可靠：请用对应 runner 或同架构机器。

## npm 包（@mage-ai-lab/api-types、@mage-ai-lab/agent-loop）

[`.github/workflows/publish-npm.yml`](../.github/workflows/publish-npm.yml) **不跟 push / PR**。脚本是 [`scripts/publish-npm-packages.mjs`](../scripts/publish-npm-packages.mjs)：编译后把工作区 `@ppeng/*` 改写成 `@mage-ai-lab/*`，打包并在隔离 consumer 安装，检查 exports、类型和 mini 运行后才发布同一 tarball，不改仓库里的包名。`npm run test:package` 仅验证，不访问发布接口、不需要 token；证据含 SHA256。

| 项 | 说明 |
|----|------|
| 触发 | Actions → **Publish npm** → Run workflow（可勾选 dry run）；或推送 tag `npm-v<version>` |
| 版本 | tag 必须等于 `packages/api-types` 与 `packages/agent-loop` 的 `package.json` `version`。该版本已在 npm 上则失败，先改版本再发 |
| Secret | `NPM_TOKEN`：npm Automation token，需能发布 `@mage-ai-lab` 这两个包。Actions 用它做 provenance |
| 卡点 | `publish` 必须等待 release gate 成功（含 dry run），失败、取消、跳过均不发布 |
| 本地 | `npm login` 后 `npm run publish:npm`；只打包不上传：`NPM_PUBLISH_DRY_RUN=1 npm run publish:npm` |

## 与本项目环境变量总表

完整变量说明见根目录 [`.env.example`](../.env.example)。Daemon / 本地调试可复制为 `.env`；CI 中仅注入你在 Workflow 里写的 `env` 与 Secrets/Variables。
