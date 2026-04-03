'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { AgentInfo, MailItem, SessionSummary } from '@/lib/types';
import { TeamGraph } from './TeamGraph';

export interface TeamsPanelProps {
  active: boolean;
  agents: AgentInfo[];
  sessions: SessionSummary[];
  mailAll: MailItem[];
  graphRedraw: number;
  onGraphRedraw: () => void;
  onTeammateCreated: (sessionId: string) => void;
}

export function TeamsPanel({
  active,
  agents,
  sessions,
  mailAll,
  graphRedraw,
  onGraphRedraw,
  onTeammateCreated,
}: TeamsPanelProps) {
  const [tmName, setTmName] = useState('');
  const [tmRole, setTmRole] = useState('');
  const [tmPrompt, setTmPrompt] = useState('');

  const handleCreate = async () => {
    const name = tmName.trim();
    const role = tmRole.trim();
    const prompt = tmPrompt.trim();
    if (!name || !role || !prompt) return;
    const data = (await api('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, role, prompt, autoRun: true, background: true }),
    })) as { session: { id: string } };
    setTmPrompt('');
    onTeammateCreated(data.session.id);
  };

  return (
    <section className={`panel ${active ? 'active' : ''}`} id="panel-teams" role="tabpanel">
      <div className="teams-hero card card-elevated">
        <div>
          <h2>多 Agent 协作拓扑</h2>
          <p className="muted">节点 = 已注册 Agent；边 = 邮箱消息流向（最近 200 条）。Teammate 会话高亮为「后台队友」。</p>
        </div>
        <div className="teams-form">
          <input
            type="text"
            id="tmName"
            placeholder="teammate id，如 reviewer-1"
            autoComplete="off"
            value={tmName}
            onChange={(e) => setTmName(e.target.value)}
          />
          <input
            type="text"
            id="tmRole"
            placeholder="角色描述"
            autoComplete="off"
            value={tmRole}
            onChange={(e) => setTmRole(e.target.value)}
          />
          <textarea id="tmPrompt" rows={2} placeholder="启动提示词" value={tmPrompt} onChange={(e) => setTmPrompt(e.target.value)} />
          <button type="button" className="btn btn-primary" id="btnSpawnTeammate" onClick={() => void handleCreate()}>
            创建 Teammate
          </button>
        </div>
      </div>
      <div className="card card-elevated teams-board">
        <div className="card-head">
          <h3>拓扑图</h3>
          <button type="button" className="btn btn-ghost btn-sm" id="btnTeamsRefresh" onClick={onGraphRedraw}>
            重绘
          </button>
        </div>
        <div className="graph-wrap" id="teamGraph">
          <TeamGraph agents={agents} sessions={sessions} mail={mailAll} redrawToken={graphRedraw} />
        </div>
      </div>
      <div className="card card-elevated">
        <div className="card-head">
          <h3>全局邮箱流</h3>
          <span className="muted">最新优先</span>
        </div>
        <div className="list-scroll tall" id="listMailAll">
          {!mailAll.length ? (
            <div className="empty-hint">暂无邮件</div>
          ) : (
            mailAll.map((m, i) => (
              <div key={i} className="list-item" style={{ cursor: 'default' }}>
                <div className="row">
                  <strong>
                    {m.fromAgentId} → {m.toAgentId}
                  </strong>{' '}
                  {m.status}
                </div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>
                  {m.createdAt}
                </div>
                <pre
                  style={{
                    margin: '8px 0 0',
                    fontSize: '0.78rem',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'var(--mono)',
                  }}
                >
                  {m.content.slice(0, 400)}
                  {m.content.length > 400 ? '…' : ''}
                </pre>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
