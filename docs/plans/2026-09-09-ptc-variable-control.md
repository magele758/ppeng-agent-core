---
title: PTC Variable Control - Plan
type: feat
date: 2026-09-09
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: session-settled
execution: code
---

# PTC Variable Control - Plan

## Goal Capsule

Give PTC cells a real variable policy: what is stored, who can see it, how large it may be, and how it comes back to the parent.
Do not replace `ptc_exec`, `agent()`, or the one-shot JS cell.
Do not add `RAW_AGENT_*` feature switches.
Stop when U1–U7 land, unit tests listed in Verification Contract pass, and `doc/PTC_DYNAMIC_WORKFLOW.md` matches the new cell API.
Out of scope stays out: recursive-llm / Lean4 / `llm()` leaf / tree-wide token budget / auto-mirroring cell locals into SQLite.

Authority: this plan, then `doc/PTC_DYNAMIC_WORKFLOW.md`, then `packages/core/src/ptc/`.

## Product Contract

### Summary

Today cell locals die with the VM.
`scratchpad.write` dumps a string into `session.scratch` under `ptc.{key}` with no TTL, delete, size cap, or visibility.
Those keys can enter the next-turn memory appendix and are copied to every `agent()` child.
`return` dumps the whole JSON into the parent transcript.
Hard replay v3 stubs scratchpad, so replay cannot read what a live cell wrote.

This work adds visibility, caps, delete, opt-in inherit, return-by-ref, and replay using the same scratchpad.

### Problem Frame

Operators cannot control PTC intermediate state.
The prompt says scratchpad lives "outside the parent context", but recall and `copySessionMemory` leak it.
There is no guidance API beyond key-name convention.

### Requirements

- R1. `scratchpad.write` accepts the current `(key, value)` form and an object form `{ key, value, visibility?, ttlSec?, pin? }`.
- R2. Visibility is `cell` | `session` | `inherit`. Omitted visibility is `session`.
- R3. `cell` values live only for the current `ptc_exec` and are discarded when the cell ends. They are not written to SQLite.
- R4. `session` and `inherit` persist as `session.scratch` keys `ptc.{key}`.
- R5. Unpinned `ptc.*` keys never enter `compileTurnAppendix` / `recallProgressive` working memory.
- R6. `pin: true` is the only way a persisted PTC key may appear in the memory appendix.
- R7. `agent()` copies `ptc.*` keys to the child only when `inheritScratch` allows it. Default is no `ptc.*` copy. Non-`ptc.` scratch copy stays as today.
- R8. `inheritScratch` is `false` | `true` | `string[]`. `true` copies all `ptc.*`. An array copies those keys only.
- R9. `agent({ summaryMaxChars })` is parsed and passed through to `formatSubagentSummary`. Default remains 4000.
- R10. `scratchpad.delete(key)` removes the cell overlay and the persisted `ptc.{key}` row.
- R11. A single persisted PTC value may not exceed 8192 characters. A session may not hold more than 40 `ptc.*` keys. Writes that exceed either limit fail with a typed error, they do not truncate silently.
- R12. If the serialized cell `return` exceeds 8192 characters, the runtime stores the full JSON under `ptc.__last_return` (session visibility, unpinned) and the parent tool result keeps a short stub plus that ref.
- R13. Hard replay v3 uses the same scratchpad adapter as live `ptc_exec` for the target session. It must not use the current no-op stub.
- R14. Cell local `const` bindings stay ephemeral. The runtime must not auto-persist them.
- R15. Prompt and `doc/PTC_DYNAMIC_WORKFLOW.md` describe the three visibilities, pin, caps, inherit, and return-by-ref.

### Actors

- A1. Orchestrator model writing a PTC cell.
- A2. Child subagent spawned by `agent()`.
- A3. Parent turn after `ptc_exec` (transcript + optional next-turn appendix).

### Flows

- F1. Write session key, spawn child with default inherit: child must not see `ptc.*`. Parent next-turn appendix must not show the key unless pinned.
- F2. Write inherit key or `inheritScratch: true` / allowlist: child scratch contains only the allowed `ptc.*` keys.
- F3. Write `visibility: 'cell'`: later `ptc_exec` in the same session cannot `read` it. SQLite has no row.
- F4. Oversized `return`: parent `tool_result` cites `ptc.__last_return`; `scratchpad.read('__last_return')` in a later cell returns the full JSON.

