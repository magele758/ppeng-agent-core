-- schema v22 snapshot: legacy bot memory backfilled, before resource_owners (v23)
-- seeded from 67ced21d2a4a7e817e5bed2de084b34e875c4e55 by scripts/migration-fixtures/generate.mjs (regenerate, do not edit)
-- seed ids: {"version":22,"chatId":"session_beb5f5421b894c3e83e966840e0bcef0","taskId":"task_77caf9a67b244bc2bed4d7d3cc17a39d","taskSessionId":"session_86c93b8731ca4164b13d8afcab8b68e7","approvalId":"approval_1876e63155f74c17b119371c0fe36235","bots":{"researcher":{"id":"researcher","agentId":"researcher","sessionId":"session_904c2b3ea3284ebabe763299969a7616"},"planner":{"id":"planner","agentId":"planner","sessionId":"session_d434935d5eb14d0ebfa93343521cbb01"},"childSessionId":"session_93d3bdf5b4c64eaa95e140aaa0ed3c0b"}}
PRAGMA foreign_keys=OFF;
BEGIN;
CREATE TABLE agent_cases (
          id TEXT PRIMARY KEY,
          namespace TEXT,
          session_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          task_fingerprint TEXT NOT NULL,
          outcome TEXT NOT NULL CHECK(outcome IN ('success','failure','partial')),
          signals_json TEXT,
          what_worked TEXT,
          what_failed TEXT,
          pivot_hint TEXT,
          applicable_when TEXT,
          not_applicable_when TEXT,
          confidence REAL NOT NULL DEFAULT 0.5 CHECK(confidence BETWEEN 0 AND 1),
          source TEXT NOT NULL CHECK(source IN ('reviewer','manual','import')),
          embedding_json TEXT,
          recall_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          extra_json TEXT NOT NULL DEFAULT '{}'
        , status TEXT NOT NULL DEFAULT 'active', half_life_days REAL NOT NULL DEFAULT 30, expires_at TEXT);
CREATE TABLE agent_memory (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL DEFAULT 'session.scratch',
          namespace TEXT NOT NULL DEFAULT 'default',
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          user_id TEXT,
          tenant_id TEXT,
          session_id TEXT,
          importance REAL NOT NULL DEFAULT 0.5,
          source TEXT,
          confidence TEXT NOT NULL DEFAULT 'medium',
          expires_at TEXT,
          access_count INTEGER NOT NULL DEFAULT 0,
          last_access_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        , agent_id TEXT);
