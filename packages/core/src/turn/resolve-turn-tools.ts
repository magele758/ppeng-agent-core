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
  const externalAiCapabilityGate = envBool(input.env, 'RAW_AGENT_EXTERNAL_AI_TOOLS', false);
  const sessionOptIn = input.session.metadata?.allowExternalAiTools === true;
  const allowExternalAiTools = externalAiCapabilityGate && sessionOptIn;
  const externallyGated = allowExternalAiTools
    ? input.tools
    : input.tools.filter((t) => !t.isExternal);
  let turnTools =
    input.agent.allowedTools && input.agent.allowedTools.length > 0
      ? externallyGated.filter((t) => input.agent.allowedTools!.includes(t.name))
      : externallyGated;

  const metaAllowed = input.session.metadata?.allowedTools;
  if (Array.isArray(metaAllowed) && metaAllowed.length > 0) {
    const allow = new Set(metaAllowed.map((n) => String(n)));
    turnTools = turnTools.filter((t) => allow.has(t.name));
  }

  const hasExplicitOptionalToolSelection =
    input.session.metadata &&
    Object.prototype.hasOwnProperty.call(input.session.metadata, 'enabledOptionalToolGroups');
  const defaultOptionalGroups = parseDefaultEnabledOptionalGroups(input.env);
  if (
    optionalToolGroupsFeatureEnabled(input.env) &&
    (hasExplicitOptionalToolSelection || defaultOptionalGroups.length > 0)
  ) {
    const ogroups = loadOptionalToolGroupsFromEnv(input.env);
    const clientEnabled = hasExplicitOptionalToolSelection
      ? input.session.metadata?.enabledOptionalToolGroups
      : [];
    const enabled = mergeEnabledOptionalToolGroups(defaultOptionalGroups, clientEnabled);
    turnTools = filterToolsByOptionalGroups(turnTools, enabled, ogroups).tools;
  }

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
    metadataPatch: toolsetLock.metadataPatch,
    drifted: toolsetLock.drifted,
    fingerprint: toolsetLock.fingerprint,
    promptCacheKey: toolsetLock.promptCacheKey
  };
}
