# 03 — 工具执行管线

从模型输出 `tool_call` 到结果写回 session 的完整路径。

---

## 管线阶段

```
assistant turn (stopReason='tool_use')
  │
  ├─ 1. filterValidToolCalls
  │     external AI gate → 未注册 → 拒绝 + problem JSON
  │
  ├─ 2. checkToolApprovals
  │     permission mode → file policy → env approval policy
  │     → 'proceed' / 'waiting' / 'skip(deny)'
  │
  ├─ 3. executeToolCalls (parallel batches)
  │     partition → Promise.allSettled per batch
  │     per-call: lifecycle pre_tool → tool.execute → lifecycle post_tool
  │
  ├─ 4. processToolResults
  │     truncate (hardMaxChars) → redact (secrets) → persist message
  │     → after_tool extension → artifact collect → RiskEngine note
  │
  └─ 5. [next turn with tool results in context]
```

---

## 1. 筛选 (`filterValidToolCalls`)

- 已注册工具直接通过。
- `isExternal` 工具（`claude_code` / `codex_exec` / `cursor_agent`）需 `RAW_AGENT_EXTERNAL_AI_TOOLS=1` **且** session metadata `allowExternalAiTools=true` 同时开启。
- 未知工具名 → `buildUnknownToolResultContent`（附最近似工具名提示），不阻断 loop。

## 2. 审批 (`checkToolApprovals`)

多层叠加（从上到下，首个决策生效）：

1. **Permission mode** (`plan` / `ask` / `acceptEdits` / `auto` / `bypass`)
   - mode gate 决定 deny → 立即拒绝 + problem
   - mode gate 决定 require_approval → 必须审批
   - mode gate 决定 proceed + (bypass | acceptEdits) → 跳过后续
2. **Env approval policy** (`RAW_AGENT_APPROVAL_POLICY`，JSON array）
3. **File policy** (`.ppeng-policy.json` 或 env，bash 命令模式 + 路径模式)
4. **Tool 自身 `approvalMode`**: `'always'` / `'auto'` + `needsApproval(ctx, input)`
5. **Idempotency**: 同参数工具如果上次已审批且未过期 → 复用

审批待定 → session 状态转 `waiting_approval`，loop 暂停直到外部调 approve API。

## 3. 执行 (`executeToolCalls`)

- `maxParallelToolCalls`（默认 4）控制并行度。
- 每个 call：
  - `runLifecycleHook('pre_tool_use')` — 可 block / force_approval
  - `tool.execute(context, input)` — 返回 `{ ok, content, artifacts?, metadata? }`
  - `runLifecycleHook('post_tool_use')` — 可注入 systemMessage
- 超时 / 异常 → `ok: false` + error content，不阻断其余。

## 4. 结果处理 (`processToolResults`)

| 步骤 | 代码 | 作用 |
|------|------|------|
| 截断 | `truncateToolContent(content, maxChars)` | head 截断 + `[truncated N chars]` 占位 |
| 脱敏 | `redactToolContent(content)` | 替换疑似密钥 / token / 私钥 |
| 落库 | `store.appendMessage(sid, 'tool', [...])` | 写入 session_messages |
| 扩展 | `extensionRegistry.run('after_tool')` | 可注入 system message |
| Artifact | 如果 exec result 带 `artifacts[]` → 追加到 task.artifacts | 产物收集 |
| Risk | `RiskEngine.noteToolFailure(name)` / `noteToolSuccess(name)` | 多信号评估 |

---

## 工具清单（内置 31 个）

| 组 | 工具 |
|----|------|
| 文件 | `read_file`, `write_file`, `edit_file`, `glob_files`, `grep_files` |
| Shell | `bash`, `bg_run`, `bg_check` |
| 网络 | `web_fetch`, `web_search` |
| 视觉 | `vision_analyze` |
| 内存 | `spill_tool_result` |
| 任务 | `task_create`, `task_get`, `task_update`, `task_list` |
| Skill | `load_skill` |
| Todo | `TodoWrite` |
| 协作 | `spawn_subagent`, `spawn_teammate`, `list_team`, `send_message`, `read_inbox` |
| 产物 | `work_evidence`, `record_summary`, `harness_write_spec` |
| 代码 | `lsp_request`, `notebook_edit` |
| 社交 | `schedule_social_post` |
| UI | `a2ui_render`, `a2ui_delete_surface` |
| 工作区 | `workspace_list` |

额外通过 Optional Tool Groups 门控（`RAW_AGENT_OPTIONAL_TOOL_GROUPS=1`）：
- `shell` / `network` / `workspace_search` / `subagents` / `external_ai` / `browser` / `sandbox`

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `runtime/tool-loop.ts` | 管线 5 步骤 + `runTurnWithRetries`（含 repetition guard） |
| `runtime/tool-services.ts` | 动态注入服务（skill load / subagent spawn / background job） |
| `tools/builtin-tools.ts` | 31 个内置工具定义 |
| `tools/tool-orchestration.ts` | `truncateToolContent` / `findToolByName` / `partitionForParallel` |
| `sandbox/result-redaction.ts` | `redactToolContent` |
| `recovery/unknown-tool-result.ts` | `buildUnknownToolResultContent` |
| `approval/` | 三文件：policy / permission-mode / policy-loader |
