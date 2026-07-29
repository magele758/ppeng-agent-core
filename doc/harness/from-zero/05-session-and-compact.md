# 05 — 会话与上下文压缩（循环叠层）

> **挂在哪**：自建 loop 每轮开头的 `autoCompact` / `prepareMessagesForModel`（见第 2 章）。不改变「自建循环」事实。  
> **本阶段目标**：长对话不 OOM；分清「落库 transcript」与「送给模型的视图」。
---

## 两层压缩（勿混）

| 机制 | 何时 | 改什么 | 有损？ |
|------|------|--------|--------|
| **micro-compact** | **每轮** `prepareMessagesForModel` 末尾 | 仅送给模型的 `tool_result` 视图 | 否（不改落库） |
| **autoCompact** | 超阈值 | LLM 摘要 + 归档 transcript | 是 |

另有 **episodic selection**（选可见历史子集）与 **session budget**（按模型窗口推导阈值，不再硬编码 24k）。显式 env 仍优先；换大窗口主要改 `RAW_AGENT_MODEL_CONTEXT_TOKENS`。

关键顺序（runtime 真实接线）：

```
autoCompact（内部：episodic → prepare/micro → 估 token → 可能摘要归档 + working-log）
  → episodic 可见子集 → prepareMessagesForModel（末尾 micro）
  → memory + working-log appendix → 最近 user（不进 system）
  → model；用量侧 splitCumulativePromptTokens；写 turnShapeBySession
```

微压缩必须参与 autoCompact 的 token 估算（prepare 末尾），否则会按未压缩量误判。详序见 [17](../17-context-memory-compaction.md)。

---

## 关键落点

| 模块 | 路径 |
|------|------|
| 微压缩 | `packages/core/src/session/micro-compact.ts` |
| 预算推导 | `packages/core/src/session/session-budget.ts` |
| Working log | `packages/core/src/session/working-log.ts` → `stateDir/working-logs/<sid>/working-memory.md` |
| Episodic | `packages/core/src/model/episodic-selection.ts` |
| Prompt cache 辅助 | `packages/core/src/session/prompt-cache.ts` |
| 图片热集 / contact sheet | image ingest + `session.metadata.imageWarmContactAssetId` |

Memory 五层（`AgentMemoryStore`）+ `RAW_AGENT_MEMORY_BACKEND=session|agent|dual` 见 [`MEMORY_MULTIUSER.md`](../../MEMORY_MULTIUSER.md) / [17](../17-context-memory-compaction.md)；`buildMemoryAppendix` 拼到最近 user。

---

## 从 0 实现顺序

1. 完整落库、完整回放（无压缩）——保证正确性。
2. micro-compact：只削旧 `tool_result` 的模型视图。
3. 预算函数：`context window → compact 阈值 / episodic 预算`。
4. autoCompact + 归档路径；working-log 记高信号锚点。
5. 累计 prompt token 份额拆分（防网关 running-total 平方膨胀）。

---

## 本阶段验收

- [ ] 人为塞入超大 tool_result：落库仍完整，送模视图被削。
- [ ] 改 `RAW_AGENT_MODEL_CONTEXT_TOKENS` 后阈值随之变化（无硬编码 24k 死锁）。
- [ ] working-log 文件缺失时降级为空串，不炸循环。

**深读**：[17-context-memory-compaction](../17-context-memory-compaction.md)、[04-context-economics](../04-context-economics.md)、[13-storage-and-state](../13-storage-and-state.md)  
**下一章**：[06-skills-routing](06-skills-routing.md)
