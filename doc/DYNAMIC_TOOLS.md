# Dynamic tools

会话可以把刚跑成功的 PTC cell（或显式 JS）收割成具名 `ToolContract`。下一内环轮进入 `tools[]`，按 memory 分层保存、晋升、退役。这是 L1 工具厂：不热补丁 `packages/core`，不加 `RAW_AGENT_*` 功能开关。

对照手册：[`PTC_DYNAMIC_WORKFLOW.md`](PTC_DYNAMIC_WORKFLOW.md)（收割源与 isolate 边界）· 计划 [`docs/plans/2026-09-14-dynamic-tool-factory.md`](../docs/plans/2026-09-14-dynamic-tool-factory.md)。

## 记录与落盘

动态工具是一条 JSON 记录，不是 `ptcLastProgram`。`ptcLastProgram` 只当收割源。

字段：`name` `description` `inputSchema` `kind` `source.code` `scope` `status` `stats` `createdFrom` `tests?`。

- `kind` 本阶段只有 `ptc_cell`。`execute` = `runPtcCell`，`args` 冻结后挂到 isolate `args`。禁止把 args 拼进源码，禁止 daemon `eval`。
- 落盘：`AgentMemory`，`namespace='dyn-tools'`，`key=name`，`source='dyn-tool'`。晋升只改 `scope`：`session.scratch` → `session.long` → `project.memory`。
- 名称：`^[a-z][a-z0-9_]{1,47}$`，不得与已注册工具、PTC reserved / blocked 重名。
- 每会话最多 20 条 `active`+`draft`。`source.code` ≤ 16_000 字符。

## 拍 4 hydrate 与粘滞

`resolveTurnTools` 并集：进程池过滤结果 ∪ 本会话 `active` ∪ **本会话已经成功调用过的动态工具**（`session.metadata.dynToolsUsed`）。本会话不卸已用过的。

**Sticky draft**：工具一旦被成功调用过，即使后来被改成 `draft`，本会话仍会 hydrate。退役（`retired`）才会从本轮 `tools[]` 拿掉。

造出的工具最早在下一内环轮可见，不是当轮同一波 `tool_call`。

Lab 主开关关闭时 hydrate 为空，行为与今日一致。工具多了以后 hydrate 改为 lexical shortlist ∪ used（`search_dyn_tools`），used 即使不在 top-k 仍注入。

`stats.uses=0` 且超过 N 轮未用只**建议** retired，未打标不得自动卸。

## 元工具

- `save_as_tool`：**必须显式调用**。读 `ptcLastProgram` 或显式 `code`，默认写成 `active`。`ptc_exec` **不会**自动收割。无 code 则失败并提示先 `ptc_exec`。
- `propose_tool`：schema + code + 1–3 fixtures；isolate 全过才 `active`，否则 `draft` 并返回失败日志。`allowPropose=false` 时从本轮 `tools[]` 卸掉，不只是 execute 拒绝。
- `search_dyn_tools`：name+description 词法短名单。随 master `enabled` 关闭；`enabled` 且本会话 active 数超过 `hydrateTopK` 时才暴露。不复用 capability `tool_search`。

它们在 optional group `dyn_tools`。真正的开关是 Lab「更多 → 动态工具厂」：`enabled` / `allowSave` / `allowPropose` / `allowProjectPromote` / `hydrateTopK` / `unusedSuggestTurns`，KV `dyn_tool_settings`。`enabled` 默认 false。默认关时 **不注入** Dynamic tools prompt 段，行为与今日一致。

具名收割工具**等同可复用的 `ptc_exec`**：执行面仍是 isolate + PTC read 工具。`approvalMode` **不**一律 `auto`（仓库没有 `'once'` 档）；按 cell 内授权工具最高 `sideEffectLevel` 继承：`none` → `never`（与 `ptc_exec` 相同），`workspace` / `system` → `always`。Chat 会话不必开 `ptc_exec` 也能调用已 hydrate 的具名工具。

## 退役与幽灵名

`status=retired` 后，`prepareMessagesForModel` 给历史 `tool_call` / `tool_result` 打 `[retired:<name>]`（只改模型视图，不改落库 transcript），再从本轮 `tools[]` 拿掉。未打标不得卸。再调用走现有 `UNKNOWN_TOOL`。

## 晋升

晋升 `project.memory` 必须审批（Lab 点晋升 → `POST .../dyn-tools/:name/promote` 创建 `dyn_tool_promote` 审批）。通过后新会话拍 4 可 hydrate（仍受 Lab `enabled` 约束）。

不要把动态工具名写进 memory appendix / working-log，除非记录显式 `pin`。

## Prompt 与观测

本轮以 `tools[]` 为准；历史名可能已 retired；技能正文不写死临时工具名。这段在 **dynamic** system 块，不 bump `STABLE_SYSTEM_VERSION`。

Trace：`dyn_tool_save` / `dyn_tool_propose` / `dyn_tool_hydrate` / `dyn_tool_retire` / `dyn_tool_promote`。

## Lab

更多卡：开关 + 本会话工具列表 + 退役 / 晋升。文案走 i18n `more.dynTools*`。

HTTP：`GET|PATCH /api/dyn-tools/settings`，`GET /api/sessions/:id/dyn-tools`，`POST .../retire`，`POST .../promote`。
