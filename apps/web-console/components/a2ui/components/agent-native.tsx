'use client';

/**
 * Agent-native catalog renderers.
 *
 * These components understand the runtime's domain objects (tasks, agents,
 * mailbox, approvals, sessions) and lazily fetch from the daemon HTTP API
 * via `lib/api.ts`. Props on the A2UI component are usually a single id
 * (e.g. `{ taskId: "task_123" }`) — Dynamic* refs are supported via
 * `evalText`/`evalProp` on the renderer.
 *
 * Future-extension placeholders (KnowledgeGraph, ChartCard) live here too;
 * their real implementations dynamic-import heavy deps in dedicated modules
 * (see `./knowledge-graph.tsx` follow-up).
 */

import { api } from '@/lib/api';
import { useEffect, useState } from 'react';
import type { ComponentRenderer } from '../registry';

interface TaskShape {
  id: string;
  title: string;
  status: string;
  ownerAgentId?: string;
  blockedBy?: string[];
  artifacts?: Array<{ kind: string; label: string; value: string }>;
}

function statusBadge(status: string): string {
  switch (status) {
    case 'completed':
      return 'a2ui-badge a2ui-badge--ok';
    case 'failed':
    case 'cancelled':
      return 'a2ui-badge a2ui-badge--err';
    case 'in_progress':
      return 'a2ui-badge a2ui-badge--running';
    default:
      return 'a2ui-badge';
  }
}