### Acceptance Examples

- AE1. Covers R5, R6. Write `scratchpad.write('notes', 'secret')` then compile the parent appendix: working slot has no `ptc.notes`. Write `{ key: 'notes', value: 'secret', pin: true }`: appendix may include it.
- AE2. Covers R7, R8. After `scratchpad.write('plan', 'v1')`, `agent({ task: 'x' })` child's scratch has no `ptc.plan`. `agent({ task: 'x', inherit_scratch: ['plan'] })` has it.
- AE3. Covers R12. `return` a 20k-char string: tool content length is bounded and mentions `__last_return`.

### Success Criteria

Cells can keep intermediates off the parent prompt and off children by default.
Pinned or inherited keys are the only exceptions.
Replay can read session-scoped keys.
No new environment-variable feature flags.

### Scope Boundaries

In: `packages/core/src/ptc/*`, spawn copy filter, recall filter, PTC prompt, `doc/PTC_DYNAMIC_WORKFLOW.md`.
Out: replacing PTC with RLM; Lean4 `verify`; `llm()` leaf; tree-wide cost budget; Lab settings UI (defaults are constants); auto-snapshot of VM locals.

### Dependencies

Existing `SessionMemoryBridge.upsertSessionMemory` / `copySessionMemory` (`packages/core/src/memory/session-memory-bridge.ts`).
Existing `formatSubagentSummary` (`packages/core/src/session/subagent-contract.ts`).
Existing `recallProgressive` (`packages/core/src/memory/memory-recall.ts`).

## Planning Contract

### Key Technical Decisions

- KTD1. New module `packages/core/src/ptc/scratchpad.ts` owns parse/normalize/caps/cell overlay. `runtime.ts` only persists session/inherit rows. (session-settled: user-directed — chosen over a new memory scope: reuse `session.scratch` + `ptc.` prefix already in production)
- KTD2. Persist visibility, pin, and expiry in session-memory `metadata` (`visibility`, `pin`, `expiresAt`). Use `source: 'ptc'`. Do not add a SQLite migration.
- KTD3. Appendix filter is `key.startsWith('ptc.') && metadata.pin !== true`. Expired rows are treated as missing on read and deleted. (session-settled: user-directed — chosen over putting PTC keys in `session.long`: scratch is the current write path)
- KTD4. Inherit is PTC-path only. `spawnSubagent` gains an optional `scratchKeyFilter`. Non-PTC `spawn_subagent` still copies all scratch.
- KTD5. Return spill uses a reserved key `__last_return`. A user write to that key is rejected.
- KTD6. Caps and defaults are constants in `scratchpad.ts`. No `RAW_AGENT_*` switch. Lab UI is deferred.
- KTD7. `buildPtcOrchestrationBlock` is dynamic context. Do not bump `STABLE_SYSTEM_VERSION`.

### Assumptions

String `scratchpad.write(key, value)` remains valid and means visibility `session`, unpinned, no TTL.
`agent()` JSON may use `inherit_scratch` (snake) matching `allowed_tools`.
`copySessionMemory` can grow an optional key predicate without changing its current three-arg callers.

### Sequencing

U1 → U2 → U3 and U4 in parallel → U5 → U6 → U7.

## Implementation Units

### U1. Scratchpad policy and cell overlay

Goal: Parse write args, enforce caps, hold `cell` values in memory.
Requirements: R1, R2, R3, R10, R11, R14
Files: Create `packages/core/src/ptc/scratchpad.ts`. Modify `packages/core/src/ptc/hooks.ts`, `packages/core/src/ptc/types.ts`, `packages/core/src/ptc/ptc-exec-tool.ts`. Test: `packages/core/test/ptc.test.js`
Approach: Export `PTC_SCRATCH_MAX_KEYS = 40`, `PTC_SCRATCH_MAX_VALUE_CHARS = 8192`, `parseScratchpadWrite`, `PtcScratchpadSession` with `write/read/list/delete` over a Map for `cell` plus persist callbacks for session/inherit. Reject reserved `__last_return` on user write except the runtime spill path.
Test scenarios:
- `(key, value)` normalizes to visibility `session`.
- `visibility: 'cell'` is readable in the same overlay and absent after `dispose()`.
- Value of 8193 chars throws. 41st distinct session key throws.
- `delete` removes overlay and calls persist delete.
- Overlay never calls persist for `cell`.
Verification: `node --test packages/core/test/ptc.test.js`

