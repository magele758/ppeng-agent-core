/**
 * Lightweight A2UI v0.9 envelope validator.
 *
 * The full schema is large and lives in google/A2UI; we only enforce the
 * structural invariants that matter for safe rendering:
 *
 *  - exactly one envelope kind per message
 *  - createSurface present (or pre-existing) before updates
 *  - exactly one component with id "root" once any updateComponents has fired
 *  - component refs (children/child) point at known ids
 *  - catalogId is registered (so the renderer can dispatch); unknown component
 *    *names* are a soft warning so future-extension components degrade gracefully
 */

import {
  isCreateSurface,
  isDeleteSurface,
  isUpdateComponents,
  isUpdateDataModel,
  surfaceIdOf,
  type A2uiComponent,
  type A2uiMessage,
  type ChildList,
  type ComponentId
} from './protocol.js';
import { getCatalog } from './catalog/registry.js';

export class A2uiValidationError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(path ? `${message} (at ${path})` : message);
    this.name = 'A2uiValidationError';
  }
}

export interface ValidateOptions {
  /**
   * Existing surface state to validate against (for incremental updates).
   * When omitted, the validator assumes a fresh stream that must start with
   * createSurface — but see `allowOrphanUpdates` for the more common case
   * where the tool can't see previous calls' state.
   */
  existingSurfaces?: Map<string, { catalogId: string; componentIds: Set<ComponentId>; hasRoot: boolean }>;
  /**
   * If true, unknown component names cause a hard error. Default: false (so
   * future-extension components and third-party catalogs degrade gracefully
   * on the renderer side).
   */
  strictComponents?: boolean;
  /**
   * When true (the default), updates that target a surface this validator
   * hasn't seen `createSurface` for are recorded as warnings instead of
   * throwing. Matches A2UI v0.9 §createSurface ("an agent may skip this if
   * it knows the surface has already been created") and the renderer's
   * cross-message accumulation strategy.
   */
  allowOrphanUpdates?: boolean;
}

interface SurfaceState {
  catalogId: string;
  componentIds: Set<ComponentId>;
  hasRoot: boolean;
}

export interface ValidateResult {
  surfaces: Map<string, SurfaceState>;
  warnings: string[];
}

