/**
 * Self-heal scheduler: manages the self-heal run state machine.
 *
 * Extracted from RawAgentRuntime to reduce the God Object.
 * The scheduler advances each active run through its lifecycle:
 *   pending → running_tests → fixing → tests_passed → merging → restart_pending → completed
 */

import { errorMessage } from './errors.js';
import {
  gitCheckoutBranch,
  gitMergeAbort,
  gitMergeBranch,
  gitPushBranch,
  gitResolveBranch,
  gitRevParseHead,
  gitStashPop,
  gitStashPush,
  gitWorktreeClean,
  runSelfHealNpmTest,
} from './self-heal-executors.js';
import { normalizeSelfHealPolicy, npmScriptForSelfHealPolicy } from './self-heal-policy.js';
import type { SqliteStateStore } from './storage.js';
import type {
  DaemonRestartRequest,
  MessagePart,
  SelfHealEventRecord,
  SelfHealPolicy,
  SelfHealRunRecord,
} from './types.js';

function textPart(text: string): MessagePart {
  return { type: 'text', text };
}

function formatAgeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export interface SelfHealContext {
  store: SqliteStateStore;
  repoRoot: string;
  /**
   * Creates the initial task + session for a self-heal run.
   * Returns the IDs so the scheduler can record them.
   */
  createTaskSession: (input: {
    title: string;
    description: string;
    message: string;
    agentId: string;
    background: boolean;
    metadata: Record<string, unknown>;
  }) => { task: { id: string }; session: { id: string } };
  /** Runs the agent session to produce a fix. */
  runSession: (sessionId: string) => Promise<void>;
  /** Binds a workspace to a task, returns workspace root. */
  bindWorkspaceForTask: (taskId: string) => Promise<string | undefined>;
}

export class SelfHealScheduler {
  private heartbeatAt = new Map<string, number>();
  private lastPrintedStatus = new Map<string, string>();
  private multiRunWarned = false;

  constructor(private readonly ctx: SelfHealContext) {}

  // ── Public API ──

  startRun(policy?: Partial<SelfHealPolicy>): SelfHealRunRecord {
    const active = this.ctx.store.listActiveSelfHealRuns();
    if (active.length > 0) {
      throw new Error(`Another self-heal run is active: ${active[0]!.id}`);
    }
    const normalized = normalizeSelfHealPolicy(policy);
    const run = this.ctx.store.createSelfHealRun({ policy: normalized });
    this.ctx.store.appendSelfHealEvent({ runId: run.id, kind: 'created', payload: { policy: normalized } });
    return this.ctx.store.getSelfHealRun(run.id) as SelfHealRunRecord;
  }

  stopRun(id: string): SelfHealRunRecord {
    return this.ctx.store.updateSelfHealRun(id, { stopped: true, status: 'stopped' });
  }

  resumeRun(id: string): SelfHealRunRecord {
    const run = this.ctx.store.getSelfHealRun(id);
    if (!run) {
      throw new Error(`Self-heal run ${id} not found`);
    }
    if (run.status === 'stopped') {
      return this.ctx.store.updateSelfHealRun(id, { stopped: false, status: 'running_tests', blockReason: undefined });
    }
    const nextStatus = run.status === 'fixing' ? 'fixing' : run.status === 'merging' ? 'merging' : 'running_tests';
    return this.ctx.store.updateSelfHealRun(id, {
      stopped: false,
      status: run.status === 'blocked' ? 'running_tests' : nextStatus,
      blockReason: undefined,
    });
  }

  getRun(id: string): SelfHealRunRecord | undefined {
    return this.ctx.store.getSelfHealRun(id);
  }

  listRuns(limit?: number): SelfHealRunRecord[] {
    return this.ctx.store.listSelfHealRuns({ limit });
  }

  listActiveRuns(): SelfHealRunRecord[] {
    return this.ctx.store.listActiveSelfHealRuns();
  }

  listEvents(runId: string, limit?: number): SelfHealEventRecord[] {
    return this.ctx.store.listSelfHealEvents(runId, limit);
  }

  getDaemonRestartRequest(): DaemonRestartRequest | undefined {
    return this.ctx.store.getDaemonControl<DaemonRestartRequest>('restart_request');
  }

