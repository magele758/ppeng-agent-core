# AGENTS.md

## Learned User Preferences

- **配置优先界面，少加环境变量**：**非必要不要新增 `RAW_AGENT_*` / 功能开关类环境变量**。功能开关、策略、白名单、探查选项等应走 **Lab UI + 持久化配置**（如 `daemon_control` KV、`PATCH /api/.../settings`），保存后立即生效，避免改 `.env` / 重启。环境变量仅保留：密钥与上游连接（API Key、Base URL）、进程级引导（端口、auth token）、以及 CI/eval 在「从未界面保存过」时的回退。参考：`packages/core/src/discovery/settings.ts`、Lab「更多 → 能力发现」。
- **本地 `.env`**：仅当任务**确需**改动既有/必要的运行相关环境变量时，才同步更新根目录本机 `.env`（不提交）与 `.env.example`；**不要**为新功能默认堆开关进 `.env`。
- Web 控制台（Next.js）：会话列表自动刷新时应保留滚动位置，并减轻整页跳动；发送消息后输入框应清空，且用户消息应立即出现在对话流（等待模型可用占位符如「…」）。
- 对话区：默认开启流式（`useStream=true`）；发送时先挂乐观用户气泡与助手占位（`…`）并滚动，再 `clearComposerOnly()` 清空输入，再 `await` 请求；thinking/推理块历史消息默认折叠、流式期间展开；工具调用结果默认折叠、点击展开；助手气泡正文用 Markdown 渲染。
- Python 相关任务优先用 conda 创建独立虚拟环境再执行，避免污染全局。

## Learned Workspace Facts

