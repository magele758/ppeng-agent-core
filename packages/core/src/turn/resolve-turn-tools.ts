/**
 * Per-turn tool allowlist: external-AI gate, agent/session whitelist, optional groups.
 */

import { envBool } from '../env.js';
import {
  assertToolsetInvariant,
  promptCacheStrictFromEnv
} from '../session/prompt-cache.js';
import {
  filterToolsByOptionalGroups,
  loadOptionalToolGroupsFromEnv,
  mergeEnabledOptionalToolGroups,
  optionalToolGroupsFeatureEnabled,
  parseDefaultEnabledOptionalGroups
} from '../tools/optional-tool-groups.js';
import type { AgentSpec, SessionRecord, ToolContract } from '../types.js';
import {
  applyRunProfileToTools,
  runProfileFromSession,
  sealTaskRunModePatch
} from '../runtime/run-profile.js';
import { sealWorkspaceBindingPatch, workspaceBindingFromMetadata } from '../workspace/index.js';

export function filterToolsForSession(input: {
  env: NodeJS.ProcessEnv;
  tools: ToolContract<any>[];
  agent: AgentSpec;
  session: SessionRecord;
}): { allowExternalAiTools: boolean; tools: ToolContract<any>[] } {
  const externalAiCapabilityGate = envBool(input.env, 'RAW_AGENT_EXTERNAL_AI_TOOLS', false);
  const sessionOptIn = input.session.metadata?.allowExternalAiTools === true;
  const allowExternalAiTools = externalAiCapabilityGate && sessionOptIn;
  const externallyGated = allowExternalAiTools
    ? input.tools
    : input.tools.filter((t) => !t.isExternal);
  let tools =
    input.agent.allowedTools && input.agent.allowedTools.length > 0
      ? externallyGated.filter((t) => input.agent.allowedTools!.includes(t.name))
      : externallyGated;

  const metaAllowed = input.session.metadata?.allowedTools;
  if (Array.isArray(metaAllowed) && metaAllowed.length > 0) {
    const allow = new Set(metaAllowed.map((n) => String(n)));
    tools = tools.filter((t) => allow.has(t.name));
  }

  const assembled = tools;

  const hasExplicitOptionalToolSelection =
    input.session.metadata &&
    Object.prototype.hasOwnProperty.call(input.session.metadata, 'enabledOptionalToolGroups');
  const defaultOptionalGroups = parseDefaultEnabledOptionalGroups(input.env);
  if (
    optionalToolGroupsFeatureEnabled(input.env) &&
    (hasExplicitOptionalToolSelection || defaultOptionalGroups.length > 0)
  ) {
    const groups = loadOptionalToolGroupsFromEnv(input.env);
    const clientEnabled = hasExplicitOptionalToolSelection
      ? input.session.metadata?.enabledOptionalToolGroups
      : [];
    const enabled = mergeEnabledOptionalToolGroups(defaultOptionalGroups, clientEnabled);
    tools = filterToolsByOptionalGroups(tools, enabled, groups).tools;
  }

  const profile = runProfileFromSession(input.session);
  tools = applyRunProfileToTools(tools, profile, assembled);
  return { allowExternalAiTools, tools };
}

export function resolveTurnTools(input: {
  env: NodeJS.ProcessEnv;
  tools: ToolContract<any>[];
  agent: AgentSpec;
  session: SessionRecord;
  sessionId: string;
  systemPromptChars: number;
}): {
  allowExternalAiTools: boolean;
  turnTools: ToolContract<any>[];
  turnShape: { systemPromptChars: number; toolCount: number };
  metadataPatch: Record<string, unknown>;
  drifted: boolean;
  fingerprint?: string;
  promptCacheKey: string;
} {
  const filtered = filterToolsForSession(input);
  const allowExternalAiTools = filtered.allowExternalAiTools;
  const turnTools = filtered.tools;
  const profile = runProfileFromSession(input.session);
  const bindPatch = sealTaskRunModePatch(input.session.metadata, profile.mode);
  const workspaceSeal = sealWorkspaceBindingPatch(
    input.session.metadata,
    workspaceBindingFromMetadata(input.session.metadata)
  );

  const toolsetLock = assertToolsetInvariant(
    input.sessionId,
    turnTools.map((t) => t.name),
    input.session.metadata,
    { strict: promptCacheStrictFromEnv(input.env) }
  );

  return {
    allowExternalAiTools,
    turnTools,
    turnShape: {
      systemPromptChars: input.systemPromptChars,
      toolCount: turnTools.length
    },
    metadataPatch: { ...toolsetLock.metadataPatch, ...bindPatch, ...workspaceSeal },
    drifted: toolsetLock.drifted,
    fingerprint: toolsetLock.fingerprint,
    promptCacheKey: toolsetLock.promptCacheKey
  };
}
