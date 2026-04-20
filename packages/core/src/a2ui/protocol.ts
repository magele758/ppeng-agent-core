/**
 * A2UI v0.9 protocol envelope types.
 *
 * Reference: https://a2ui.org/specification/v0.9-a2ui/
 *
 * The server sends a stream of A2uiMessage objects to the client. Each message
 * is one of four envelope kinds: createSurface, updateComponents, updateDataModel,
 * deleteSurface. The client folds them into a per-surface state (component map +
 * data model) and renders the component whose id is "root".
 *
 * The protocol is intentionally transport-agnostic. In this project the messages
 * travel over our existing SSE channel as ModelStreamChunk { type: 'a2ui_message' },
 * and they are persisted in SessionMessage parts as SurfaceUpdatePart so a session
 * reload can replay the surface deterministically.
 */

export const A2UI_PROTOCOL_VERSION = 'v0.9';

/** RFC 6901 JSON Pointer (with A2UI relative-path extension). */
export type JsonPointer = string;

/**
 * Dynamic value: literal | data binding (path) | function call.
 *
 * Per spec §"Common types" the typed Dynamic* unions all reduce to the same
 * shape at runtime: `T | { path: string } | { call: string; args?: ... }`.
 * We collapse them into one structural type to keep the validator simple;
 * the catalog layer is the source of truth for which Dynamic* is allowed
 * on which property.
 */
export type DynamicValue<T = unknown> =
  | T
  | { path: JsonPointer }
  | { call: string; args?: Record<string, unknown>; returnType?: string };

/** Reference to another component by id within the same surface. */
export type ComponentId = string;

/**
 * Container child reference: either a static array of ids or a template
 * iterating over a data binding.
 */
export type ChildList =
  | ComponentId[]
  | { path: JsonPointer; componentId: ComponentId };

/** A single component definition (adjacency-list entry). */
export interface A2uiComponent {
  id: ComponentId;
  /**
   * The component type name (e.g. "Text", "Button", "TaskCard").
   * Resolved against the surface's catalogId on the renderer side.
   */
  component: string;
  /** Container child list (some components use `child` for a single ref). */
  children?: ChildList;
  /** Single-child container ref (Card, Button label, etc.). */
  child?: ComponentId;
  /** All other component-specific props travel as plain JSON. */
  [key: string]: unknown;
}

export interface CreateSurfaceMessage {
  version: typeof A2UI_PROTOCOL_VERSION;
  createSurface: {
    surfaceId: string;
    catalogId: string;
    theme?: Record<string, unknown>;
    /** When true, client echoes its full data model in every action message. */
    sendDataModel?: boolean;
  };
}

export interface UpdateComponentsMessage {
  version: typeof A2UI_PROTOCOL_VERSION;
  updateComponents: {
    surfaceId: string;
    components: A2uiComponent[];
  };
}

export interface UpdateDataModelMessage {
  version: typeof A2UI_PROTOCOL_VERSION;
  updateDataModel: {
    surfaceId: string;
    /** JSON Pointer; "/" or omitted means replace the whole model. */
    path?: JsonPointer;
    /** When omitted, the value at `path` is removed. */
    value?: unknown;
  };
}

export interface DeleteSurfaceMessage {
  version: typeof A2UI_PROTOCOL_VERSION;
  deleteSurface: {
    surfaceId: string;
  };
}

export type A2uiMessage =
  | CreateSurfaceMessage
  | UpdateComponentsMessage
  | UpdateDataModelMessage
  | DeleteSurfaceMessage;

/** Action sent from client → server when a user interacts with the surface. */
export interface A2uiAction {
  surfaceId: string;
  /** Action name as declared in the component's `action.event.name`. */
  name: string;
  /** Resolved values from the action's `context` map (paths already de-referenced). */
  context: Record<string, unknown>;
  /** Optional full data model snapshot when surface was created with `sendDataModel: true`. */
  dataModel?: Record<string, unknown>;
}

/** Discriminator helpers (cheap and tree-shakeable). */
export function isCreateSurface(m: A2uiMessage): m is CreateSurfaceMessage {
  return 'createSurface' in m;
}
export function isUpdateComponents(m: A2uiMessage): m is UpdateComponentsMessage {
  return 'updateComponents' in m;
}
export function isUpdateDataModel(m: A2uiMessage): m is UpdateDataModelMessage {
  return 'updateDataModel' in m;
}
export function isDeleteSurface(m: A2uiMessage): m is DeleteSurfaceMessage {
  return 'deleteSurface' in m;
}

export function surfaceIdOf(m: A2uiMessage): string {
  if (isCreateSurface(m)) return m.createSurface.surfaceId;
  if (isUpdateComponents(m)) return m.updateComponents.surfaceId;
  if (isUpdateDataModel(m)) return m.updateDataModel.surfaceId;
  return m.deleteSurface.surfaceId;
}