function useFetch<T>(path: string | undefined): { data: T | undefined; error?: string; loading: boolean } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(Boolean(path));
  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    api(path)
      .then((d) => {
        if (!cancelled) setData(d as T);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return { data, error, loading };
}

const TaskCard: ComponentRenderer = ({ component, evalText }) => {
  const taskId = evalText(component.taskId);
  const { data, loading, error } = useFetch<{ task: TaskShape }>(taskId ? `/api/tasks/${encodeURIComponent(taskId)}` : undefined);
  const literalTask = component.task && typeof component.task === 'object' ? (component.task as TaskShape) : undefined;
  const task = data?.task ?? literalTask;
  if (loading && !task) return <div className="a2ui-card a2ui-card--task">loading task {taskId}…</div>;
  if (error) return <div className="a2ui-card a2ui-card--task a2ui-card--err">{error}</div>;
  if (!task) return <div className="a2ui-card a2ui-card--task a2ui-card--err">missing task</div>;
  return (
    <article className="a2ui-card a2ui-card--task" data-task-id={task.id}>
      <header className="a2ui-card__head">
        <span className="a2ui-card__title">{task.title}</span>
        <span className={statusBadge(task.status)}>{task.status}</span>
      </header>
      {task.ownerAgentId ? (
        <div className="a2ui-card__row">
          <span className="a2ui-muted">owner</span>
          <span>{task.ownerAgentId}</span>
        </div>
      ) : null}
      {task.blockedBy && task.blockedBy.length ? (
        <div className="a2ui-card__row">
          <span className="a2ui-muted">blocked by</span>
          <span>{task.blockedBy.join(', ')}</span>
        </div>
      ) : null}
      {task.artifacts && task.artifacts.length ? (
        <details className="a2ui-card__artifacts">
          <summary>{task.artifacts.length} artifact(s)</summary>
          <ul>
            {task.artifacts.map((a, i) => (
              <li key={i}>
                <strong>{a.label}</strong>: {a.value.slice(0, 200)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
};

const TaskList: ComponentRenderer = ({ component, evalProp }) => {
  const filter = evalProp(component.filter) as { status?: string; ownerAgentId?: string } | undefined;
  const limit = typeof component.limit === 'number' ? component.limit : 10;
  const { data, loading, error } = useFetch<{ tasks: TaskShape[] }>('/api/tasks');
  if (loading) return <div className="a2ui-card a2ui-card--task">loading tasks…</div>;
  if (error) return <div className="a2ui-card a2ui-card--err">{error}</div>;
  const tasks = (data?.tasks ?? []).filter((t) => {
    if (filter?.status && t.status !== filter.status) return false;
    if (filter?.ownerAgentId && t.ownerAgentId !== filter.ownerAgentId) return false;
    return true;
  });
  if (tasks.length === 0) return <div className="a2ui-muted">no matching tasks</div>;
  return (
    <ul className="a2ui-task-list">
      {tasks.slice(0, limit).map((t) => (
        <li key={t.id}>
          <span className="a2ui-task-list__title">{t.title}</span>
          <span className={statusBadge(t.status)}>{t.status}</span>
          {t.ownerAgentId ? <span className="a2ui-muted">@{t.ownerAgentId}</span> : null}
        </li>
      ))}
    </ul>
  );
};

const AgentBadge: ComponentRenderer = ({ component, evalText }) => {
  const agentId = evalText(component.agentId);
  const { data } = useFetch<{ agents: Array<{ id: string; role: string }> }>('/api/agents');
  const agent = (data?.agents ?? []).find((a) => a.id === agentId);
  return (
    <span className="a2ui-agent-badge" data-agent-id={agentId}>
      <strong>{agentId}</strong>
      {agent ? <small>{agent.role}</small> : null}
    </span>
  );
};

const MailboxThread: ComponentRenderer = ({ component, evalText }) => {
  const agentId = evalText(component.agentId);
  const limit = typeof component.limit === 'number' ? component.limit : 5;
  const { data, loading, error } = useFetch<{ mail: Array<{ fromAgentId: string; toAgentId: string; status: string; createdAt: string; content: string }> }>(
    agentId ? `/api/mailbox?agentId=${encodeURIComponent(agentId)}` : undefined
  );
  if (loading) return <div className="a2ui-muted">loading mailbox…</div>;
  if (error) return <div className="a2ui-card a2ui-card--err">{error}</div>;
  const items = (data?.mail ?? []).slice(0, limit);
  return (
    <ul className="a2ui-mailbox">
      {items.length === 0 ? <li className="a2ui-muted">empty</li> : null}
      {items.map((m, i) => (
        <li key={i} className="a2ui-mailbox__item">
          <span className="a2ui-mailbox__meta">
            {m.fromAgentId} → {m.toAgentId} · {m.status}
          </span>
          <span className="a2ui-mailbox__body">{m.content.slice(0, 240)}</span>
        </li>
      ))}
    </ul>
  );
};

const ApprovalRequest: ComponentRenderer = ({ component, evalText, dispatchAction }) => {
  const approvalId = evalText(component.approvalId);
  const { data } = useFetch<{ approvals: Array<{ id: string; toolName: string; sessionId: string }> }>(
    approvalId ? '/api/approvals' : undefined
  );
  const approval = (data?.approvals ?? []).find((a) => a.id === approvalId);
  return (
    <div className="a2ui-card a2ui-card--approval" data-approval-id={approvalId}>
      <header className="a2ui-card__head">
        <span className="a2ui-card__title">Approval {approval?.toolName ?? approvalId}</span>
      </header>
      <div className="a2ui-row">
        <button
          type="button"
          className="a2ui-button a2ui-button--primary"
          onClick={() => dispatchAction('approval.approve', { approvalId })}
        >
          Approve
        </button>
        <button
          type="button"
          className="a2ui-button"
          onClick={() => dispatchAction('approval.deny', { approvalId })}
        >
          Deny
        </button>
      </div>
    </div>
  );
};

const SessionLink: ComponentRenderer = ({ component, evalText }) => {
  const sessionId = evalText(component.sessionId);
  const label = evalText(component.label) || sessionId;
  return (
    <a className="a2ui-session-link" href={`/?session=${encodeURIComponent(sessionId)}`}>
      {label}
    </a>
  );
};

const TodoEditable: ComponentRenderer = ({ evalProp, setAt, dispatchAction }) => {
  const todos = (evalProp({ path: '/todos' }) as Array<{ content: string; status: string }> | undefined) ?? [];
  return (
    <div className="a2ui-todo">
      {todos.map((t, i) => (
        <label key={i} className="a2ui-todo__row">
          <input
            type="checkbox"
            checked={t.status === 'completed'}
            onChange={(e) =>
              setAt(`/todos/${i}/status`, e.target.checked ? 'completed' : 'pending')
            }
          />
          <span className={t.status === 'completed' ? 'a2ui-todo__done' : ''}>{t.content}</span>
        </label>
      ))}
      <button type="button" className="a2ui-button" onClick={() => dispatchAction('todo.save', { todos: { path: '/todos' } })}>
        Save
      </button>
    </div>
  );
};

const DiffView: ComponentRenderer = ({ component, evalText }) => {
  const diff = evalText(component.diff);
  return <pre className="a2ui-diff">{diff || '(no diff)'}</pre>;
};

const TraceMini: ComponentRenderer = ({ component, evalText }) => {
  const sessionId = evalText(component.sessionId);
  const limit = typeof component.limit === 'number' ? component.limit : 8;
  const { data, loading } = useFetch<{ events: Array<{ kind: string; createdAt: string; payload?: Record<string, unknown> }> }>(
    sessionId ? `/api/traces?sessionId=${encodeURIComponent(sessionId)}` : undefined
  );
  if (loading) return <div className="a2ui-muted">loading trace…</div>;
  const events = (data?.events ?? []).slice(-limit);
  return (
    <ul className="a2ui-trace">
      {events.map((e, i) => (
        <li key={i}>
          <code>{e.kind}</code> <small className="a2ui-muted">{e.createdAt}</small>
        </li>
      ))}
    </ul>
  );
};

/** Future-extension placeholder. Renderer ships a minimal node/edge table; when
 *  the real Cytoscape integration lands, swap this for the dynamic-import. */
const KnowledgeGraph: ComponentRenderer = ({ component, evalProp, evalText }) => {
  const title = evalText(component.title);
  const nodes = (evalProp(component.nodes) as Array<{ id: string; label?: string }> | undefined) ?? [];
  const edges = (evalProp(component.edges) as Array<{ source: string; target: string; label?: string }> | undefined) ?? [];
  return (
    <details className="a2ui-card a2ui-card--graph" open>
      <summary>
        <strong>{title || 'Knowledge graph'}</strong>
        <span className="a2ui-muted">
          {' '}
          {nodes.length} nodes · {edges.length} edges (Cytoscape integration pending)
        </span>
      </summary>
      <div className="a2ui-graph__cols">
        <div>
          <h4>Nodes</h4>
          <ul>
            {nodes.map((n) => (
              <li key={n.id}>
                <code>{n.id}</code> {n.label ?? ''}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4>Edges</h4>
          <ul>
            {edges.map((e, i) => (
              <li key={i}>
                <code>{e.source}</code> → <code>{e.target}</code> {e.label ? `(${e.label})` : ''}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
};

const ChartCard: ComponentRenderer = ({ component, evalText, evalProp }) => {
  const kind = evalText(component.kind) || 'bar';
  const title = evalText(component.title);
  const data = (evalProp(component.data) as Array<Record<string, unknown>> | undefined) ?? [];
  return (
    <details className="a2ui-card a2ui-card--chart" open>
      <summary>
        <strong>{title || `Chart (${kind})`}</strong>
        <span className="a2ui-muted"> · Recharts integration pending</span>
      </summary>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
};

export const AGENT_NATIVE_RENDERERS: Record<string, ComponentRenderer> = {
  TaskCard,
  TaskList,
  AgentBadge,
  MailboxThread,
  ApprovalRequest,
  SessionLink,
  TodoEditable,
  DiffView,
  TraceMini,
  KnowledgeGraph,
  ChartCard
};
