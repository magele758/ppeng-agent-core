# 02 — Prompt 与消息附录的组装

> Prompt 是行为输入之一；工具白名单、审批、沙箱和循环控制同样会约束运行时行为。本章只解释送模内容的组织方式。

---

## 设计动机：为什么要分四层？

### 问题

部分 provider 会对稳定请求前缀做缓存。即使不依赖具体 provider，按变化频率分开 stable identity、dynamic context 和 user-side appendix，也更容易定位每轮发生了什么变化。

### 解法

把 prompt 拆成四层，按**变化频率**排列：

```
┌────────────────────────────────────────────────────────┐
│  STABLE PREFIX（会话内尽量稳定）                        │
│  身份 + workspace + 模式 + 可选安全附录                │
├────────────────────────────────────────────────────────┤
│  DYNAMIC CONTEXT（每轮可能变 → 不进 cache prefix）      │
│  任务描述 + 认知阶段 + 滚动摘要 + routing 块           │
├────────────────────────────────────────────────────────┤
│  ADVISORY（按需注入，0~N 条 system 消息）              │
│  RiskEngine 告警 + recovery advisory                   │
├────────────────────────────────────────────────────────┤
│  USER-SIDE APPENDIX（拼到 user message 前）            │
│  Memory + working log tail                             │
└────────────────────────────────────────────────────────┘
```

### 为什么 Memory 走 user 侧？

这是最不直觉但最重要的设计决策。

- Memory 和 working log **每轮都变**
- 如果放进 system prompt → stable prefix 被破坏 → 每轮 cache miss
- 放到最近一条 user message 之前（走 user role）→ system prefix 保持稳定

这样做为 prefix cache 提供条件，但是否命中和节省多少必须看 provider 返回的 cached usage，不能仅从 prompt 结构推断。

---

## 各层详解

### Layer 1: Stable Prefix

| 组成 | 变化频率 | 说明 |
|------|----------|------|
| 身份指令 | 极低（agentSpec 变时） | `agentSpec.instructions` / `harnessRole` |
| Workspace 根 | 会话内不变 | 告诉模型文件系统上下文 |
| 会话模式 | 会话内不变 | task / chat / subagent 行为差异 |
| Safety appendix | 版本级不变 | agentic 安全指南（可选） |

**指纹管理**：`STABLE_SYSTEM_VERSION` 常量——改了 stable prefix 的措辞必须 bump 这个版本号。它不进 prompt 本身、不进 cache key，只进 trace 用于审计"哪个版本的 prompt 产生了这个行为"。

### Layer 2: Dynamic Context

每轮重新计算，但不影响 stable prefix 的 cache：

- **任务描述 + todo 列表**：让模型始终知道"当前在做什么"
- **认知阶段提示**：根据 cognitive state（exploration / implementation / verification / stuck）给不同的行为指引
- **滚动摘要**：autoCompact 产生的 session.summary，让模型"记得"已归档的历史
- **Skill routing 块**：shortlist 的 skill 名称 + 描述 + invocation hint

### Layer 3: Advisory

不是每轮都有——只在安全/恢复机制触发时注入：

- `AdvisoryQueue.drainCombined()`：RiskEngine 的多信号告警
- Recovery advisory：LoopGuard 判定异常时的修正指引

`AdvisoryQueue` drain 后会清空队列，但注入内容作为 system message 持久化；只要该消息仍在可见历史里，后续轮次仍可能看到它。

### Layer 4: User-side Appendix

拼到最后一条 user message 之前（走 user role），包含：

- **Memory appendix**：scratch（本次中间值）+ long-term KV（用户偏好）
- **Working log tail**：working-memory.md 最近 4k 字符

---

## 如何验证组装结果

- `PromptBuilder.buildSystemPrompt()` 实际返回 stable prefix 与 dynamic context 两段。
- Advisory 是单独持久化的 system message，不是 `buildSystemPrompt()` 的第三个返回字段。
- Memory 与 working-log 通过 runtime 注入最近 user message，避免改变 system prefix。
- `prompt_cache_bust` 只说明工具集合指纹发生变化；它不是 provider cache hit 的直接证明。

要观察实际请求，可临时启用 `RAW_AGENT_DEBUG_LLM_PROMPT`。调试输出可能含用户内容，只应在受控本地环境使用。

---

## 关键文件

| 文件 | 职责 |
|------|------|
| `model/prompt-builder.ts` | `buildStablePrefix` / `buildDynamicContext` / `buildSystemPrompt` / `buildMemoryAppendix` |
| `model/prompt-builder.ts:STABLE_SYSTEM_VERSION` | 指纹常量 |
| `session/working-log.ts` | `readWorkingLogTail` → user-side appendix |
| `session/prompt-cache.ts` | `assertToolsetInvariant` — toolset 变化检测 |
| `runtime.ts:applyMemoryAppendixToMessages` | 将 appendix 注入 user message |
