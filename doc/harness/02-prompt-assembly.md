# 02 — Prompt 四段组装

> **核心洞察**：System prompt 不只是"告诉模型你是谁"——它是 Agent 行为控制的**唯一杠杆**。而这个杠杆的设计直接决定了两件事：模型行为的稳定性，和 provider 缓存命中率带来的成本节省。

---

## 设计动机：为什么要分四层？

### 问题

Provider prompt cache（OpenAI / Anthropic / DeepSeek 都有）按 **prefix match** 工作——请求的 system prompt 前缀与上一次相同，就复用 KV 缓存，省 50%+ 的输入 token 计费。

但 agent 的 system prompt 天然包含"每轮都变"的内容（记忆、摘要、认知提示）。如果把这些塞进 system prefix，**每轮都 cache miss**——白白多付一倍钱。

### 解法

把 prompt 拆成四层，按**变化频率**排列：

```
┌────────────────────────────────────────────────────────┐
│  STABLE PREFIX（几乎不变 → cache 复用率 > 95%）         │
│  身份 + workspace + 模式 + 安全附录 + skill 正文       │
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

实测验证：在 DeepSeek / OpenAI / Anthropic 三个 provider 上确认此路径均可复用 cache。**仅这一个设计就能在长对话中节省 30-50% 的 input token 费用。**

---

## 各层详解

### Layer 1: Stable Prefix

| 组成 | 变化频率 | 说明 |
|------|----------|------|
| 身份指令 | 极低（agentSpec 变时） | `agentSpec.instructions` / `harnessRole` |
| Workspace 根 | 会话内不变 | 告诉模型文件系统上下文 |
| 会话模式 | 会话内不变 | task / chat / subagent 行为差异 |
| Safety appendix | 版本级不变 | agentic 安全指南（可选） |
| Skill disclosure | 路由后不变（同一 shortlist） | 注入的 top-K skill 正文 |

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

设计原则：advisory 是**一次性的**——drain 后就清空，不会在后续轮次重复注入。

### Layer 4: User-side Appendix

拼到最后一条 user message 之前（走 user role），包含：

- **Memory appendix**：scratch（本次中间值）+ long-term KV（用户偏好）
- **Working log tail**：working-memory.md 最近 4k 字符

---

## 与竞品对比

| 方案 | Prompt 结构 | Cache 利用 | 动态内容处理 |
|------|------------|-----------|-------------|
| LangChain | 单层 template + variable interpolation | 无感知 | 全部混在 system 里 |
| AutoGen | 固定 system + agent description | 无感知 | 无 |
| Claude Code (Anthropic) | system + tools 固定 | 内部优化 | 全走 user turn |
| **ppeng Harness** | **四层分离** | **显式 prefix 稳定** | **按变化频率分层** |

---

## 效果评估

| 场景 | 无分层（每轮全重建） | 四层分层 | 节省 |
|------|---------------------|---------|------|
| 10 轮对话 | 10 次 cache miss | 1 miss + 9 hit | ~45% input cost |
| 50 轮长对话 | 50 次 cache miss | 1-3 miss + 47-49 hit | ~48% input cost |
| 带 memory 的对话 | 每轮 miss（memory 变） | 仍然 hit（memory 走 user） | ~50% input cost |

**prompt_cache_bust trace** 会在 toolset 指纹漂移时发出——这是监控 cache 利用率的核心指标。

---

## 长期计划

1. **Adaptive prefix splitting**：根据实际 cache hit rate 动态调整 stable/dynamic 的分界线
2. **Cross-session prefix sharing**：同一 agent 的不同 session 共享 stable prefix（需 provider 支持 explicit cache key）
3. **Prompt compression**：对 stable prefix 本身做 semantic compression，在不影响行为的前提下缩短

---

## 关键文件

| 文件 | 职责 |
|------|------|
| `model/prompt-builder.ts` | `buildStablePrefix` / `buildDynamicContext` / `buildSystemPrompt` / `buildMemoryAppendix` |
| `model/prompt-builder.ts:STABLE_SYSTEM_VERSION` | 指纹常量 |
| `session/working-log.ts` | `readWorkingLogTail` → user-side appendix |
| `session/prompt-cache.ts` | `assertToolsetInvariant` — toolset 变化检测 |
| `runtime.ts:applyMemoryAppendixToMessages` | 将 appendix 注入 user message |