- **手册目录**：专题文档见 [`doc/README.md`](doc/README.md)；项目入口为根目录 `README.md` / `README.zh.md`
- 模型通过 `.env` 配置，支持 `openai-compatible`，需 `RAW_AGENT_BASE_URL`、`RAW_AGENT_API_KEY`、`RAW_AGENT_MODEL_NAME`
- 可选 **VL**：`RAW_AGENT_VL_MODEL_NAME`（及可选 `RAW_AGENT_VL_BASE_URL` / `RAW_AGENT_VL_API_KEY`）启用 `hybrid-router`，含图用户轮走 VL；`vision_analyze` 工具亦使用该 VL
- 第三方 API 若不支持 `response_format`，可设 `RAW_AGENT_USE_JSON_MODE=0`
- 修改 `.env` 后需重启 daemon 使配置生效
- 会话支持 `ImagePart`：`POST /api/sessions/:id/images/ingest-base64`、`.../fetch-url`，消息 body 可带 `imageAssetIds`
- 图片资产在 `stateDir/images/`；热图超限时生成 contact sheet 并写入 `session.metadata.imageWarmContactAssetId`
- 设 `RAW_AGENT_EXTERNAL_AI_TOOLS=1` 并重启 daemon 后，运行时向模型暴露 `claude_code` / `codex_exec` / `cursor_agent`（默认每次需审批），供对话中的 Agent 自主调用（需本机 PATH 有对应 CLI）；仓库未集成 `opencode`。本机 CLI 自检与说明见 `doc/EXTERNAL_AI_CLI.md`、`npm run ai:tools` 等脚本
- **Skills**：除仓库 `skills/**/SKILL.md` 外，默认递归加载 `~/.agents/**/SKILL.md` 并与仓库技能按名合并（同名时 `~/.agents` 覆盖）；`RAW_AGENT_AGENTS_SKILLS=0` 关闭；`RAW_AGENT_AGENTS_SKILLS_DIR` 可改目录（见 `.env.example`）；路由：`RAW_AGENT_SKILL_ROUTING_MODE`（`legacy`/`hybrid`）、`RAW_AGENT_SKILL_LOAD_STRICT=1` 时 `load_skill` 仅限当轮 shortlist（见 `doc/skill-router-baseline.md`）
- **Self-heal**：`POST /api/self-heal/start` 或 `npm run start:cli -- self-heal start`；`npm run self-heal:flow`（`scripts/self-heal-flow.sh`）一键 stash→调 daemon 自愈→轮询结束→stash pop（可 `sheal_*` resume、`--new`、`SELF_HEAL_FLOW_NO_STASH=1`）；调度器在 worktree 内跑白名单测试、失败则由 `self-healer` 修；可选自动合并主仓与 `restart-request` 握手（见 `doc/ARCHITECTURE.md`、`.env.example` 中 `RAW_AGENT_SELF_HEAL_*`）；`supervisor.mjs` 自动拉起重启的 daemon（`npm run start:supervised`）。若 daemon/supervisor 下出现 `spawn npm`/`git` ENOENT，可设 `RAW_AGENT_NPM_BIN` / `RAW_AGENT_GIT_BIN`；合并后可选 `RAW_AGENT_SELF_HEAL_GIT_PUSH` 推远端（需凭证）
- **前端架构（重构后）**：`apps/web-console` 是 **Next.js 15 App Router** 应用（非旧版 SPA）。入口 `app/page.tsx` → `components/AgentLabApp.tsx`；辅助库在 `lib/`（`api.ts`、`sse.ts`、`chat-utils.ts`、`markdown.ts`、`types.ts`）；组件 `components/ChatTurns.tsx`、`components/TeamGraph.tsx`。Daemon 仅在 `/` 返回 stub 页，业务全走 `/api/*`。Next 通过 `middleware.ts` 按 `DAEMON_PROXY_TARGET` 将 `/api/*` 代理到 daemon；若在 Next 进程中设置与 daemon **相同**的 `RAW_AGENT_AUTH_TOKEN`，middleware 会在服务端出站请求补上 `Authorization: Bearer`（浏览器不暴露 token）。开发：根目录 `npm run dev` / `npm run dev:lab`（`scripts/dev-lab.mjs`，会先加载根 `.env` 再并行起 daemon+Next，`DAEMON_PROXY_TARGET` 默认 `http://127.0.0.1:37070`）；或单独 `npm run dev:web-console`（须在 shell 或 `apps/web-console/.env.local`/`apps/web-console/.env.example` 指引处对齐 `DAEMON_PROXY_TARGET` 与可选同源 token），Next 默认 `http://127.0.0.1:33815`；生产：`npm run build:web-console && npm run start:web-console`。内置 Agent `general`（通用助手）置顶为默认选项，通过 `RawAgentRuntime.ensureBuiltinAgentsSynced()` 写入 SQLite；`npm run dev:daemon` 只编译 `apps/daemon`，修改 `packages/core` 后需额外执行 `npx tsc -b packages/core`
- **E2E / 回归子进程**：`npm run test:e2e` 由 `scripts/e2e-run.mjs` 自拉起临时 daemon + Next（随机端口、同源随机 `RAW_AGENT_AUTH_TOKEN`），Playwright 验证「直连 daemon 401 / 经 Lab 200」；仅用 `PLAYWRIGHT_BASE_URL` 指已有控制台时则无该断言。回归 `regression-test`、integration、`agent:eval` 拉起的临时 daemon **不会继承**宿主 `RAW_AGENT_AUTH_TOKEN`，以免黑盒脚本未带 Bearer 时误失败；另有 `RAW_AGENT_SELF_HEAL_AUTO_START=0`（避免与本机 `.env` 自愈冲突）、`evolution-run-day.mjs` 剥离 `RAW_AGENT_SELF_HEAL_*` 等与既有说明一致。
- **Evolution 展示页（GitHub Pages）**：首页源仓库 `https://github.com/magele758/magele758.github.io.git`；本机 `EVOLUTION_SHOWCASE_DEPLOY_DIR`、`EVOLUTION_SHOWCASE_AUTO_DEPLOY`、`EVOLUTION_SHOWCASE_GIT_PUSH`、`EVOLUTION_SHOWCASE_GIT_REMOTE_BRANCH`（可选）等见根目录 `.env` 与 `.env.example`。发布前会在 Pages 克隆内 `pull --rebase`。展示 JSON 中「合并提交」链接指向**代码主仓**（`EVOLUTION_SHOWCASE_GITHUB_REPO`），与 Pages 仓库不同。
- **Evolution 管线**：统一入口 `npm run evolution -- [options]`（`scripts/evolution-cli.mjs`）通过参数控制完整流程，替代旧的 `run-cursor-*` 系列命令。常用参数：`--learn`（先拉 RSS inbox）、`--agent cursor|claude|codex|full|multi`（实现 agent）、`--model <name>`（cursor 模型，默认 `composer-2-fast`）、`--review cursor|codex|none`（review agent，默认 none）、`--concurrency <n>`（并发数，默认上限见 `EVOLUTION_CONCURRENCY_MAX`，未设 env 时为 32，硬顶 200）、`--items <n>`（限制条目数）、`--merge`（自动合并）、`--pipeline-build`（先编译 gateway）、`--learn-only`（仅 learn）；`--help` 查看全部选项。典型用法：`npm run evolution -- --learn --agent cursor --review codex`（cursor 开发 + codex review）；`npm run evolution -- --learn --agent claude`（claude 开发，默认）；`npm run evolution -- --learn-only`（仅更新 inbox）；底层仍可直接用 `npm run evolution:learn` / `npm run evolution:run-day` / `npm run evolution:pipeline`（`scripts/evolution-pipeline.sh`，一键 build+learn+run-day）；run-day 流程：建 worktree → 复制 `.env`/`gateway.config.json` → `EVOLUTION_AGENT_CMD` 改代码 → 构建（`EVOLUTION_BUILD_CMD`）→ `EVOLUTION_TEST_CMD`（默认 `test:unit`）→ 可选 review/refine 循环；管线扫描 `doc/evolution/{success,failure,skip,no-op}/` 避免重复；Evolution 观测页 `/evolution` 由 `apps/daemon/src/evolution-api.ts` 提供 `GET /api/evolution/overview`、`/results`、`/result/:id`；定时见 `scripts/cron-evolution.example.sh`
- **Sandbox（子进程沙箱）**：所有 `spawn()` 调用均通过 `sanitizeSpawnEnv()`（`packages/core/src/sandbox/env-sanitizer.ts`）剥离 LD_PRELOAD / NODE_OPTIONS / DYLD_INSERT_LIBRARIES 等注入向量（Tier 0）；`bash` 和 `bg_run` 工具通过 `SandboxManager`（`packages/core/src/sandbox/os-sandbox.ts`）路由：macOS 用 `sandbox-exec` 阻止 ~/.ssh, ~/.aws, ~/.gnupg 访问（Tier 1），Linux 用 `bwrap` 做 namespace 隔离（Tier 1），不支持时降级为 Tier 0；配置 `RAW_AGENT_SANDBOX_MODE=auto|direct|os|container`（默认 `auto`）；新增 spawn 必须用 `sanitizeSpawnEnv()` 或 `SandboxManager`
- **Tool result 回流脱敏**：`packages/core/src/sandbox/result-redaction.ts` 把敏感 env 值从 bash/bg_*/work_evidence 结果替换为 `[REDACTED:NAME]`（防 printenv 进 LLM/trace/会话库）
- **Unknown-tool 自愈**：未知工具返回结构化 JSON（`did_you_mean` / `available_tools_sample`），保持 tool_call↔result 配对
- **Recovery AdvisoryGrace**：LoopGuard 将 abort 时默认宽限 1 轮并注入 `[recovery-advisory]`（`RAW_AGENT_RECOVERY_ADVISORY_GRACE` / `_BUDGET`）
- **Goal soft-gate**：`metadata.goalCondition` + `goal/`；软完成判官 `completeText`（JSON met/reason）；fail-open；`RAW_AGENT_GOAL_GATE`
- **RiskEngine + AdvisoryQueue**：多信号 → 入队 → 下轮 system；`RAW_AGENT_RISK_ENGINE`
- **Case governance**：`evolving/case-governance`（decay/archive/capacity）；schema v10
- **Memory user appendix**：`buildMemoryAppendix` 拼到最近 user 消息（不进 system）
- **Token 成本估算**：`model/token-cost.ts` → `turn_end.costUsd` + `session.metadata.usageCostUsd`
- **智能体失范（治理层）**：公开研究（如 Anthropic「Agentic Misalignment」、MSM / Teaching Why）主要对应 **训练与模型方**；本仓库侧为 **审批、沙箱、最小权限、审计** 与可选 **系统提示附录**。说明与控件映射见 `doc/AGENTIC_SAFETY_RUNTIME.md`；可选 `RAW_AGENT_AGENTIC_SAFETY_APPENDIX=1`（仅 `general`）或 `=all`，见 `.env.example`
- **A2UI**：`RAW_AGENT_A2UI_ENABLED=1` 暴露 `a2ui_render` / `a2ui_delete_surface` 工具（`packages/core/src/tools/builtin-tools.ts`），按 v0.9 envelope 序列在对话气泡里渲染 surface；协议层 `packages/core/src/a2ui/`（envelope + validator + 两个 catalog：basic + agent-native v1，catalogId `https://ppeng.dev/agent-core/a2ui/v1`），渲染层 `apps/web-console/components/a2ui/`（`A2uiSurface` + JSON-Pointer 绑定 + 注册表）；工具结果通过 metadata 推 `ModelStreamChunk { type: 'a2ui_message' }` 实时流式 + 持久化为 `SurfaceUpdatePart`；用户点按钮 → POST `/api/sessions/:id/a2ui/action` → 合成用户消息 `[a2ui:action <name>] {...}` 喂回 agent。catalog 速查见 `skills/a2ui/SKILL.md`，详见 `doc/A2UI.md`
- **Domain Agents**：`RAW_AGENT_DOMAINS=sre,stock`（CSV）按需挂载领域包；当前内置 `@ppeng/agent-sre`（personas: sre-oncall / sre-postmortem，tools: prom_query / loki_query / k8s_get / pagerduty_list，全 read-only）和 `@ppeng/agent-stock`（personas: stock-analyst / stock-screener，tools: quote_get / fundamentals_get / news_search，provider 切换 yahoo|alphavantage|mock）。core 扩展点：`RuntimeOptions.{extraAgents,extraTools,extraSkills}`、`AgentSpec.{allowedTools,domainId}` 在 `_runSessionInner` 过滤 turnTools；`DomainBundle` + `mergeDomainBundles` 在 `packages/core/src/domain.ts`；daemon 加载器 `apps/daemon/src/domain-loader.ts`。新增 domain 包参见 `doc/DOMAIN_AGENTS.md` 5 步指南
- **A/B Release（Stable/Candidate）**：`npm run release`（`scripts/release-orchestrator.mjs`）；Compose `profile stable|candidate`（`deploy/compose/docker-compose.yml`）+ Helm `values-candidate.yaml`；报告 `doc/evolution/reports/<release_run_id>.json`；`EVOLUTION_RELEASE_BACKEND=compose|helm`；详见 `doc/SELF_EVOLUTION_AB_RELEASE.md`
- **Evolution 2.0**：`scripts/evolution/capability-tagger.mjs`（规则打标）、`scripts/evolution/source-score-report.mjs`（来源评分报告）；run-day 写 JSONL 到 `doc/evolution/runs/YYYY-MM-DD.jsonl`；result doc frontmatter 含 `capability_tags/failure_type/risk_level/cost_estimate/run_id/agent/model`；可选 `EVOLUTION_USE_ORCHESTRATOR=1` 接入 Orchestrator（`scripts/evolution/evolution-orchestrator-bridge.mjs`）、`EVOLUTION_MERGE_RISK_CHECK=1` 按风险等级控制合并（low=自动合并、medium=警告后合并、high=写 backlog 跳过合并，见 `scripts/evolution/merge-gate.mjs`）、`EVOLUTION_HARNESS_GATE=1` 合并前跑 fast eval；`doc/evolution/backlog/` 存放 high-risk 被拦截条目
- **Agent Orchestrator**：`packages/core/src/orchestrator/`；类型 `OrchestrationRun/Step/Event`；SQLite 表 `orchestration_runs/steps/events`；HTTP API `GET/POST /api/orchestration/runs`、`PATCH /api/orchestration/runs/:id/status`、`/steps`、`/events`
- **DeepResearch**：`packages/core/src/deepresearch/`；类型 `ResearchTask/Source/Evidence/Claim`；HTTP API `GET/POST /api/research/tasks`、`/sources`、`/evidence`、`/claims`
- **Memory 多层**：`packages/core/src/memory/`；`AgentMemoryStore` 五层 scope（`session.scratch`/`session.long`/`user.memory`/`team.memory`/`project.memory`）；**对话回路**（`memory_set`/`memory_get`、PromptBuilder）统一经 `AgentMemoryStore`；`RAW_AGENT_MEMORY_BACKEND=session` 可回退旧 `session_memory` 表；HTTP `GET/POST /api/memory`、`/api/users`、`/api/tenants`
- **Teams Swarm**：`packages/core/src/swarm/`；类型 `SwarmRun/SwarmTask/SwarmReview`；HTTP API `GET/POST /api/swarm/runs`、`/tasks`、`/reviews`；scheduler 自动超时检查
- **Deployment**：`deploy/docker/`（Dockerfile.daemon/web）、`deploy/compose/docker-compose.yml`、`deploy/helm/ppeng-agent-core/`（Helm chart）；daemon 新增 `/api/readiness` 端点
- **Harness eval**：`npm run agent:eval` / `npm run agent:eval:fast`；cases 在 `scripts/agent-eval/cases/fast/`；结果写 `doc/eval-results/YYYY-MM-DD.jsonl`；支持 `--exit-on-fail`（任意 case 失败时 exit 1，不带此参数则 exit 0）
- **LLM 用量 / 截断可观测性**：`ModelTurnResult` 携带可选 `usage`（`TokenUsage`）/`finishReason`/`truncated`；归一化纯函数在 `packages/core/src/model/usage.ts`（OpenAI chat + responses + Anthropic）。chat 流式带 `stream_options.include_usage`。runtime `turn_end` trace 记 `usage`/`finishReason`，截断轮另发 `turn_truncated` trace，会话累计写 `session.metadata.usageTotals`。**纯观测、不改循环控制**（不因截断改写 stopReason）。
- **Upstream request-id**：`ModelTurnResult.requestId?`；提取纯函数 `packages/core/src/model/upstream-request-id.ts`（header / JSON / SSE / 嵌套 error）；`turn_end` 透传。
- **STABLE_SYSTEM_VERSION**：`prompt-builder.ts` 指纹常量，进 `turn_end`（不进 prompt/cache key）；改 stable 文案须 bump，见 `packages/core/src/model/AGENTS.md`。
- **Optional groups 服务端默认**：`RAW_AGENT_DEFAULT_ENABLED_OPTIONAL_GROUPS`（CSV）∪ 会话 `enabledOptionalToolGroups`；需 `RAW_AGENT_OPTIONAL_TOOL_GROUPS=1`。
- **轮内退化防护（与 LoopGuard 正交，别混）**：LoopGuard / RiskEngine 都是**跨轮 + 工具中心**；
  两个 watchdog 补的是**轮内**盲区。① 复读 `streaming/repetition-watchdog.ts`：包在
  `runtime/tool-loop.ts` 的 `runTurnWithRetries` 里（**不在各 adapter 内**，故 chat / responses /
  hybrid 一条路全覆盖），命中 abort 流 + **干净重答一次**，二次命中即收尾；注意它对
  `runTurnWithRetries` 的通用退避重试是**豁免**的（重试只会重送整套 prompt 换同一份垃圾）。
  ② 思考空转 `streaming/reasoning-spin-watchdog.ts`：连续 N 轮只有 reasoning / 空输出，
  **刻意不重试**（同理）；先落盘已有产出再优雅收尾。env / trace kind 见 `doc/CAPABILITY_ABSORPTION_PLAN.md`
