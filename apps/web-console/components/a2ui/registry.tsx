'use client';

/**
 * Catalog → component-renderer registry.
 *
 * The renderer never looks up by component name alone; it always scopes by
 * the surface's `catalogId`. This lets multiple catalogs (basic v0.9, our
 * agent-native v1, future third-party ones) coexist on the same page without
 * name collisions.
 *
 * Adding a new catalog is purely additive: write the React components, then
 * `registerCatalogRenderers(catalogId, { ComponentName: Renderer, ... })`.
 *
 * Future-extension hook (KnowledgeGraph, ChartCard, …):
 *   - dynamic import the heavy renderer in its own module
 *   - register under the agent-native catalog id (or a third-party id)
 *   - the unknown-component fallback below ensures payloads with the name
 *     never break rendering until the heavy renderer ships.
 */

import type { ComponentType } from 'react';
import type { A2uiComponent } from './types';

export interface RenderProps {
  component: A2uiComponent;
  /** Render a child component by id (used by Card / Button). */
  renderChild: (id: string) => React.ReactNode;
  /** Render the children list of a container. Handles array + template form. */
  renderChildren: () => React.ReactNode;
  /** Resolve a Dynamic* prop against the data model + scope. */
  evalProp: (value: unknown) => unknown;
  /** Stringify a Dynamic* prop. */
  evalText: (value: unknown) => string;
  /** Set value at JSON Pointer (for two-way bindings on TextField/Checkbox/…). */
  setAt: (path: string, value: unknown) => void;
  /** Dispatch a server action. `context` may be a static object or a map of Dynamic* values. */
  dispatchAction: (name: string, context?: Record<string, unknown>) => void;
  /** surfaceId for ARIA / debug. */
  surfaceId: string;
}

export type ComponentRenderer = ComponentType<RenderProps>;

const catalogs = new Map<string, Map<string, ComponentRenderer>>();

export function registerCatalogRenderers(catalogId: string, renderers: Record<string, ComponentRenderer>): void {
  let bucket = catalogs.get(catalogId);
  if (!bucket) {
    bucket = new Map();
    catalogs.set(catalogId, bucket);
  }
  for (const [name, renderer] of Object.entries(renderers)) {
    bucket.set(name, renderer);
  }
}

export function findRenderer(catalogId: string, name: string): ComponentRenderer | undefined {
  return catalogs.get(catalogId)?.get(name);
}

export function listRegisteredCatalogs(): string[] {
  return [...catalogs.keys()];
}
