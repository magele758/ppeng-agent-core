---- MODULE GoalStateMachine ----
\* Protocol draft mirroring packages/core/src/goal/goal-state-machine.ts
\* Not a proof of the TypeScript implementation. yarn/npm test:formal does not run TLC.

EXTENDS Integers

Statuses == {"deriving", "active", "waiting_user", "unmet_closed", "achieved"}
Events == {
  "derive_ok", "derive_failed", "turn", "need_user", "met",
  "exhausted", "superseded", "aborted", "stalled",
  "needs_user_unattended", "user_reply", "resume"
}

\* LEGAL edges (must stay in sync with listGoalTransitions()):
\* deriving --derive_ok--> active
\* deriving --derive_failed--> unmet_closed
\* deriving --aborted--> unmet_closed
\* active --turn--> active
\* active --need_user--> waiting_user
\* active --met--> achieved
\* active --exhausted--> unmet_closed
\* active --superseded--> unmet_closed
\* active --aborted--> unmet_closed
\* active --stalled--> unmet_closed
\* active --needs_user_unattended--> unmet_closed
\* waiting_user --user_reply--> active
\* waiting_user --aborted--> unmet_closed
\* unmet_closed --resume--> active

NextStatus(from, event) ==
  CASE from = "deriving" /\ event = "derive_ok" -> "active"
    [] from = "deriving" /\ event \in {"derive_failed", "aborted"} -> "unmet_closed"
    [] from = "active" /\ event = "turn" -> "active"
    [] from = "active" /\ event = "need_user" -> "waiting_user"
    [] from = "active" /\ event = "met" -> "achieved"
    [] from = "active" /\ event \in {"exhausted", "superseded", "aborted", "stalled", "needs_user_unattended"} -> "unmet_closed"
    [] from = "waiting_user" /\ event = "user_reply" -> "active"
    [] from = "waiting_user" /\ event = "aborted" -> "unmet_closed"
    [] from = "unmet_closed" /\ event = "resume" -> "active"
    [] OTHER -> from

VARIABLES status

TypeOK == status \in Statuses

Init == status = "deriving"

Next == \E e \in Events:
  LET nxt == NextStatus(status, e)
  IN nxt # status \/ (status = "active" /\ e = "turn")
     => status' = nxt

AchievedTerminal == status = "achieved" => status' = "achieved"

====
