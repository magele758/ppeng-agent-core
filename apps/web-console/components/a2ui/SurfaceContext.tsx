'use client';

/**
 * Cross-message A2UI surface accumulator.
 *
 * A single surface can grow across multiple `a2ui_render` calls — the agent
 * may first send `createSurface + updateComponents` and later only an
 * `updateDataModel` envelope. Each call lands as its own SurfaceUpdatePart
 * on a different tool message, so the renderer must fold ALL parts for the
 * same surfaceId together (per spec §"Server to client updates"). It then
 * renders the accumulated state exactly once — at the last surface_update
 * part for that surface — so the user sees one canvas evolving instead of
 * snapshots of partial states.
 *
 * Usage:
 *   <SurfaceContextProvider messages={messages}>
 *     {... chat turns ...}
 *   </SurfaceContextProvider>
 *
 *   inside SurfaceUpdateBlock:
 *     const ctx = useSurfaceContext();
 *     const key = `${msgIdx}-${partIdx}`;
 *     if (ctx.latestKey.get(surfaceId) !== key) return null;
 *     const state = ctx.states.get(surfaceId);
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ChatMessage, MessagePart } from '@/lib/types';
import { applyA2uiMessage } from './fold';
import type { A2uiMessage, SurfaceState } from './types';

export interface SurfaceContextValue {
  /** Accumulated final state per surfaceId after folding every surface_update part. */
  states: Map<string, SurfaceState>;
  /** surfaceId → opaque key of the surface_update part that is the "latest" position. */
  latestKey: Map<string, string>;
}

const EMPTY: SurfaceContextValue = {
  states: new Map(),
  latestKey: new Map()
};

const Ctx = createContext<SurfaceContextValue>(EMPTY);

export function useSurfaceContext(): SurfaceContextValue {
  return useContext(Ctx);
}

/** Stable key for a surface_update part inside a particular message position. */
export function surfacePartKey(msgIdx: number, partIdx: number): string {
  return `m${msgIdx}-p${partIdx}`;
}

export function buildSurfaceContext(messages: ChatMessage[]): SurfaceContextValue {
  let states = new Map<string, SurfaceState>();
  const latestKey = new Map<string, string>();
  for (let mi = 0; mi < messages.length; mi += 1) {
    const parts = (messages[mi]?.parts ?? []) as MessagePart[];
    for (let pi = 0; pi < parts.length; pi += 1) {
      const part = parts[pi];
      if (part?.type !== 'surface_update') continue;
      const envelopes = (part.messages ?? []) as A2uiMessage[];
      for (const env of envelopes) {
        states = applyA2uiMessage(states, env);
      }
      latestKey.set(part.surfaceId, surfacePartKey(mi, pi));
    }
  }
  return { states, latestKey };
}

export function SurfaceContextProvider({
  messages,
  children
}: {
  messages: ChatMessage[];
  children: ReactNode;
}) {
  const value = useMemo(() => buildSurfaceContext(messages), [messages]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
