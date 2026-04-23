import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AppError,
  errorMessage,
  NotFoundError,
  ValidationError,
  type ModelStreamChunk,
  type RawAgentRuntime,
  type SessionRecord
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { etagFromState, json, sendIfNotModified, sseInit, sseSend } from '../http-utils.js';

function imageAssetIdsFromBody(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body.imageAssetIds)) return [];
  return body.imageAssetIds.map(String).filter(Boolean);
}

function sessionMetadataFromBody(body: Record<string, unknown>): Record<string, unknown> | undefined {
  const extra =
    body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? { ...(body.metadata as Record<string, unknown>) }
      : {};
  if (Array.isArray(body.enabledOptionalToolGroups)) {
    extra.enabledOptionalToolGroups = body.enabledOptionalToolGroups.map(String).filter(Boolean);
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
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

async function streamRun(
  runtime: RawAgentRuntime,
  response: ServerResponse<IncomingMessage>,
  sessionId: string
) {
  sseInit(response);
  try {
    await runtime.runSession(sessionId, {
      onModelStreamChunk: (chunk: ModelStreamChunk) => sseSend(response, 'model', chunk)
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
      handler: ({ request, response }) => {
        if (sendIfNotModified(request, response, etagFromState(runtime.getStateVersion()))) return;
        json(response, 200, { sessions: runtime.listSessions() });
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
            agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
            blockedBy: Array.isArray(body.blockedBy) ? body.blockedBy.map(String) : undefined,
            background: body.background !== false,
            metadata: sessionMetadataFromBody(body)
          });
          if (body.autoRun !== false) await runtime.runSession(result.session.id);
          json(response, 201, {
            session: runtime.getSession(result.session.id),
            task: runtime.getTask(result.task.id),
            latestAssistant: runtime.getLatestAssistantText(result.session.id)
          });
          return;
        }
        const session = runtime.createChatSession({
          title: typeof body.title === 'string' ? body.title : 'Chat Session',
          message: typeof body.message === 'string' ? body.message : undefined,
          imageAssetIds: imageAssetIdsFromBody(body),
          agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
          background: body.background === true,
          metadata: sessionMetadataFromBody(body)
        });
        const hasContent =
          (typeof body.message === 'string' && body.message.trim()) ||
          imageAssetIdsFromBody(body).length > 0;
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
        json(response, 200, {
          sessions,
          rootIds: roots.map((r) => r.id),
          links
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
          latestAssistant: runtime.getLatestAssistantText(session.id)
        });
      }
    },

    // PATCH /api/sessions/:id — merge metadata (e.g. enabledOptionalToolGroups)
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
        const session = runtime.getSession(id);
        if (!session) throw new NotFoundError('Session');
        json(response, 200, { session });
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
        if (!message && imgIds.length === 0) throw new ValidationError('Missing message or imageAssetIds');
        maybeMergeOptionalGroupsFromBody(runtime, id, body);
        runtime.sendUserMessage(id, message || '(image)', { imageAssetIds: imgIds });
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
        const session = await runtime.runSession(id);
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
        maybeMergeOptionalGroupsFromBody(runtime, id, body);
        if (msg || imgIds.length > 0) {
          runtime.sendUserMessage(id, msg || '(image)', { imageAssetIds: imgIds });
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
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
        if (!message && imgIds.length === 0) throw new ValidationError('Missing message or imageAssetIds');
        let session;
        if (sessionId) {
          maybeMergeOptionalGroupsFromBody(runtime, sessionId, body);
          session = runtime.sendUserMessage(sessionId, message || '(image)', { imageAssetIds: imgIds });
        } else {
          session = runtime.createChatSession({
            title: typeof body.title === 'string' ? body.title : 'Chat Session',
            message: message || undefined,
            imageAssetIds: imgIds.length ? imgIds : undefined,
            agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
            background: false,
            metadata: sessionMetadataFromBody(body)
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
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
        if (!message && imgIds.length === 0) throw new ValidationError('Missing message or imageAssetIds');
        let session;
        if (sessionId) {
          maybeMergeOptionalGroupsFromBody(runtime, sessionId, body);
          session = runtime.sendUserMessage(sessionId, message || '(image)', { imageAssetIds: imgIds });
        } else {
          session = runtime.createChatSession({
            title: typeof body.title === 'string' ? body.title : 'Chat Session',
            message: message || undefined,
            imageAssetIds: imgIds.length ? imgIds : undefined,
            agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
            background: false,
            metadata: sessionMetadataFromBody(body)
          });
        }
        await streamRun(runtime, response, session.id);
      }
    }
  ];
}