  acknowledgeDaemonRestart(): void {
    const req = this.ctx.store.getDaemonControl<DaemonRestartRequest>('restart_request');
    this.ctx.store.deleteDaemonControl('restart_request');
    const runId = req?.runId;
    if (runId) {
      const run = this.ctx.store.getSelfHealRun(runId);
      if (run?.status === 'restart_pending') {
        this.ctx.store.updateSelfHealRun(runId, { restartAckAt: new Date().toISOString(), status: 'completed' });
        this.ctx.store.appendSelfHealEvent({ runId, kind: 'restart_acked', payload: {} });
      }
    }
  }

  // ── Scheduler tick ──

  async processRuns(): Promise<void> {
    const active = this.ctx.store.listActiveSelfHealRuns();
    for (const run of active) {
      try {
        await this.advanceRun(run);
      } catch (error) {
        const message = errorMessage(error);
        this.ctx.store.updateSelfHealRun(run.id, { status: 'failed', blockReason: message });
        this.ctx.store.appendSelfHealEvent({ runId: run.id, kind: 'error', payload: { message } });
        this.log(run.id, `fatal: ${message}`);
      }
    }
    const activeHb = this.ctx.store.listActiveSelfHealRuns();
    if (activeHb.length > 1) {
      if (!this.multiRunWarned) {
        this.multiRunWarned = true;
        console.log(
          `[self-heal] note: ${activeHb.length} concurrent runs (only one is normal). List: npm run start:cli -- self-heal runs — stop one: npm run start:cli -- self-heal stop <runId>`,
        );
      }
    } else {
      this.multiRunWarned = false;
    }
    for (const run of activeHb) {
      this.emitHeartbeat(run);
    }
  }

  // ── Private ──

  private log(runId: string, message: string): void {
    const short = runId.length > 14 ? runId.slice(-14) : runId;
    console.log(`[self-heal] ${short} ${message}`);
  }

  private runSummary(run: SelfHealRunRecord): string {
    let npm = 'test:unit';
    try {
      npm = npmScriptForSelfHealPolicy(run.policy);
    } catch { /* keep default */ }
    const sid = run.sessionId;
    const sess = sid ? this.ctx.store.getSession(sid) : undefined;
    const sessTail = sid ? (sid.length > 10 ? `…${sid.slice(-8)}` : sid) : '—';
    const sessSt = sess?.status ?? '—';
    const branch = run.worktreeBranch ?? '—';
    const age = formatAgeSince(run.createdAt);
    return `phase=${run.status} npm run ${npm} branch=${branch} fix#${run.fixIteration} age=${age} session=${sessTail}(${sessSt})`;
  }

  private emitHeartbeat(run: SelfHealRunRecord): void {
    const terminal = new Set(['completed', 'failed', 'blocked', 'stopped']);
    if (terminal.has(run.status)) {
      this.heartbeatAt.delete(run.id);
      this.lastPrintedStatus.delete(run.id);
      return;
    }
    const st = run.status;
    if (this.lastPrintedStatus.get(run.id) !== st) {
      this.lastPrintedStatus.set(run.id, st);
      this.log(run.id, `status → ${st} | ${this.runSummary(run)}`);
    }
    const now = Date.now();
    const last = this.heartbeatAt.get(run.id) ?? 0;
    if (now - last < 8000) return;
    this.heartbeatAt.set(run.id, now);
    const hint = this.waitHint(run);
    this.log(run.id, `heartbeat | ${this.runSummary(run)} | ${hint}`);
  }

  private waitHint(run: SelfHealRunRecord): string {
    const sid = run.sessionId;
    const sess = sid ? this.ctx.store.getSession(sid) : undefined;
    switch (run.status) {
      case 'pending': return 'starting worktree + task (next: whitelist npm test)';
      case 'running_tests':
        return sess?.status === 'running'
          ? 'waiting: self-healer chat still active (LLM/tools) — next npm test runs after this session finishes'
          : 'running or scheduling whitelist tests in worktree';
      case 'fixing':
        return sess?.status === 'running' ? 'waiting: fix wave — self-healer model still working' : 'fix phase (scheduling)';
      case 'merging': return 'merging worktree branch into main (may stash)';
      case 'restart_pending': return 'merge done — supervisor must restart daemon (restart-request pending)';
      case 'tests_passed': return 'finishing (merge/restart bookkeeping)';
      default: return run.status;
    }
  }

  // ── State machine ──

