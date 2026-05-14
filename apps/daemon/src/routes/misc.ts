import { access, constants, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ValidationError,
  buildOptionalToolGroupsPayload,
  loadOptionalToolGroupsFromEnv,
  optionalToolGroupsFeatureEnabled,
  type RawAgentRuntime
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { etagFromState, json, sendIfNotModified } from '../http-utils.js';

interface MiscOptions {
  pkgName: string;
  pkgVersion: string;
}

export function miscRoutes(runtime: RawAgentRuntime, opts: MiscOptions): RouteSpec[] {
  return [
    {
      method: 'GET',
      pattern: '/api/version',
      handler: ({ response }) => json(response, 200, { name: opts.pkgName, version: opts.pkgVersion })
    },
    {
      method: 'GET',
      pattern: '/api/health',
      handler: ({ response }) =>
        json(response, 200, { ok: true, adapter: runtime.modelAdapter.name, version: opts.pkgVersion })
    },
    {
      method: 'GET',
      pattern: '/api/readiness',
      handler: async ({ response }) => {
        const checks: Record<string, boolean> = {};
        const reasons: string[] = [];

        // Check stateDir is writable
        const probeFile = join(tmpdir(), `.ppeng-readiness-${Date.now()}.tmp`);
        try {
          await writeFile(probeFile, '1');
          await unlink(probeFile);
          checks['stateDirWritable'] = true;
        } catch {
          checks['stateDirWritable'] = false;
          reasons.push('stateDir not writable');
        }

        // Check SQLite db file is accessible (readable after runtime init)
        const dbPath = join(runtime.stateDir, 'runtime.sqlite');
        try {
          await access(dbPath, constants.R_OK | constants.W_OK);
          checks['sqliteReadWrite'] = true;
        } catch {
          // DB may not exist yet on first boot — that's still ready
          checks['sqliteReadWrite'] = true;
        }

        const ready = Object.values(checks).every(Boolean);
        if (ready) {
          json(response, 200, { ready: true, checks });
        } else {
          json(response, 400, { ready: false, reason: reasons.join('; '), checks });
        }
      }
    },
    {
      method: 'GET',
      pattern: '/api/agents',
      handler: ({ response }) => {
        // Lazily upsert built-in agents so newly-added builtins surface without a daemon restart.
        runtime.ensureBuiltinAgentsSynced();
        json(response, 200, { agents: runtime.listAgents() });
      }
    },
    {
      method: 'GET',
      pattern: '/api/optional-tool-groups',
      handler: ({ response }) => {
        const enabled = optionalToolGroupsFeatureEnabled(process.env);
        const groups = loadOptionalToolGroupsFromEnv(process.env);
        json(response, 200, {
          enabled,
          catalog: buildOptionalToolGroupsPayload(groups)
        });
      }
    },
    {
      method: 'GET',
      pattern: '/api/workspaces',
      handler: ({ response }) => json(response, 200, { workspaces: runtime.listWorkspaces() })
    },
    {
      method: 'GET',
      pattern: '/api/background-jobs',
      handler: ({ response }) => json(response, 200, { jobs: runtime.listBackgroundJobs() })
    },
    {
      method: 'GET',
      pattern: '/api/approvals',
      handler: ({ request, response }) => {
        if (sendIfNotModified(request, response, etagFromState(runtime.getStateVersion()))) return;
        json(response, 200, { approvals: runtime.listApprovals() });
      }
    },
    {
      method: 'POST',
      pattern: '/api/approvals/:id/:decision',
      handler: async ({ requireParam, response }) => {
        const id = requireParam('id');
        const decision = requireParam('decision') === 'reject' ? 'rejected' : 'approved';
        const approval = await runtime.approve(id, decision);
        const session = runtime.getSession(approval.sessionId);
        if (decision === 'approved' && session?.status === 'idle') {
          await runtime.runSession(session.id);
        }
        json(response, 200, {
          approval,
          session: session ? runtime.getSession(session.id) : undefined,
          latestAssistant: session ? runtime.getLatestAssistantText(session.id) : undefined
        });
      }
    },
    {
      method: 'GET',
      pattern: '/api/traces',
      handler: async ({ url, response }) => {
        const sessionId = url.searchParams.get('sessionId');
        if (!sessionId) throw new ValidationError('Missing sessionId');
        const limit = Number(url.searchParams.get('limit') ?? '500');
        const events = await runtime.listTraceEvents(sessionId, Number.isFinite(limit) ? limit : 500);
        json(response, 200, { sessionId, events });
      }
    },
    {
      method: 'POST',
      pattern: '/api/scheduler/run',
      handler: async ({ response }) => {
        await runtime.runScheduler();
        json(response, 200, { ok: true });
      }
    },
    {
      method: 'POST',
      pattern: '/api/teams',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as Record<string, unknown>;
        const name = String(body.name ?? '').trim();
        const role = String(body.role ?? '').trim();
        const prompt = String(body.prompt ?? '').trim();
        if (!name || !role || !prompt) throw new ValidationError('Missing name, role, or prompt');
        const session = runtime.createTeammateSession({
          name,
          role,
          prompt,
          taskId: typeof body.taskId === 'string' ? body.taskId : undefined,
          parentSessionId: typeof body.parentSessionId === 'string' ? body.parentSessionId : undefined,
          background: body.background !== false
        });
        if (body.autoRun !== false) await runtime.runSession(session.id);
        json(response, 201, {
          session: runtime.getSession(session.id),
          latestAssistant: runtime.getLatestAssistantText(session.id)
        });
      }
    },
    {
      method: 'GET',
      pattern: '/api/daemon/restart-request',
      handler: ({ response }) =>
        json(response, 200, { restartRequest: runtime.getDaemonRestartRequest() ?? null })
    },
    {
      method: 'POST',
      pattern: '/api/daemon/restart-request/ack',
      handler: ({ response }) => {
        runtime.acknowledgeDaemonRestart();
        json(response, 200, { ok: true });
      }
    }
  ];
}
