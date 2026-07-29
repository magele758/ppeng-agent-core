# 15 — 可观测性

> **核心信念**：如果你不能观测 agent 的决策过程，你就不能调试它、优化它、信任它。可观测性不是 nice-to-have——它是 agent 从"demo 可用"到"生产可靠"的分水岭。

---

## 问题：Agent 的 debug 为什么比传统软件难？

传统软件：输入确定 → 逻辑确定 → 输出确定。出 bug 加个 log 就能复现。

Agent：输入确定 → LLM 输出不确定 → 工具结果不确定 → 行为路径每次不同。你需要记录的不是"代码跑了什么"，而是"agent 做了什么决策、为什么"。

---

## 设计方案：Trace Events

每个 session 有一条 JSONL trace 文件，记录**所有关键决策点**：

```ts
interface TraceEvent {
  ts: string;           // ISO 时间戳
  sessionId: string;
  kind: TraceEventKind; // 决策类型
  payload?: Record<string, unknown>; // 决策上下文
}
```

### 为什么是 JSONL 而不是结构化日志框架？

| 方案 | 问题 |
|------|------|
| Winston/Pino | 通用日志——不是为 agent 决策设计的 |
| OTEL spans | 太重——agent 一轮内有 10+ 个决策点 |
| 结构化 DB | 写入延迟影响主流程 |
| **JSONL 文件** | **append-only、零依赖、可 jq/grep 分析** |

关键：trace 的写入不能影响 agent 主循环的性能。JSONL append 是 O(1)、不阻塞。

---

## Trace Kind 全表

| Kind | 产生时机 | 用来分析什么 |
|------|----------|-------------|
| `turn_start` | 每轮开始 | 路由了哪些 skill？prompt 多大？ |
| `turn_end` | 每轮结束 | `stopReason` / `usage` / `finishReason` / `truncated` / `requestId` / `costUsd` / **`stableSystemVersion`**（stable prefix 指纹，不进 prompt） |
| `turn_truncated` | 输出被截断 | 是否需要加大 output budget？ |
| `tool_start/end` | 工具执行 | 哪个工具最慢？失败率？ |
| `compact` | 压缩执行 | 何时触发？摘要质量？ |
| `repetition_abort` | 复读检测 | 哪些 prompt 容易导致复读？ |
| `reasoning_spin_abort` | 空转检测 | 哪类任务容易空转？ |
| `recovery_abort/advisory` | 恢复机制 | 多少 session 被救回？ |
| `risk_advisory` | 风险告警 | 风险模式分布？ |
| `goal_eval` | Goal Gate | 多少次被否决？原因分布？ |
| `evolving_case/coach` | 自进化 | case 积累速度？coach 介入频率？ |
| `prompt_cache_bust` | cache 失效 | cache 利用率监控 |
| `micro_compact` | 微压缩 | 节省了多少 token？ |
| `usage_cumulative_split` | 累计 token 修正 | 哪些 provider 有报数问题？ |
| `skill_load` | skill 加载 | 路由准确率？ |

---

## OTEL 集成

`maybeExportOtelSpan(event, opts)` — 当配置了 `RAW_AGENT_OTEL_EXPORTER_ENDPOINT` 时，把关键 trace event 投射为 OpenTelemetry span。

**为什么是"投射"而不是"用 OTEL 替代"？**

1. OTEL 的 span 模型对 agent 不够贴合——agent 的"一轮"不是简单的 request/response
2. 本地 JSONL 零依赖、零延迟；OTEL 需要 exporter + collector
3. 两者并行：JSONL 保证本地可调试，OTEL 满足企业级监控

---

## LLM Prompt Debug

`RAW_AGENT_LLM_PROMPT_DEBUG=1` 时，每轮 dump 完整请求 payload 到 JSON 文件。

**用途**：当 agent 行为异常时，你可以看到"模型实际看到了什么 prompt"——包括 system prompt 全文、所有 messages、tools schema。

**为什么不默认开？** 单轮 payload 可能 50-200KB，50 轮就是 10MB。只在调试时开。

---

## Cognitive State（认知阶段）

把对话历史分类为认知阶段：

| 阶段 | 特征 | 用途 |
|------|------|------|
| `exploration` | 问答多、工具少 | episodic 选择保留早期探索 |
| `implementation` | 工具密集、代码产出 | 保留近期工具结果 |
| `verification` | 测试、review | 保留验证结果 |
| `stuck` | 多轮无进展 | 触发不同的 dynamic context |

这不只是"统计"——它直接影响 episodic selection 和 prompt 内容（见 [04-context-economics](04-context-economics.md)）。

---

## Doctor（环境诊断）

`runDoctor(env)` 启动时检查环境一致性：

- API key 可达？
- 模型能响应？
- Skill 目录存在？
- Sandbox 可执行？
- Optional groups 与 env 匹配？

输出 `DoctorReport`——在部署失败时第一时间定位问题，而不是等到用户报错。

---

## 与竞品对比

| | LangChain (LangSmith) | AutoGen | CrewAI | **ppeng** |
|---|----------------------|---------|--------|-----------|
| 本地 trace | 无（需 LangSmith 云） | print | 无 | **JSONL 零依赖** |
| 成本追踪 | LangSmith 付费 | 无 | 无 | **内置 per-turn** |
| 认知状态 | 无 | 无 | 无 | **认知阶段分类器** |
| OTEL | 需插件 | 无 | 无 | **内置投射** |
| 环境诊断 | 无 | 无 | 无 | **Doctor** |
| Prompt 快照 | LangSmith | 无 | 无 | **本地 JSON dump** |

---

## 效果评估

| 场景 | 无观测 | 有观测 |
|------|--------|--------|
| 定位"为什么 agent 行为异常" | 看日志猜（30min+） | 看 trace 5 分钟定位 |
| 发现累计 token bug | 不可能（隐性成本翻倍） | `usage_cumulative_split` 自动发现 |
| 优化 prompt cache | 无数据 | `prompt_cache_bust` 统计命中率 |
| 复读问题排查 | 用户报告后才知道 | `repetition_abort` 实时告警 |

---

## 长期计划

1. **Trace UI**：web 端 trace viewer，类似 Chrome DevTools 的 timeline
2. **Anomaly detection**：基于 trace 数据自动发现异常 session
3. **A/B testing**：基于 trace 比较不同 prompt/config 的效果
4. **Cost forecasting**：基于历史 trace 预测月度成本

---

## `STABLE_SYSTEM_VERSION`（turn_end）

`prompt-builder.ts` 常量写入每轮 `turn_end.stableSystemVersion`。  
**不进** prompt / cache key；改 stable 文案须 bump（见 `packages/core/src/model/AGENTS.md`）。治理叠层与其它 turn 观测：[16-runtime-governance](16-runtime-governance.md) §8。

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `stores/trace.ts` | `appendTraceEvent` + kind 类型 |
| `stores/read-traces.ts` | JSONL 解析 |
| `otel.ts` | OTEL span 导出 |
| `model/llm-prompt-debug.ts` | debug dump |
| `model/cognitive-state.ts` | 认知阶段分类器 |
| `model/prompt-builder.ts` | `STABLE_SYSTEM_VERSION` |
| `doctor/doctor.ts` | 环境诊断 |
