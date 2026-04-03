'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { AgentInfo, ApprovalItem } from '@/lib/types';

interface Job {
  command?: string;
  status?: string;
}

interface Workspace {
  name?: string;
  mode?: string;
}

export interface MorePanelProps {
  active: boolean;
  approvals: ApprovalItem[];
  jobs: Job[];
  workspaces: Workspace[];
  agents: AgentInfo[];
  onRefresh: () => void;
  onSwitchToTeams: () => void;
}

function sortAgentsById<T extends { id: string }>(aList: T[]): T[] {
  return [...aList].sort((a, b) => {
    if (a.id === 'general') return -1;
    if (b.id === 'general') return 1;
    return a.id.localeCompare(b.id);
  });
}

export function MorePanel({ active, approvals, jobs, workspaces, agents, onRefresh, onSwitchToTeams }: MorePanelProps) {
  const [mailFrom, setMailFrom] = useState('');
  const [mailTo, setMailTo] = useState('');
  const [mailBody, setMailBody] = useState('');
  const agentsSorted = sortAgentsById(agents);

  const handleSendMail = async () => {
    const body = mailBody.trim();
    if (!body) return;
    await api('/api/mailbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromAgentId: mailFrom || agentsSorted[0]?.id, toAgentId: mailTo || agentsSorted[0]?.id, content: body }),
    });
    await api('/api/scheduler/run', { method: 'POST' });
    setMailBody('');
    onRefresh();
    onSwitchToTeams();
  };

  return (
    <section className={`panel ${active ? 'active' : ''}`} id="panel-more" role="tabpanel">
      <div className="three-col">
        <div className="card card-elevated">
          <div className="card-head">
            <h3>审批</h3>
            <span className="badge" id="countApprovals">
              {approvals.length}
            </span>
          </div>
          <div className="list-scroll tall" id="listApprovals">
            {!approvals.length ? (
              <div className="empty-hint">无审批</div>
            ) : (
              approvals.map((a) => (
                <div key={a.id} className="list-item">
                  <div className="row">
                    <strong>{a.toolName}</strong>
                  </div>
                  <div className="muted" style={{ fontSize: '0.75rem' }}>
                    {a.sessionId}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      aria-label={`批准 ${a.toolName}`}
                      onClick={() => void api(`/api/approvals/${a.id}/approve`, { method: 'POST' }).then(() => onRefresh())}
                    >
                      批准
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      aria-label={`拒绝 ${a.toolName}`}
                      onClick={() => void api(`/api/approvals/${a.id}/reject`, { method: 'POST' }).then(() => onRefresh())}
                    >
                      拒绝
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="card card-elevated">
          <div className="card-head">
            <h3>后台作业</h3>
          </div>
          <div className="list-scroll tall" id="listJobs">
            {!jobs.length ? (
              <div className="empty-hint">无数据</div>
            ) : (
              jobs.map((j, i) => (
                <div key={i} className="list-item" style={{ cursor: 'default' }}>
                  {`${j.command?.slice(0, 40)}… · ${j.status}`}
                </div>
              ))
            )}
          </div>
        </div>
        <div className="card card-elevated">
          <div className="card-head">
            <h3>工作区</h3>
          </div>
          <div className="list-scroll tall" id="listWorkspaces">
            {!workspaces.length ? (
              <div className="empty-hint">无数据</div>
            ) : (
              workspaces.map((w, i) => (
                <div key={i} className="list-item" style={{ cursor: 'default' }}>
                  {`${w.name} · ${w.mode}`}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <div className="card card-elevated mail-compose">
        <h3 className="card-title">发邮箱消息</h3>
        <div className="row-3">
          <label className="field">
            <span>From</span>
            <select id="mailFrom" value={mailFrom} onChange={(e) => setMailFrom(e.target.value)}>
              {agentsSorted.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>To</span>
            <select id="mailTo" value={mailTo} onChange={(e) => setMailTo(e.target.value)}>
              {agentsSorted.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id}
                </option>
              ))}
            </select>
          </label>
          <label className="field field-span">
            <span>内容</span>
            <textarea id="mailBody" rows={2} value={mailBody} onChange={(e) => setMailBody(e.target.value)} />
          </label>
        </div>
        <button type="button" className="btn btn-primary" id="btnSendMail" onClick={() => void handleSendMail()}>
          发送并触发调度
        </button>
      </div>
    </section>
  );
}
