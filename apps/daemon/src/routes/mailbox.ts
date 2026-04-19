import { ValidationError, type RawAgentRuntime } from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { etagFromState, json, sendIfNotModified } from '../http-utils.js';

export function mailboxRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  return [
    {
      method: 'GET',
      pattern: '/api/mailbox',
      handler: ({ url, response }) => {
        const agentId = url.searchParams.get('agentId');
        if (!agentId) throw new ValidationError('Missing agentId');
        json(response, 200, {
          mail: runtime.listMailbox(agentId, url.searchParams.get('pending') === '1')
        });
      }
    },
    {
      method: 'GET',
      pattern: '/api/mailbox/all',
      handler: ({ request, url, response }) => {
        if (sendIfNotModified(request, response, etagFromState(runtime.getStateVersion()))) return;
        const limit = Number(url.searchParams.get('limit') ?? '200');
        json(response, 200, { mail: runtime.listAllMailbox(Number.isFinite(limit) ? limit : 200) });
      }
    },
    {
      method: 'POST',
      pattern: '/api/mailbox',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as Record<string, unknown>;
        const fromAgentId = String(body.fromAgentId ?? '').trim();
        const toAgentId = String(body.toAgentId ?? '').trim();
        const content = String(body.content ?? '').trim();
        if (!fromAgentId || !toAgentId || !content) {
          throw new ValidationError('Missing fromAgentId, toAgentId, or content');
        }
        const mail = runtime.sendMailboxMessage({
          fromAgentId,
          toAgentId,
          content,
          type: typeof body.type === 'string' ? body.type : undefined,
          correlationId: typeof body.correlationId === 'string' ? body.correlationId : undefined,
          sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
          taskId: typeof body.taskId === 'string' ? body.taskId : undefined
        });
        json(response, 201, { mail });
      }
    }
  ];
}
