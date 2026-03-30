# Evolution 实验记录（自我进化管线）

本目录与仓库根目录的 `docs/`（架构与 CI 说明）区分：**`doc/evolution/`** 存放自动化实验的 **inbox、成功/失败记录**，由 `npm run evolution:learn` / `npm run evolution:run-day` 写入或更新。

## 布局

| 路径 | 说明 |
|------|------|
| `inbox/YYYY-MM-DD.md` | 每日 RSS 候选条目（标题+链接），供 `evolution:run-day` 消费 |
| `success/YYYY-MM-DD-<slug>.md` | 验证通过：假设、来源、分支、测试命令、合并信息 |
| `failure/YYYY-MM-DD-<slug>.md` | 验证失败：日志摘要、原因分析 |
| `templates/` | 成功/失败 Markdown 模板（可复制） |

## 环境变量（节选）

见仓库根目录 `.env.example` 中 `EVOLUTION_*`。合并主分支默认 **关闭**（`EVOLUTION_AUTO_MERGE=0`）。

## 定时任务示例

见 [`scripts/cron-evolution.example.sh`](../scripts/cron-evolution.example.sh)。