### U2. Persist session and inherit rows

Goal: Wire overlay persist callbacks to `upsertSessionMemory` / delete.
Requirements: R4, R11
Files: Modify `packages/core/src/runtime.ts` (scratchpad adapter around lines 334–365). Modify `packages/core/src/memory/session-memory-bridge.ts` if delete-by-key is missing on the bridge. Test: `packages/core/test/ptc.test.js`, `packages/core/test/agent-memory-bridge.test.js`
Approach: Persist key `ptc.{key}` with `metadata: { source: 'ptc', visibility, pin, expiresAt }`. Count existing `ptc.*` keys before insert. Read skips and deletes expired rows.
Test scenarios:
- session write appears in `listSessionMemory(sessionId, 'scratch')` as `ptc.k`.
- cell write does not.
- expired `ttlSec: 0` (or past `expiresAt`) read throws not-found and row is gone.
Verification: `node --test packages/core/test/ptc.test.js packages/core/test/agent-memory-bridge.test.js`

### U3. Keep unpinned PTC keys out of the appendix

Goal: Recall must not surface unpinned `ptc.*`.
Requirements: R5, R6
Files: Modify `packages/core/src/memory/memory-recall.ts` (`recallProgressive` workingRows). Modify `packages/core/src/session/context-compiler.ts` fallback `listSessionMemory` path. Test: `packages/core/test/memory-hybrid.test.js`, `packages/core/test/context-compiler.test.js`
Approach: One helper `isPtcAppendixEligible(entry)` in `packages/core/src/ptc/scratchpad.ts` (or a tiny `memory/ptc-recall.ts` if memory must not import ptc — prefer `packages/core/src/memory/ptc-recall-filter.ts` to avoid a memory→ptc cycle). Filter `key.startsWith('ptc.')` unless `metadata.pin === true` or, for agent_memory rows without metadata, `source === 'ptc'` is still excluded unless pin is stored. Bridge must keep `metadata` on agent-backend reads (today `agentToSessionEntry` drops metadata — fix that in this unit).
Test scenarios:
- `ptc.notes` unpinned omitted from working slot.
- pinned `ptc.notes` may appear.
- non-`ptc.` scratch still appears.
- compiler fallback `listSessionMemory` path applies the same filter.
Verification: `node --test packages/core/test/memory-hybrid.test.js packages/core/test/context-compiler.test.js`

### U4. agent inherit and summary length

Goal: Children do not inherit `ptc.*` unless asked. Summary length is controllable.
Requirements: R7, R8, R9
Files: Modify `packages/core/src/ptc/types.ts` (`PtcAgentSpec`), `packages/core/src/ptc/agent-hook.ts`, `packages/core/src/runtime/spawn-host.ts`, `packages/core/src/runtime/tool-services.ts`, `packages/core/src/session/subagent-contract.ts` (types only if needed). Test: `packages/core/test/ptc.test.js`, `packages/core/test/runtime.test.js`
Approach: Parse `inherit_scratch` / `inheritScratch` and `summary_max_chars` / `summaryMaxChars`. Pass `scratchKeyFilter` into `copySessionMemory` or filter keys after list. Default filter: copy non-`ptc.` keys only.
Test scenarios:
- default spawn after `ptc.plan` write: child list has no `ptc.plan`.
- `inherit_scratch: true`: child has `ptc.plan`.
- `inherit_scratch: ['plan']`: child has `ptc.plan` only among `ptc.*`.
- `summary_max_chars: 20`: returned content length respects the cap (use existing summary helper).
- non-PTC `spawn_subagent` still copies full scratch (regression).
Verification: `node --test packages/core/test/ptc.test.js packages/core/test/runtime.test.js`

### U5. Bound ptc_exec return

