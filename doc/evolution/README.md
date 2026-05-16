# Evolution 实验记录（自我进化管线）

本目录与仓库根目录的 `doc/`（架构与 CI 说明）区分：**`doc/evolution/`** 存放自动化实验的 **inbox、成功/失败记录**，由 `npm run evolution:learn` / `npm run evolution:run-day` 写入或更新。

## 最常用：三步自我学习循环

本机 `.env` / `gateway.config.json` 就绪后，日常可按顺序固定跑下面三条（先 ingest → 再跑一轮实验 → 最后更新展示站）：

```bash
npm run evolution -- --learn-only
npm run evolution -- --agent cursor --review cursor --model composer-2-fast --review-model composer-2-fast --concurrency 5 --items 100
npm run evolution:showcase-deploy
```

1. **`--learn-only`**：只拉 RSS / 本地源 → 更新 inbox 与 gateway 状态，**不**进入 `run-day`。
2. **第二条**：跑完整 evolution（研究 + Cursor 实现/审查 + 测试等）；`--concurrency` / `--items` 可按机器与配额改。
3. **`evolution:showcase-deploy`**：构建展示页并同步到 Pages 克隆目录（需配置 `EVOLUTION_SHOWCASE_*`，见根目录 `.env.example`）。

更完整的 8 飞轮审查、Agent 调度器模式、能力地图与上线回归卡点，见 `doc/evolution-flywheel-review.md`。

## 布局

| 路径 | 说明 |
|------|------|
| `inbox/YYYY-MM-DD.md` | 每日 RSS 候选条目（标题+链接），供 `evolution:run-day` 消费 |
| `success/YYYY-MM-DD-<slug>.md` | 验证通过且有功能源码改动：来源、分支、测试命令、变更分类、合并信息 |
| `skip/YYYY-MM-DD-<slug>.md` | 测试通过但无功能源码改动（仅测试/文档），不执行自动合并，分支保留供手动审查 |
| `no-op/YYYY-MM-DD-<slug>.md` | 研究阶段判定无改进机会，不进入研发，分支已删除 |
| `failure/YYYY-MM-DD-<slug>.md` | 验证失败：日志摘要、原因分析 |
| `runs/latest-learn.md` | 最近一次 `evolution:learn` 的摘要（路径、新条目数） |
| `runs/latest-run-day.md` | 最近一次 `evolution:run-day` 的时间线（每步耗时与结果） |
| `templates/` | 成功/失败 Markdown 模板（可复制） |

## 环境变量（节选）

见仓库根目录 `.env.example` 中 `EVOLUTION_*`。合并主分支默认 **关闭**（`EVOLUTION_AUTO_MERGE=0`）。

### 合并回主分支

- **未合并 ≠ 冲突**：日志里「未自动合并 / 分支保留」通常是因为 **`EVOLUTION_AUTO_MERGE=0`**（默认），实验分支仍保留，需你本地 `git merge exp/evolution-…`。只有 **`EVOLUTION_AUTO_MERGE=1`** 时，在测试通过后会从主仓对目标分支做 `git merge`（且并发会降为 1）。
- **真有冲突**时：`evolution-run-day` 会写 failure 并 `merge --abort`，不会悄悄破坏主分支。

### 运行记录要不要进 Git

- **默认**：`success/`、`skip/`、`no-op/`、`failure/`、`runs/` 可随仓库提交，便于审计与对照。
- **若不想跟踪自动生成**：可在根目录 `.gitignore` 取消注释 `doc/evolution/success/` 等（见该文件说明）；**已跟踪的文件**需先 `git rm -r --cached doc/evolution/success` 再提交。更轻量做法是只忽略 `runs/`、保留 success 摘要，按团队习惯选择。

## 研究评估与选取（减少「误杀」有价值条目）

- **统一提示词**：`scripts/evolution/research-eval-prompt.mjs` 供 `evolution-research.sh` 与 `research-cursor.mjs` 共用，避免 bash / Cursor 两套口径漂移。
- **源强度**：`full`（长摘录或 arXiv 摘要）与 `weak`（短摘录或抓取差，但有 **inbox 标题 + URL**）——弱源仍跑研究，由模型判断是否值得一次有界尝试；仅「无标题、无 URL、无正文」才硬 `SKIP`。
- **`.evolution/source-excerpt.txt`**：`run-day` 写入 **标题、URL、抓取错误说明** 与正文摘录，研究阶段可据此补全信号。
- **解析**：`scripts/evolution/research-gate.mjs` 识别 `Decision: PROCEED`、`**PROCEED**` 等变体；`EVOLUTION_RESEARCH_UNPARSED_DEFAULT` 控制无法解析时的默认（默认 `proceed` 减少误杀，可改 `skip` 求稳）。
- **严格度**：`EVOLUTION_RESEARCH_STRICTNESS=strict|balanced|recall`（默认 `balanced`）；`recall` 更偏向召回可落地点子。
- **默认摘录上限**：`EVOLUTION_AGENT_EXCERPT_MAX_CHARS` 默认提高到 **22000**（仍可用环境变量下调）。

