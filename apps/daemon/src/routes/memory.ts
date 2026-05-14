import { ValidationError } from '@ppeng/agent-core';
import { AgentMemoryStore } from '@ppeng/agent-core';
import type { MemoryFilter, MemoryScope } from '@ppeng/agent-core';
import type { RawAgentRuntime } from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { json } from '../http-utils.js';

function getStore(runtime: RawAgentRuntime): AgentMemoryStore {
  return new AgentMemoryStore(runtime.store.db);
}

export function memoryRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  return [
    // ── Agent Memory ──────────────────────────────────────────────────────────

    {
      method: 'GET',
      pattern: '/api/memory',
      handler: ({ url, response }) => {
        const store = getStore(runtime);
        const filter: MemoryFilter = {};

        const scope = url.searchParams.get('scope');
        if (scope) filter.scope = scope as MemoryScope;

        const namespace = url.searchParams.get('namespace');
        if (namespace) filter.namespace = namespace;

        const userId = url.searchParams.get('userId');
        if (userId) filter.userId = userId;

        const tenantId = url.searchParams.get('tenantId');
        if (tenantId) filter.tenantId = tenantId;

        const sessionId = url.searchParams.get('sessionId');
        if (sessionId) filter.sessionId = sessionId;

        const query = url.searchParams.get('query');
        if (query) filter.query = query;

        const limitParam = url.searchParams.get('limit');
        if (limitParam) {
          const n = Number(limitParam);
          if (Number.isFinite(n) && n > 0) filter.limit = n;
        }

        const orderBy = url.searchParams.get('orderBy') as MemoryFilter['orderBy'] | null;
        if (orderBy) filter.orderBy = orderBy;

        const entries = store.search(filter);
        json(response, 200, { entries });
      }
    },

    {
      method: 'POST',
      pattern: '/api/memory',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as Record<string, unknown>;
        if (!body.scope || !body.key || body.value === undefined) {
          throw new ValidationError('Missing required fields: scope, key, value');
        }
        const store = getStore(runtime);
        const entry = store.set({
          scope: String(body.scope) as MemoryScope,
          namespace: String(body.namespace ?? 'default'),
          key: String(body.key),
          value: String(body.value),
          userId: body.userId != null ? String(body.userId) : undefined,
          tenantId: body.tenantId != null ? String(body.tenantId) : undefined,
          sessionId: body.sessionId != null ? String(body.sessionId) : undefined,
          importance: body.importance != null ? Number(body.importance) : 0.5,
          source: body.source != null ? String(body.source) : undefined,
          confidence: (body.confidence as 'low' | 'medium' | 'high' | undefined) ?? 'medium',
          expiresAt: body.expiresAt != null ? String(body.expiresAt) : undefined
        });
        json(response, 201, { entry });
      }
    },

    {
      method: 'DELETE',
      pattern: '/api/memory/:id',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        getStore(runtime).delete(id);
        json(response, 200, { ok: true });
      }
    },

    {
      method: 'POST',
      pattern: '/api/memory/expire',
      handler: ({ response }) => {
        const count = getStore(runtime).expire();
        json(response, 200, { deleted: count });
      }
    },

    // ── Users ─────────────────────────────────────────────────────────────────

    {
      method: 'GET',
      pattern: '/api/users',
      handler: ({ response }) => {
        const users = getStore(runtime).listUsers();
        json(response, 200, { users });
      }
    },

    {
      method: 'POST',
      pattern: '/api/users',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as Record<string, unknown>;
        if (!body.id) throw new ValidationError('Missing required field: id');
        const store = getStore(runtime);
        const now = new Date().toISOString();
        store.upsertUser({
          id: String(body.id),
          email: body.email != null ? String(body.email) : undefined,
          displayName: body.displayName != null ? String(body.displayName) : undefined,
          status: body.status != null ? String(body.status) : 'active',
          createdAt: body.createdAt != null ? String(body.createdAt) : now
        });
        const user = store.getUser(String(body.id));
        json(response, 201, { user });
      }
    },

    {
      method: 'GET',
      pattern: '/api/users/:id',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        const user = getStore(runtime).getUser(id);
        if (!user) {
          json(response, 404, { error: 'User not found' });
          return;
        }
        json(response, 200, { user });
      }
    },

    // ── Tenants ───────────────────────────────────────────────────────────────

    {
      method: 'GET',
      pattern: '/api/tenants',
      handler: ({ response }) => {
        const tenants = getStore(runtime).listTenants();
        json(response, 200, { tenants });
      }
    },

    {
      method: 'POST',
      pattern: '/api/tenants',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as Record<string, unknown>;
        if (!body.id || !body.name) throw new ValidationError('Missing required fields: id, name');
        const store = getStore(runtime);
        const now = new Date().toISOString();
        store.upsertTenant({
          id: String(body.id),
          name: String(body.name),
          createdAt: body.createdAt != null ? String(body.createdAt) : now
        });
        const tenant = store.getTenant(String(body.id));
        json(response, 201, { tenant });
      }
    }
  ];
}
