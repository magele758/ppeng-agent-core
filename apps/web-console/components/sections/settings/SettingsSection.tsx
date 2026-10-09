'use client';

import { useMemo, useState } from 'react';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { SUB_PAGES } from '@/lib/nav';
import { filterSettingsEntries } from '@/lib/settings-search';
import { AdvancedToggle, EmptyState, Section, useAdvancedMode } from '../../ui';
import { useLab } from '../../shell/LabProvider';
import { useSectionNav } from '../../shell/useSectionNav';
import { SETTINGS_ENTRIES, type SettingsCategoryId } from './registry';

export function SettingsSection({ active }: { active: boolean }) {
  const { t } = useI18n();
  const { selectedSessionId } = useLab();
  const { sub, select } = useSectionNav('settings');
  const [advanced] = useAdvancedMode();
  const [query, setQuery] = useState('');

  const searchable = useMemo(
    () =>
      SETTINGS_ENTRIES.map((entry) => ({
        entry,
        id: entry.id,
        advanced: entry.advanced,
        haystack: [t(entry.titleKey), entry.keywordsKey ? t(entry.keywordsKey) : '', entry.id].join(' ')
      })),
    [t]
  );

  const searching = query.trim().length > 0;
  const category = (sub ?? SUB_PAGES.settings[0]) as SettingsCategoryId;

  const visible = useMemo(() => {
    const matched = filterSettingsEntries(searchable, query, advanced);
    return searching ? matched : matched.filter((m) => m.entry.category === category);
  }, [searchable, query, advanced, searching, category]);

  if (!active) return null;

  const categoryLabel = (id: SettingsCategoryId) => t(`settings.categories.${id}` as MessageKey);

  return (
    <div className="lab-page">
      <Section
        id="section-settings"
        title={t('shell.nav.settings')}
        description={t('shell.desc.settings')}
        actions={<AdvancedToggle />}
      >
        <div className="settings-search">
          <input
            type="search"
            id="settingsSearch"
            value={query}
            placeholder={t('settings.searchPlaceholder')}
            aria-label={t('settings.searchPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label={t('settings.categoriesLabel')}>
            {SUB_PAGES.settings.map((id) => (
              <button
                key={id}
                type="button"
                id={`settings-cat-${id}`}
                className={`settings-nav__item${!searching && id === category ? ' is-active' : ''}`}
                aria-current={!searching && id === category ? 'page' : undefined}
                onClick={() => {
                  setQuery('');
                  select(id);
                }}
              >
                {categoryLabel(id)}
              </button>
            ))}
          </nav>
          <div className="settings-entries" id={`section-settings-${searching ? 'search' : category}`}>
            {visible.length === 0 ? (
              <EmptyState
                title={searching ? t('settings.noResultsTitle') : t('settings.emptyCategoryTitle')}
                description={searching ? t('settings.noResultsDesc', { query: query.trim() }) : t('settings.emptyCategoryDesc')}
              />
            ) : (
              visible.map(({ entry }) => (
                <div key={entry.id} id={`setting-${entry.id}`} className="settings-entry">
                  {searching ? (
                    <span className="settings-entry__tag">
                      {categoryLabel(entry.category)}
                      {entry.advanced ? ` · ${t('shell.ui.advanced')}` : ''}
                    </span>
                  ) : null}
                  {entry.render({ sessionId: selectedSessionId ?? undefined })}
                </div>
              ))
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}