## `evolution:run-day` 在做什么

- **来源阅读**：对 inbox 里每条链接会先 **HTTP 抓取正文**（去 HTML 后的摘录），写入 `success`/`failure` 与运行日志，便于与 RSS 标题对照。
- **验证对象**：在 **本仓库** 的独立 worktree 上跑白名单测试（默认 `npm run test:unit`），**不会**自动克隆 RSS 里的外链 GitHub 项目；测试失败表示当前快照未过测，而非「未尝试外链仓库」。
- **并行**：`EVOLUTION_CONCURRENCY` 控制同时跑几条（默认与上限见 `EVOLUTION_CONCURRENCY_MAX`，未设置 env 时默认上限 **32**，硬顶 **200**）。`EVOLUTION_AUTO_MERGE=1` 时各 worktree 内构建/测试仍可并行；**合并进主分支**在脚本内 **串行（互斥）**，避免多路同时操作主仓。
- **可选 Agent 钩子**（`EVOLUTION_AGENT_CMD`）：顺序为 **`npm ci` → 写 `.evolution/source-excerpt.txt` / `constraints.txt` → 执行你的命令（继承完整 `process.env`，含 API Key）→ `git diff` 摘要 → **构建** → **测试**。用于把摘录 + 约束交给本机 CLI/agent 改代码；未设置则行为与旧版一致（仅构建+测）。
- **合并门槛**：测试通过后，`run-day` 会检查实验分支相对目标分支的变更文件。只有在 `packages/` 或 `apps/` 下存在**非测试源码文件**的改动（非 `*.test.*`、非 `test/` 目录）时，才允许 `EVOLUTION_AUTO_MERGE` 生效并执行合并。仅补测试或仅改文档的实验会被记录为 `skip/`（测试通过但不合并），分支保留供手动审查。

## 研究→研发→验证→合并 完整闭环

通过组合 `EVOLUTION_RESEARCH_CMD` + `EVOLUTION_AGENT_CMD` + `EVOLUTION_AUTO_MERGE=1`，可以实现完整的闭环：只研究有价值的文章，确认有能力提升再研发，测试通过后自动合并。

```bash
# .env
EVOLUTION_RESEARCH_CMD=bash scripts/evolution-research.sh   # ① 评估：有无改进机会？
EVOLUTION_AGENT_CMD=bash scripts/evolution-agent-multi.sh   # ② 研发：实现改进
EVOLUTION_AUTO_MERGE=1                                       # ③ 验证通过后自动合并
```

### 流程与 doc 类型

```text
inbox 条目
    │
    ▼  npm ci
    │
    ▼  EVOLUTION_RESEARCH_CMD（若设置）
    │    写 .evolution/research-decision.txt
    ├──► SKIP  → doc/evolution/no-op/   分支删除，不进入研发
    └──► PROCEED
         │
         ▼  EVOLUTION_AGENT_CMD（若设置）
         │    agent 实现改进
         ▼
         构建 + 测试
         ├──► 失败  → doc/evolution/failure/
         └──► 通过
              ▼
              变更分类门禁（packages/apps 下有非测试源码？）
              ├──► 否  → doc/evolution/skip/   分支保留
              └──► 是  → doc/evolution/success/
                         AUTO_MERGE=1 → git merge 主分支
```

### 各 doc 目录含义

| 目录 | 触发条件 | 分支处理 |
|------|---------|---------|
| `no-op/` | 研究阶段判定无改进机会 | **删除**（无价值保留） |
| `skip/` | 测试通过但仅改测试/文档 | 保留供手动审查 |
| `failure/` | 构建或测试失败 | 保留供手动审查 |
| `success/` | 测试通过且有功能源码改动 | `AUTO_MERGE=1` 时自动合并 |

### 推荐配合 EVOLUTION_AUTO_MERGE=1 使用

开启研究门槛后，管线已保证「能跑通且有实际功能改动」才进入合并，不再需要过多人工干预：