INSERT INTO "agent_memory" ("id", "scope", "namespace", "key", "value", "user_id", "tenant_id", "session_id", "importance", "source", "confidence", "expires_at", "access_count", "last_access_at", "created_at", "updated_at", "agent_id") VALUES ('amem_227f4b7c6a5847a3b8dcbaa763137990', 'user.memory', 'default', 'shared-pref', 'prefers short answers (general chat)', 'u1', NULL, 'session_beb5f5421b894c3e83e966840e0bcef0', 0.5, NULL, 'medium', NULL, 0, '2026-10-08T10:34:38.174Z', '2026-10-08T10:34:38.174Z', '2026-10-08T10:34:38.174Z', NULL);
INSERT INTO "agent_memory" ("id", "scope", "namespace", "key", "value", "user_id", "tenant_id", "session_id", "importance", "source", "confidence", "expires_at", "access_count", "last_access_at", "created_at", "updated_at", "agent_id") VALUES ('amem_bd8aebebe0bf4270999ff1d767e21e35', 'user.memory', 'default', 'global-pref', 'timezone UTC (no session)', 'u1', NULL, NULL, 0.5, NULL, 'medium', NULL, 0, '2026-10-08T10:34:38.174Z', '2026-10-08T10:34:38.174Z', '2026-10-08T10:34:38.174Z', NULL);
INSERT INTO "agent_memory" ("id", "scope", "namespace", "key", "value", "user_id", "tenant_id", "session_id", "importance", "source", "confidence", "expires_at", "access_count", "last_access_at", "created_at", "updated_at", "agent_id") VALUES ('amem_5cac867efa424b1e813a14eb2ae353cf', 'session.long', 'default', 'chat-long', 'plain chat long note', NULL, NULL, 'session_beb5f5421b894c3e83e966840e0bcef0', 0.5, NULL, 'medium', NULL, 0, '2026-10-08T10:34:38.175Z', '2026-10-08T10:34:38.175Z', '2026-10-08T10:34:38.175Z', NULL);
INSERT INTO "agent_memory" ("id", "scope", "namespace", "key", "value", "user_id", "tenant_id", "session_id", "importance", "source", "confidence", "expires_at", "access_count", "last_access_at", "created_at", "updated_at", "agent_id") VALUES ('amem_0f51afa0030b45baa54c96663ca567a7', 'user.memory', 'default', 'bot-pref', 'likes tea (written by Researcher)', 'u1', NULL, 'session_904c2b3ea3284ebabe763299969a7616', 0.5, NULL, 'medium', NULL, 0, '2026-10-08T10:34:38.176Z', '2026-10-08T10:34:38.176Z', '2026-10-08T10:34:38.176Z', NULL);
INSERT INTO "agent_memory" ("id", "scope", "namespace", "key", "value", "user_id", "tenant_id", "session_id", "importance", "source", "confidence", "expires_at", "access_count", "last_access_at", "created_at", "updated_at", "agent_id") VALUES ('amem_f666088f18954ed7a8357f09ffc64a57', 'user.memory', 'default', 'bot-child-pref', 'cites sources (Researcher subagent)', 'u1', NULL, 'session_93d3bdf5b4c64eaa95e140aaa0ed3c0b', 0.5, NULL, 'medium', NULL, 0, '2026-10-08T10:34:38.176Z', '2026-10-08T10:34:38.176Z', '2026-10-08T10:34:38.176Z', NULL);
INSERT INTO "agent_memory" ("id", "scope", "namespace", "key", "value", "user_id", "tenant_id", "session_id", "importance", "source", "confidence", "expires_at", "access_count", "last_access_at", "created_at", "updated_at", "agent_id") VALUES ('amem_ce7a9a1e86934fa0bf20e50a1890dda9', 'session.long', 'default', 'bot-long', 'Researcher long note', NULL, NULL, 'session_904c2b3ea3284ebabe763299969a7616', 0.5, NULL, 'medium', NULL, 0, '2026-10-08T10:34:38.176Z', '2026-10-08T10:34:38.176Z', '2026-10-08T10:34:38.176Z', NULL);
CREATE TABLE agent_memory_embedding (
          memory_id TEXT PRIMARY KEY,
          model TEXT,
          embedding_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        spec_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
INSERT INTO "agents" ("id", "name", "role", "spec_json", "created_at", "updated_at") VALUES ('general', 'General', 'assistant', '{"id":"general","name":"General","role":"assistant","instructions":"General assistant.","capabilities":["tool-use"]}', '2026-10-08T10:34:38.173Z', '2026-10-08T10:34:38.173Z');
INSERT INTO "agents" ("id", "name", "role", "spec_json", "created_at", "updated_at") VALUES ('reviewer', 'Reviewer', 'reviewer', '{"id":"reviewer","name":"Reviewer","role":"reviewer","instructions":"Reviews changes.","capabilities":[]}', '2026-10-08T10:34:38.173Z', '2026-10-08T10:34:38.173Z');
INSERT INTO "agents" ("id", "name", "role", "spec_json", "created_at", "updated_at") VALUES ('researcher', 'Researcher', 'Researcher', '{"id":"researcher","name":"Researcher","role":"Researcher","instructions":"You are Researcher.\nlegacy bot (default permission)\nYou are a named persistent teammate. Continue this conversation; do not treat it as a disposable chat.\nYou choose the execution style for each request — do not ask the user to pick Chat / Task / Orchestrator / Self-Heal / Planner / Generator / Evaluator.\nQ&A: answer directly. Multi-step or implementation: TodoWrite, tools, task_create. Cross-cutting work: orchestrate teammates or spawn_subagent. Research/plan/implement/review as the task requires.\nWhether a tool call needs approval is decided by this session''s permissionMode.\nThis is a long-lived conversation. Older turns are compacted and keyframes are kept (session cut); do not ask the user to start a new chat.","capabilities":["bot","tool-use","task-management","orchestration"],"autonomous":true,"domainId":"bot"}', '2026-10-08T10:34:38.175Z', '2026-10-08T10:34:38.175Z');
INSERT INTO "agents" ("id", "name", "role", "spec_json", "created_at", "updated_at") VALUES ('planner', 'Planner', 'Planner', '{"id":"planner","name":"Planner","role":"Planner","instructions":"You are Planner.\nlegacy bot the user moved to ask\nYou are a named persistent teammate. Continue this conversation; do not treat it as a disposable chat.\nYou choose the execution style for each request — do not ask the user to pick Chat / Task / Orchestrator / Self-Heal / Planner / Generator / Evaluator.\nQ&A: answer directly. Multi-step or implementation: TodoWrite, tools, task_create. Cross-cutting work: orchestrate teammates or spawn_subagent. Research/plan/implement/review as the task requires.\nWhether a tool call needs approval is decided by this session''s permissionMode.\nThis is a long-lived conversation. Older turns are compacted and keyframes are kept (session cut); do not ask the user to start a new chat.","capabilities":["bot","tool-use","task-management","orchestration"],"autonomous":true,"domainId":"bot"}', '2026-10-08T10:34:38.176Z', '2026-10-08T10:34:38.176Z');
CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT NOT NULL,
        args_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      , idempotency_key TEXT);
