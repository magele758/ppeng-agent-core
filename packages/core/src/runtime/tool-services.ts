/**
 * Build RuntimeToolServices for builtin tools — extracted from RawAgentRuntime.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NotFoundError, ValidationError } from '../errors.js';
import {
  imageBufferToDataUrl,
  touchImageAccess
} from '../image-assets.js';
import type { RuntimeToolServices } from '../tools/builtin-tools.js';
import {
  HARNESS_ARTIFACT_DIR,
  harnessWriteSpecBasename,
  type BackgroundJobRecord,
  type RunContext
} from '../types.js';
import type { SqliteStateStore } from '../storage.js';

export interface ToolServicesHost {
  store: SqliteStateStore;
  stateDir: string;
  resolveSkillLoad: (name: string, sessionId: string) => Promise<{ content?: string; error?: string }>;
  unblockDependentTasks: (taskId: string) => Promise<void>;
  spawnSubagent: (
    context: RunContext,
    prompt: string,
    role?: string,
    opts?: { allowedTools?: string[]; model?: string; minConfidence?: number; summaryMaxChars?: number }
  ) => Promise<string>;
  spawnTeammate: (
    context: RunContext,
    input: { name: string; role: string; prompt: string }
  ) => Promise<string>;
  startBackgroundJob: (sessionId: string, command: string) => Promise<BackgroundJobRecord>;
}

export function createToolServices(host: ToolServicesHost): RuntimeToolServices {
  return {
    loadSkill: (name, sessionId) => host.resolveSkillLoad(name, sessionId),
    updateTodo: async (sessionId, items) => {
      const session = host.store.getSession(sessionId);
      if (!session) {
        throw new NotFoundError('Session', sessionId);
      }
      return host.store.updateSession(sessionId, { todo: items }).todo;
    },
    createTask: async (input) => host.store.createTask(input),
    getTask: async (taskId) => host.store.getTask(taskId),
    listTasks: async () => host.store.listTasks(),
    updateTask: async (taskId, patch) => {
      const mergedPatch = { ...patch };
      if (patch.metadata) {
        const existing = host.store.getTask(taskId);
        mergedPatch.metadata = { ...(existing?.metadata ?? {}), ...patch.metadata };
      }
      const task = host.store.updateTask(taskId, mergedPatch);
      if (patch.status === 'completed') {
        await host.unblockDependentTasks(taskId);
      }
      return task;
    },
    harnessWriteSpec: async (context, input) => {
      const root = context.workspaceRoot ?? context.repoRoot;
      const relName = harnessWriteSpecBasename(input.kind);
      const relPath = join(HARNESS_ARTIFACT_DIR, relName);
      const dir = join(root, HARNESS_ARTIFACT_DIR);
      await mkdir(dir, { recursive: true });
      const abs = join(root, relPath);
      await writeFile(abs, input.content, 'utf8');
      return relPath;
    },
    spawnSubagent: async (context, prompt, role, opts) =>
      host.spawnSubagent(context, prompt, role, opts),
    spawnTeammate: async (context, input) => host.spawnTeammate(context, input),
    listAgents: async () => host.store.listAgents(),
    sendMail: async (context, input) =>
      host.store.createMail({
        fromAgentId: context.agent.id,
        toAgentId: input.toAgentId,
        type: input.type ?? 'message',
        content: input.content,
        correlationId: input.correlationId,
        sessionId: context.session.id,
        taskId: context.task?.id
      }),
    readInbox: async (agentId) => {
      const messages = host.store.listMailbox(agentId, true);
      return messages.map((message) => host.store.markMailRead(message.id));
    },
    startBackgroundJob: async (sessionId, command) => host.startBackgroundJob(sessionId, command),
    getBackgroundJob: async (jobId) => host.store.getBackgroundJob(jobId),
    listBackgroundJobs: async (sessionId) => host.store.listBackgroundJobs(sessionId),
    listWorkspaces: async () =>
      host.store.listWorkspaces().map((workspace) => ({
        id: workspace.id,
        taskId: workspace.taskId,
        name: workspace.name,
        rootPath: workspace.rootPath,
        mode: workspace.mode
      })),
    upsertSessionMemory: async (sessionId, scope, key, value, metadata) => {
      void (await host.store.upsertSessionMemory({ sessionId, scope, key, value, metadata }));
    },
    listSessionMemory: async (sessionId, scope) => host.store.listSessionMemory(sessionId, scope),
    deleteSessionMemory: async (sessionId, scope, key) =>
      host.store.deleteSessionMemory(sessionId, scope, key),
    upsertAgentMemory: async (input) => {
      host.store.agentMemory().set({
        scope: input.scope,
        namespace: input.namespace,
        key: input.key,
        value: input.value,
        sessionId: input.sessionId,
        userId: input.userId,
        tenantId: input.tenantId,
        importance: 0.5,
        confidence: 'medium'
      });
    },
    listAgentMemory: async (input) =>
      host.store.agentMemory().search({
        scope: input.scope,
        sessionId: input.sessionId,
        userId: input.userId,
        tenantId: input.tenantId,
        limit: input.limit ?? 40
      }),
    prefetchAgentMemory: async (input) => {
      const am = host.store.agentMemory();
      const limit = input.limit ?? 20;
      const scopes = [
        'session.scratch',
        'session.long',
        'user.memory',
        'team.memory',
        'project.memory'
      ] as const;
      const out: unknown[] = [];
      for (const scope of scopes) {
        const rows = am.search({
          scope,
          sessionId: input.sessionId,
          userId: input.userId,
          tenantId: input.tenantId,
          query: input.query,
          limit: Math.ceil(limit / scopes.length) + 2,
          orderBy: 'importance'
        });
        out.push(...rows);
        if (out.length >= limit) break;
      }
      return out.slice(0, limit);
    },
    listSessionMessages: (sessionId) => host.store.listMessages(sessionId),
    visionAnalyze: async ({ sessionId: sid, assetIds, prompt, signal: sig }) => {
      const vlModel = process.env.RAW_AGENT_VL_MODEL_NAME?.trim();
      const baseUrl = (
        process.env.RAW_AGENT_VL_BASE_URL ??
        process.env.RAW_AGENT_BASE_URL ??
        ''
      ).trim();
      const apiKey = (
        process.env.RAW_AGENT_VL_API_KEY ??
        process.env.RAW_AGENT_API_KEY ??
        ''
      ).trim();
      if (!vlModel || !baseUrl || !apiKey) {
        throw new ValidationError(
          'vision_analyze requires RAW_AGENT_VL_MODEL_NAME and API base URL/key'
        );
      }
      const { runOpenAiVisionTurn } = await import('../model/model-adapters.js');
      const urls: string[] = [];
      for (const id of assetIds) {
        const asset = host.store.getImageAsset(id);
        if (!asset || asset.sessionId !== sid) continue;
        await touchImageAccess(host.store, id);
        const u = await imageBufferToDataUrl(host.store, host.stateDir, id);
        if (u) urls.push(u);
      }
      if (urls.length === 0) {
        throw new NotFoundError('image assets', sid);
      }
      return runOpenAiVisionTurn({
        baseUrl,
        apiKey,
        model: vlModel,
        userPrompt: prompt,
        imageDataUrls: urls,
        signal: sig
      });
    }
  };
}
