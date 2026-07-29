# 04 — 工具与审批（自建循环的工具边）

> **挂在哪**：第 2 章 `stopReason === 'tool_use'` 之后 → `runtime/tool-loop.ts`。  
> 这是自建循环的一半身体；不是 Agents SDK 的 `@tool` 装饰器运行时。

---

## 管线

```
allowlist / optional groups / agent.allowedTools
  → permission mode + approval policy
  → execute（可并行分区）
  → redact + truncate
  → append tool message（按 toolCallId 配对）
```

未知工具 → 在 **execute** 阶段合成 JSON result（`UNKNOWN_TOOL` / `did_you_mean` / `available_tools_sample`），**保持配对**（`recovery/unknown-tool-result.ts`）。  
并行：`RAW_AGENT_MAX_PARALLEL_TOOLS` 分块（块内并行、块间串行）。

审批：`approval/*` + `waiting_approval`；批准后再次 `runSession` 续跑。

内置工具：`tools/builtin-tools.ts`（以 ARCHITECTURE §7 / `doc-sync-tools` 为准）。  
可选外部 CLI 工具：`RAW_AGENT_EXTERNAL_AI_TOOLS=1`（仍走本 tool-loop）。

---

## 验收

- [ ] 能从 `_runSessionInner` 指到 tool-loop 调用点。
- [ ] 说明审批如何结束本次 dispatch 且不留下无 result 的 tool_call。
- [ ] 能说出未知工具 JSON 至少含 `did_you_mean` 与配对不变量。

**深读**：[../03-tool-execution.md](../03-tool-execution.md)、治理叠层 [../16-runtime-governance.md](../16-runtime-governance.md)、合章 [../18-model-tools-sandbox.md](../18-model-tools-sandbox.md)  
**下一章**：[05-session-and-compact](05-session-and-compact.md)（循环上的叠层）
