---- MODULE ToolCallPairing ----
\* Protocol draft for tool_call ↔ tool_result pairing
\* (packages/core/src/session/surface-invariants.ts unmatchedToolCallIds).
\* Closed transcript => no unmatched tool_call. Not a TLC proof.

EXTENDS Integers, Sequences, FiniteSets

VARIABLES openIds

TypeOK == openIds \subseteq STRING

Init == openIds = {}

Call(id) == openIds' = openIds \union {id}
Result(id) == openIds' = openIds \ {id}

Closed == openIds = {}

\* After a finished run (chat idle / task completed / waiting_approval
\* with results persisted), Closed must hold on the folded transcript.

====
