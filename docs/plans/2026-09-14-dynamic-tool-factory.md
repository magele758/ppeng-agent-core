---
title: Dynamic Tool Factory - Plan
type: feat
date: 2026-09-14
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: session-settled
execution: code
---

# Dynamic Tool Factory - Plan

## Goal Capsule

让会话能把「刚跑成功的 PTC cell / 新写的 JS 函数」收割成具名 `ToolContract`，下一内环轮次进 `tools[]`，并按 memory 分层保存、晋升、退役。
执行后端复用 `runPtcCell`，落盘复用 `AgentMemory` namespace `dyn-tools`。
不改主循环控制权，不热补丁 `packages/core`，不加 `RAW_AGENT_*` 功能开关。
做到 U1–U10 落地、Verification Contract 通过、手册与 Lab 文案对齐即停。

Authority: 本计划 → `doc/PTC_DYNAMIC_WORKFLOW.md` → `packages/core/src/ptc/` + `packages/core/src/turn/resolve-turn-tools.ts`。

对照研究：[RSI × 动态工具](../../.cursor 不入库) 会话结论：做 L1 工具厂，不做 L2 自改 runtime / L3 改权重。

## Product Contract

### Summary

今天工具集在进程启动时挂死（builtin / extraTools / domain / plugin），会话里只能过滤。
`ptc_exec` 会覆盖 `session.metadata.ptcLastProgram`，scratchpad 只存变量，`SavedOrchestration` 只存一条可回放编排。
多轮历史里的 `tool_call.name` 不会随 toolset 变化改写，模型会复用幽灵名；执行层已有 `UNKNOWN_TOOL`。

本工作增加：工具记录、会话粘滞挂载、从 PTC 收割 / 提议、退役打标、Lab 开关与晋升。

### Problem Frame

Agent 能写能跑一段 JS，但不能把它变成下一轮可点的 function calling。
若每轮按检索换 top-k，历史名和本轮 `tools[]` 打架，幽灵调用变主路径。

### Requirements

- R1. 动态工具是一条 JSON 记录，不是 `ptcLastProgram`。`ptcLastProgram` 只当收割源。
- R2. 记录字段：`name`, `description`, `inputSchema`, `kind`, `source.code`, `scope`, `status`, `stats`, `createdFrom`, `tests?`。
- R3. P0/P1 只实现 `kind=ptc_cell`。`execute` = `runPtcCell`，`args` 注入 `bindings.args`。禁止 `eval` 进 daemon。
- R4. `kind=sandbox_wrapper`（bash / 写文件升格）本计划不做（P3）。
- R5. 落盘：`AgentMemory`，`namespace='dyn-tools'`，`key=name`。晋升只改 `scope`：`session.scratch` → `session.long` → `project.memory`。
- R6. 不新增 SQLite 表、不新增 `RAW_AGENT_*` 功能开关。开关走 Lab + `daemon_control` KV（对齐 discovery settings）。
- R7. 名称：`^[a-z][a-z0-9_]{1,47}$`，不得与已注册工具名、PTC reserved / blocked 重名。
- R8. 每会话最多 20 条 `active`+`draft`。`source.code` ≤ 16_000 字符（小于 PTC 60k 上限）。
- R9. 拍 4 `resolveTurnTools` 并集：进程池过滤结果 ∪ 本会话 `active` ∪ **本会话已经成功调用过的动态工具**。本会话不卸已用过的。
- R10. 造出的工具最早在**下一内环轮**的拍 4 可见，不是当轮同一波 `tool_call`。
- R11. `save_as_tool`：把 `ptcLastProgram`（或显式 `code`）+ schema 写成 `draft`/`active`。仅 PTC 会话或设置允许时可见。
- R12. `propose_tool`：schema + code + 1–3 个 fixtures；isolate 全过才 `active`，否则 `draft` 并返回失败日志。
- R13. `ptc_cell` 工具的 `sideEffectLevel='none'`，`approvalMode='auto'`；cell 内仍只挂 PTC read 工具，不进 `bash` / 写文件。
- R14. 退役：`status=retired` 后，`prepareMessagesForModel` 给历史 `tool_call`/`tool_result` 打 `[retired:<name>]`，再从本轮 `tools[]` 拿掉。未打标不得卸。
- R15. 未知调用继续走现有 `UNKNOWN_TOOL`；主路径应少走到这里。
- R16. 不复用 `tool_search` / `load_capability_tool`（那是外部能力 Registry）。P2 另做 `search_dyn_tools`。
- R17. 不把动态工具名写进 memory appendix / working-log，除非用户显式 `pin`。
- R18. 晋升 `project.memory` 必须审批。Lab 可关「自动收割 / 提议」。
- R19. Prompt / 手册写清：本轮以 `tools[]` 为准；历史名可能已 retired；技能正文不写死临时工具名。
- R20. Trace：`dyn_tool_save` / `dyn_tool_propose` / `dyn_tool_hydrate` / `dyn_tool_retire` / `dyn_tool_promote`。
- R21. 前端用户可见文案走 i18n（`more` namespace），zh/en 同 key。

