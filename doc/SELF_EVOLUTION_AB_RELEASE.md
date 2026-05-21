# A/B 自进化发布（Stable / Candidate）

控制面 `release-orchestrator` 驱动 **Stable（A）** 与 **Candidate（B）** 双栈发布；进化产物经 G0–G3 门禁后晋升。

## 架构

- **控制面**：`scripts/release-orchestrator.mjs`（git sync → evolution → gates → deploy → observe → promote/fix）
- **数据面 Stable**：`docker compose --profile stable` 或 Helm `ppeng-stable`
- **数据面 Candidate**：`docker compose --profile candidate` 或 Helm `ppeng-candidate`
- **报告**：`doc/evolution/reports/<release_run_id>.json` + `.md`；HTTP `GET /api/evolution/reports`、`/api/evolution/report/:id`

## 状态机

`GitSync → Learn/Run-day → G0 → Deploy Candidate → G1 → Observe/G2 → [Fix] → G3/Promote`

## 门禁

| 关卡 | 内容 |
|------|------|
| G0 | build + test:unit + 可选 EVOLUTION_HARNESS_GATE |
| G1 | Candidate health/readiness + agent:eval:fast |
| G2 | regression + integration + e2e（打 Candidate URL） |
| G3 | Bake 期满 + G2 全绿（`EVOLUTION_RELEASE_AUTO_PROMOTE=1` 时自动晋升） |

## 环境变量

见 `.env.example` 中 `EVOLUTION_RELEASE_*`、`EVOLUTION_CODING_*`。

## 常用命令

```bash
npm run release                    # 完整流水线 start
npm run release:git-sync
npm run release:status
npm run release:observe -- --run-id rel_YYYYMMDD_NNN
npm run release:promote -- --run-id rel_YYYYMMDD_NNN
npm run release:rollback -- --run-id rel_YYYYMMDD_NNN
```

## Compose ↔ Helm 对齐

| Concern | Compose | Helm |
|---------|---------|------|
| Candidate daemon | `http://127.0.0.1:7071` | Service DNS + 7070 |
| Candidate web / e2e | `http://127.0.0.1:13001` | Ingress / port-forward |
| DAEMON_PROXY_TARGET | `http://daemon-candidate:7070` | `values-candidate.yaml` |
| RAW_AGENT_AUTH_TOKEN | web-b + daemon-b 同源 | Secret 双 Deployment |
| State | `agent-state-candidate` volume | PVC |
| 切换后端 | `EVOLUTION_RELEASE_BACKEND=compose` | `=helm` |

## Coding-Agent（FixCandidate）

统一入口 `scripts/release/coding-agent.mjs`：默认 `EVOLUTION_CODING_AGENT=cmd` → `EVOLUTION_AGENT_CMD`；模型用 `EVOLUTION_CODING_*`（与 `RAW_AGENT_*` 分离）。

## 相关文档

- 能力地图：[`SELF_EVOLUTION_V2.md`](SELF_EVOLUTION_V2.md)
- Evolution 管线：根目录 `AGENTS.md` / `npm run evolution -- --help`
