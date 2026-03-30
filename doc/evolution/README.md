# Evolution 实验记录（自我进化管线）

本目录与仓库根目录的 `docs/`（架构与 CI 说明）区分：**`doc/evolution/`** 存放自动化实验的 **inbox、成功/失败记录**，由 `npm run evolution:learn` / `npm run evolution:run-day` 写入或更新。

## 布局

| 路径 | 说明 |
|------|------|
| `inbox/YYYY-MM-DD.md` | 每日 RSS 候选条目（标题+链接），供 `evolution:run-day` 消费 |
| `success/YYYY-MM-DD-<slug>.md` | 验证通过：假设、来源、分支、测试命令、合并信息 |
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

- **默认**：`success/`、`failure/`、`runs/` 可随仓库提交，便于审计与对照。
- **若不想跟踪自动生成**：可在根目录 `.gitignore` 取消注释 `doc/evolution/success/` 等（见该文件说明）；**已跟踪的文件**需先 `git rm -r --cached doc/evolution/success` 再提交。更轻量做法是只忽略 `runs/`、保留 success 摘要，按团队习惯选择。

## `evolution:run-day` 在做什么

- **来源阅读**：对 inbox 里每条链接会先 **HTTP 抓取正文**（去 HTML 后的摘录），写入 `success`/`failure` 与运行日志，便于与 RSS 标题对照。
- **验证对象**：在 **本仓库** 的独立 worktree 上跑白名单测试（默认 `npm run test:unit`），**不会**自动克隆 RSS 里的外链 GitHub 项目；测试失败表示当前快照未过测，而非「未尝试外链仓库」。
- **并行**：默认最多 **3** 路并行（`EVOLUTION_CONCURRENCY`，上限 3）；若 `EVOLUTION_AUTO_MERGE=1`，会 **强制串行**，避免多路同时 `git merge` 进主分支。
- **可选 Agent 钩子**（`EVOLUTION_AGENT_CMD`）：顺序为 **`npm ci` → 写 `.evolution/source-excerpt.txt` / `constraints.txt` → 执行你的命令（继承完整 `process.env`，含 API Key）→ `git diff` 摘要 → **构建** → **测试**。用于把摘录 + 约束交给本机 CLI/agent 改代码；未设置则行为与旧版一致（仅构建+测）。

## 定时任务示例

见 [`scripts/cron-evolution.example.sh`](../scripts/cron-evolution.example.sh)。

## 播客与 X（Twitter）补充

- **播客**：`gateway.config.json` 的 `learn.feeds` 中已含若干 **RSS 稳定** 的 AI 向播客/通讯（如 Practical AI、TWIML、Cognitive Revolution、Latent Space、Last Week in AI）及 **GitHub Blog「AI and ML」**（[`github.blog/ai-and-ml/feed/`](https://github.blog/ai-and-ml/feed/)）。更多清单可参考 GitHub 上的社区整理，例如 [swyxio/ai-notes — Good AI Podcasts](https://github.com/swyxio/ai-notes/blob/main/Resources/Good%20AI%20Podcasts%20and%20Newsletters.md)。
- **Nitter（X 的 RSS 镜像）**：可用 `https://<nitter实例>/<用户名>/rss` 订阅建造者动态；公网实例可用性变化大，可在 [Nitter 实例列表/wiki](https://github.com/zedeus/nitter/wiki/Instances) 自选可用域名后，将上述 URL **追加**到 `learn.feeds`（若某实例返回 403/502，换掉实例或删除该条即可）。