INSERT INTO "approvals" ("id", "session_id", "tool_name", "status", "reason", "args_json", "created_at", "updated_at", "idempotency_key") VALUES ('approval_1876e63155f74c17b119371c0fe36235', 'session_86c93b8731ca4164b13d8afcab8b68e7', 'bash', 'pending', 'writes files', '{"command":"touch x"}', '2026-10-08T10:34:38.174Z', '2026-10-08T10:34:38.174Z', NULL);
CREATE TABLE artifacts (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          source_tool TEXT NOT NULL,
          file_name TEXT,
          mime_type TEXT NOT NULL,
          local_rel_path TEXT NOT NULL,
          total_bytes INTEGER NOT NULL,
          total_chars INTEGER NOT NULL,
          page_size_chars INTEGER NOT NULL,
          total_pages INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
CREATE TABLE attachments (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          file_name TEXT NOT NULL,
          mime_type TEXT,
          kind TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_url TEXT,
          local_rel_path TEXT,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          status_reason TEXT,
          encoding TEXT,
          image_asset_id TEXT,
          artifact_handle TEXT,
          emit_text TEXT,
          created_at TEXT NOT NULL
        );
CREATE TABLE auth_sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
CREATE TABLE background_jobs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        command TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
CREATE TABLE bots (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          agent_id TEXT NOT NULL,
          canonical_session_id TEXT NOT NULL,
          hidden INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
INSERT INTO "bots" ("id", "name", "title", "description", "agent_id", "canonical_session_id", "hidden", "created_at", "updated_at") VALUES ('researcher', 'Researcher', 'Researcher', 'legacy bot (default permission)', 'researcher', 'session_904c2b3ea3284ebabe763299969a7616', 0, '2026-10-08T10:34:38.175Z', '2026-10-08T10:34:38.175Z');
INSERT INTO "bots" ("id", "name", "title", "description", "agent_id", "canonical_session_id", "hidden", "created_at", "updated_at") VALUES ('planner', 'Planner', 'Planner', 'legacy bot the user moved to ask', 'planner', 'session_d434935d5eb14d0ebfa93343521cbb01', 0, '2026-10-08T10:34:38.176Z', '2026-10-08T10:34:38.176Z');
CREATE TABLE capabilities (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          endpoint TEXT NOT NULL,
          transport TEXT NOT NULL DEFAULT 'https',
          schema_ref TEXT,
          schema_hash TEXT,
          trust TEXT NOT NULL DEFAULT 'untrusted',
          scope TEXT NOT NULL DEFAULT '[]',
          cred_ref TEXT,
          source TEXT NOT NULL DEFAULT 'manual',
          cbom_json TEXT,
          pool TEXT,
          tags_json TEXT,
          metadata_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
CREATE TABLE capability_bindings (
          id TEXT PRIMARY KEY,
          capability_id TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          schema_hash_pin TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          bound_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          metadata_json TEXT,
          FOREIGN KEY (capability_id) REFERENCES capabilities(id)
        );
CREATE TABLE cloud_folders (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          backend TEXT NOT NULL,
          local_path TEXT NOT NULL,
          s3_prefix TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
CREATE TABLE daemon_control (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
CREATE TABLE goal_records (
          goal_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          status TEXT NOT NULL,
          close_reason TEXT,
          spec_json TEXT NOT NULL,
          condition TEXT NOT NULL,
          turns_used INTEGER NOT NULL DEFAULT 0,
          max_turns INTEGER NOT NULL DEFAULT 25,
          missing_json TEXT,
          criteria_status_json TEXT,
          ledger_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
CREATE TABLE image_assets (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_url TEXT,
        local_rel_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        derived_from_json TEXT NOT NULL,
        retention_tier TEXT NOT NULL,
        kind TEXT NOT NULL,
        last_access_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
CREATE TABLE mailbox (
        id TEXT PRIMARY KEY,
        from_agent_id TEXT NOT NULL,
        to_agent_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        correlation_id TEXT,
        session_id TEXT,
        task_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        read_at TEXT
      );
CREATE TABLE memberships (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'member',
          PRIMARY KEY (user_id, tenant_id)
        );
CREATE TABLE memory_dream_runs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          tenant_id TEXT,
          dream_date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          facts_count INTEGER NOT NULL DEFAULT 0,
          summary TEXT,
          journal TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          UNIQUE(user_id, dream_date)
        );
CREATE TABLE memory_observations (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          session_id TEXT,
          user_id TEXT,
          agent_id TEXT,
          tenant_id TEXT,
          task_content TEXT,
          outcome TEXT,
          tools_used_json TEXT NOT NULL DEFAULT '[]',
          raw_summary TEXT,
          gate TEXT NOT NULL DEFAULT 'pending',
          gate_reason TEXT,
          written_memory_id TEXT,
          created_at TEXT NOT NULL
        );
CREATE TABLE oauth_identities (
          provider TEXT NOT NULL,
          provider_user_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          email TEXT,
          created_at TEXT NOT NULL,
          PRIMARY KEY (provider, provider_user_id)
        );
CREATE TABLE oauth_states (
          state TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          code_verifier TEXT,
          redirect_to TEXT,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
CREATE TABLE orchestration_events (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES orchestration_runs(id) ON DELETE CASCADE,
          step_id TEXT,
          kind TEXT NOT NULL,
          actor TEXT NOT NULL DEFAULT '',
          payload_json TEXT,
          created_at TEXT NOT NULL
        );
CREATE TABLE orchestration_runs (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          source_type TEXT NOT NULL DEFAULT '',
          source_ref TEXT NOT NULL DEFAULT '',
          flywheels TEXT NOT NULL DEFAULT '[]',
          capability_tags TEXT NOT NULL DEFAULT '[]',
          risk_level TEXT NOT NULL DEFAULT 'low',
          status TEXT NOT NULL DEFAULT 'pending',
          budget TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
CREATE TABLE orchestration_steps (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES orchestration_runs(id) ON DELETE CASCADE,
          stage TEXT NOT NULL,
          executor TEXT NOT NULL DEFAULT '',
          input_artifact TEXT,
          output_artifact TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          failure_type TEXT,
          next_action TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
CREATE TABLE project_roots (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          alias TEXT NOT NULL,
          path TEXT NOT NULL,
          is_primary INTEGER NOT NULL DEFAULT 0,
          UNIQUE(project_id, alias)
        );
CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
CREATE TABLE research_claims (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
          text TEXT NOT NULL,
          confidence TEXT NOT NULL DEFAULT 'medium',
          evidence_ids TEXT NOT NULL DEFAULT '[]',
          caveats TEXT,
          created_at TEXT NOT NULL
        );
CREATE TABLE research_evidence (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL REFERENCES research_sources(id) ON DELETE CASCADE,
          task_id TEXT NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
          quote TEXT NOT NULL,
          location TEXT,
          relevance REAL NOT NULL DEFAULT 0.5
        );
CREATE TABLE research_sources (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
          kind TEXT NOT NULL DEFAULT 'web',
          url TEXT,
          title TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          trust_level TEXT NOT NULL DEFAULT 'unknown'
        );
CREATE TABLE research_tasks (
          id TEXT PRIMARY KEY,
          query TEXT NOT NULL,
          scope TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          capability_tags TEXT NOT NULL DEFAULT '[]',
          report_path TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
CREATE TABLE scheduler_wake (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
CREATE TABLE schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT NOT NULL
    );
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (1, '2026-10-08T10:34:38.165Z', 'baseline (initial schema applied by storage.ts top-level DDL)');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (2, '2026-10-08T10:34:38.166Z', 'add approvals.idempotency_key');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (3, '2026-10-08T10:34:38.166Z', 'session_memory consolidation columns');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (4, '2026-10-08T10:34:38.167Z', 'agent_cases + fts for evolving / case recall');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (5, '2026-10-08T10:34:38.167Z', 'orchestration_runs / orchestration_steps / orchestration_events tables');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (6, '2026-10-08T10:34:38.167Z', 'deep research tables: tasks / sources / evidence / claims');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (7, '2026-10-08T10:34:38.168Z', 'users / tenants / memberships / agent_memory multi-layer memory tables');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (8, '2026-10-08T10:34:38.168Z', 'swarm_runs / swarm_tasks / swarm_reviews tables for Teams Swarm');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (9, '2026-10-08T10:34:38.168Z', 'migrate session_memory rows into agent_memory (session.scratch / session.long)');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (10, '2026-10-08T10:34:38.169Z', 'agent_cases status / half_life_days / expires_at for case governance');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (11, '2026-10-08T10:34:38.169Z', 'capability discovery registry (capabilities + capability_bindings)');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (12, '2026-10-08T10:34:38.169Z', 'session_messages surface algebra: seq / key / surface_op / replaces_*');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (13, '2026-10-08T10:34:38.169Z', 'session_inbox for next-step / next-run steer');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (14, '2026-10-08T10:34:38.170Z', 'sessions.active_writer_run_id WAL writer claim');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (15, '2026-10-08T10:34:38.170Z', 'bots roster + canonical session binding');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (16, '2026-10-08T10:34:38.170Z', 'user_profiles + memory_observations + memory_dream_runs + agent_memory FTS triggers');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (17, '2026-10-08T10:34:38.171Z', 'goal_records + team_plans DAG');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (18, '2026-10-08T10:34:38.171Z', 'attachments + artifacts tables for ingestion / paged artifact');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (19, '2026-10-08T10:34:38.171Z', 'projects + project_roots + cloud_folders for workspace binding');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (20, '2026-10-08T10:34:38.172Z', 'oauth identities + auth sessions + user avatar');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (21, '2026-10-08T10:34:38.172Z', 'agent_memory.agent_id isolates bot memory from shared user.memory');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (22, '2026-10-08T10:34:38.173Z', 'move pre-v21 bot memory into the bot namespace; flag bots that got bypass by default; drop FTS triggers without FTS5');
CREATE TABLE self_heal_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
CREATE TABLE self_heal_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        policy_json TEXT NOT NULL,
        task_id TEXT,
        session_id TEXT,
        workspace_id TEXT,
        worktree_branch TEXT,
        fix_iteration INTEGER NOT NULL DEFAULT 0,
        last_error_summary TEXT,
        last_test_output TEXT,
        merge_commit_sha TEXT,
        block_reason TEXT,
        stopped INTEGER NOT NULL DEFAULT 0,
        restart_requested_at TEXT,
        restart_ack_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
CREATE TABLE session_inbox (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        target TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        key TEXT,
        created_at TEXT NOT NULL,
        claimed_at TEXT
      );
CREATE TABLE session_memory (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        updated_at TEXT NOT NULL, importance REAL DEFAULT 0.5, access_count INTEGER DEFAULT 0, last_access_at TEXT, source TEXT, merged_from_json TEXT,
        UNIQUE(session_id, scope, key)
      );
CREATE TABLE session_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        parts_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        seq INTEGER,
        key TEXT,
        surface_op TEXT DEFAULT 'append',
        replaces_start INTEGER,
        replaces_end INTEGER
      );
INSERT INTO "session_messages" ("id", "session_id", "role", "parts_json", "created_at", "seq", "key", "surface_op", "replaces_start", "replaces_end") VALUES ('msg_5f8af3a21b744aceaf2c59f51d19136e', 'session_beb5f5421b894c3e83e966840e0bcef0', 'user', '[{"type":"text","text":"list the repo files"}]', '2026-10-08T10:34:38.173Z', 1, NULL, 'append', NULL, NULL);
INSERT INTO "session_messages" ("id", "session_id", "role", "parts_json", "created_at", "seq", "key", "surface_op", "replaces_start", "replaces_end") VALUES ('msg_38d438f7a9bf4018b216dcd388163637', 'session_beb5f5421b894c3e83e966840e0bcef0', 'assistant', '[{"type":"text","text":"Listing."},{"type":"tool_call","toolCallId":"call_seed_1","name":"bash","input":{"command":"ls"}}]', '2026-10-08T10:34:38.173Z', 2, NULL, 'append', NULL, NULL);
INSERT INTO "session_messages" ("id", "session_id", "role", "parts_json", "created_at", "seq", "key", "surface_op", "replaces_start", "replaces_end") VALUES ('msg_b30be52c16ef419c8eda632e4cac5650', 'session_beb5f5421b894c3e83e966840e0bcef0', 'tool', '[{"type":"tool_result","toolCallId":"call_seed_1","name":"bash","ok":true,"content":"README.md"}]', '2026-10-08T10:34:38.173Z', 3, NULL, 'append', NULL, NULL);
INSERT INTO "session_messages" ("id", "session_id", "role", "parts_json", "created_at", "seq", "key", "surface_op", "replaces_start", "replaces_end") VALUES ('msg_7c3a698bd4964d4ba4d683a5061db6c5', 'session_beb5f5421b894c3e83e966840e0bcef0', 'assistant', '[{"type":"text","text":"One file: README.md."}]', '2026-10-08T10:34:38.174Z', 4, NULL, 'append', NULL, NULL);
INSERT INTO "session_messages" ("id", "session_id", "role", "parts_json", "created_at", "seq", "key", "surface_op", "replaces_start", "replaces_end") VALUES ('msg_c43a2d7635c9489ab8db37598f4e1ce2', 'session_86c93b8731ca4164b13d8afcab8b68e7', 'user', '[{"type":"text","text":"review it"}]', '2026-10-08T10:34:38.174Z', 1, NULL, 'append', NULL, NULL);
INSERT INTO "session_messages" ("id", "session_id", "role", "parts_json", "created_at", "seq", "key", "surface_op", "replaces_start", "replaces_end") VALUES ('msg_8ddcd33c37b949bab38a55dc52102fef', 'session_904c2b3ea3284ebabe763299969a7616', 'user', '[{"type":"text","text":"remember I like tea"}]', '2026-10-08T10:34:38.176Z', 1, NULL, 'append', NULL, NULL);
CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        task_id TEXT,
        workspace_id TEXT,
        parent_session_id TEXT,
        background INTEGER NOT NULL,
        summary TEXT,
        todo_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      , active_writer_run_id TEXT);
INSERT INTO "sessions" ("id", "title", "mode", "status", "agent_id", "task_id", "workspace_id", "parent_session_id", "background", "summary", "todo_json", "metadata_json", "created_at", "updated_at", "active_writer_run_id") VALUES ('session_beb5f5421b894c3e83e966840e0bcef0', 'plain chat', 'chat', 'idle', 'general', NULL, NULL, NULL, 0, NULL, '[]', '{"userId":"u1"}', '2026-10-08T10:34:38.173Z', '2026-10-08T10:34:38.174Z', NULL);
INSERT INTO "sessions" ("id", "title", "mode", "status", "agent_id", "task_id", "workspace_id", "parent_session_id", "background", "summary", "todo_json", "metadata_json", "created_at", "updated_at", "active_writer_run_id") VALUES ('session_86c93b8731ca4164b13d8afcab8b68e7', 'task session', 'task', 'idle', 'reviewer', 'task_77caf9a67b244bc2bed4d7d3cc17a39d', NULL, NULL, 0, NULL, '[]', '{}', '2026-10-08T10:34:38.174Z', '2026-10-08T10:34:38.174Z', NULL);
INSERT INTO "sessions" ("id", "title", "mode", "status", "agent_id", "task_id", "workspace_id", "parent_session_id", "background", "summary", "todo_json", "metadata_json", "created_at", "updated_at", "active_writer_run_id") VALUES ('session_904c2b3ea3284ebabe763299969a7616', 'Bot Chat · Researcher', 'chat', 'idle', 'researcher', NULL, NULL, NULL, 0, NULL, '[]', '{"botId":"researcher","canonicalBotChat":true,"sessionCut":true,"permissionMode":"auto","maxTurns":24}', '2026-10-08T10:34:38.175Z', '2026-10-08T10:34:38.176Z', NULL);
INSERT INTO "sessions" ("id", "title", "mode", "status", "agent_id", "task_id", "workspace_id", "parent_session_id", "background", "summary", "todo_json", "metadata_json", "created_at", "updated_at", "active_writer_run_id") VALUES ('session_d434935d5eb14d0ebfa93343521cbb01', 'Bot Chat · Planner', 'chat', 'idle', 'planner', NULL, NULL, NULL, 0, NULL, '[]', '{"botId":"planner","canonicalBotChat":true,"sessionCut":true,"permissionMode":"ask","maxTurns":24,"permissionModeChangedAt":"2026-08-02T00:00:00.000Z"}', '2026-10-08T10:34:38.176Z', '2026-10-08T10:34:38.176Z', NULL);
INSERT INTO "sessions" ("id", "title", "mode", "status", "agent_id", "task_id", "workspace_id", "parent_session_id", "background", "summary", "todo_json", "metadata_json", "created_at", "updated_at", "active_writer_run_id") VALUES ('session_93d3bdf5b4c64eaa95e140aaa0ed3c0b', 'researcher subagent', 'subagent', 'idle', 'helper', NULL, NULL, 'session_904c2b3ea3284ebabe763299969a7616', 0, NULL, '[]', '{}', '2026-10-08T10:34:38.176Z', '2026-10-08T10:34:38.176Z', NULL);
CREATE TABLE swarm_reviews (
          id TEXT PRIMARY KEY,
          swarm_run_id TEXT NOT NULL REFERENCES swarm_runs(id) ON DELETE CASCADE,
          task_id TEXT NOT NULL,
          reviewer_agent_id TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'reviewer',
          scores TEXT NOT NULL DEFAULT '{}',
          passed INTEGER NOT NULL DEFAULT 0,
          feedback TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
CREATE TABLE swarm_runs (
          id TEXT PRIMARY KEY,
          goal TEXT NOT NULL,
          orchestration_run_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          strategy TEXT NOT NULL DEFAULT 'pipeline',
          budget TEXT NOT NULL DEFAULT '{"maxTeammates":3,"maxTurnsPerAgent":20,"maxDurationMs":600000}',
          quality_gate TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
CREATE TABLE swarm_tasks (
          id TEXT PRIMARY KEY,
          swarm_run_id TEXT NOT NULL REFERENCES swarm_runs(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          required_role TEXT NOT NULL DEFAULT 'implementer',
          owner_agent_id TEXT,
          capability_tags TEXT NOT NULL DEFAULT '[]',
          acceptance_criteria TEXT NOT NULL DEFAULT '[]',
          artifacts TEXT NOT NULL DEFAULT '[]',
          blocked_by TEXT NOT NULL DEFAULT '[]',
          budget TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
CREATE TABLE task_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        actor TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
INSERT INTO "task_events" ("id", "task_id", "kind", "actor", "payload_json", "created_at") VALUES ('evt_4076afeec8f74497a11cd09f04fa4b53', 'task_77caf9a67b244bc2bed4d7d3cc17a39d', 'task.created', 'reviewer', '{"title":"seeded task","sessionId":null,"parentTaskId":null}', '2026-10-08T10:34:38.174Z');
CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        owner_agent_id TEXT,
        session_id TEXT,
        parent_task_id TEXT,
        workspace_id TEXT,
        blocked_by_json TEXT NOT NULL,
        artifacts_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
INSERT INTO "tasks" ("id", "title", "description", "status", "owner_agent_id", "session_id", "parent_task_id", "workspace_id", "blocked_by_json", "artifacts_json", "metadata_json", "created_at", "updated_at") VALUES ('task_77caf9a67b244bc2bed4d7d3cc17a39d', 'seeded task', 'carry over', 'pending', 'reviewer', NULL, NULL, NULL, '[]', '[]', '{}', '2026-10-08T10:34:38.174Z', '2026-10-08T10:34:38.174Z');
CREATE TABLE team_plan_reviews (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          passed INTEGER NOT NULL DEFAULT 0,
          feedback TEXT NOT NULL DEFAULT '',
          reviewer_agent_id TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
CREATE TABLE team_plans (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          objective TEXT NOT NULL,
          status TEXT NOT NULL,
          tasks_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
CREATE TABLE tenants (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
CREATE TABLE user_profiles (
          user_id TEXT PRIMARY KEY,
          display_name TEXT,
          bio TEXT,
          facts_json TEXT NOT NULL DEFAULT '[]',
          preferences_json TEXT NOT NULL DEFAULT '[]',
          updated_at TEXT NOT NULL
        );
CREATE TABLE users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE,
          display_name TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL
        , avatar_url TEXT);
INSERT INTO "users" ("id", "email", "display_name", "status", "created_at", "avatar_url") VALUES ('u1', 'user-one@example.invalid', 'User One', 'active', '2026-08-01T00:00:00.000Z', NULL);
CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mode TEXT NOT NULL,
        source_path TEXT NOT NULL,
        root_path TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
CREATE VIRTUAL TABLE agent_cases_fts USING fts5(
          body,
          case_id UNINDEXED,
          tokenize = 'unicode61'
        );
CREATE VIRTUAL TABLE agent_memory_fts USING fts5(
            key,
            value,
            content=agent_memory,
            content_rowid=rowid
          );
INSERT INTO "agent_memory_fts"("agent_memory_fts") VALUES ('rebuild');
CREATE INDEX idx_agent_cases_agent ON agent_cases(agent_id, created_at DESC);
CREATE INDEX idx_agent_cases_namespace ON agent_cases(namespace, agent_id);
CREATE INDEX idx_agent_cases_session ON agent_cases(session_id);
CREATE INDEX idx_agent_cases_status ON agent_cases(status, agent_id);
CREATE INDEX idx_agent_memory_agent_id ON agent_memory(agent_id);
CREATE INDEX idx_agent_memory_expires_at ON agent_memory(expires_at);
CREATE INDEX idx_agent_memory_scope_key ON agent_memory(scope, namespace, key);
CREATE INDEX idx_agent_memory_session_id ON agent_memory(session_id);
CREATE INDEX idx_agent_memory_tenant_id ON agent_memory(tenant_id);
CREATE INDEX idx_agent_memory_user_id ON agent_memory(user_id);
CREATE INDEX idx_approvals_status ON approvals(status);
CREATE INDEX idx_artifacts_session ON artifacts(session_id, created_at);
CREATE INDEX idx_attachments_session ON attachments(session_id, created_at);
CREATE INDEX idx_auth_sessions_expires ON auth_sessions(expires_at);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX idx_bg_jobs_status ON background_jobs(status, updated_at);
CREATE INDEX idx_bots_canonical_session ON bots(canonical_session_id);
CREATE INDEX idx_bots_hidden ON bots(hidden);
CREATE UNIQUE INDEX idx_bots_name_nocase ON bots(name COLLATE NOCASE);
CREATE INDEX idx_capabilities_kind ON capabilities(kind);
CREATE INDEX idx_capabilities_pool ON capabilities(pool);
CREATE INDEX idx_capabilities_trust ON capabilities(trust);
CREATE INDEX idx_capability_bindings_cap
          ON capability_bindings(capability_id, status);
CREATE INDEX idx_events_task ON task_events(task_id, created_at);
CREATE INDEX idx_goal_records_session
          ON goal_records(session_id, updated_at DESC);
CREATE INDEX idx_goal_records_status
          ON goal_records(status);
CREATE INDEX idx_image_assets_session ON image_assets(session_id, created_at);
CREATE INDEX idx_image_assets_sha ON image_assets(session_id, sha256);
CREATE INDEX idx_mail_to_status ON mailbox(to_agent_id, status, created_at);
CREATE INDEX idx_memory_dream_user ON memory_dream_runs(user_id, dream_date);
CREATE INDEX idx_memory_obs_session ON memory_observations(session_id, created_at DESC);
CREATE INDEX idx_memory_obs_user ON memory_observations(user_id, created_at DESC);
CREATE INDEX idx_messages_session ON session_messages(session_id, created_at);
CREATE INDEX idx_oauth_identities_user ON oauth_identities(user_id);
CREATE INDEX idx_orchestration_events_run_id ON orchestration_events(run_id);
CREATE INDEX idx_orchestration_runs_status ON orchestration_runs(status);
CREATE INDEX idx_orchestration_steps_run_id ON orchestration_steps(run_id);
CREATE INDEX idx_project_roots_project ON project_roots(project_id);
CREATE INDEX idx_research_claims_task_id ON research_claims(task_id);
CREATE INDEX idx_research_evidence_task_id ON research_evidence(task_id);
CREATE INDEX idx_research_sources_task_id ON research_sources(task_id);
CREATE INDEX idx_research_tasks_status ON research_tasks(status);
CREATE INDEX idx_scheduler_wake_created ON scheduler_wake(created_at ASC);
CREATE INDEX idx_self_heal_events_run ON self_heal_events(run_id, created_at);
CREATE INDEX idx_self_heal_runs_status ON self_heal_runs(status, updated_at);
CREATE INDEX idx_session_inbox_claim
        ON session_inbox(session_id, target, claimed_at);
CREATE INDEX idx_session_memory_session ON session_memory(session_id, scope);
CREATE INDEX idx_session_messages_key ON session_messages(session_id, key);
CREATE UNIQUE INDEX idx_session_messages_seq ON session_messages(session_id, seq);
CREATE INDEX idx_sessions_agent ON sessions(agent_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_swarm_reviews_run_id ON swarm_reviews(swarm_run_id);
CREATE INDEX idx_swarm_runs_status ON swarm_runs(status);
CREATE INDEX idx_swarm_tasks_run_id ON swarm_tasks(swarm_run_id);
CREATE INDEX idx_swarm_tasks_status ON swarm_tasks(status);
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_team_plan_reviews_plan ON team_plan_reviews(plan_id);
CREATE INDEX idx_team_plans_session ON team_plans(session_id);
CREATE INDEX idx_team_plans_status ON team_plans(status);
CREATE INDEX idx_workspaces_task ON workspaces(task_id);
CREATE TRIGGER agent_memory_ad AFTER DELETE ON agent_memory BEGIN
            INSERT INTO agent_memory_fts(agent_memory_fts, rowid, key, value)
              VALUES('delete', old.rowid, old.key, old.value);
          END;
CREATE TRIGGER agent_memory_ai AFTER INSERT ON agent_memory BEGIN
            INSERT INTO agent_memory_fts(rowid, key, value) VALUES (new.rowid, new.key, new.value);
          END;
CREATE TRIGGER agent_memory_au AFTER UPDATE ON agent_memory BEGIN
            INSERT INTO agent_memory_fts(agent_memory_fts, rowid, key, value)
              VALUES('delete', old.rowid, old.key, old.value);
            INSERT INTO agent_memory_fts(rowid, key, value) VALUES (new.rowid, new.key, new.value);
          END;
COMMIT;
