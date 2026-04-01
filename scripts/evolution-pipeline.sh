#!/usr/bin/env bash
# 自进化一键编排：编译 gateway（learn 依赖）→ evolution:learn → evolution:run-day
# →（可选）合并后全量 build + 向 daemon 发 SIGTERM 以便 supervisor 拉起新进程。
#
# 环境变量（见 .env.example「自进化一键管线」）：
#   EVOLUTION_SKIP_PIPELINE_BUILD — 跳过管线开头的编译（默认执行 EVOLUTION_PIPELINE_BUILD_CMD）
#   EVOLUTION_PIPELINE_BUILD_CMD — 默认 npx tsc -b packages/capability-gateway
#   EVOLUTION_PIPELINE_LEARN_ONLY — 仅跑 learn（适合 CI 仅摄入 RSS）
#   EVOLUTION_POST_MERGE_RELOAD — 跑完 run-day 后执行 evolution-post-merge-reload.sh
#   EVOLUTION_AGENT_CMD — 未在环境中设置时，本脚本默认为 Claude Code（scripts/evolution-agent-claude.sh）；
#     若在 .env 中写 EVOLUTION_AGENT_CMD= 留空，则仍跳过 Agent（不覆盖空值）
#
# 用法：npm run evolution:pipeline
# crontab 示例见 scripts/cron-evolution.example.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:$PATH"
[[ -f .env ]] && set -a && source .env && set +a

# run-day 开发工具：未设置 EVOLUTION_AGENT_CMD 时默认 Claude Code（本机需已安装 claude CLI）
if [ -z "${EVOLUTION_AGENT_CMD+x}" ]; then
  export EVOLUTION_AGENT_CMD="bash ${ROOT}/scripts/evolution-agent-claude.sh"
  echo "[evolution-pipeline] EVOLUTION_AGENT_CMD 未设置 → 默认 Claude Code: ${EVOLUTION_AGENT_CMD}"
fi

is_truthy() {
  case "${1:-}" in
    1 | true | True | yes | Yes | on | ON) return 0 ;;
    *) return 1 ;;
  esac
}

if ! is_truthy "${EVOLUTION_SKIP_PIPELINE_BUILD:-}"; then
  PCMD="${EVOLUTION_PIPELINE_BUILD_CMD:-npx tsc -b packages/capability-gateway}"
  echo "[evolution-pipeline] $PCMD"
  eval "$PCMD"
fi

if is_truthy "${EVOLUTION_PIPELINE_LEARN_ONLY:-}"; then
  npm run evolution:learn
  exit 0
fi

npm run evolution:learn
npm run evolution:run-day

if is_truthy "${EVOLUTION_POST_MERGE_RELOAD:-}"; then
  bash "$ROOT/scripts/evolution-post-merge-reload.sh"
fi