### Actors

- A1. 对话模型（Chat 或 PTC Task）。
- A2. Lab 操作者（开关、审批晋升、查看本会话工具）。
- A3. 下一内环轮的 `resolveTurnTools` / 模型视图。

### Flows

- F1. PTC 会话 `ptc_exec` 成功 → `save_as_tool({ name, description, inputSchema })` → 本会话 `dyn-tools` `active` → 下一轮 `tools[]` 含该 name。
- F2. `propose_tool` fixtures 失败 → 不挂载，返回日志；成功 → 下一轮可调。
- F3. 同会话第二条用户消息：已用过的动态工具仍在 `tools[]`（粘滞），即使本轮检索本会把它挤掉。
- F4. 退役：历史调用名带 retired 标，本轮 schema 无此名；再调用走 `UNKNOWN_TOOL`。
- F5. 审批通过后 scope 改为 `project.memory`；新会话拍 4 可 hydrate（受 Lab 开关约束）。

### Acceptance Examples

- AE1. 覆盖 R10, R11. MockLLM：第 1 轮 `save_as_tool`，第 2 轮 `tools[]` 含新名且能跑通 cell。
- AE2. 覆盖 R12. fixture 断言失败：记录为 `draft`，第 2 轮 `tools[]` 不含该名。
- AE3. 覆盖 R9, R14. 标记 retired 后 hydrate 不含该名；prepare-view 历史出现 `retired:`。
- AE4. 覆盖 R13. cell 内调用 `bash` 不可用（namespace 仍屏蔽）。

### Success Criteria

同会话内「造 → 下一轮用 → 粘滞 → 可退役」闭环可测。
PTC isolate 是唯一 `ptc_cell` 执行面。
无新功能 env。幽灵名不再是默认主路径。

### Scope Boundaries

In: `packages/core/src/dyn-tools/`（新）、`resolve-turn-tools`、`prepare-view`、`ptc` 收割接缝、Lab 更多卡、i18n、手册。
Out: 自改 runtime / Evolution 当本功能；SEAL；bash wrapper；Capability Registry 混用；新 SQLite 表；monkey-patch；会话内卸工具却不改历史。

### Dependencies

- `runPtcCell` / `buildPtcNamespace` / `PTC_NAMESPACE_BLOCKED_NAMES`
- `AgentMemoryStore` + `upsertSessionMemory` / `upsertAgentMemory`
- `resolveTurnTools` + prompt-cache fingerprint（粘滞会 lock，属预期；卸工具=退役打标后的 cache bust）
- `buildUnknownToolResultContent`（不改协议，只当兜底）
- `discovery/settings.ts` 作为 Lab KV 开关样板
- 现有审批 / permission-mode

## Planning Contract

### Key Technical Decisions

- KTD1. 新目录 `packages/core/src/dyn-tools/`：`types.ts` `store.ts` `materialize.ts` `settings.ts`。runtime 只 hydrate + 注册元工具。
- KTD2. 存储用 memory，不用新表。`source: 'dyn-tool'`。列表 = 按 namespace 扫。
- KTD3. 执行注入 `bindings.args`（冻结对象）。cell 写 `const { a, b } = args;`。不把 args 拼进源码字符串。
- KTD4. 会话粘滞集合写在 `session.metadata.dynToolsUsed: string[]`。hydrate = memory active ∪ used。
- KTD5. `save_as_tool` / `propose_tool` 放 optional group `dyn_tools`，默认随 Lab 开关打开，不新加 env。
- KTD6. Chat 会话不必开 `ptc_exec`。hydrate 出的具名工具在普通会话也可调（底下仍是 isolate）。
- KTD7. `search_dyn_tools` 放 P2，勿复用 capability `tool_search`。
- KTD8. Prompt 动态段提及「以本轮 tools 为准」。不 bump `STABLE_SYSTEM_VERSION`。
- KTD9. 配额与默认值是 `dyn-tools/settings.ts` 常量 + Lab 可改 `enabled` / `allowPropose` / `allowSave` / `allowProjectPromote`。

### Assumptions

`AgentMemory` 在 daemon 默认后端可用（非 `RAW_AGENT_MEMORY_BACKEND=session` 退化时，session.scratch 桥仍可写；U1 测两条后端）。
内环每轮都会再跑 `resolveTurnTools`（`kernel.ts` 已如此）。
PTC cell 无文件系统、无 bash——收割工具只能是纯计算 / 只读工具组合。