  private async advanceRun(run: SelfHealRunRecord): Promise<void> {
    const r = this.ctx.store.getSelfHealRun(run.id);
    if (!r || r.stopped) return;
    const policy = r.policy;

    if (r.status === 'restart_pending') {
      if (r.restartAckAt) {
        this.log(r.id, 'restart acknowledged — run completed');
        this.ctx.store.updateSelfHealRun(r.id, { status: 'completed' });
      }
      return;
    }

    if (r.status === 'pending') {
      await this.advancePending(r, policy);
      return;
    }

    const sessionId = r.sessionId;
    const taskId = r.taskId;
    if (!sessionId || !taskId) {
      this.ctx.store.updateSelfHealRun(r.id, { status: 'failed', blockReason: 'missing session or task' });
      return;
    }

    if (r.status === 'running_tests') {
      await this.advanceRunningTests(r, policy, sessionId, taskId);
      return;
    }
    if (r.status === 'fixing') {
      await this.advanceFixing(r, sessionId, taskId);
      return;
    }
    if (r.status === 'tests_passed') {
      this.ctx.store.updateSelfHealRun(r.id, { status: policy.autoMerge ? 'merging' : 'completed' });
      return;
    }
    if (r.status === 'merging') {
      await this.advanceMerging(r, policy);
      return;
    }
  }

  private async advancePending(r: SelfHealRunRecord, policy: SelfHealPolicy): Promise<void> {
    const externalAiToolNames = ['claude_code', 'codex_exec', 'cursor_agent'];
    const sessionMeta: Record<string, unknown> = { selfHealControlled: true, selfHealRunId: r.id };
    if (policy.allowExternalAiTools) {
      sessionMeta.approvalPolicy = {
        rules: externalAiToolNames.map((name) => ({ toolPattern: name, match: 'exact', when: 'auto' })),
      };
    }
    const { task, session } = this.ctx.createTaskSession({
      title: `Self-heal ${r.id.slice(-8)}`,
      description: `Automated self-heal. Policy: ${JSON.stringify(policy)}`,
      message: [
        `Self-heal run ${r.id}.`,
        'Tests run automatically in this task workspace (git worktree).',
        'STACK: backend = packages/core + apps/daemon (TypeScript); frontend = apps/web-console (Next.js 15 App Router, entry: app/page.tsx → components/AgentLabApp.tsx, helpers in lib/). E2E Playwright tests hit the Next origin; /api/* is proxied to daemon via DAEMON_PROXY_TARGET.',
        policy.allowExternalAiTools
          ? 'You may use claude_code, codex_exec, or cursor_agent for complex fixes; they are pre-approved in this session.'
          : 'Fix using read_file / write_file / edit_file / bash only under the workspace root.',
        'Do not merge into the main repository or run git push; the harness merges after tests pass.',
        `Test command: npm run … (preset ${policy.testPreset}).`,
      ].join('\n'),
      agentId: policy.agentId ?? 'self-healer',
      background: true,
      metadata: sessionMeta,
    });
    this.ctx.store.updateTask(task.id, { status: 'in_progress' });
    this.ctx.store.updateSelfHealRun(r.id, { status: 'running_tests', taskId: task.id, sessionId: session.id });
    this.ctx.store.appendSelfHealEvent({ runId: r.id, kind: 'task_created', payload: { taskId: task.id, sessionId: session.id } });
    this.log(r.id, 'task + session created; next tick will run tests in worktree');
  }

