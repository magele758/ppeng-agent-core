/**
 * Catalog registry — describes the *server-side knowledge* about which
 * components exist, which child slot each container exposes, and which
 * properties are required.
 *
 * The renderer keeps its own runtime registry (component name → React
 * component); this registry only has to know enough to validate envelopes
 * and to surface "what is allowed" in agent prompts.
 *
 * Future-extension hook: third-party catalogs (KnowledgeGraph, charts, …)
 * register themselves here at boot, and the validator + skill cheat-sheet
 * pick them up automatically.
 */

export interface ComponentSpec {
  /** Component type name as it appears in `component` field of A2uiComponent. */
  name: string;
  /** Short description for prompt cheat-sheet. */
  description?: string;
  /**
   * Property names that the validator should require. Children/child are
   * handled separately based on `containerKind`.
   */
  requiredProps?: string[];
  /**
   * - "single": expects optional `child: ComponentId`.
   * - "list":   expects optional `children: ChildList`.
   * - "leaf":   neither (e.g. Text, Icon).
   */
  containerKind?: 'single' | 'list' | 'leaf';
}

export interface CatalogSpec {
  id: string;
  /** Human-readable name for cheat-sheet rendering. */
  label: string;
  /** Components keyed by name. */
  components: Record<string, ComponentSpec>;
}

const catalogs = new Map<string, CatalogSpec>();

export function registerCatalog(spec: CatalogSpec): void {
  catalogs.set(spec.id, spec);
}

export function getCatalog(id: string): CatalogSpec | undefined {
  return catalogs.get(id);
}

export function listCatalogs(): CatalogSpec[] {
  return [...catalogs.values()];
}

export function clearCatalogsForTesting(): void {
  catalogs.clear();
}

/** Convenience: render a one-line prompt cheat-sheet for an agent skill. */
export function summarizeCatalog(id: string): string {
  const cat = catalogs.get(id);
  if (!cat) return `(unknown catalog ${id})`;
  const lines = [`# ${cat.label}  (${cat.id})`];
  for (const c of Object.values(cat.components)) {
    const slot = c.containerKind === 'single' ? '  [child]' : c.containerKind === 'list' ? '  [children]' : '';
    const desc = c.description ? `  — ${c.description}` : '';
    lines.push(`- ${c.name}${slot}${desc}`);
  }
  return lines.join('\n');
}
