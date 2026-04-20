'use client';

/**
 * Future-extension: KnowledgeGraph renderer scaffold.
 *
 * The placeholder in `./agent-native.tsx` ships today and degrades gracefully.
 * When the heavy graph engine (Cytoscape, D3, vis-network, …) is approved for
 * the bundle, follow this pattern:
 *
 *   1. `npm i cytoscape` in apps/web-console.
 *   2. Replace the placeholder export below with the real React component.
 *   3. Re-register in `register-catalogs.ts`:
 *
 *        registerCatalogRenderers(AGENT_NATIVE_CATALOG_ID, {
 *          KnowledgeGraph: (await import('./knowledge-graph')).RealKnowledgeGraph
 *        });
 *
 *   4. Use `next/dynamic({ ssr: false })` so the Cytoscape canvas doesn't run
 *      during static generation. Example:
 *
 *        const Cyto = dynamic(() => import('cytoscape-react'), { ssr: false });
 *
 * Until then, this file documents the contract so the protocol layer remains
 * stable regardless of which engine ends up shipping.
 */

import type { ComponentRenderer } from '../registry';

/**
 * Minimal stub kept here as a hook for future code-mod scripts.
 * Currently `agent-native.tsx` already exports a usable placeholder under the
 * same component name, so this file isn't wired in by default.
 */
export const KnowledgeGraphPlaceholder: ComponentRenderer = ({ component }) => {
  return (
    <div className="a2ui-card a2ui-card--graph">
      Knowledge graph integration pending. Component spec:
      <pre>{JSON.stringify(component, null, 2)}</pre>
    </div>
  );
};
