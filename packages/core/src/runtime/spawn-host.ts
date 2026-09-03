/**
 * Subagent / teammate / background-job / orchestration spawn helpers.
 */

import { builtinAgents } from '../builtin-agents.js';
import { ResearchPipeline } from '../deepresearch/pipeline.js';
import { NotFoundError } from '../errors.js';
import { createAgentSandboxFromEnv } from '../sandbox/create-agent-sandbox.js';
import type { AgentSandbox } from '../sandbox/agent-sandbox-types.js';
import {
  formatSubagentSummary,
  resolveSubagentAgentId,
  type SubagentSpawnArgs
} from '../session/subagent-contract.js';
import type { SqliteStateStore } from '../storage.js';
import type { WorkspaceManager } from '../workspaces.js';
import type {
  BackgroundJobRecord,
  RunContext,
  SessionRecord,
  TaskRecord
} from '../types.js';
import { inheritWorkspaceBinding, resolveEffectiveWorkspace, workspaceBindingFromMetadata } from '../workspace/index.js';
import type { OrchestrationRun } from '../orchestrator/types.js';
import {
  createTeammateSession,
  ensureAgent,
  getLatestAssistantText,
  textPart,
  type SessionFacadeHost
} from './session-facade.js';

export interface SpawnHost extends SessionFacadeHost {
  store: SqliteStateStore;
  repoRoot: string;
  stateDir: string;
  workspaceManager: WorkspaceManager;
  sandbox: AgentSandbox | undefined;
  setSandbox(sandbox: AgentSandbox): void;
  backgroundJobAborts: Map<string, AbortController>;
  runSession(sessionId: string): Promise<SessionRecord>;
  cancelSession?(sessionId: string): void;
}

export async function ensureWorkspaceRoot(
  host: SpawnHost,
  session: SessionRecord,
  task?: TaskRecord
): Promise<string | undefined> {
  const binding = workspaceBindingFromMetadata(session.metadata);
  if (binding.kind === 'project' || binding.kind === 'cloud_folder') {
    const effective = await resolveEffectiveWorkspace({
      store: host.store,
      session,
      repoRoot: host.repoRoot,
      stateDir: host.stateDir
    });
    return effective.workspaceRoot;
  }

  if (!task) {
    return undefined;
  }

  if (task.workspaceId) {
    return host.store.getWorkspace(task.workspaceId)?.rootPath;
  }

  const workspace = await host.workspaceManager.createForTask(task.id, task.title);
  host.store.createWorkspace(workspace);
  host.store.updateTask(task.id, { workspaceId: workspace.id });
  host.store.updateSession(session.id, { workspaceId: workspace.id });
  host.store.appendEvent({
    taskId: task.id,
    kind: 'workspace.bound',
    actor: 'system',
    payload: {
      workspaceId: workspace.id,
      rootPath: workspace.rootPath
    }
  });
  return workspace.rootPath;
}

export async function runOrchestrationResearch(
  host: SpawnHost,
  run: OrchestrationRun
): Promise<string> {
  const researchStore = host.store.research();
  const task = researchStore.createTask({
    query: run.title,
    scope: run.sourceRef,
    capabilityTags: [...run.capabilityTags]
  });
  await new ResearchPipeline({
    store: researchStore,
    stateDir: host.stateDir,
    env: process.env
  }).runTask(task.id);
  return `research:${task.id}`;
}

export async function runOrchestrationSubagentStage(
  host: SpawnHost,
  run: OrchestrationRun,
  stage: 'review' | 'test'
): Promise<string> {
  const agentId = stage === 'test' ? 'evaluator' : 'reviewer';
  const spec =
    builtinAgents.find((a) => a.id === agentId) ??
    builtinAgents.find((a) => a.id === 'general') ??
    builtinAgents[0]!;
  ensureAgent(host.store, spec);
  const subagent = host.store.createSession({
    title: `Orchestration ${stage}: ${run.title.slice(0, 60)}`,
    mode: 'subagent',
    agentId,
    background: false,
    metadata: { orchestrationRunId: run.id, orchestrationStage: stage }
  });
  const prompt =
    stage === 'review'
      ? `Review this orchestration item.\nTitle: ${run.title}\nSource: ${run.sourceRef}\nTags: ${run.capabilityTags.join(', ')}\nGive a brief pass/fail review.`
      : `Run a lightweight harness check for:\nTitle: ${run.title}\nSource: ${run.sourceRef}\nReport pass/fail in one short paragraph.`;
  host.store.appendMessage(subagent.id, 'user', [textPart(prompt)]);
  await host.runSession(subagent.id);
  const summary = (getLatestAssistantText(host.store, subagent.id) ?? 'no-output').slice(0, 200);
  return `${stage}:${subagent.id}:${summary}`;
}

