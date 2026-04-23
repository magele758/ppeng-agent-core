# Evolution 展示站（静态）

从本仓库 `doc/evolution/{success,failure,no-op,skip,superseded}` 生成 `dist/`，用于托管到 GitHub Pages（例如 `magele758.github.io`）。

## 构建

在仓库根目录：

```bash
npm run evolution:showcase-build
```

可选：限制 `no-op` 条数（减小 JSON）：

```bash
node scripts/build-evolution-showcase.mjs --max-no-op 200
```

可选：指定输出目录：

```bash
node scripts/build-evolution-showcase.mjs --out /path/to/out
```

`data/evolution.json` 每条大致包含：**标题、来源 URL、结果类型**（`outcome` / `outcomeLabel`）、**研究门控标签**（`skipTag`，若有）、**主仓合并提交**（`mergeCommit` / `commitUrl`，仅 success 且 frontmatter 有 `merge_commit` 时）、**为何继续演进**（`reasonChosen`）、**为何未采纳/跳过**（`reasonSkipped`）、**失败原因**（`reasonFailed`）、**沉淀摘要**（`summary`）。根字段 `sourceRepoWebBase` 为构建时解析到的 GitHub 仓库 `https://github.com/owner/repo`（用于生成 `commitUrl`）。直链依赖 `.env` 中 `EVOLUTION_SHOWCASE_GITHUB_REPO` 或 `git remote origin`（或 `EVOLUTION_SHOWCASE_COMMIT_URL_PREFIX`）。

## 发布到 magele758.github.io

1. 克隆 Pages 仓库：  
   `git clone https://github.com/magele758/magele758.github.io.git`
2. 在本仓库执行 `npm run evolution:showcase-build`
3. 将 `evolution-showcase/dist/` 中 **白名单文件**复制到 Pages 仓库根目录（默认 `index.html`、`styles.css`、`app.js`、`data/`，与 `EVOLUTION_SHOWCASE_DEPLOY_ARTIFACTS` 一致；`npm run evolution:showcase-deploy` 仅用 `git add` 这些路径，避免误提交本地 `node_modules` / 实验目录）
4. 提交并推送；在 GitHub 仓库 Settings → Pages 中选择分支（通常为 `main`）与 `/ (root)`。

**自动同步（run-day 结束后）**：在主仓 `.env` 设置 `EVOLUTION_SHOWCASE_AUTO_DEPLOY=1`、`EVOLUTION_SHOWCASE_DEPLOY_DIR`（Pages 仓库绝对路径）；若需直接 push，再加 `EVOLUTION_SHOWCASE_GIT_PUSH=1`；远端与本地分支名不一致或需固定拉取分支时用 `EVOLUTION_SHOWCASE_GIT_REMOTE_BRANCH`（如 `master`）。推送前脚本会先 `git pull --rebase`。手动一键：`npm run evolution:showcase-deploy`（会加载根目录 `.env`）。

静态资源无服务端依赖，路径为相对路径 `data/evolution.json`。

**Pages 克隆目录建议 `.gitignore`**（若本地跑过其它脚手架，避免误提交）：

```
node_modules/
.astro/
/dist/
```

（若 GitHub Pages **根目录**即为静态产物，勿与 Astro 的 `dist/` 输出混淆；当前 `magele758.github.io` 远端为根目录四件套 + `README`。）

## 目录说明

- `static/`：手写 HTML / CSS / JS（极客终端风，可访问性：focus 环、`prefers-reduced-motion`）
- `dist/`：构建产物（根目录 `.gitignore` 已忽略 `dist/`，不提交到 agent-core）
