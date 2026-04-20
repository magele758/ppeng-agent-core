'use client';

/**
 * Render a fully-folded A2UI surface state.
 *
 * Inputs come from `<ChatTurnFromMessage>` (persisted SurfaceUpdatePart) or
 * the streaming overlay (live a2ui_message chunks). Either way we hand a
 * `SurfaceState` to this component and it walks the component tree starting
 * at id "root".
 *
 * Two-way bindings: TextField / CheckBox / etc. mutate a local copy of the
 * data model. We do NOT push every keystroke back to the server; the agent
 * only sees the data when the user dispatches an action that includes it
 * via `context: { ..., field: { path: "/..." } }`.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { evalDynamic, evalDynamicString, setAtPointer, type BindingScope } from './bindings';
import { findRenderer, type RenderProps } from './registry';
import './register-catalogs';
import type { A2uiComponent, ActionPayload, SurfaceState } from './types';

const DEFAULT_SCOPE: BindingScope = {};

interface SurfaceProps {
  state: SurfaceState;
  sessionId: string;
}

export function A2uiSurface({ state, sessionId }: SurfaceProps) {
  const [dataModel, setDataModel] = useState<Record<string, unknown>>(state.dataModel);

  // Re-sync local state when server pushes a new updateDataModel frame.
  useEffect(() => {
    setDataModel(state.dataModel);
  }, [state.dataModel]);

  const setAt = useCallback((path: string, value: unknown) => {
    setDataModel((prev) => {
      const updated = setAtPointer(prev, path, value);
      return (updated && typeof updated === 'object' ? updated : prev) as Record<string, unknown>;
    });
  }, []);

  const dispatchAction = useCallback(
    (name: string, contextDef?: Record<string, unknown>) => {
      const context: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(contextDef ?? {})) {
        context[k] = evalDynamic(v, dataModel, DEFAULT_SCOPE);
      }
      const payload: ActionPayload = {
        surfaceId: state.surfaceId,
        name,
        context,
        ...(state.sendDataModel ? { dataModel } : {})
      };
      void postAction(sessionId, payload);
    },
    [dataModel, sessionId, state.sendDataModel, state.surfaceId]
  );

  const root = state.components.get('root');
  if (state.deleted) return null;

  if (!root) {
    return (
      <div className="a2ui-surface a2ui-surface--placeholder">
        <span className="a2ui-debug">A2UI surface {state.surfaceId} (waiting for root component…)</span>
      </div>
    );
  }

  return (
    <div
      className="a2ui-surface"
      data-surface-id={state.surfaceId}
      data-catalog-id={state.catalogId}
    >
      <RenderNode
        component={root}
        state={state}
        dataModel={dataModel}
        scope={DEFAULT_SCOPE}
        setAt={setAt}
        dispatchAction={dispatchAction}
      />
    </div>
  );
}

interface RenderNodeProps {
  component: A2uiComponent;
  state: SurfaceState;
  dataModel: Record<string, unknown>;
  scope: BindingScope;
  setAt: (path: string, value: unknown) => void;
  dispatchAction: (name: string, context?: Record<string, unknown>) => void;
}

function RenderNode({ component, state, dataModel, scope, setAt, dispatchAction }: RenderNodeProps) {
  const renderChild = useCallback(
    (id: string): ReactNode => {
      const child = state.components.get(id);
      if (!child) {
        return <UnknownChild key={id} id={id} />;
      }
      return (
        <RenderNode
          key={child.id}
          component={child}
          state={state}
          dataModel={dataModel}
          scope={scope}
          setAt={setAt}
          dispatchAction={dispatchAction}
        />
      );
    },
    [state, dataModel, scope, setAt, dispatchAction]
  );

  const renderChildren = useCallback((): ReactNode => {
    const ch = component.children;
    if (Array.isArray(ch)) {
      return ch.map((id) => renderChild(id));
    }
    if (ch && typeof ch === 'object' && 'path' in ch && 'componentId' in ch) {
      const path = (ch as { path: string }).path;
      const tplId = (ch as { componentId: string }).componentId;
      const tpl = state.components.get(tplId);
      const arr = resolvePath(dataModel, scope, path);
      if (!Array.isArray(arr) || !tpl) return null;
      return arr.map((_, i) => {
        const childScope: BindingScope = {
          templatePath: path.startsWith('/') ? `${path}/${i}` : `/${path}/${i}`,
          templateIndex: i
        };
        return (
          <RenderNode
            key={`${tplId}-${i}`}
            component={tpl}
            state={state}
            dataModel={dataModel}
            scope={childScope}
            setAt={setAt}
            dispatchAction={dispatchAction}
          />
        );
      });
    }
    if (typeof component.child === 'string') return renderChild(component.child);
    return null;
  }, [component.children, component.child, state, dataModel, scope, renderChild, setAt, dispatchAction]);

  const evalProp = useCallback((value: unknown) => evalDynamic(value, dataModel, scope), [dataModel, scope]);
  const evalText = useCallback((value: unknown) => evalDynamicString(value, dataModel, scope), [dataModel, scope]);

  const props = useMemo<RenderProps>(
    () => ({
      component,
      renderChild,
      renderChildren,
      evalProp,
      evalText,
      setAt,
      dispatchAction,
      surfaceId: state.surfaceId
    }),
    [component, renderChild, renderChildren, evalProp, evalText, setAt, dispatchAction, state.surfaceId]
  );

  const Renderer = findRenderer(state.catalogId, component.component);
  if (!Renderer) {
    return <UnknownComponent component={component} catalogId={state.catalogId} renderChildren={renderChildren} />;
  }
  return <Renderer {...props} />;
}

function UnknownChild({ id }: { id: string }) {
  return (
    <span className="a2ui-debug a2ui-debug--missing">missing component id "{id}"</span>
  );
}

function UnknownComponent({
  component,
  catalogId,
  renderChildren
}: {
  component: A2uiComponent;
  catalogId: string;
  renderChildren: () => ReactNode;
}) {
  return (
    <details className="a2ui-unknown">
      <summary>
        <span className="a2ui-unknown__pill">A2UI</span>
        <span className="a2ui-unknown__name">{component.component}</span>
        <span className="a2ui-unknown__hint">unknown component (catalog {catalogId})</span>
      </summary>
      <pre className="a2ui-unknown__pre">{JSON.stringify(component, null, 2)}</pre>
      <div className="a2ui-unknown__children">{renderChildren()}</div>
    </details>
  );
}

function resolvePath(model: unknown, scope: BindingScope, path: string): unknown {
  if (path.startsWith('/')) return walk(model, path);
  if (scope.templatePath) return walk(model, `${scope.templatePath}/${path}`);
  return walk(model, `/${path}`);
}

function walk(model: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return model;
  const tokens = pointer.slice(1).split('/');
  let cursor: unknown = model;
  for (const token of tokens) {
    if (cursor === null || cursor === undefined) return undefined;
    if (Array.isArray(cursor)) {
      const idx = Number(token);
      cursor = Number.isFinite(idx) ? cursor[idx] : undefined;
    } else if (typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return cursor;
}

// Lazy import to keep the "actions" module out of the SSR critical path.
async function postAction(sessionId: string, payload: ActionPayload) {
  const mod = await import('./actions');
  await mod.postA2uiAction(sessionId, payload);
}