export async function spawnSubagent(
  host: SpawnHost,
  context: RunContext,
  prompt: string,
  role?: string,
  opts?: Omit<SubagentSpawnArgs, 'prompt' | 'role'>
): Promise<string> {
  const parentAgent = context.agent;
  const agentId = resolveSubagentAgentId(role, parentAgent.id);
  const childMeta: Record<string, unknown> = {
    parentSessionId: context.session.id,
    subagentRole: role ?? parentAgent.role
  };
  if (opts?.allowedTools?.length) {
    childMeta.allowedTools = opts.allowedTools;
  }
  if (opts?.model) {
    childMeta.modelOverride = opts.model;
  }
  if (opts?.minConfidence != null) {
    childMeta.minConfidence = opts.minConfidence;
  }

  if (context.session.metadata?.permissionMode) {
    childMeta.permissionMode = context.session.metadata.permissionMode;
  }
  Object.assign(childMeta, inheritWorkspaceBinding(context.session.metadata));

  const subagent = host.store.createSession({
    title: `Subagent: ${role ?? parentAgent.role}`,
    mode: 'subagent',
    agentId,
    taskId: context.task?.id,
    parentSessionId: context.session.id,
    background: false,
    metadata: childMeta
  });

  host.store.copySessionMemory(context.session.id, subagent.id, 'scratch');
  const reviewHint =
    role === 'review' || role === 'evaluator' || role === 'reviewer'
      ? `\n\nWhen finished, include a line: confidence: <0-100>`
      : '';
  host.store.appendMessage(subagent.id, 'user', [textPart(`${prompt}${reviewHint}`)]);
  const cancelChild = () => host.cancelSession?.(subagent.id);
  if (opts?.signal?.aborted) throw new Error('Subagent spawn aborted');
  opts?.signal?.addEventListener('abort', cancelChild, { once: true });
  try {
    await host.runSession(subagent.id);
  } finally {
    opts?.signal?.removeEventListener('abort', cancelChild);
  }
  if (opts?.signal?.aborted) throw new Error('Subagent run aborted');
  const raw = getLatestAssistantText(host.store, subagent.id) ?? '(subagent returned no text)';
  const summary = formatSubagentSummary({
    text: raw,
    sessionId: subagent.id,
    role,
    minConfidence: opts?.minConfidence ?? (role === 'review' || role === 'evaluator' ? 80 : undefined),
    summaryMaxChars: opts?.summaryMaxChars
  });
  return summary.text;
}

export async function spawnTeammate(
  host: SpawnHost,
  context: RunContext,
  input: { name: string; role: string; prompt: string }
): Promise<string> {
  const session = createTeammateSession(host, {
    name: input.name,
    role: input.role,
    prompt: input.prompt,
    taskId: context.task?.id,
    parentSessionId: context.session.id,
    background: true,
    metadata: inheritWorkspaceBinding(context.session.metadata)
  });
  host.store.copySessionMemory(context.session.id, session.id, 'scratch');
  await host.runSession(session.id);
  return `Spawned teammate ${input.name} in session ${session.id}`;
}

export async function startBackgroundJob(
  host: SpawnHost,
  sessionId: string,
  command: string
): Promise<BackgroundJobRecord> {
  const session = host.store.getSession(sessionId);
  if (!session) {
    throw new NotFoundError('Session', sessionId);
  }

  const workspaceRoot = session.workspaceId ? host.store.getWorkspace(session.workspaceId)?.rootPath : undefined;
  let cwd = workspaceRoot ?? host.repoRoot;
  let workspace: string | string[] = cwd;
  try {
    const effective = await resolveEffectiveWorkspace({
      store: host.store,
      session,
      repoRoot: host.repoRoot,
      stateDir: host.stateDir,
      isolatedWorkspaceRoot: workspaceRoot
    });
    cwd = effective.workspaceRoot;
    workspace = effective.workspaceRoots.map((r) => r.path);
  } catch {
    workspace = cwd;
  }
  const job = host.store.createBackgroundJob({
    sessionId,
    command,
    status: 'running'
  });

  let sandbox = host.sandbox;
  if (!sandbox) {
    sandbox = createAgentSandboxFromEnv();
    host.setSandbox(sandbox);
  }
  const ac = new AbortController();
  host.backgroundJobAborts.set(job.id, ac);
  sandbox
    .execute({
      command,
      cwd,
      workspace,
      signal: ac.signal,
      sessionId
    })
    .then((result) => {
      host.backgroundJobAborts.delete(job.id);
      const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n') || '(no output)';
      host.store.updateBackgroundJob(job.id, 'completed', output);
      host.store.appendMessage(sessionId, 'user', [textPart(`Background job ${job.id} completed.\n${output.slice(0, 4000)}`)]);
    }).catch((error) => {
      host.backgroundJobAborts.delete(job.id);
      host.store.updateBackgroundJob(job.id, 'error', String(error));
      host.store.appendMessage(sessionId, 'user', [textPart(`Background job ${job.id} failed: ${String(error)}`)]);
    });

  return job;
}
