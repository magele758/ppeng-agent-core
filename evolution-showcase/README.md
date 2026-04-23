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

`data/evolution.json` 每条大致包含：**标题、来源 URL、结果类型**（`outcome` / `outcomeLabel`）、**研究门控标签**（`skipTag`，若有）、**为何继续演进**（`reasonChosen`）、**为何未采纳/跳过**（`reasonSkipped`）、**失败原因**（`reasonFailed`）、**沉淀摘要**（`summary`）。不含分支、提交、仓库路径等 Git 信息。

## 发布到 magele758.github.io

1. 克隆 Pages 仓库：  
   `git clone https://github.com/magele758/magele758.github.io.git`
2. 在本仓库执行 `npm run evolution:showcase-build`
3. 将 `evolution-showcase/dist/` **内所有文件**复制到 Pages 仓库根目录（覆盖 `index.html` 等）
4. 提交并推送；在 GitHub 仓库 Settings → Pages 中选择分支（通常为 `main`）与 `/ (root)`。

静态资源无服务端依赖，路径为相对路径 `data/evolution.json`。

## 目录说明

- `static/`：手写 HTML / CSS / JS（极客终端风，可访问性：focus 环、`prefers-reduced-motion`）
- `dist/`：构建产物（根目录 `.gitignore` 已忽略 `dist/`，不提交到 agent-core）