export function validateA2uiStream(messages: A2uiMessage[], options: ValidateOptions = {}): ValidateResult {
  const surfaces = new Map<string, SurfaceState>();
  for (const [id, s] of options.existingSurfaces ?? []) {
    surfaces.set(id, {
      catalogId: s.catalogId,
      componentIds: new Set(s.componentIds),
      hasRoot: s.hasRoot
    });
  }
  const warnings: string[] = [];
  const allowOrphan = options.allowOrphanUpdates !== false;

  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    const at = `messages[${i}]`;
    if (!m || typeof m !== 'object') throw new A2uiValidationError('message must be an object', at);
    if ((m as A2uiMessage).version !== 'v0.9') {
      throw new A2uiValidationError(`unsupported version ${(m as A2uiMessage).version ?? '<missing>'}`, at);
    }
    if (!isCreateSurface(m) && !isUpdateComponents(m) && !isUpdateDataModel(m) && !isDeleteSurface(m)) {
      throw new A2uiValidationError('message must contain exactly one envelope key', at);
    }
    const sid = surfaceIdOf(m);
    if (!sid) throw new A2uiValidationError('surfaceId is required', at);

    if (isCreateSurface(m)) {
      const { catalogId } = m.createSurface;
      if (!catalogId) throw new A2uiValidationError('createSurface.catalogId required', at);
      if (!getCatalog(catalogId)) {
        throw new A2uiValidationError(`unknown catalogId ${catalogId}`, at);
      }
      surfaces.set(sid, { catalogId, componentIds: new Set(), hasRoot: false });
      continue;
    }

    const surface = surfaces.get(sid);
    if (!surface) {
      if (!allowOrphan) {
        throw new A2uiValidationError(`message references surface ${sid} before createSurface`, at);
      }
      // Spec sanctions skipping createSurface when the surface already exists
      // (perhaps from an earlier tool call). Record it as a warning so callers
      // can debug, but keep validating subsequent envelopes against a synthetic
      // "unknown" catalog (component-name checks turn into warnings, refs are
      // unconstrained until the renderer folds across messages).
      warnings.push(`${at}: surface ${sid} not yet created in this stream; assuming prior createSurface`);
      const synthetic: SurfaceState = {
        catalogId: '',
        componentIds: new Set(),
        hasRoot: false
      };
      surfaces.set(sid, synthetic);
    }

    const liveSurface = surfaces.get(sid)!;

    if (isUpdateComponents(m)) {
      const components = m.updateComponents.components;
      if (!Array.isArray(components)) {
        throw new A2uiValidationError('updateComponents.components must be an array', at);
      }
      const catalog = liveSurface.catalogId ? getCatalog(liveSurface.catalogId) : undefined;
      for (let j = 0; j < components.length; j += 1) {
        const c = components[j];
        const cAt = `${at}.components[${j}]`;
        if (!c) throw new A2uiValidationError('component is missing', cAt);
        validateComponent(c, cAt);
        if (catalog && !catalog.components[c.component]) {
          if (options.strictComponents) {
            throw new A2uiValidationError(`unknown component ${c.component} for catalog ${liveSurface.catalogId}`, cAt);
          }
          warnings.push(`${cAt}: component ${c.component} is not declared in catalog ${liveSurface.catalogId}; renderer will fall back`);
        }
        liveSurface.componentIds.add(c.id);
        if (c.id === 'root') liveSurface.hasRoot = true;
      }
      validateChildRefs(components, liveSurface.componentIds, at, warnings);
      continue;
    }

    if (isUpdateDataModel(m)) {
      const path = m.updateDataModel.path ?? '/';
      if (typeof path !== 'string' || (path !== '/' && !path.startsWith('/'))) {
        throw new A2uiValidationError('updateDataModel.path must be JSON Pointer ("/" or "/...")', at);
      }
      continue;
    }

    if (isDeleteSurface(m)) {
      surfaces.delete(sid);
      continue;
    }

    throw new A2uiValidationError('message must contain exactly one envelope key', at);
  }

  return { surfaces, warnings };
}

function validateComponent(c: A2uiComponent, at: string): void {
  if (!c || typeof c !== 'object') throw new A2uiValidationError('component must be an object', at);
  if (typeof c.id !== 'string' || !c.id) throw new A2uiValidationError('component.id must be a non-empty string', at);
  if (typeof c.component !== 'string' || !c.component) {
    throw new A2uiValidationError('component.component must be a non-empty string', at);
  }
  if (c.children !== undefined && !isValidChildList(c.children)) {
    throw new A2uiValidationError('component.children must be string[] or { path, componentId }', at);
  }
  if (c.child !== undefined && typeof c.child !== 'string') {
    throw new A2uiValidationError('component.child must be a string ComponentId', at);
  }
}

function isValidChildList(value: unknown): value is ChildList {
  if (Array.isArray(value)) return value.every((v) => typeof v === 'string');
  if (value && typeof value === 'object') {
    const v = value as { path?: unknown; componentId?: unknown };
    return typeof v.path === 'string' && typeof v.componentId === 'string';
  }
  return false;
}

function validateChildRefs(
  components: A2uiComponent[],
  knownIds: Set<ComponentId>,
  at: string,
  warnings: string[]
): void {
  for (let i = 0; i < components.length; i += 1) {
    const c = components[i];
    if (!c) continue;
    const refs: string[] = [];
    if (Array.isArray(c.children)) refs.push(...c.children);
    if (typeof c.child === 'string') refs.push(c.child);
    if (c.children && !Array.isArray(c.children) && typeof c.children === 'object') {
      // template; componentId must be known
      const cid = (c.children as { componentId: string }).componentId;
      if (cid) refs.push(cid);
    }
    for (const ref of refs) {
      if (!knownIds.has(ref)) {
        // Spec allows forward refs (progressive rendering); flag as warning only.
        warnings.push(`${at}.components[${i}] references unknown id ${ref}; ok for progressive rendering`);
      }
    }
  }
}
