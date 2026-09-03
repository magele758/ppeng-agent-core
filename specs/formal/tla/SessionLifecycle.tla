---- MODULE SessionLifecycle ----
\* Protocol draft mirroring packages/core/src/formal/session-lifecycle.ts
\* Observed L5 statuses. Not a TLC proof. test:formal does not run TLC.

Statuses == {"idle", "running", "waiting_approval", "completed", "failed"}
Events == {"start", "end_chat", "end_task", "need_approval", "resume", "fail", "abort"}

\* LEGAL edges (must stay in sync with listSessionTransitions()):
\* idle --start--> running
\* running --end_chat--> idle
\* running --end_task--> completed
\* running --need_approval--> waiting_approval
\* running --fail--> failed
\* running --abort--> idle
\* waiting_approval --resume--> running
\* waiting_approval --abort--> idle
\* waiting_approval --fail--> failed

NextStatus(from, event) ==
  CASE from = "idle" /\ event = "start" -> "running"
    [] from = "running" /\ event = "end_chat" -> "idle"
    [] from = "running" /\ event = "end_task" -> "completed"
    [] from = "running" /\ event = "need_approval" -> "waiting_approval"
    [] from = "running" /\ event = "fail" -> "failed"
    [] from = "running" /\ event = "abort" -> "idle"
    [] from = "waiting_approval" /\ event = "resume" -> "running"
    [] from = "waiting_approval" /\ event = "abort" -> "idle"
    [] from = "waiting_approval" /\ event = "fail" -> "failed"
    [] OTHER -> from

VARIABLES status

TypeOK == status \in Statuses

Init == status = "idle"

Terminal == status \in {"completed", "failed"} => status' = status

====
