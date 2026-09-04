/**
 * Named Bot roster + canonical session.
 * GET/POST /api/bots, GET/PATCH /api/bots/:id, POST /api/bots/:id/open
 * Persistence is core `bots` table (schema v15). No RAW_AGENT_* switches.
 */

import {
  stampOwnerMetadata,
  type RawAgentRuntime,
  type UpdateBotInput
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { etagFromState, json, sendIfNotModified } from '../http-utils.js';

export function botsRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  return [
    {
      method: 'GET',
      pattern: '/api/bots',
      handler: ({ request, response, url }) => {
        const includeHidden = url.searchParams.get('includeHidden') === '1';
        if (
          !includeHidden &&
          sendIfNotModified(request, response, etagFromState(runtime.getStateVersion()))
        ) {
          return;
        }
        json(response, 200, { bots: runtime.listBots({ includeHidden }) });
      }
    },
    {
      method: 'POST',
      pattern: '/api/bots',
      handler: async ({ readBody, response, auth }) => {
        const body = (await readBody()) as Record<string, unknown>;
        const bot = runtime.createBot({
          name: typeof body.name === 'string' ? body.name : '',
          title: typeof body.title === 'string' ? body.title : undefined,
          description: typeof body.description === 'string' ? body.description : undefined
        });
        if (auth.user) {
          runtime.mergeSessionMetadata(bot.canonicalSessionId, stampOwnerMetadata({}, auth));
        }
        json(response, 201, { bot });
      }
    },
    {
      method: 'GET',
      pattern: '/api/bots/:id',
      handler: ({ requireParam, response }) => {
        const bot = runtime.getBot(requireParam('id'));
        json(response, 200, { bot });
      }
    },
    {
      method: 'PATCH',
      pattern: '/api/bots/:id',
      handler: async ({ requireParam, readBody, response }) => {
        const id = requireParam('id');
        const body = (await readBody()) as Record<string, unknown>;
        const patch: UpdateBotInput = {};
        if (typeof body.name === 'string') patch.name = body.name;
        if (typeof body.title === 'string') patch.title = body.title;
        if (typeof body.description === 'string') patch.description = body.description;
        if (typeof body.hidden === 'boolean') patch.hidden = body.hidden;
        const bot = runtime.updateBot(id, patch);
        json(response, 200, { bot });
      }
    },
    {
      method: 'POST',
      pattern: '/api/bots/:id/open',
      handler: ({ requireParam, response, auth }) => {
        const opened = runtime.openBot(
          requireParam('id'),
          auth.user ? { userId: auth.user.id, tenantId: auth.user.tenantId } : undefined
        );
        json(response, 200, {
          bot: opened.bot,
          session: runtime.getSession(opened.sessionId),
          createdSession: opened.createdSession
        });
      }
    }
  ];
}