Goal: Huge cell returns do not flood the parent transcript.
Requirements: R12
Files: Modify `packages/core/src/ptc/ptc-exec-tool.ts`. Reuse U1 persist. Test: `packages/core/test/ptc.test.js`
Approach: After a successful cell, if `JSON.stringify(value)` length > 8192, write `__last_return` via the runtime persist path and set tool `content` to a stub `{ ok, spilled: true, ref: '__last_return', preview }` plus `metadata.ptc.ref`.
Test scenarios:
- small return unchanged.
- large return stub contains `ref` and persist was called with `__last_return`.
- user `scratchpad.write('__last_return', ...)` fails.
Verification: `node --test packages/core/test/ptc.test.js`

### U6. Hard replay v3 uses real scratchpad

Goal: Replay reads and writes the session scratchpad.
Requirements: R13
Files: Modify `packages/core/src/ptc/replay.ts` (`runHardReplayV3` stub around the current no-op write/read/list). Thread scratchpad deps through `RunHardReplayOpts`. Call sites that already have a session store must pass the live adapter. Test: `packages/core/test/ptc.test.js` (add a v3 replay case that writes then reads)
Approach: If opts omit scratchpad, keep a documented in-memory overlay so unit tests without a store still run. Production replay from runtime must pass the same adapter as `createPtcExecTool`.
Test scenarios:
- v3 program `scratchpad.write('k','v'); return await scratchpad.read('k')` returns the value when a persist adapter is provided.
- default test stub still does not throw on write.
Verification: `node --test packages/core/test/ptc.test.js`

### U7. Prompt and handbook

Goal: The model and humans see the same rules as the runtime.
Requirements: R15
Files: Modify `packages/core/src/model/prompt-builder.ts` (`buildPtcOrchestrationBlock`), `packages/core/src/ptc/ptc-exec-tool.ts` (tool description), `doc/PTC_DYNAMIC_WORKFLOW.md`, `doc/README.md` (link this plan). Test: `packages/core/test/prompt-builder.test.js` if it snapshots the PTC block; otherwise a small assertion in `ptc.test.js` that the block mentions `visibility` and `inherit_scratch`.
Approach: List `scratchpad.write/read/list/delete`, the three visibilities, pin, caps, `inherit_scratch`, and “return a short summary; large payloads go to scratchpad / auto-spill `__last_return`”. Do not bump `STABLE_SYSTEM_VERSION` (KTD7).
Test scenarios:
- PTC prompt contains `visibility`, `inherit_scratch`, `delete`.
- handbook cell API list matches the runtime names.
Verification: `node --test packages/core/test/prompt-builder.test.js packages/core/test/ptc.test.js`

## Verification Contract

Primary: `export PATH="/home/ubuntu/.nvm/versions/node/v22.22.2/bin:$PATH" && cd packages/core && npx tsc -b && node --test test/ptc.test.js test/memory-hybrid.test.js test/context-compiler.test.js test/agent-memory-bridge.test.js test/runtime.test.js test/prompt-builder.test.js`

Repo gate before merge: `npm run test:unit` from the workspace root (same Node with FTS5).

No e2e required: no Lab UI change.
No new i18n keys unless a Lab string is added (none planned).

## Definition of Done

- All R1–R15 are covered by a named unit and a test scenario.
- Unpinned `ptc.*` is absent from appendix tests.
- Default `agent()` does not copy `ptc.*`.
- Oversized return spills to `__last_return`.
- v3 replay can read a session key through a real adapter.
- `doc/PTC_DYNAMIC_WORKFLOW.md` Cell API matches code.
- No new `RAW_AGENT_*` keys.
- No abandoned experiment files left in `packages/core/src/ptc/`.

## Appendix

Incumbent write path: `packages/core/src/runtime.ts` prefixes `ptc.` and calls `upsertSessionMemory(..., 'scratch', ...)`.
Child copy: `packages/core/src/runtime/spawn-host.ts` `copySessionMemory(..., 'scratch')`.
Appendix: `packages/core/src/memory/memory-recall.ts` searches `session.scratch` limit 40.
Replay stub: `packages/core/src/ptc/replay.ts` `runHardReplayV3`.
Prior analysis settled: keep JS PTC; do not import recursive-llm; variable control is the first increment.
