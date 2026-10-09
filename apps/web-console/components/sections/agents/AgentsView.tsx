'use client';

import { useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { agentToolScope, filterAgents, type AgentDetail } from '@/lib/agents-view';
import { sortAgentsById } from '@/lib/sort-utils';
import { EmptyState } from '../../ui';
import { NoMatch } from './NoMatch';
import { SearchBox } from './SearchBox';

interface AgentsViewProps {
  agents: AgentDetail[];
  onRefresh: () => void;
}

export function AgentsView({ agents, onRefresh }: AgentsViewProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sorted = useMemo(() => sortAgentsById(agents), [agents]);
  const visible = useMemo(() => filterAgents(sorted, query), [sorted, query]);
  const selected = sorted.find((a) => a.id === selectedId) ?? null;

  if (agents.length === 0) {
    return <EmptyState title={t('agents.agents.emptyTitle')} description={t('agents.agents.emptyDesc')} />;
  }

  return (
    <div className="ag-block" id="agentsView">
      <div className="ag-toolbar">
        <div className="ag-toolbar__grow">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder={t('agents.agents.searchPh')}
            ariaLabel={t('agents.agents.searchAria')}
          />
        </div>
        <span className="ag-toolbar__meta">{t('agents.common.count', { count: visible.length })}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}>
          {t('agents.common.refresh')}
        </button>
      </div>
      <div className={`ag-split${selected ? ' ag-split--detail' : ''}`}>
        {visible.length === 0 ? (
          <NoMatch onClear={() => setQuery('')} />
        ) : (
          <div className="ag-grid" role="list">
            {visible.map((a) => (
              <button
                key={a.id}
                type="button"
                role="listitem"
                className={`ag-card${a.id === selectedId ? ' is-selected' : ''}`}
                aria-pressed={a.id === selectedId}
                aria-label={t('agents.agents.openDetail', { name: a.name || a.id })}
                data-testid={`agent-card-${a.id}`}
                onClick={() => setSelectedId(a.id === selectedId ? null : a.id)}
              >
                <span className="ag-card__title">{a.name || a.id}</span>
                <span className="ag-card__sub">{a.role}</span>
                <span className="ag-chips">
                  <span className="chip chip-muted">{a.id}</span>
                  {a.domainId ? <span className="chip">{a.domainId}</span> : null}
                </span>
              </button>
            ))}
          </div>
        )}
        {selected ? <AgentDetailPanel agent={selected} onClose={() => setSelectedId(null)} /> : null}
      </div>
    </div>
  );
}

function AgentDetailPanel({ agent, onClose }: { agent: AgentDetail; onClose: () => void }) {
  const { t } = useI18n();
  const scope = agentToolScope(agent);
  const capabilities = agent.capabilities ?? [];
  return (
    <aside className="ag-panel" aria-label={t('agents.agents.detailTitle')} id="agentDetail">
      <div className="ag-panel__head">
        <div>
          <h3 className="ag-panel__title">{agent.name || agent.id}</h3>
          <p className="ag-panel__lead">{agent.role}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          {t('agents.common.close')}
        </button>
      </div>
      <div className="ag-chips">
        <span className="chip chip-muted">
          {t('agents.agents.idLabel')}: {agent.id}
        </span>
        <span className="chip">{agent.domainId ?? t('agents.agents.domainCore')}</span>
        {agent.harnessRole ? (
          <span className="chip chip-muted">
            {t('agents.agents.harnessRole')}: {agent.harnessRole}
          </span>
        ) : null}
      </div>
      <section className="ag-block">
        <h4 className="ag-block__title">{t('agents.agents.purpose')}</h4>
        {agent.instructions?.trim() ? (
          <pre className="ag-pre">{agent.instructions.trim()}</pre>
        ) : (
          <p className="ag-panel__lead">{t('agents.agents.noPurpose')}</p>
        )}
      </section>
      <section className="ag-block">
        <h4 className="ag-block__title">{t('agents.agents.capabilities')}</h4>
        {capabilities.length ? (
          <div className="ag-chips">
            {capabilities.map((c) => (
              <span key={c} className="chip">
                {c}
              </span>
            ))}
          </div>
        ) : (
          <p className="ag-panel__lead">{t('agents.agents.noCapabilities')}</p>
        )}
      </section>
      <section className="ag-block" data-testid="agent-tools">
        <h4 className="ag-block__title">{t('agents.agents.tools')}</h4>
        {scope.kind === 'all' ? (
          <p className="ag-panel__lead">{t('agents.agents.toolsAll')}</p>
        ) : (
          <>
            <p className="ag-panel__lead">{t('agents.agents.toolsLimited', { count: scope.tools.length })}</p>
            <div className="ag-chips">
              {scope.tools.map((tool) => (
                <span key={tool} className="chip chip-muted">
                  {tool}
                </span>
              ))}
            </div>
          </>
        )}
      </section>
    </aside>
  );
}