  private async advanceRunningTests(
    r: SelfHealRunRecord,
    policy: SelfHealPolicy,
    sessionId: string,
    taskId: string,
  ): Promise<void> {
    const wsRoot = await this.ctx.bindWorkspaceForTask(taskId);
    if (!wsRoot) {
      this.ctx.store.updateSelfHealRun(r.id, { status: 'blocked', blockReason: 'no workspace root' });
      return;
    }
    const task = this.ctx.store.getTask(taskId);
    const ws = task?.workspaceId ? this.ctx.store.getWorkspace(task.workspaceId) : undefined;
    const branch = await gitResolveBranch(wsRoot);
    if (branch) {
      this.ctx.store.updateSelfHealRun(r.id, { worktreeBranch: branch });
    }

    const session = this.ctx.store.getSession(sessionId);
    if (session?.status === 'running') return;

    let npmScript = String(policy.testPreset);
    try { npmScript = npmScriptForSelfHealPolicy(policy); } catch { /* keep */ }
    this.log(r.id, `running npm run ${npmScript} (worktree ${ws?.mode ?? '?'}) …`);

    const { ok, output } = await runSelfHealNpmTest(wsRoot, policy);
    const trimmedOut = output.slice(0, 120_000);
    this.ctx.store.updateSelfHealRun(r.id, { lastTestOutput: trimmedOut });
    this.ctx.store.appendSelfHealEvent({
      runId: r.id,
      kind: ok ? 'test_pass' : 'test_fail',
      payload: { ok, snippet: output.slice(0, 2000), workspaceMode: ws?.mode },
    });

    if (ok) {
      this.log(r.id, 'tests passed');
      if (policy.autoMerge) {
        if (ws?.mode === 'directory-copy' || !branch) {
          this.log(r.id, 'blocked: autoMerge needs git worktree with a branch (not directory-copy)');
          this.ctx.store.updateSelfHealRun(r.id, {
            status: 'blocked',
            blockReason: 'autoMerge requires git worktree with a named branch; directory-copy workspace cannot auto-merge',
          });
          return;
        }
        this.ctx.store.updateSelfHealRun(r.id, { status: 'merging', lastErrorSummary: undefined });
      } else {
        this.log(r.id, 'done (autoMerge off)');
        this.ctx.store.updateSelfHealRun(r.id, { status: 'completed', lastErrorSummary: undefined });
      }
      return;
    }

    const summary = output.split('\n').find((line) => line.trim()) ?? 'tests failed';
    if (r.fixIteration >= policy.maxFixIterations) {
      this.ctx.store.updateSelfHealRun(r.id, { status: 'failed', lastErrorSummary: summary.slice(0, 2000) });
      return;
    }

    this.log(r.id, `tests failed (iter ${r.fixIteration + 1}/${policy.maxFixIterations}) → self-healer will fix`);
    this.ctx.store.appendMessage(sessionId, 'user', [
      textPart(`Tests failed (iteration ${r.fixIteration + 1}/${policy.maxFixIterations}). Output:\n\n${output.slice(0, 80_000)}`),
    ]);
    this.ctx.store.updateSelfHealRun(r.id, { status: 'fixing', lastErrorSummary: summary.slice(0, 2000) });
  }

  private async advanceFixing(r: SelfHealRunRecord, sessionId: string, taskId: string): Promise<void> {
    const session = this.ctx.store.getSession(sessionId);
    if (!session) return;
    if (session.status === 'waiting_approval') {
      this.ctx.store.updateSelfHealRun(r.id, { status: 'blocked', blockReason: 'session waiting for approval' });
      return;
    }
    if (session.status === 'running') return;

    this.log(r.id, `self-healer turn (fix wave, iteration ${r.fixIteration + 1}) …`);
    await this.ctx.runSession(sessionId);

    const after = this.ctx.store.getSession(sessionId);
    if (after?.status === 'waiting_approval') {
      this.ctx.store.updateSelfHealRun(r.id, { status: 'blocked', blockReason: 'approval required mid-fix' });
      return;
    }
    if (after?.status === 'completed') {
      this.ctx.store.updateSession(sessionId, { status: 'idle' });
      const t = this.ctx.store.getTask(taskId);
      if (t) this.ctx.store.updateTask(taskId, { status: 'in_progress' });
    }

    this.ctx.store.updateSelfHealRun(r.id, { status: 'running_tests', fixIteration: r.fixIteration + 1 });
    this.ctx.store.appendSelfHealEvent({ runId: r.id, kind: 'fix_wave_done', payload: { iteration: r.fixIteration + 1 } });
  }

