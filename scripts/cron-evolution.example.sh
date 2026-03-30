#!/usr/bin/env bash
# 每日自我进化管线示例（cron / launchd 调用）
# 1) 拉 RSS → doc/evolution/inbox + skills digest
# 2) 按 inbox 在独立 worktree 跑测试并写 success/failure（可选合并）
#
# crontab 示例（每天 06:30，仓库路径请改成你的）：
# 30 6 * * * cd /path/to/ppeng-agent-core && /usr/bin/env bash scripts/cron-evolution.example.sh >> /tmp/evolution-cron.log 2>&1

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:$PATH"
[[ -f .env ]] && set -a && source .env && set +a

# 需已执行过 npm run build（capability-gateway dist）
npm run evolution:learn
npm run evolution:run-day
