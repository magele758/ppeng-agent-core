# 11 — Evolution / Self-heal（循环之上的演进）

> **要点**：演进管线改的是仓库代码；Self-heal 在 worktree 跑测试并用 **同一套自建 runtime**（如 `self-healer` agent）修失败——不是换用 openai-agents。

| 能力 | 入口 |
|------|------|
| Evolution CLI | `npm run evolution -- …`（`scripts/evolution-cli.mjs`） |
| Self-heal | `POST /api/self-heal/start` / `npm run self-heal:flow` |
| Orchestrator / Swarm / DeepResearch | `/api/orchestration/*`、`/api/swarm/*`、`/api/research/*` |
| 叙事切片 | [../10-self-heal.md](../10-self-heal.md)、[../11-subagents-and-swarm.md](../11-subagents-and-swarm.md)、[../08-memory-and-evolving.md](../08-memory-and-evolving.md) |
| **API / 2.0 门禁 / A/B / eval 拼图** | **[../20-orchestration-evolution-eval.md](../20-orchestration-evolution-eval.md)** |

Evolution 专题：[`../../evolution/README.md`](../../evolution/README.md)、[`../../SELF_EVOLUTION_V2.md`](../../SELF_EVOLUTION_V2.md)、[`../../SELF_EVOLUTION_AB_RELEASE.md`](../../SELF_EVOLUTION_AB_RELEASE.md)。

回到主线入口：[`../00-self-built-agent-loop.md`](../00-self-built-agent-loop.md)。
