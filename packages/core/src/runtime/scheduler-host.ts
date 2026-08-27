/**
 * Scheduler / cron / mailbox-wake host extracted from RawAgentRuntime.
 */

import { CronJobStore, cronToolsFeatureEnabled, markCronJobRan } from '../cron/cron-store.js';
import type { Logger } from '../logger.js';
import type { AutonomousScheduler } from '../services/autonomous-scheduler.js';
import type { SqliteStateStore } from '../storage.js';
import type { SessionRecord } from '../types.js';
import { textPart } from './session-facade.js';

export interface SchedulerTickHost {
  store: SqliteStateStore;
  stateDir: string;
  log: Logger;
  cronStore: CronJobStore | undefined;
  setCronStore(store: CronJobStore): void;
  selfHeal: { processRuns(): Promise<void> };
  swarmExecutor: { tick(): Promise<unknown> };
  orchestrationEngine: { tick(): Promise<unknown> };
  autonomousScheduler: AutonomousScheduler;
  runSession(sessionId: string): Promise<SessionRecord>;
}

/** Tick due cron jobs: append prompt to owning session and enqueue a run. */
export async function tickCronJobs(host: SchedulerTickHost): Promise<number> {
  let cronStore = host.cronStore;
  if (!cronStore) {
    cronStore = new CronJobStore(host.stateDir);
    host.setCronStore(cronStore);
  }
  const due = cronStore.dueJobs();
  let n = 0;
  for (const job of due) {
    const session = host.store.getSession(job.sessionId);
    if (!session) {
      cronStore.update(job.id, { enabled: false });
      continue;
    }
    host.store.appendMessage(job.sessionId, 'user', [
      textPart(`[cron:${job.name}] ${job.prompt}`)
    ]);
    markCronJobRan(cronStore, job);
    if (session.background && session.status === 'idle') {
      host.store.enqueueSchedulerWake(job.sessionId, `cron:${job.id}`);
    } else if (session.status === 'idle') {
      void host.runSession(job.sessionId).catch((err) => {
        host.log.warn('cron session run failed', {
          sessionId: job.sessionId,
          error: err instanceof Error ? err.message : String(err)
        });
      });
    }
    n += 1;
  }
  return n;
}

export async function runScheduler(host: SchedulerTickHost): Promise<void> {
  await host.selfHeal.processRuns();
  await host.swarmExecutor.tick();
  await host.orchestrationEngine.tick();
  if (cronToolsFeatureEnabled(process.env)) {
    await tickCronJobs(host);
  }
  await host.autonomousScheduler.tick();
}

export async function ingestMailbox(store: SqliteStateStore, session: SessionRecord): Promise<void> {
  const pending = store.listMailbox(session.agentId, true);
  if (pending.length === 0) {
    return;
  }

  const delivered = pending.map((mail) => store.markMailRead(mail.id));
  const text = delivered
    .map((mail) => `[${mail.type}] from ${mail.fromAgentId}${mail.correlationId ? ` (${mail.correlationId})` : ''}: ${mail.content}`)
    .join('\n');

  store.appendMessage(session.id, 'user', [textPart(`Inbox:\n${text}`)]);
}

export async function autoClaimTask(store: SqliteStateStore, session: SessionRecord): Promise<void> {
  if (session.mode !== 'teammate') {
    return;
  }

  const available = store
    .listTasks({ status: 'pending' })
    .find((task) => !task.ownerAgentId && task.blockedBy.length === 0);

  if (!available) {
    return;
  }

  store.updateTask(available.id, {
    ownerAgentId: session.agentId,
    status: 'in_progress',
    sessionId: session.id
  });
  store.appendMessage(
    session.id,
    'user',
    [textPart(`You auto-claimed task ${available.id}: ${available.title}\n${available.description}`)]
  );
}

export async function unblockDependentTasks(
  store: SqliteStateStore,
  completedTaskId: string
): Promise<void> {
  const tasks = store.listTasks();
  for (const task of tasks) {
    if (!task.blockedBy.includes(completedTaskId)) {
      continue;
    }

    const nextBlockedBy = task.blockedBy.filter((candidate) => candidate !== completedTaskId);
    const nextStatus = task.status === 'pending' ? 'pending' : nextBlockedBy.length === 0 ? 'pending' : task.status;
    store.updateTask(task.id, {
      blockedBy: nextBlockedBy,
      status: nextStatus
    });
  }
}

/** Swarm teammate is done when completed, or idle after at least one assistant/tool WAL turn. */
export function sessionTeammateFinished(store: SqliteStateStore, sessionId: string): boolean {
  const session = store.getSession(sessionId);
  if (!session) return false;
  if (session.status === 'completed') return true;
  if (session.status !== 'idle') return false;
  return store.listMessages(sessionId).some((m) => m.role === 'assistant' || m.role === 'tool');
}
