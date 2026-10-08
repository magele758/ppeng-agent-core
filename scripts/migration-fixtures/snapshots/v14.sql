-- schema v14 snapshot: before bots roster (v15)
-- seeded from 6bdad1cbf29483535571eb00f0b6f704c1cb344c by scripts/migration-fixtures/generate.mjs (regenerate, do not edit)
-- seed ids: {"version":14,"chatId":"session_61ab11873541430e87f9f4b740a40d62","taskId":"task_aef8ef2e54c54da9b3710b7d667ce801","taskSessionId":"session_23ecaa5a6b424bdb8e1d2dcc564caa21","approvalId":"approval_058039baddfc4607b7401f5687f58310"}
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
        );
INSERT INTO "agent_memory" ("id", "scope", "namespace", "key", "value", "user_id", "tenant_id", "session_id", "importance", "source", "confidence", "expires_at", "access_count", "last_access_at", "created_at", "updated_at") VALUES ('amem_d8124ae23a3547d2a74febf1fd548528', 'user.memory', 'default', 'shared-pref', 'prefers short answers (general chat)', 'u1', NULL, 'session_61ab11873541430e87f9f4b740a40d62', 0.5, NULL, 'medium', NULL, 0, '2026-10-08T08:48:48.041Z', '2026-10-08T08:48:48.041Z', '2026-10-08T08:48:48.041Z');
INSERT INTO "agent_memory" ("id", "scope", "namespace", "key", "value", "user_id", "tenant_id", "session_id", "importance", "source", "confidence", "expires_at", "access_count", "last_access_at", "created_at", "updated_at") VALUES ('amem_bb4c4e919d694c52a55c8b14c6b5eeaf', 'user.memory', 'default', 'global-pref', 'timezone UTC (no session)', 'u1', NULL, NULL, 0.5, NULL, 'medium', NULL, 0, '2026-10-08T08:48:48.042Z', '2026-10-08T08:48:48.042Z', '2026-10-08T08:48:48.042Z');
INSERT INTO "agent_memory" ("id", "scope", "namespace", "key", "value", "user_id", "tenant_id", "session_id", "importance", "source", "confidence", "expires_at", "access_count", "last_access_at", "created_at", "updated_at") VALUES ('amem_b0a4e9cd631d4cde886d8ac47c93e110', 'session.long', 'default', 'chat-long', 'plain chat long note', NULL, NULL, 'session_61ab11873541430e87f9f4b740a40d62', 0.5, NULL, 'medium', NULL, 0, '2026-10-08T08:48:48.042Z', '2026-10-08T08:48:48.042Z', '2026-10-08T08:48:48.042Z');
CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        spec_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
INSERT INTO "agents" ("id", "name", "role", "spec_json", "created_at", "updated_at") VALUES ('general', 'General', 'assistant', '{"id":"general","name":"General","role":"assistant","instructions":"General assistant.","capabilities":["tool-use"]}', '2026-10-08T08:48:48.040Z', '2026-10-08T08:48:48.040Z');
INSERT INTO "agents" ("id", "name", "role", "spec_json", "created_at", "updated_at") VALUES ('reviewer', 'Reviewer', 'reviewer', '{"id":"reviewer","name":"Reviewer","role":"reviewer","instructions":"Reviews changes.","capabilities":[]}', '2026-10-08T08:48:48.040Z', '2026-10-08T08:48:48.040Z');
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
INSERT INTO "approvals" ("id", "session_id", "tool_name", "status", "reason", "args_json", "created_at", "updated_at", "idempotency_key") VALUES ('approval_058039baddfc4607b7401f5687f58310', 'session_23ecaa5a6b424bdb8e1d2dcc564caa21', 'bash', 'pending', 'writes files', '{"command":"touch x"}', '2026-10-08T08:48:48.041Z', '2026-10-08T08:48:48.041Z', NULL);
CREATE TABLE background_jobs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        command TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
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
CREATE TABLE daemon_control (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
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
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (1, '2026-10-08T08:48:48.035Z', 'baseline (initial schema applied by storage.ts top-level DDL)');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (2, '2026-10-08T08:48:48.035Z', 'add approvals.idempotency_key');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (3, '2026-10-08T08:48:48.036Z', 'session_memory consolidation columns');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (4, '2026-10-08T08:48:48.036Z', 'agent_cases + fts for evolving / case recall');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (5, '2026-10-08T08:48:48.037Z', 'orchestration_runs / orchestration_steps / orchestration_events tables');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (6, '2026-10-08T08:48:48.037Z', 'deep research tables: tasks / sources / evidence / claims');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (7, '2026-10-08T08:48:48.037Z', 'users / tenants / memberships / agent_memory multi-layer memory tables');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (8, '2026-10-08T08:48:48.038Z', 'swarm_runs / swarm_tasks / swarm_reviews tables for Teams Swarm');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (9, '2026-10-08T08:48:48.038Z', 'migrate session_memory rows into agent_memory (session.scratch / session.long)');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (10, '2026-10-08T08:48:48.039Z', 'agent_cases status / half_life_days / expires_at for case governance');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (11, '2026-10-08T08:48:48.039Z', 'capability discovery registry (capabilities + capability_bindings)');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (12, '2026-10-08T08:48:48.039Z', 'session_messages surface algebra: seq / key / surface_op / replaces_*');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (13, '2026-10-08T08:48:48.039Z', 'session_inbox for next-step / next-run steer');
INSERT INTO "schema_version" ("version", "applied_at", "description") VALUES (14, '2026-10-08T08:48:48.040Z', 'sessions.active_writer_run_id WAL writer claim');
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
INSERT INTO "session_messages" ("id", "session_id", "role", "parts_json", "created_at", "seq", "key", "surface_op", "replaces_start", "replaces_end") VALUES ('msg_3a0787b64bf04198ab08695510f66572', 'session_61ab11873541430e87f9f4b740a40d62', 'user', '[{"type":"text","text":"list the repo files"}]', '2026-10-08T08:48:48.041Z', 1, NULL, 'append', NULL, NULL);
INSERT INTO "session_messages" ("id", "session_id", "role", "parts_json", "created_at", "seq", "key", "surface_op", "replaces_start", "replaces_end") VALUES ('msg_b08ec109cf644704902893aeca3a4e84', 'session_61ab11873541430e87f9f4b740a40d62', 'assistant', '[{"type":"text","text":"Listing."},{"type":"tool_call","toolCallId":"call_seed_1","name":"bash","input":{"command":"ls"}}]', '2026-10-08T08:48:48.041Z', 2, NULL, 'append', NULL, NULL);
INSERT INTO "session_messages" ("id", "session_id", "role", "parts_json", "created_at", "seq", "key", "surface_op", "replaces_start", "replaces_end") VALUES ('msg_35a283f89c6a4038a2c482fbd23b5574', 'session_61ab11873541430e87f9f4b740a40d62', 'tool', '[{"type":"tool_result","toolCallId":"call_seed_1","name":"bash","ok":true,"content":"README.md"}]', '2026-10-08T08:48:48.041Z', 3, NULL, 'append', NULL, NULL);
INSERT INTO "session_messages" ("id", "session_id", "role", "parts_json", "created_at", "seq", "key", "surface_op", "replaces_start", "replaces_end") VALUES ('msg_0d3612fbc41641348f77d07685c25fb4', 'session_61ab11873541430e87f9f4b740a40d62', 'assistant', '[{"type":"text","text":"One file: README.md."}]', '2026-10-08T08:48:48.041Z', 4, NULL, 'append', NULL, NULL);
INSERT INTO "session_messages" ("id", "session_id", "role", "parts_json", "created_at", "seq", "key", "surface_op", "replaces_start", "replaces_end") VALUES ('msg_034736c753ea43ea93132d285785b36f', 'session_23ecaa5a6b424bdb8e1d2dcc564caa21', 'user', '[{"type":"text","text":"review it"}]', '2026-10-08T08:48:48.041Z', 1, NULL, 'append', NULL, NULL);
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
INSERT INTO "sessions" ("id", "title", "mode", "status", "agent_id", "task_id", "workspace_id", "parent_session_id", "background", "summary", "todo_json", "metadata_json", "created_at", "updated_at", "active_writer_run_id") VALUES ('session_61ab11873541430e87f9f4b740a40d62', 'plain chat', 'chat', 'idle', 'general', NULL, NULL, NULL, 0, NULL, '[]', '{"userId":"u1"}', '2026-10-08T08:48:48.040Z', '2026-10-08T08:48:48.041Z', NULL);
INSERT INTO "sessions" ("id", "title", "mode", "status", "agent_id", "task_id", "workspace_id", "parent_session_id", "background", "summary", "todo_json", "metadata_json", "created_at", "updated_at", "active_writer_run_id") VALUES ('session_23ecaa5a6b424bdb8e1d2dcc564caa21', 'task session', 'task', 'idle', 'reviewer', 'task_aef8ef2e54c54da9b3710b7d667ce801', NULL, NULL, 0, NULL, '[]', '{}', '2026-10-08T08:48:48.041Z', '2026-10-08T08:48:48.041Z', NULL);
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
INSERT INTO "task_events" ("id", "task_id", "kind", "actor", "payload_json", "created_at") VALUES ('evt_3bd54e72ddc342b39540c4960ec9939c', 'task_aef8ef2e54c54da9b3710b7d667ce801', 'task.created', 'reviewer', '{"title":"seeded task","sessionId":null,"parentTaskId":null}', '2026-10-08T08:48:48.041Z');
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
INSERT INTO "tasks" ("id", "title", "description", "status", "owner_agent_id", "session_id", "parent_task_id", "workspace_id", "blocked_by_json", "artifacts_json", "metadata_json", "created_at", "updated_at") VALUES ('task_aef8ef2e54c54da9b3710b7d667ce801', 'seeded task', 'carry over', 'pending', 'reviewer', NULL, NULL, NULL, '[]', '[]', '{}', '2026-10-08T08:48:48.041Z', '2026-10-08T08:48:48.041Z');
CREATE TABLE tenants (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
CREATE TABLE users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE,
          display_name TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL
        );
INSERT INTO "users" ("id", "email", "display_name", "status", "created_at") VALUES ('u1', 'user-one@example.invalid', 'User One', 'active', '2026-08-01T00:00:00.000Z');
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
CREATE INDEX idx_agent_memory_expires_at ON agent_memory(expires_at);
CREATE INDEX idx_agent_memory_scope_key ON agent_memory(scope, namespace, key);
CREATE INDEX idx_agent_memory_session_id ON agent_memory(session_id);
CREATE INDEX idx_agent_memory_tenant_id ON agent_memory(tenant_id);
CREATE INDEX idx_agent_memory_user_id ON agent_memory(user_id);
CREATE INDEX idx_approvals_status ON approvals(status);
CREATE INDEX idx_bg_jobs_status ON background_jobs(status, updated_at);
CREATE INDEX idx_capabilities_kind ON capabilities(kind);
CREATE INDEX idx_capabilities_pool ON capabilities(pool);
CREATE INDEX idx_capabilities_trust ON capabilities(trust);
CREATE INDEX idx_capability_bindings_cap
          ON capability_bindings(capability_id, status);
CREATE INDEX idx_events_task ON task_events(task_id, created_at);
CREATE INDEX idx_image_assets_session ON image_assets(session_id, created_at);
CREATE INDEX idx_image_assets_sha ON image_assets(session_id, sha256);
CREATE INDEX idx_mail_to_status ON mailbox(to_agent_id, status, created_at);
CREATE INDEX idx_messages_session ON session_messages(session_id, created_at);
CREATE INDEX idx_orchestration_events_run_id ON orchestration_events(run_id);
CREATE INDEX idx_orchestration_runs_status ON orchestration_runs(status);
CREATE INDEX idx_orchestration_steps_run_id ON orchestration_steps(run_id);
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
CREATE INDEX idx_workspaces_task ON workspaces(task_id);
COMMIT;
