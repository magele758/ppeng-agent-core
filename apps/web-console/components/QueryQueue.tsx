'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import {
  queryExecModeOf,
  type QueryExecMode,
  type SteerInboxItem
} from '@/lib/query-queue';
import { ConfigGroup } from './ConfigGroup';

export function QueryQueue({
  inbox,
  running,
  busy = false,
  composeMode,
  onComposeModeChange,
  onUpdateText,
  onDelete,
  onSetMode
}: {
  inbox: SteerInboxItem[];
  running: boolean;
  busy?: boolean;
  composeMode: QueryExecMode;
  onComposeModeChange: (next: QueryExecMode) => void;
  onUpdateText: (id: string, text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSetMode: (id: string, mode: QueryExecMode) => Promise<void>;
}) {
  const { t } = useI18n();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  useEffect(() => {
    if (editingId && !inbox.some((item) => item.id === editingId)) {
      setEditingId(null);
      setDraft('');
    }
  }, [editingId, inbox]);

  const beginEdit = (item: SteerInboxItem) => {
    setEditingId(item.id);
    setDraft(item.text);
  };

  const commitEdit = async (id: string) => {
    const next = draft.trim();
    if (!next) return;
    setRowBusy(id);
    try {
      await onUpdateText(id, next);
      setEditingId(null);
      setDraft('');
    } finally {
      setRowBusy(null);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft('');
  };

  const changeMode = async (item: SteerInboxItem, mode: QueryExecMode) => {
    if (queryExecModeOf(item) === mode) return;
    setRowBusy(item.id);
    try {
      await onSetMode(item.id, mode);
    } finally {
      setRowBusy(null);
    }
  };

  const remove = async (id: string) => {
    setRowBusy(id);
    try {
      await onDelete(id);
      if (editingId === id) cancelEdit();
    } finally {
      setRowBusy(null);
    }
  };

  return (
    <ConfigGroup title={t('play.queue.title')} tip={t('play.queue.tip')}>
      <div className="query-queue" role="group" aria-label={t('play.queue.aria')}>
        <div className="query-queue__compose">
          <span className="query-queue__compose-label">{t('play.queue.nextMode')}</span>
          <div className="query-queue__modes" role="group" aria-label={t('play.queue.modeAria')}>
            <button
              type="button"
              className={`query-queue__mode${composeMode === 'steering' ? ' is-active' : ''}`}
              aria-pressed={composeMode === 'steering'}
              disabled={busy}
              onClick={() => onComposeModeChange('steering')}
            >
              {t('play.queue.modeSteering')}
            </button>
            <button
              type="button"
              className={`query-queue__mode${composeMode === 'subagent' ? ' is-active' : ''}`}
              aria-pressed={composeMode === 'subagent'}
              disabled={busy}
              onClick={() => onComposeModeChange('subagent')}
            >
              {t('play.queue.modeSubagent')}
            </button>
          </div>
        </div>
        {inbox.length === 0 ? (
          <p className="query-queue__empty">
            {running ? t('play.queue.emptyRunning') : t('play.queue.empty')}
          </p>
        ) : (
          <ul className="query-queue__list">
            {inbox.map((item) => {
              const mode = queryExecModeOf(item);
              const locked = busy || rowBusy === item.id;
              const editing = editingId === item.id;
              return (
                <li key={item.id} className="query-queue__item">
                  {editing ? (
                    <input
                      type="text"
                      className="query-queue__edit"
                      value={draft}
                      disabled={locked}
                      aria-label={t('play.queue.editAria')}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void commitEdit(item.id);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelEdit();
                        }
                      }}
                      onBlur={() => {
                        if (draft.trim() && draft.trim() !== item.text) {
                          void commitEdit(item.id);
                        } else {
                          cancelEdit();
                        }
                      }}
                      autoFocus
                    />
                  ) : (
                    <button
                      type="button"
                      className="query-queue__text"
                      title={item.text}
                      disabled={locked}
                      onClick={() => beginEdit(item)}
                    >
                      {item.text}
                    </button>
                  )}
                  <div className="query-queue__modes query-queue__modes--item">
                    <button
                      type="button"
                      className={`query-queue__mode${mode === 'steering' ? ' is-active' : ''}`}
                      aria-pressed={mode === 'steering'}
                      disabled={locked}
                      onClick={() => void changeMode(item, 'steering')}
                    >
                      {t('play.queue.modeSteering')}
                    </button>
                    <button
                      type="button"
                      className={`query-queue__mode${mode === 'subagent' ? ' is-active' : ''}`}
                      aria-pressed={mode === 'subagent'}
                      disabled={locked}
                      onClick={() => void changeMode(item, 'subagent')}
                    >
                      {t('play.queue.modeSubagent')}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="query-queue__delete"
                    disabled={locked}
                    aria-label={t('play.queue.deleteAria')}
                    title={t('play.queue.delete')}
                    onClick={() => void remove(item.id)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ConfigGroup>
  );
}
