'use client';

import { useI18n } from '@/lib/i18n';
import type { AuthUser } from '@/lib/auth';
import { AccountMenu } from '../AccountMenu';
import { LanguageToggle } from '../LanguageToggle';
import { ModelSettingsDialog } from '../ModelSettingsDialog';
import { ThemeToggle } from '../ThemeToggle';
import { AgentsSection } from '../sections/agents/AgentsSection';
import { ChatSection } from '../sections/chat/ChatSection';
import { KnowledgeSection } from '../sections/knowledge/KnowledgeSection';
import { OpsSection } from '../sections/ops/OpsSection';
import { SettingsSection } from '../sections/settings/SettingsSection';
import { TasksSection } from '../sections/tasks/TasksSection';
import { useLab } from './LabProvider';
import { Rail } from './Rail';
import { ShellToolbar } from './ShellToolbar';

export function LabShell({ authUser }: { authUser: AuthUser | null }) {
  const { t } = useI18n();
  const { location, modelSetupOpen, setModelSetupOpen, getChatBridge } = useLab();
  const section = location.section;

  return (
    <>
      <a className="skip-link" href="#lab-main">
        {t('nav.skipToContent')}
      </a>
      <div className="ambient" aria-hidden="true">
        <div className="ambient-grid" />
      </div>
      <div className="app lab-shell">
        <Rail
          footer={
            <>
              <button
                type="button"
                className={`btn btn-ghost btn-sm${modelSetupOpen ? ' is-active' : ''}`}
                id="btnModelSetup"
                aria-haspopup="dialog"
                aria-expanded={modelSetupOpen}
                onClick={() => setModelSetupOpen(true)}
              >
                {t('nav.configureModel')}
              </button>
              <LanguageToggle />
              <ThemeToggle />
              {authUser ? <AccountMenu user={authUser} /> : null}
            </>
          }
        />
        <main className="lab-main" id="lab-main">
          {section !== 'chat' ? <ShellToolbar /> : null}
          <div className="lab-view" hidden={section !== 'chat'}>
            <ChatSection active={section === 'chat'} />
          </div>
          <AgentsSection active={section === 'agents'} />
          <TasksSection active={section === 'tasks'} />
          <KnowledgeSection active={section === 'knowledge'} />
          <OpsSection active={section === 'ops'} />
          <SettingsSection active={section === 'settings'} />
        </main>
        <ModelSettingsDialog
          open={modelSetupOpen}
          onClose={() => setModelSetupOpen(false)}
          onCatalogChange={(data) => getChatBridge()?.applyModelCatalog(data)}
        />
      </div>
    </>
  );
}