### Sequencing

P0 = U1 → U2 → U3 → U4。
P1 = U5 → U6 → U7。
P2 = U8 → U9。
U10 随各阶段改手册，P2 结束收口。

## Implementation Units

### U1. 记录类型与 store

Goal: 可读写 `dyn-tools` 记录，含校验与配额。
Requirements: R1, R2, R5, R7, R8
Files: Create `packages/core/src/dyn-tools/{types,store,index}.ts`. Test: `packages/core/test/dyn-tools-store.test.js`
Approach: `upsert/get/list/retire`。非法名、超配额、保留名抛 typed error。`listActive(sessionId)` 供 hydrate。
Test scenarios:
- 合法 upsert 后 get 回来字段完整。
- 重名内置 `bash` 被拒。
- 第 21 条 active 被拒。
- retire 后 listActive 不含。
Verification: `node --test packages/core/test/dyn-tools-store.test.js`

### U2. ptc_cell 物化成 ToolContract

Goal: 记录 → 可执行合同，args 进 isolate。
Requirements: R3, R13
Files: Create `packages/core/src/dyn-tools/materialize.ts`. Reuse `runPtcCell` + `buildPtcNamespace`（授权工具与 `ptc_exec` 同一过滤）。Test: `packages/core/test/dyn-tools-materialize.test.js`
Approach: `execute(ctx, args)` 把 `Object.freeze({ ...args })` 挂到 hooks.args。返回 JSON 字符串。超时沿用 PTC clamp。
Test scenarios:
- cell `return args.x + 1`，调用 `{x:1}` 得 2。
- cell 调 `bash` 失败（不在 namespace）。
- 空 code 拒绝物化。
Verification: `node --test packages/core/test/dyn-tools-materialize.test.js`

### U3. 拍 4 hydrate + 会话粘滞

Goal: 每轮 `tools[]` 并上动态工具。
Requirements: R9, R10, R17
Files: Modify `packages/core/src/turn/resolve-turn-tools.ts`. Create `packages/core/src/dyn-tools/hydrate.ts`. Kernel 在成功执行动态工具后 `mergeSessionMetadata({ dynToolsUsed })`. Test: `packages/core/test/resolve-turn-tools.test.js`（或新建 `dyn-tools-hydrate.test.js`）
Approach: settings.enabled 才 hydrate。指纹变化走现有 cache-bust（粘滞增工具会 drift，允许并打 `dyn_tool_hydrate` trace）。
Test scenarios:
- 无记录时与现在过滤结果一致（回归）。
- 有一条 session active：turnTools 含该 name。
- used 但 memory 误标 draft：仍 hydrate（粘滞优先）。
Verification: `node --test packages/core/test/dyn-tools-hydrate.test.js packages/core/test/resolve-turn-tools.test.js`

### U4. save_as_tool（P0 闭环）

Goal: 从 `ptcLastProgram` 或显式 code 收割。
Requirements: R11, R20
Files: Create `packages/core/src/dyn-tools/save-as-tool.ts`，挂进 `builtin-tools` / tool-assembly。Test: `packages/core/test/dyn-tools-save.test.js` + MockLLM 一轮收割一轮调用（可放 `mock-llm-e2e` 小用例）。
Approach: 无 code 则读 `session.metadata.ptcLastProgram`；没有则失败并提示先 `ptc_exec`。默认 `active`（源码刚跑成功）。写 store + trace。
Test scenarios:
- AE1：两轮 MockLLM。
- 无 last program 且无 code：ok=false。
Verification: `node --test packages/core/test/dyn-tools-save.test.js`

### U5. propose_tool + fixtures

Goal: 先测后挂。
Requirements: R12, AE2
Files: Create `packages/core/src/dyn-tools/propose-tool.ts`. Test: `packages/core/test/dyn-tools-propose.test.js`
Approach: 每个 fixture `{ args, expect? }`（`expect` 为可选 JSON 深相等或 `{ contains: string }`）。全过 → active，否则 draft + 日志。
Test scenarios:
- 全过 → 下一轮可 hydrate。
- 一失败 → 不出现在 turnTools。
Verification: `node --test packages/core/test/dyn-tools-propose.test.js`

### U6. 退役打标（防幽灵）

Goal: 卸之前改模型视图。
Requirements: R14, R15, AE3
Files: Modify `packages/core/src/turn/prepare-view.ts`（或 `dyn-tools/annotate-retired.ts` 由 prepare-view 调用）。Test: `packages/core/test/dyn-tools-retire-view.test.js`
Approach: 纯函数：对已 retired 的 name，改写 part 旁注，不改落库 transcript（与 micro-compact 同一原则）。
Test scenarios:
- 落库原文无 `retired:`，模型视图有。
- 未 retired 不改写。
Verification: `node --test packages/core/test/dyn-tools-retire-view.test.js`

