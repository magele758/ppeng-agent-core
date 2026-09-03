import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AppError,
  applyUnboundTaskModePatch,
  applyUnboundWorkspaceBindingPatch,
  buildSessionModelView,
  describePermissionMode,
  errorMessage,
  filterSessionsByQuery,
  mergeModelRefMetadata,
  NotFoundError,
  parseModelRef,
  parseTaskMode,
  parseWorkspaceBinding,
  ConflictError,
  ptcMetadataPatchFromInput,
  resolveBotIdFromBody,
  retrieveSessionToolResult,
  storedToolResultToJson,
  ValidationError,
  upsertGoalFromApi,
  type ModelStreamChunk,
  type RawAgentRuntime,
  type SessionRecord
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { etagFromState, json, sendIfNotModified, sseInit, sseSend } from '../http-utils.js';
import { steerHttpFromCoreAck } from '../steer-ack.js';
import { readLoopSettings } from '../loop-settings.js';
import { assertWorkspaceBindingRefs } from './workspace.js';

function imageAssetIdsFromBody(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body.imageAssetIds)) return [];
  return body.imageAssetIds.map(String).filter(Boolean);
}

function attachmentIdsFromBody(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body.attachmentIds)) return [];
  return body.attachmentIds.map(String).filter(Boolean);
}

function sessionMetadataFromBody(
  runtime: RawAgentRuntime,
  body: Record<string, unknown>
): Record<string, unknown> {
  const extra =
    body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? { ...(body.metadata as Record<string, unknown>) }
      : {};
  if (Array.isArray(body.enabledOptionalToolGroups)) {
    extra.enabledOptionalToolGroups = body.enabledOptionalToolGroups.map(String).filter(Boolean);
  }
  Object.assign(extra, ptcMetadataPatchFromInput(body));
  if (!parseTaskMode(extra.taskRunMode)) {
    extra.taskRunMode = readLoopSettings(runtime.store).defaultTaskMode;
  }
  if (typeof extra.skillScope !== 'string') {
    extra.skillScope = readLoopSettings(runtime.store).defaultSkillScope;
  }
  const binding = parseWorkspaceBinding(body.workspaceBinding ?? extra.workspaceBinding);
  if (binding) {
    assertWorkspaceBindingRefs(runtime, binding);
    extra.workspaceBinding = binding;
  }
  return mergeModelRefMetadata(runtime.store, extra, body);
}

function maybeMergeOptionalGroupsFromBody(
  runtime: RawAgentRuntime,
  sessionId: string,
  body: Record<string, unknown>
): void {
  if (Array.isArray(body.enabledOptionalToolGroups)) {
    runtime.mergeSessionMetadata(sessionId, {
      enabledOptionalToolGroups: body.enabledOptionalToolGroups.map(String).filter(Boolean)
    });
  }
  const ptcPatch = ptcMetadataPatchFromInput(body);
  if (Object.keys(ptcPatch).length > 0) {
    const session = runtime.getSession(sessionId);
    const incomingMode = parseTaskMode(ptcPatch.taskRunMode);
    const bind = applyUnboundTaskModePatch(session?.metadata, incomingMode);
    if (bind.ok) {
      const { taskRunMode: _ignored, ...rest } = ptcPatch;
      runtime.mergeSessionMetadata(sessionId, { ...rest, ...bind.patch });
    }
  }
  const modelRef = parseModelRef(body.modelRef) ?? parseModelRef(body);
  if (modelRef) {
    runtime.mergeSessionMetadata(sessionId, { modelRef });
  }
}

/** Open canonical Bot Chat and apply session metadata from the request body. */
function openBotFromBody(
  runtime: RawAgentRuntime,
  body: Record<string, unknown>
): { sessionId: string } | undefined {
  const botId = resolveBotIdFromBody(body);
  if (!botId) return undefined;
  const opened = runtime.openBot(botId);
  const extra = sessionMetadataFromBody(runtime, body);
  if (Object.keys(extra).length > 0) {
    runtime.mergeSessionMetadata(opened.sessionId, extra);
  }
  return { sessionId: opened.sessionId };
}

