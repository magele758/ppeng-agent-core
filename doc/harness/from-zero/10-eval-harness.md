# 10 — Eval（质量门，挂在自建循环外）

> **要点**：`npm run agent:eval` 拉起临时 runtime/daemon 跑 case，验证的是**自建循环行为**（工具序列、回合数、关键 HTTP 面等），不是 openai-agents 测试套件。

| 项 | 值 |
|----|-----|
| 入口 | `npm run agent:eval` / `agent:eval:fast` → `scripts/agent-eval/runner.mjs` |
| Cases | `scripts/agent-eval/cases/fast/`（nightly 另目录） |
| 结果 | `doc/eval-results/YYYY-MM-DD.jsonl` |
| 退出码 | 默认始终 0；CI/门禁用 `--exit-on-fail` |
| Auth | 临时 daemon **不继承**宿主 `RAW_AGENT_AUTH_TOKEN`（`envForEphemeralDaemon`） |

合并门可选 `EVOLUTION_HARNESS_GATE=1`。E2E（临时 daemon+Next、同源随机 token）见切片 [20 §7](../20-orchestration-evolution-eval.md#7-e2e-lab--auth-隔离)。

规划愿景：[`../../HARNESS_EVAL.md`](../../HARNESS_EVAL.md)。  
**加深（Orchestrator/Swarm/Research cases、门禁拼图）**：[../20-orchestration-evolution-eval.md](../20-orchestration-evolution-eval.md) §6。

**下一章**：[11-evolution-and-self-heal](11-evolution-and-self-heal.md)
