import {
  filterSessionsByAuth,
  requireAccessibleSession,
  type RawAgentRuntime,
  type RequestAuth
} from '@ppeng/agent-core';
import type { RouteSpec } from './routing.js';

export function guardSession(runtime: RawAgentRuntime, id: string, auth: RequestAuth) {
  return requireAccessibleSession(runtime.getSession(id), auth);
}

export function listedSessions(runtime: RawAgentRuntime, auth: RequestAuth) {
  return filterSessionsByAuth(runtime.listSessions(), auth);
}

export function wrapSessionIdRoutes(runtime: RawAgentRuntime, specs: RouteSpec[]): RouteSpec[] {
  return specs.map((spec) => {
    if (!(spec.pattern ?? '').includes('/sessions/:id')) return spec;
    const inner = spec.handler;
    return {
      ...spec,
      handler: (ctx) => {
        guardSession(runtime, ctx.requireParam('id'), ctx.auth);
        return inner(ctx);
      }
    };
  });
}