function hasUserContent(body: Record<string, unknown>): boolean {
  const message = typeof body.message === 'string' && body.message.trim();
  return (
    Boolean(message) ||
    imageAssetIdsFromBody(body).length > 0 ||
    attachmentIdsFromBody(body).length > 0
  );
}

function sendBodyContentToSession(
  runtime: RawAgentRuntime,
  sessionId: string,
  body: Record<string, unknown>
): void {
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const imgIds = imageAssetIdsFromBody(body);
  const attIds = attachmentIdsFromBody(body);
  maybeMergeOptionalGroupsFromBody(runtime, sessionId, body);
  runtime.sendUserMessage(sessionId, message || (imgIds.length ? '(image)' : '(attachment)'), {
    imageAssetIds: imgIds,
    attachmentIds: attIds
  });
}

function teamLinksAndRoots(sessions: SessionRecord[]): {
  roots: SessionRecord[];
  links: Array<{ parentId: string; childId: string }>;
} {
  const ids = new Set(sessions.map((s) => s.id));
  const links = sessions
    .filter((s) => s.parentSessionId && ids.has(s.parentSessionId))
    .map((s) => ({ parentId: s.parentSessionId as string, childId: s.id }));
  const roots = sessions.filter((s) => !s.parentSessionId || !ids.has(s.parentSessionId));
  return { roots, links };
}

function collectDescendants(sessions: SessionRecord[], rootId: string): SessionRecord[] {
  const byParent = new Map<string, SessionRecord[]>();
  for (const s of sessions) {
    if (!s.parentSessionId) continue;
    const arr = byParent.get(s.parentSessionId) ?? [];
    arr.push(s);
    byParent.set(s.parentSessionId, arr);
  }
  const out: SessionRecord[] = [];
  const stack = [...(byParent.get(rootId) ?? [])];
  while (stack.length) {
    const s = stack.pop()!;
    out.push(s);
    for (const c of byParent.get(s.id) ?? []) stack.push(c);
  }
  return out;
}

/** Compact counts for terminals / dashboards (long-running team + mailbox backlog). */
function buildTeamOverviewPulse(
  sessions: SessionRecord[],
  pendingMailbox: { total: number; byRecipientAgentId: Record<string, number> }
): {
  sessionCount: number;
  byStatus: Partial<Record<SessionRecord['status'], number>>;
  byMode: Partial<Record<SessionRecord['mode'], number>>;
  pendingMailboxTotal: number;
  sessionIdsWithPendingMailbox: string[];
  pendingMailboxByRecipientAgentId: Record<string, number>;
} {
  const byStatus: Partial<Record<SessionRecord['status'], number>> = {};
  const byMode: Partial<Record<SessionRecord['mode'], number>> = {};
  for (const s of sessions) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    byMode[s.mode] = (byMode[s.mode] ?? 0) + 1;
  }
  const sessionIdsWithPendingMailbox = sessions
    .filter((s) => (pendingMailbox.byRecipientAgentId[s.agentId] ?? 0) > 0)
    .map((s) => s.id);
  return {
    sessionCount: sessions.length,
    byStatus,
    byMode,
    pendingMailboxTotal: pendingMailbox.total,
    sessionIdsWithPendingMailbox,
    pendingMailboxByRecipientAgentId: pendingMailbox.byRecipientAgentId
  };
}

async function streamRun(
  runtime: RawAgentRuntime,
  response: ServerResponse<IncomingMessage>,
  sessionId: string
) {
  sseInit(response);
  try {
    await runtime.runSession(sessionId, {
      onModelStreamChunk: (chunk: ModelStreamChunk) => sseSend(response, 'model', chunk),
      steerDrainPolicy: readLoopSettings(runtime.store).steerDrainPolicy
    });
    sseSend(response, 'result', {
      session: runtime.getSession(sessionId),
      latestAssistant: runtime.getLatestAssistantText(sessionId)
    });
  } catch (error) {
    sseSend(response, 'error', { message: error instanceof Error ? error.message : String(error) });
  }
  response.end();
}