```bash
EVOLUTION_AUTO_MERGE=1          # 研究 + 测试均通过才合并
EVOLUTION_CONCURRENCY=5         # 与 AUTO_MERGE 可同时使用；合并主仓仍串行
```

## 多 Agent 路由（充分利用多个 AI 套餐）

`scripts/evolution-agent-multi.sh` 是一个多路由钩子，可按**比例**或**难度**把不同 Evolution 任务分配给本机已安装的多个 AI CLI。

```bash
# .env
EVOLUTION_AGENT_CMD=bash scripts/evolution-agent-multi.sh
```

### 策略 1：按权重轮转（rotate，默认）

基于来源 URL hash 确定性分配，**并发安全**，无共享计数器。

```bash
EVOLUTION_AGENT_STRATEGY=rotate
# 总权重 4：claude 占 50%，codex / cursor 各 25%
EVOLUTION_AGENT_WEIGHTS=claude:2,codex:1,cursor:1
# 只有两个 CLI 且各半：
# EVOLUTION_AGENT_WEIGHTS=claude:1,codex:1
```

支持的 cli 名称：`claude` / `codex` / `cursor` / `gemini`（对应命令 `claude` / `codex` / `agent` / `gemini`）。

若所选 CLI 未安装，自动 fallback 到权重列表里下一个可用的。

### 策略 2：按难度路由（difficulty）

扫描来源摘录的关键词，推断 simple / medium / complex 后路由。

```bash
EVOLUTION_AGENT_STRATEGY=difficulty
# 简单（fix/bug/typo/minor）→ codex（快且便宜）
# 中等（默认）→ cursor
# 复杂（architecture/security/refactor/MCP/agent/…）→ claude
EVOLUTION_AGENT_DIFFICULTY_MAP=simple:codex,medium:cursor,complex:claude
```

### 常见组合示例

| 场景 | 配置 |
|------|------|
| 只有 claude + codex，各半 | `WEIGHTS=claude:1,codex:1` |
| claude 为主，codex 打杂 | `WEIGHTS=claude:3,codex:1` |
| 难度路由 + gemini 做中等 | `STRATEGY=difficulty DIFFICULTY_MAP=simple:codex,medium:gemini,complex:claude` |
| 全部给 cursor agent | `WEIGHTS=cursor:1` |

> **检查本机 CLI 安装情况**：`npm run ai:tools`

## 定时任务示例

- **系统 cron**：[`scripts/cron-evolution.example.sh`](../scripts/cron-evolution.example.sh)（委托 `evolution-pipeline.sh`，默认 Claude agent）。
- **PM2 + cron 表达式**：仓库根目录 [`ecosystem.evolution.config.cjs`](../ecosystem.evolution.config.cjs) + [`scripts/evolution-nightly-wrap.sh`](../scripts/evolution-nightly-wrap.sh)；`npm run evolution:pm2:start`，参数与 `EVOLUTION_PM2_*` 见根目录 `.env.example`。

## Web 观测页

开发或监控时，打开 **`http://127.0.0.1:13000/evolution`**（端口以 Next 实际监听为准）即可实时查看进化状态。需同时运行 daemon（`npm run start:daemon`）与 Next（`npm run dev:lab`）。页面每 8 秒自动刷新，展示：当前活跃 worktree、最近 run 日志、历史结果表（成功/失败/跳过/无效），点击任一行可展开完整 Markdown 报告。

## RSS 信源与「少噪音」研究门控

- **默认取向**：`gateway.config.json` / `gateway.config.example.json` 的 `learn.feeds` 以 **arXiv 分类（cs.CL / cs.AI / cs.LG / cs.CR / cs.SE）+ 窄查询 HNRSS + 工程/研究博客**（HF Blog、GitHub AI/ML、LangChain、Google Research、Latent Space、Distill、Practical AI、Sebastian Ruder 等）为主，**不包含** HN 首页全量 RSS、Google 泛科技公关流、大批量 Nitter，从源头压低 inbox 噪音。需要播客/社媒可自行追加 feed URL。
- **研究阶段更保守**：在 `.env` 中设 `EVOLUTION_RESEARCH_STRICTNESS=strict` 与 `EVOLUTION_RESEARCH_UNPARSED_DEFAULT=skip`（见根目录 `.env.example`）。`strict` 下 **多数** inbox 会在研究阶段 **SKIP**；仅当来源给出非常明确、可映射到本仓库的有界改动时才 **PROCEED**。无法解析模型输出时默认 **SKIP**，减少误进 `run-day`。