- **两层压缩别混**：`autoCompact`（过阈值 → LLM 摘要 + 归档 transcript，有损）
  与 `session/micro-compact.ts`（**每轮**跑、只碰 `tool_result`、纯函数）。微压缩
  **只改送给模型的视图，不改落库 transcript**——所以它跑在 `prepareMessagesForModel` 末尾，
  且要在 token 估算之前，否则 autoCompact 会按未压缩的量误判。
- **历史预算按模型窗口推导**：压缩阈值与 episodic 预算**不再硬编码 24k**
  （`session/session-budget.ts`），显式 env 仍优先。换大窗口模型只改
  `RAW_AGENT_MODEL_CONTEXT_TOKENS`；`turnShapeBySession` 用上一轮实际 prompt 形状喂下一轮推导。
- **Session working log**：`session/working-log.ts`，`stateDir/working-logs/<sid>/working-memory.md`
  append-only，只记高信号（压缩锚点+归档路径、步骤结论）。尾部与 memory appendix **同走 user 侧**
  注入（进 system 会破坏 prompt cache）；文件缺失降级为空串，写失败只 warn。
- **累计 prompt token**：部分网关把 `prompt_tokens` 报成会话running total，直接累加会让
  totals / 成本按平方涨（30k 上下文 10 轮报成 433k）。`splitCumulativePromptTokens` 在 runtime
  归一为「本轮份额」后才交给成本与 `usageTotals`。
- 能力对照与差距分析见 `doc/CAPABILITY_ABSORPTION_PLAN.md`（对照 ai-agent-node）
