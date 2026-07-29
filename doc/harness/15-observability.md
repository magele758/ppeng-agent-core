# 15 — 可观测性

Trace events / OTEL / LLM debug / persona metrics / cognitive state。

---

## Trace Events (`stores/trace.ts`)

每个 session 有一条 JSONL trace 文件（`stateDir/traces/<sessionId>/<ts>.jsonl`），记录运行时关键决策点。

### Event 结构

```ts
interface TraceEvent {
  ts: string;           // ISO 时间戳
  sessionId: string;
  kind: TraceEventKind;
  payload?: Record<string, unknown>;
}
```

### Kind 全表

| Kind | 产生时机 |
|------|----------|
| `turn_start` | 每轮开始（turn index, adapter, stablePrefixHash, routing） |
| `turn_end` | 每轮结束（stopReason, finishReason, usage, costUsd, requestId, STABLE_SYSTEM_VERSION） |
| `turn_truncated` | 输出被 token cap 截断 |
| `tool_start` / `tool_end` | 工具执行开始/结束 |
| `model_error` | adapter 抛错 |
| `compact` / `compact_skipped` | autoCompact 执行 / 被 hook/extension 拦截 |
| `cancel` | session 被外部 abort |
| `skill_load` | load_skill 调用（含 shortlist 匹配信息） |
| `refusal_preservation` | refusal guard 触发 |
| `recovery_abort` / `recovery_advisory` | LoopGuard 终止 / 降级为 advisory |
| `risk_advisory` | RiskEngine 发出 advisory |
| `goal_eval` | Goal gate 评估（met, reason, decision, turnsUsed） |
| `evolving_case` / `evolving_coach` | 自进化 case 持久化 / coach 注入 |
| `prompt_cache_bust` | toolset 指纹漂移 |
| `repetition_abort` | 流式复读 watchdog 命中 |
| `reasoning_spin_abort` | 思考空转 watchdog 命中 |
| `micro_compact` | 微压缩生效（collapsed / trimmed / charsSaved） |
| `usage_cumulative_split` | 累计 token 检测修正 |
| `working_log_append` | working log 写入 |
| `otel_proxy` | OTEL span 导出 |

### 云端缓冲

`AppendTraceCloudOptions` 可选推 Redis EventBuffer（`storage/cloud/redis-event-buffer-repository.ts`），供集中查询。

---

## OTEL (`otel.ts`)

`maybeExportOtelSpan(event, opts)` — 当 `RAW_AGENT_OTEL_EXPORTER_ENDPOINT` 有值时，把关键 trace event 投射为 OpenTelemetry span。轻量实现，不拉完整 OTEL SDK。

---

## LLM Prompt Debug (`model/llm-prompt-debug.ts`)

`RAW_AGENT_LLM_PROMPT_DEBUG=1` 时每轮 dump 完整请求 payload 到 `stateDir/llm-debug/<sessionId>/<turn>.json`。调试用，生产不开（体积大）。

---

## Persona Dialogue Metrics (`model/persona-dialogue-metrics.ts`)

量化 persona 遵从度（实验性）：
- 分析 assistant 输出的用词、语气标记
- 与 agent persona 描述做匹配评分
- 写入 `turn_end` payload（当启用时）

---

## Cognitive State (`model/cognitive-state.ts`)

把对话历史分类为认知阶段：
- `exploration` — 早期问答、信息收集
- `implementation` — 工具密集、生产输出
- `verification` — 验证、测试、review
- `stuck` — 多轮无进展

用途：
1. `selectEpisodicMessagesWithCognitiveState`：按阶段调整消息选择权重
2. `buildDynamicContext`：注入阶段提示（可选）

---

## Doctor (`doctor/doctor.ts`)

`runDoctor(env)` → `DoctorReport`：启动时/CLI 调用时检查环境一致性：
- API key 可达
- model 响应
- skill 目录存在
- sandbox 可执行
- optional groups 与 env 匹配

`formatDoctorReport(report)` → 人类可读文本。

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `stores/trace.ts` | `appendTraceEvent` + `TraceEventKind` 类型 |
| `stores/read-traces.ts` | `readSessionTraceEvents`（JSONL 解析） |
| `otel.ts` | OTEL span 导出 |
| `model/llm-prompt-debug.ts` | debug dump 开关 |
| `model/persona-dialogue-metrics.ts` | persona 评分 |
| `model/cognitive-state.ts` | 认知阶段分类器 |
| `doctor/doctor.ts` | 环境健康检查 |
