# 02 — Prompt 四段组装

System prompt 是模型行为的唯一控制面。ppeng 把它拆成**四层**，各层有独立职责和缓存策略。

---

## 分层结构

```
┌────────────────────────────────────────────────────────────────┐
│  STABLE PREFIX（不变 → prompt cache 可复用）                     │
│  - 身份（agentSpec.instructions / harnessRole）                 │
│  - 仓库根 / workspace 根                                       │
│  - 会话模式（task / chat / subagent）                           │
│  - agentic safety appendix（可选）                              │
│  - skill disclosure（注入的 shortlist skill 正文）               │
│  指纹：STABLE_SYSTEM_VERSION（改措辞必 bump）                    │
├────────────────────────────────────────────────────────────────┤
│  DYNAMIC CONTEXT（每轮变 → 不进 cache prefix）                  │
│  - 当前 task 描述 + todo 列表                                   │
│  - 认知阶段提示（exploration / implementation / stuck …）        │
│  - 滚动摘要（autoCompact 生成的 session.summary）               │
│  - skill routing 块（shortlist 名 + 描述 + invocation hint）    │
├────────────────────────────────────────────────────────────────┤
│  ADVISORY (system 消息追加在 turn 前)                           │
│  - AdvisoryQueue.drainCombined()（RiskEngine 多信号）           │
│  - recovery advisory（LoopGuard advise）                        │
├────────────────────────────────────────────────────────────────┤
│  USER-SIDE APPENDIX（拼到最近 user message 前，走 user role）    │
│  - Memory appendix（scratch + long-term KV）                    │
│  - Working log tail（working-memory.md 最近 4k 字符）           │
│    → 合并后作为 combinedAppendix 注入                           │
└────────────────────────────────────────────────────────────────┘
```

---

## 为什么分 system 和 user

**Provider prompt cache** 按 prefix match 生效——前缀相同的请求复用 KV 缓存。Memory 和 working log 每轮都变，若放进 system 前缀，整段失效。放到 user 侧则稳定 prefix 得以复用。ai-agent-node 验证此路径在 deepseek/openai/anthropic 上均可复用 cache。

---

## 关键模块

| 文件 | 职责 |
|------|------|
| `model/prompt-builder.ts` | `buildStablePrefix` / `buildDynamicContext` / `buildSystemPrompt` / `buildMemoryAppendix` |
| `model/prompt-builder.ts:STABLE_SYSTEM_VERSION` | 改 stable 文案必须 bump 的指纹常量 |
| `session/working-log.ts` | `readWorkingLogTail` → 尾部追加到 combinedAppendix |
| `session/prompt-cache.ts` | `assertToolsetInvariant` — 工具面变化时发 `prompt_cache_bust` trace |
| `runtime.ts:applyMemoryAppendixToMessages` | 把 combinedAppendix 插到最后一条 user 消息之前 |

---

## Skill 注入

Skill 正文经路由后注入到 stable prefix 的尾部（`buildStablePrefix` → skill disclosure block）。路由详见 [07-skills-and-routing.md](07-skills-and-routing.md)。

---

## 观测

- `turn_start` trace 携带 `stablePrefixHash` + routing metadata。
- `prompt_cache_bust` trace 在 toolset 指纹漂移时发出。
- `STABLE_SYSTEM_VERSION` 写进 `turn_end` payload（不进 prompt 本身、不进 cache key）。
