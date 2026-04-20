/**
 * Reduce a sequence of A2UI envelope messages into per-surface state.
 *
 * Used both at initial render time (replay persisted SurfaceUpdatePart) and
 * during live streaming (apply each `a2ui_message` chunk as it arrives).
 */

import { setAtPointer } from './bindings';
import type {
  A2uiMessage,
  SurfaceState,
  CreateSurfaceMessage,
  UpdateComponentsMessage,
  UpdateDataModelMessage,
  DeleteSurfaceMessage
} from './types';

function isCreate(m: A2uiMessage): m is CreateSurfaceMessage {
  return 'createSurface' in m;
}
function isUpdate(m: A2uiMessage): m is UpdateComponentsMessage {
  return 'updateComponents' in m;
}
function isData(m: A2uiMessage): m is UpdateDataModelMessage {
  return 'updateDataModel' in m;
}
function isDelete(m: A2uiMessage): m is DeleteSurfaceMessage {
  return 'deleteSurface' in m;
}

export function applyA2uiMessage(
  state: Map<string, SurfaceState>,
  message: A2uiMessage
): Map<string, SurfaceState> {
  // Treat the map as immutable for React's referential-equality renders.
  const next = new Map(state);
  if (isCreate(message)) {
    const cs = message.createSurface;
    next.set(cs.surfaceId, {
      surfaceId: cs.surfaceId,
      catalogId: cs.catalogId,
      components: new Map(),
      dataModel: {},
      theme: cs.theme,
      sendDataModel: cs.sendDataModel === true,
      deleted: false
    });
    return next;
  }
  if (isDelete(message)) {
    next.delete(message.deleteSurface.surfaceId);
    return next;
  }
  if (isUpdate(message)) {
    const uc = message.updateComponents;
    const surface = next.get(uc.surfaceId);
    if (!surface) return state;
    const components = new Map(surface.components);
    for (const c of uc.components) {
      if (c && typeof c.id === 'string') {
        components.set(c.id, c);
      }
    }
    next.set(uc.surfaceId, { ...surface, components });
    return next;
  }
  if (isData(message)) {
    const ud = message.updateDataModel;
    const surface = next.get(ud.surfaceId);
    if (!surface) return state;
    const path = ud.path && ud.path !== '/' ? ud.path : '/';
    let dataModel: Record<string, unknown>;
    if (path === '/') {
      dataModel = (ud.value && typeof ud.value === 'object'
        ? (ud.value as Record<string, unknown>)
        : {}) as Record<string, unknown>;
    } else {
      const updated = setAtPointer(surface.dataModel, path, ud.value);
      dataModel = (updated && typeof updated === 'object'
        ? (updated as Record<string, unknown>)
        : {}) as Record<string, unknown>;
    }
    next.set(ud.surfaceId, { ...surface, dataModel });
    return next;
  }
  return state;
}

export function foldA2uiMessages(messages: A2uiMessage[]): Map<string, SurfaceState> {
  let state = new Map<string, SurfaceState>();
  for (const m of messages) state = applyA2uiMessage(state, m);
  return state;
}
