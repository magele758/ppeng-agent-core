# ppeng-agent-core Harness 纵向切片文档

> 本目录从**纵向切片**视角拆解 ppeng-agent-core 运行时——每个文件覆盖一条从入口到存储的完整路径，而非按代码目录罗列。

## 如何读

先按需求读某一条切片即可。各切片间有重叠（它们共用同一套 `runtime.ts` 主循环），重叠处只给指针、不重复。

---

## 切片索引

| # | 文件 | 切面 |
|---|------|------|
| 1 | [`01-request-lifecycle.md`](01-request-lifecycle.md) | 请求生命周期：HTTP → session → turn loop → stream/SSE → 回复 |
| 2 | [`02-prompt-assembly.md`](02-prompt-assembly.md) | System prompt 四段组装：stable → dynamic → appendix → working log |
| 3 | [`03-tool-execution.md`](03-tool-execution.md) | 工具面筛选 → approval → parallel execute → 脱敏 → 落库 |
| 4 | [`04-context-economics.md`](04-context-economics.md) | 三层压缩（micro-compact / episodic / autoCompact）、预算推导、working log |
| 5 | [`05-safety-and-recovery.md`](05-safety-and-recovery.md) | 四级兜底：LoopGuard / RiskEngine / AdvisoryGrace / 轮内 watchdog |
| 6 | [`06-goal-gate.md`](06-goal-gate.md) | Goal soft-completion gate：条件 → judge → ledger → stalled/exhausted/achieved |
| 7 | [`07-skills-and-routing.md`](07-skills-and-routing.md) | Skill 发现 → lexical/hybrid 路由 → shortlist → load_skill 验证 |
| 8 | [`08-memory-and-evolving.md`](08-memory-and-evolving.md) | 五层记忆 + ShadowCoach + BackgroundReviewer + Case governance |
| 9 | [`09-model-adapters.md`](09-model-adapters.md) | OpenAI / Anthropic / Hybrid Router、stream 消费、usage 归一化、cost |
| 10 | [`10-self-heal.md`](10-self-heal.md) | SelfHealScheduler：worktree → test → fix → merge → restart |
| 11 | [`11-subagents-and-swarm.md`](11-subagents-and-swarm.md) | spawn_subagent / spawn_teammate / SwarmExecutor / teams graph |
| 12 | [`12-sandbox-and-execution.md`](12-sandbox-and-execution.md) | OS / native / remote-VM / microservice sandbox 四选一 |
| 13 | [`13-storage-and-state.md`](13-storage-and-state.md) | SQLite 主表 + 磁盘资产 + 云 tiered asset + 迁移纪律 |
| 14 | [`14-hooks-extensions-plugins.md`](14-hooks-extensions-plugins.md) | env-script hooks + in-process extension + plugin loader |
| 15 | [`15-observability.md`](15-observability.md) | Trace events / OTEL / LLM prompt debug / cognitive-state metrics |

---

## 全景概要

```
HTTP request (daemon)
  │
  ├─ Auth (RAW_AGENT_AUTH_TOKEN / bearer)
  ├─ Router (route table → handler)
  │
  └─ runtime.runSession(sessionId, {onModelStreamChunk})
       │
       ├─ Turn loop (max N turns per dispatch)
       │    │
       │    ├─ autoCompact (threshold-driven LLM summarization)
       │    ├─ visibleMessages (episodic selection / cognitive state)
       │    ├─ prepareMessagesForModel (images, refusal guard, micro-compact)
       │    ├─ PromptBuilder.buildSystemPrompt (stable + dynamic)
       │    ├─ Memory + working-log appendix (user-side)
       │    ├─ runTurnWithRetries (stream + repetition guard)
       │    │    └─ ModelAdapter.runTurnStream / runTurn
       │    ├─ cumulative-token split
       │    ├─ cost estimate
       │    ├─ reasoning-spin watchdog
       │    ├─ SessionLoopGuard + AdvisoryGrace
       │    ├─ stopReason == 'end' → lifecycle hooks → goal gate → complete
       │    └─ stopReason == 'tool_use' → tool loop
       │         ├─ filterValid → checkApprovals → execute (parallel batches)
       │         ├─ truncate + redact → persist → after_tool hook
       │         └─ RiskEngine → AdvisoryQueue → next turn
       │
       ├─ Self-heal (optional, worktree-based NPM test/fix)
       ├─ Swarm (multi-agent cooperative tasks)
       ├─ Orchestration (step-driven pipeline engine)
       └─ DeepResearch (source → evidence → claim pipeline)
```