### U7. Lab 开关与 optional group

Goal: 配置优先界面。
Requirements: R6, R18, R21（先 API + 常量，UI 在 U8）
Files: Create `packages/core/src/dyn-tools/settings.ts`（照 `discovery/settings.ts`）。Daemon `PATCH /api/dyn-tools/settings`。optional group `dyn_tools`: `save_as_tool` / `propose_tool`。Test: `packages/core/test/dyn-tools-settings.test.js`
Approach: KV key `dyn_tool_settings`。`enabled` 默认 false，与 discovery 一样需 Lab 打开后才 hydrate。CI 未保存过时默认 false（测试里显式打开）。
Test scenarios:
- enabled=false：hydrate 空，元工具可隐藏。
- enabled=true + allowSave=false：`save_as_tool` 执行拒绝。
Verification: `node --test packages/core/test/dyn-tools-settings.test.js`

### U8. Lab 更多卡 + i18n

Goal: 操作者能开关注、看本会话工具、点晋升/退役。
Requirements: R18, R21
Files: `apps/web-console` 更多卡；`messages/{zh,en}/more.ts`；`lib/api.ts`。Test: `apps/web-console/lib/i18n` 既有 key 对称测试。
Approach: 列表来自 `GET /api/sessions/:id/dyn-tools`。晋升走 `POST .../dyn-tools/:name/promote`（创建审批）。禁止硬编码中英文。
Test scenarios:
- zh/en 叶子 key 集合一致。
Verification: `npm test` 中 i18n 单测；手测或 Playwright 非本阶段必做（P2 再加一条 e2e 可选项）。

### U9. 检索、晋升、修剪（P2）

Goal: 工具多了不灌满 schema。
Requirements: R16, R5, R8
Files: `search_dyn_tools`（短名单 name+description）；hydrate 改为「shortlist ∪ used」。修剪：`stats.uses=0` 且超过 N 轮未用 → 建议 retired，不自动卸未打标项。
Test: `packages/core/test/dyn-tools-search.test.js`
Approach: 先 lexical（对齐 skill-router legacy），不上新向量依赖。
Test scenarios:
- 15 条 active 只注入 top-k + used。
- used 不在 top-k 仍注入。
Verification: `node --test packages/core/test/dyn-tools-search.test.js`

### U10. Prompt、手册、观测

Goal: 模型与人看到同一规则。
Requirements: R19, R20
Files: `prompt-builder.ts` 动态段；`doc/PTC_DYNAMIC_WORKFLOW.md` 增「收割为工具」；`doc/DYNAMIC_TOOLS.md`（短手册）；`doc/README.md` 挂计划与手册。`stores/trace.ts` 增 kind。
Approach: 不 bump `STABLE_SYSTEM_VERSION`。
Test scenarios: prompt 含 “current tools[]” / retired 提示。
Verification: `node --test packages/core/test/prompt-builder.test.js`

## Verification Contract

P0: `cd packages/core && npx tsc -b && node --test test/dyn-tools-store.test.js test/dyn-tools-materialize.test.js test/dyn-tools-hydrate.test.js test/dyn-tools-save.test.js`

P1: 上式 + `test/dyn-tools-propose.test.js test/dyn-tools-retire-view.test.js test/dyn-tools-settings.test.js`

P2: 上式 + `test/dyn-tools-search.test.js` + web-console i18n 测试。

合并前：`npm run test:unit`（FTS5 Node）。

可选：`scripts/agent-eval/cases/fast/dyn-tool-save.json`（heuristic / mock）。

## Definition of Done

- R1–R21 都有具名 unit 与测试场景（R4 明确不做）。
- AE1–AE4 有自动测试。
- 无新 `RAW_AGENT_*` 功能开关。
- 无 daemon 进程内 `eval`。
- `doc/DYNAMIC_TOOLS.md` 与 `doc/PTC_DYNAMIC_WORKFLOW.md` 描述一致。
- Lab 开关关闭时行为与今日完全一致。

## Appendix

现有拍序：`packages/core/src/turn/kernel.ts`（prepareView → buildSystemPrompt → resolveTurnTools → model → tool-loop）。
PTC 落盘：`saveProgram` → `ptcLastProgram`（`runtime.ts`）；scratch `ptc.*`（`scratchpad.ts`）。
未知工具：`packages/core/src/recovery/unknown-tool-result.ts`。
能力发现：`tool_search` 管 bound 外部工具，与本库正交。
P3 预留：`sandbox_wrapper`、TroVE 自动 trim、Evolution 外环改工厂本身。