export function sessionsRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  return [
    // GET /api/sessions  (ETag-conditional for cheap polling)
    {
      method: 'GET',
      pattern: '/api/sessions',
      handler: ({ request, response, url }) => {
        const q = url.searchParams.get('q') ?? '';
        if (!q.trim() && sendIfNotModified(request, response, etagFromState(runtime.getStateVersion()))) return;
        const sessions = filterSessionsByQuery(runtime.listSessions(), q);
        json(response, 200, { sessions });
      }
    },

    // POST /api/sessions/bulk-delete — must be registered before /:id
    {
      method: 'POST',
      pattern: '/api/sessions/bulk-delete',
      handler: async ({ readBody, response }) => {
        const body = ((await readBody()) ?? {}) as Record<string, unknown>;
        const raw = Array.isArray(body.ids) ? body.ids : [];
        const ids = [...new Set(raw.map((v) => String(v).trim()).filter(Boolean))];
        if (!ids.length) throw new ValidationError('ids is required');
        json(response, 200, runtime.deleteSessions(ids));
      }
    },

    // POST /api/sessions
    {
      method: 'POST',
      pattern: '/api/sessions',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as Record<string, unknown>;
        const mode = body.mode === 'task' ? 'task' : 'chat';
        if (mode === 'task') {
          const result = runtime.createTaskSession({
            title: String(body.title ?? body.message ?? 'Task Session'),
            description: typeof body.description === 'string' ? body.description : undefined,
            message: typeof body.message === 'string' ? body.message : undefined,
            imageAssetIds: imageAssetIdsFromBody(body),
            attachmentIds: attachmentIdsFromBody(body),
            agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
            blockedBy: Array.isArray(body.blockedBy) ? body.blockedBy.map(String) : undefined,
            background: body.background !== false,
            metadata: sessionMetadataFromBody(runtime, body)
          });
          if (body.autoRun !== false) await runtime.runSession(result.session.id);
          json(response, 201, {
            session: runtime.getSession(result.session.id),
            task: runtime.getTask(result.task.id),
            latestAssistant: runtime.getLatestAssistantText(result.session.id)
          });
          return;
        }
        const openedBot = openBotFromBody(runtime, body);
        if (openedBot) {
          const hasContent = hasUserContent(body);
          if (hasContent) {
            sendBodyContentToSession(runtime, openedBot.sessionId, body);
          }
          if (body.autoRun !== false && hasContent) await runtime.runSession(openedBot.sessionId);
          json(response, 201, {
            session: runtime.getSession(openedBot.sessionId),
            latestAssistant: runtime.getLatestAssistantText(openedBot.sessionId)
          });
          return;
        }
        const session = runtime.createChatSession({
          title: typeof body.title === 'string' ? body.title : 'Chat Session',
          message: typeof body.message === 'string' ? body.message : undefined,
          imageAssetIds: imageAssetIdsFromBody(body),
          attachmentIds: attachmentIdsFromBody(body),
          agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
          background: body.background === true,
          metadata: sessionMetadataFromBody(runtime, body)
        });
        const hasContent =
          (typeof body.message === 'string' && body.message.trim()) ||
          imageAssetIdsFromBody(body).length > 0 ||
          attachmentIdsFromBody(body).length > 0;
        if (body.autoRun !== false && hasContent) await runtime.runSession(session.id);
        json(response, 201, {
          session: runtime.getSession(session.id),
          latestAssistant: runtime.getLatestAssistantText(session.id)
        });
      }
    },

    // GET /api/sessions/team-overview — read-only forest for terminals / plugins
    {
      method: 'GET',
      pattern: '/api/sessions/team-overview',
      handler: ({ request, response }) => {
        if (sendIfNotModified(request, response, etagFromState(runtime.getStateVersion()))) return;
        const sessions = runtime.listSessions();
        const { roots, links } = teamLinksAndRoots(sessions);
        const pendingMailbox = runtime.countPendingMailboxByRecipient();
        json(response, 200, {
          sessions,
          rootIds: roots.map((r) => r.id),
          links,
          pulse: buildTeamOverviewPulse(sessions, pendingMailbox)
        });
      }
    },

    // GET /api/sessions/:id/team — subtree under a session (teammates / subagents)
    {
      method: 'GET',
      pattern: '/api/sessions/:id/team',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        const root = runtime.getSession(id);
        if (!root) throw new NotFoundError('Session');
        const all = runtime.listSessions();
        const direct = all.filter((s) => s.parentSessionId === id);
        const descendants = collectDescendants(all, id);
        json(response, 200, {
          root,
          directChildren: direct,
          descendants
        });
      }
    },

    // GET /api/sessions/:id/model-view — read-only micro-compact preview (no writes)
    {
      method: 'GET',
      pattern: '/api/sessions/:id/model-view',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        const session = runtime.getSession(id);
        if (!session) throw new NotFoundError('Session');
        const stored = runtime.getSessionMessages(session.id);
        json(
          response,
          200,
          buildSessionModelView({
            messages: stored,
            store: runtime.store,
            env: process.env
          })
        );
      }
    },

    // GET /api/sessions/:id/tool-results/:messageId — stored tool_result (not the model-view stub)
    {
      method: 'GET',
      pattern: '/api/sessions/:id/tool-results/:messageId',
      handler: ({ requireParam, url, response }) => {
        const sessionId = requireParam('id');
        const messageId = requireParam('messageId');
        const partRaw = url.searchParams.get('part');
        const seqRaw = url.searchParams.get('seq');
        const partIndex =
          partRaw !== null && partRaw !== ''
            ? Number.parseInt(partRaw, 10)
            : undefined;
        const seq = seqRaw !== null && seqRaw !== '' ? Number.parseInt(seqRaw, 10) : undefined;
        if (partRaw && (partIndex === undefined || !Number.isFinite(partIndex))) {
          throw new ValidationError('part must be an integer');
        }
        if (seqRaw && (seq === undefined || !Number.isFinite(seq))) {
          throw new ValidationError('seq must be an integer');
        }
        const row = retrieveSessionToolResult(runtime.store, sessionId, {
          messageId,
          partIndex,
          seq
        });
        json(response, 200, storedToolResultToJson(row));
      }
    },

    // DELETE /api/sessions/:id
    {
      method: 'DELETE',
      pattern: '/api/sessions/:id',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        if (!runtime.deleteSession(id)) throw new NotFoundError('Session');
        json(response, 200, { ok: true, id });
      }
    },

    // GET /api/sessions/:id
    {
      method: 'GET',
      pattern: '/api/sessions/:id',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        const session = runtime.getSession(id);
        if (!session) throw new NotFoundError('Session');
        const task = session.taskId ? runtime.getTask(session.taskId) : undefined;
        json(response, 200, {
          session,
          task,
          messages: runtime.getSessionMessages(session.id),
          latestAssistant: runtime.getLatestAssistantText(session.id),
          inbox: runtime.store.listUnclaimedInbox(session.id)
        });
      }
    },

    // PATCH /api/sessions/:id — merge metadata (e.g. enabledOptionalToolGroups, permissionMode, goal*)
    {
      method: 'PATCH',
      pattern: '/api/sessions/:id',
      handler: async ({ requireParam, readBody, response }) => {
        const id = requireParam('id');
        const body = (await readBody()) as Record<string, unknown>;
        if (Array.isArray(body.enabledOptionalToolGroups)) {
          runtime.mergeSessionMetadata(id, {
            enabledOptionalToolGroups: body.enabledOptionalToolGroups.map(String).filter(Boolean)
          });
        }
        const ptcPatch = ptcMetadataPatchFromInput(body);
        if (Object.keys(ptcPatch).length > 0) {
          const session = runtime.getSession(id);
          const incomingMode = parseTaskMode(ptcPatch.taskRunMode);
          const bind = applyUnboundTaskModePatch(session?.metadata, incomingMode);
          if (!bind.ok) {
            throw new ConflictError(
              `taskRunMode is write-once; session bound to ${bind.bound}`
            );
          }
          const { taskRunMode: _ignored, ...rest } = ptcPatch;
          runtime.mergeSessionMetadata(id, { ...rest, ...bind.patch });
        }
        const goalPatch: Record<string, unknown> = {};
        if (typeof body.goalCondition === 'string') {
          const cond = body.goalCondition.trim();
          goalPatch.goalCondition = cond;
          goalPatch.goalEnabled = cond.length > 0;
        }
        if (typeof body.goalEnabled === 'boolean') {
          goalPatch.goalEnabled = body.goalEnabled;
          if (!body.goalEnabled) goalPatch.goalCondition = '';
        }
        if (typeof body.goalMaxTurns === 'number' && Number.isFinite(body.goalMaxTurns)) {
          goalPatch.goalMaxTurns = Math.max(1, Math.min(100, Math.floor(body.goalMaxTurns)));
        }
        if (Object.keys(goalPatch).length > 0) {
          runtime.mergeSessionMetadata(id, goalPatch);
          const cond = typeof goalPatch.goalCondition === 'string' ? goalPatch.goalCondition.trim() : '';
          if (cond) {
            try {
              upsertGoalFromApi(runtime.store.goal(), {
                sessionId: id,
                condition: cond,
                maxTurns:
                  typeof goalPatch.goalMaxTurns === 'number' ? goalPatch.goalMaxTurns : undefined
              });
            } catch {
              /* fail-soft */
            }
          }
        }
        if (body.workspaceBinding !== undefined) {
          const incoming =
            body.workspaceBinding === null
              ? { kind: 'default' as const }
              : parseWorkspaceBinding(body.workspaceBinding);
          if (!incoming) {
            throw new ValidationError('Invalid workspaceBinding');
          }
          if (incoming.kind !== 'default') {
            assertWorkspaceBindingRefs(runtime, incoming);
          }
          const session = runtime.getSession(id);
          const bind = applyUnboundWorkspaceBindingPatch(session?.metadata, incoming);
          if (!bind.ok) {
            throw new ConflictError(
              `workspaceBinding is write-once; session bound to ${bind.bound.kind}`
            );
          }
          runtime.mergeSessionMetadata(id, bind.patch);
        }
        const modelRef = parseModelRef(body.modelRef) ?? parseModelRef(body);
        if (modelRef) {
          runtime.mergeSessionMetadata(id, { modelRef });
        }
        const sessionPatch: Partial<Omit<SessionRecord, 'id' | 'createdAt'>> = {};
        if (typeof body.agentId === 'string' && body.agentId.trim()) {
          sessionPatch.agentId = body.agentId.trim();
        }
        if (body.mode === 'chat' || body.mode === 'task' || body.mode === 'subagent' || body.mode === 'teammate') {
          sessionPatch.mode = body.mode;
        }
        if (Object.keys(sessionPatch).length > 0) {
          runtime.store.updateSession(id, sessionPatch);
        }
        if (typeof body.permissionMode === 'string' || body.shiftPermission === 'elevate' || body.shiftPermission === 'demote') {
          const result = runtime.setPermissionMode(id, {
            mode: typeof body.permissionMode === 'string' ? body.permissionMode : undefined,
            shift:
              body.shiftPermission === 'elevate' || body.shiftPermission === 'demote'
                ? body.shiftPermission
                : undefined
          });
          json(response, 200, {
            session: runtime.getSession(id),
            permission: result
          });
          return;
        }
        const session = runtime.getSession(id);
        if (!session) throw new NotFoundError('Session');
        json(response, 200, { session });
      }
    },

    // GET /api/sessions/:id/permission — explain current mode
    {
      method: 'GET',
      pattern: '/api/sessions/:id/permission',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        const mode = runtime.getPermissionMode(id);
        json(response, 200, {
          sessionId: id,
          mode,
          description: describePermissionMode(mode)
        });
      }
    },

    // POST /api/sessions/:id/permission — set or elevate/demote
    {
      method: 'POST',
      pattern: '/api/sessions/:id/permission',
      handler: async ({ requireParam, readBody, response }) => {
        const id = requireParam('id');
        const body = (await readBody()) as Record<string, unknown>;
        const result = runtime.setPermissionMode(id, {
          mode: typeof body.mode === 'string' ? body.mode : undefined,
          shift: body.shift === 'elevate' || body.shift === 'demote' ? body.shift : undefined
        });
        json(response, 200, { permission: result, session: runtime.getSession(id) });
      }
    },

    // POST /api/sessions/:id/messages
    {
      method: 'POST',
      pattern: '/api/sessions/:id/messages',
      handler: async ({ readBody, requireParam, response }) => {
        const id = requireParam('id');
        const body = (await readBody()) as Record<string, unknown>;
        const message = String(body.message ?? '').trim();
        const imgIds = imageAssetIdsFromBody(body);
        const attIds = attachmentIdsFromBody(body);
        if (!message && imgIds.length === 0 && attIds.length === 0) {
          throw new ValidationError('Missing message, imageAssetIds, or attachmentIds');
        }
        maybeMergeOptionalGroupsFromBody(runtime, id, body);
        runtime.sendUserMessage(id, message || (imgIds.length ? '(image)' : '(attachment)'), {
          imageAssetIds: imgIds,
          attachmentIds: attIds
        });
        if (body.autoRun !== false) await runtime.runSession(id);
        json(response, 200, {
          session: runtime.getSession(id),
          latestAssistant: runtime.getLatestAssistantText(id),
          messages: runtime.getSessionMessages(id)
        });
      }
    },

    // POST /api/sessions/:id/run
    {
      method: 'POST',
      pattern: '/api/sessions/:id/run',
      handler: async ({ requireParam, response }) => {
        const id = requireParam('id');
        const session = await runtime.runSession(id, {
          steerDrainPolicy: readLoopSettings(runtime.store).steerDrainPolicy
        });
        json(response, 200, {
          session,
          latestAssistant: runtime.getLatestAssistantText(id),
          messages: runtime.getSessionMessages(id)
        });
      }
    },

    // POST /api/sessions/:id/stream
    {
      method: 'POST',
      pattern: '/api/sessions/:id/stream',
      handler: async ({ requireParam, readBody, response }) => {
        const id = requireParam('id');
        const body = (await readBody()) as Record<string, unknown>;
        const msg = typeof body.message === 'string' ? body.message.trim() : '';
        const imgIds = imageAssetIdsFromBody(body);
        const attIds = attachmentIdsFromBody(body);
        maybeMergeOptionalGroupsFromBody(runtime, id, body);
        if (msg || imgIds.length > 0 || attIds.length > 0) {
          runtime.sendUserMessage(id, msg || (imgIds.length ? '(image)' : '(attachment)'), {
            imageAssetIds: imgIds,
            attachmentIds: attIds
          });
        }
        await streamRun(runtime, response, id);
      }
    },

    // POST /api/sessions/:id/cancel
    {
      method: 'POST',
      pattern: '/api/sessions/:id/cancel',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        runtime.cancelSession(id);
        json(response, 200, { ok: true, sessionId: id });
      }
    },

    // POST /api/sessions/:id/fork — copy closed WAL prefix; open turn → 409
    {
      method: 'POST',
      pattern: '/api/sessions/:id/fork',
      handler: async ({ requireParam, readBody, response }) => {
        const id = requireParam('id');
        const body = ((await readBody()) ?? {}) as Record<string, unknown>;
        const boundarySeq =
          typeof body.boundarySeq === 'number' && Number.isFinite(body.boundarySeq)
            ? body.boundarySeq
            : undefined;
        const title = typeof body.title === 'string' ? body.title : undefined;
        const result = runtime.forkSession(id, { boundarySeq, title });
        json(response, 201, {
          session: result.session,
          seedSeq: result.seedSeq,
          copied: result.copied
        });
      }
    },

    // POST /api/sessions/:id/steer — next-shot inbox; does not mutate in-flight request
    {
      method: 'POST',
      pattern: '/api/sessions/:id/steer',
      handler: async ({ requireParam, readBody, response }) => {
        const id = requireParam('id');
        const body = (await readBody()) as Record<string, unknown>;
        const text = String(body.text ?? body.message ?? '').trim();
        if (!text) throw new ValidationError('Missing steer text');
        const target = body.target === 'next-run' ? 'next-run' : 'next-step';
        const key = typeof body.key === 'string' && body.key.trim() ? body.key.trim() : undefined;
        const role = body.role === 'system' ? 'system' : 'user';
        const steerMode = body.mode === 'subagent' || body.steerMode === 'subagent' ? 'subagent' : undefined;
        const subagentRole =
          typeof body.subagentRole === 'string' && body.subagentRole.trim()
            ? body.subagentRole.trim()
            : undefined;
        const ack = runtime.enqueueSteer(id, text, { target, key, role, steerMode, subagentRole });
        json(response, 200, steerHttpFromCoreAck(ack, runtime.getSession(id)));
      }
    },

    // PATCH /api/sessions/:id/steer/:itemId — edit unclaimed text or promote to SubAgent
    {
      method: 'PATCH',
      pattern: '/api/sessions/:id/steer/:itemId',
      handler: async ({ requireParam, readBody, response }) => {
        const id = requireParam('id');
        const itemId = requireParam('itemId');
        const body = (await readBody()) as Record<string, unknown>;
        const steerMode = body.mode === 'subagent' || body.steerMode === 'subagent' ? 'subagent' : undefined;
        const text = typeof body.text === 'string' ? body.text : undefined;
        if (text !== undefined) {
          runtime.updateSteerItem(id, itemId, text);
        }
        if (steerMode === 'subagent') {
          const result = runtime.promoteSteerToSubagent(
            id,
            itemId,
            typeof body.subagentRole === 'string' ? body.subagentRole : undefined
          );
          json(response, 200, {
            ok: true,
            spawned: true,
            childSessionId: result.childSessionId,
            item: result.item,
            inbox: runtime.store.listUnclaimedInbox(id)
          });
          return;
        }
        const item = runtime.store.getUnclaimedInbox(id, itemId);
        if (!item) throw new NotFoundError('Steer', itemId);
        json(response, 200, { ok: true, item, inbox: runtime.store.listUnclaimedInbox(id) });
      }
    },

    // DELETE /api/sessions/:id/steer/:itemId — drop unclaimed follow-up
    {
      method: 'DELETE',
      pattern: '/api/sessions/:id/steer/:itemId',
      handler: async ({ requireParam, response }) => {
        const id = requireParam('id');
        const itemId = requireParam('itemId');
        const ok = runtime.dropSteerItem(id, itemId);
        if (!ok) throw new NotFoundError('Steer', itemId);
        json(response, 200, { ok: true, inbox: runtime.store.listUnclaimedInbox(id) });
      }
    },

    // POST /api/sessions/:id/a2ui/action
    // The renderer hits this when the user interacts with an A2UI surface
    // (button click, form submit, etc.). We turn the action into a synthetic
    // user message so the agent can reason about it on its next turn.
    {
      method: 'POST',
      pattern: '/api/sessions/:id/a2ui/action',
      handler: async ({ requireParam, readBody, response }) => {
        const id = requireParam('id');
        const session = runtime.getSession(id);
        if (!session) throw new NotFoundError('Session');
        const body = (await readBody()) as Record<string, unknown>;
        const surfaceId = String(body.surfaceId ?? '').trim();
        const name = String(body.name ?? '').trim();
        if (!surfaceId || !name) {
          throw new ValidationError('surfaceId and name are required');
        }
        const context =
          body.context && typeof body.context === 'object' ? (body.context as Record<string, unknown>) : {};
        const dataModel =
          body.dataModel && typeof body.dataModel === 'object'
            ? (body.dataModel as Record<string, unknown>)
            : undefined;

        const payload = { surfaceId, name, context, ...(dataModel ? { dataModel } : {}) };
        // Plain-text framing the agent already understands; no schema gymnastics.
        const message = `[a2ui:action ${name}] ${JSON.stringify(payload)}`;
        runtime.sendUserMessage(id, message);
        if (body.autoRun !== false) {
          await runtime.runSession(id);
        }
        json(response, 200, {
          session: runtime.getSession(id),
          latestAssistant: runtime.getLatestAssistantText(id)
        });
      }
    },

    // POST /api/sessions/:id/images/ingest-base64
    {
      method: 'POST',
      pattern: '/api/sessions/:id/images/ingest-base64',
      handler: async ({ requireParam, readBody, response }) => {
        const id = requireParam('id');
        const body = (await readBody()) as Record<string, unknown>;
        try {
          const asset = await runtime.ingestImageBase64(id, {
            dataBase64: String(body.dataBase64 ?? ''),
            mimeType: String(body.mimeType ?? 'image/png'),
            sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : undefined
          });
          json(response, 201, { asset });
        } catch (error) {
          throw error instanceof AppError ? error : new ValidationError(errorMessage(error));
        }
      }
    },

    // POST /api/sessions/:id/images/fetch-url
    {
      method: 'POST',
      pattern: '/api/sessions/:id/images/fetch-url',
      handler: async ({ requireParam, readBody, response }) => {
        const id = requireParam('id');
        const body = (await readBody()) as Record<string, unknown>;
        const imageUrl = String(body.url ?? '').trim();
        if (!imageUrl) throw new ValidationError('Missing url');
        try {
          const asset = await runtime.ingestImageFromUrl(id, imageUrl);
          json(response, 201, { asset });
        } catch (error) {
          throw error instanceof AppError ? error : new ValidationError(errorMessage(error));
        }
      }
    },

    // POST /api/chat — start or continue a chat (non-streaming)
    {
      method: 'POST',
      pattern: '/api/chat',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as Record<string, unknown>;
        const message = String(body.message ?? '').trim();
        const imgIds = imageAssetIdsFromBody(body);
        const attIds = attachmentIdsFromBody(body);
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
        if (!message && imgIds.length === 0 && attIds.length === 0) {
          throw new ValidationError('Missing message, imageAssetIds, or attachmentIds');
        }
        let session;
        const openedBot = openBotFromBody(runtime, body);
        const sendOpts = { imageAssetIds: imgIds, attachmentIds: attIds };
        if (openedBot) {
          maybeMergeOptionalGroupsFromBody(runtime, openedBot.sessionId, body);
          session = runtime.sendUserMessage(openedBot.sessionId, message || '(attachment)', sendOpts);
        } else if (sessionId) {
          maybeMergeOptionalGroupsFromBody(runtime, sessionId, body);
          session = runtime.sendUserMessage(sessionId, message || '(attachment)', sendOpts);
        } else {
          session = runtime.createChatSession({
            title: typeof body.title === 'string' ? body.title : 'Chat Session',
            message: message || undefined,
            imageAssetIds: imgIds.length ? imgIds : undefined,
            attachmentIds: attIds.length ? attIds : undefined,
            agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
            background: false,
            metadata: sessionMetadataFromBody(runtime, body)
          });
        }
        await runtime.runSession(session.id);
        json(response, 200, {
          session: runtime.getSession(session.id),
          latestAssistant: runtime.getLatestAssistantText(session.id),
          messages: runtime.getSessionMessages(session.id)
        });
      }
    },

    // POST /api/chat/stream
    {
      method: 'POST',
      pattern: '/api/chat/stream',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as Record<string, unknown>;
        const message = String(body.message ?? '').trim();
        const imgIds = imageAssetIdsFromBody(body);
        const attIds = attachmentIdsFromBody(body);
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
        if (!message && imgIds.length === 0 && attIds.length === 0) {
          throw new ValidationError('Missing message, imageAssetIds, or attachmentIds');
        }
        let session;
        const openedBot = openBotFromBody(runtime, body);
        const sendOpts = { imageAssetIds: imgIds, attachmentIds: attIds };
        if (openedBot) {
          maybeMergeOptionalGroupsFromBody(runtime, openedBot.sessionId, body);
          session = runtime.sendUserMessage(openedBot.sessionId, message || '(attachment)', sendOpts);
        } else if (sessionId) {
          maybeMergeOptionalGroupsFromBody(runtime, sessionId, body);
          session = runtime.sendUserMessage(sessionId, message || '(attachment)', sendOpts);
        } else {
          session = runtime.createChatSession({
            title: typeof body.title === 'string' ? body.title : 'Chat Session',
            message: message || undefined,
            imageAssetIds: imgIds.length ? imgIds : undefined,
            attachmentIds: attIds.length ? attIds : undefined,
            agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
            background: false,
            metadata: sessionMetadataFromBody(runtime, body)
          });
        }
        await streamRun(runtime, response, session.id);
      }
    }
  ];
}