  private async advanceMerging(r: SelfHealRunRecord, policy: SelfHealPolicy): Promise<void> {
    const fresh = this.ctx.store.getSelfHealRun(r.id) as SelfHealRunRecord;
    const wtBranch = fresh.worktreeBranch;
    if (!wtBranch) {
      this.log(r.id, 'blocked: unknown worktree branch');
      this.ctx.store.updateSelfHealRun(r.id, { status: 'blocked', blockReason: 'unknown worktree branch' });
      return;
    }

    this.log(r.id, `merging ${wtBranch} into main at ${this.ctx.repoRoot} …`);
    const autoStashMain = ['1', 'true', 'yes'].includes(
      String(process.env.RAW_AGENT_SELF_HEAL_AUTO_STASH_MAIN ?? '').toLowerCase(),
    );
    let stashedForMerge = false;
    let mainClean = await gitWorktreeClean(this.ctx.repoRoot);
    if (!mainClean && autoStashMain) {
      const stash = await gitStashPush(this.ctx.repoRoot, `self-heal merge ${r.id}`);
      if (stash.ok) {
        stashedForMerge = true;
        this.ctx.store.appendSelfHealEvent({ runId: r.id, kind: 'main_stashed', payload: { snippet: stash.output.slice(0, 500) } });
        mainClean = await gitWorktreeClean(this.ctx.repoRoot);
      }
    }
    if (!mainClean) {
      this.log(r.id, 'blocked: main repo dirty (enable RAW_AGENT_SELF_HEAL_AUTO_STASH_MAIN=1 or stash/commit)');
      this.ctx.store.updateSelfHealRun(r.id, {
        status: 'blocked',
        blockReason: autoStashMain
          ? 'main repo has uncommitted changes and git stash push failed or left a dirty tree; commit/stash manually or fix git stash'
          : 'main repo has uncommitted changes; refusing to merge (set RAW_AGENT_SELF_HEAL_AUTO_STASH_MAIN=1 to auto-stash, or commit/stash manually)',
      });
      return;
    }

    if (policy.targetBranch) {
      const co = await gitCheckoutBranch(this.ctx.repoRoot, policy.targetBranch);
      if (!co.ok) {
        if (stashedForMerge) await gitStashPop(this.ctx.repoRoot);
        this.ctx.store.updateSelfHealRun(r.id, { status: 'blocked', blockReason: `git checkout failed: ${co.output.slice(0, 2000)}` });
        return;
      }
    }

    const mergeResult = await gitMergeBranch(this.ctx.repoRoot, wtBranch);
    if (!mergeResult.ok) {
      this.log(r.id, `merge failed (blocked): ${mergeResult.output.split('\n')[0]?.slice(0, 120) ?? 'see blockReason'}`);
      if (stashedForMerge) {
        await gitMergeAbort(this.ctx.repoRoot);
        const pop = await gitStashPop(this.ctx.repoRoot);
        if (!pop.ok) {
          this.ctx.store.appendSelfHealEvent({ runId: r.id, kind: 'stash_pop_after_merge_abort', payload: { output: pop.output.slice(0, 2000) } });
        }
      }
      this.ctx.store.updateSelfHealRun(r.id, { status: 'blocked', blockReason: `merge failed: ${mergeResult.output.slice(0, 4000)}` });
      return;
    }

    if (stashedForMerge) {
      const pop = await gitStashPop(this.ctx.repoRoot);
      if (!pop.ok) {
        this.ctx.store.updateSelfHealRun(r.id, {
          status: 'blocked',
          blockReason: `merge succeeded but git stash pop failed; fix conflicts then: git stash pop — ${pop.output.slice(0, 2000)}`,
        });
        return;
      }
      this.ctx.store.appendSelfHealEvent({ runId: r.id, kind: 'main_stash_popped', payload: {} });
    }

    const pushEnabled = ['1', 'true', 'yes'].includes(String(process.env.RAW_AGENT_SELF_HEAL_GIT_PUSH ?? '').toLowerCase());
    if (pushEnabled) {
      const remote = process.env.RAW_AGENT_SELF_HEAL_GIT_REMOTE?.trim() || 'origin';
      const branchName = (await gitResolveBranch(this.ctx.repoRoot)) ?? policy.targetBranch ?? 'main';
      const pushResult = await gitPushBranch(this.ctx.repoRoot, remote, branchName);
      if (!pushResult.ok) {
        this.ctx.store.updateSelfHealRun(r.id, { status: 'blocked', blockReason: `git push failed: ${pushResult.output.slice(0, 4000)}` });
        return;
      }
      this.ctx.store.appendSelfHealEvent({ runId: r.id, kind: 'git_pushed', payload: { remote, branch: branchName, snippet: pushResult.output.slice(0, 500) } });
    }

    const sha = await gitRevParseHead(this.ctx.repoRoot);
    this.log(r.id, `merge OK @ ${sha?.slice(0, 12) ?? '?'}`);
    if (policy.autoRestartDaemon) {
      const req: DaemonRestartRequest = { requestedAt: new Date().toISOString(), reason: `self-heal merge ${r.id}`, runId: r.id };
      this.ctx.store.setDaemonControl('restart_request', req);
      this.ctx.store.updateSelfHealRun(r.id, { status: 'restart_pending', restartRequestedAt: req.requestedAt, mergeCommitSha: sha });
      this.ctx.store.appendSelfHealEvent({ runId: r.id, kind: 'restart_requested', payload: { ...req } as Record<string, unknown> });
      this.log(r.id, 'daemon restart requested — supervisor will restart process');
    } else {
      this.log(r.id, 'completed (no auto-restart)');
      this.ctx.store.updateSelfHealRun(r.id, { status: 'completed', mergeCommitSha: sha });
      this.ctx.store.appendSelfHealEvent({ runId: r.id, kind: 'merge_done', payload: { sha } });
    }
  }
}
