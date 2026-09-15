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
import {
  resolveWebSearchTemplate,
  type WebSettingsReadStore
} from '../tools/web-settings.js';
import { DYN_META_TOOL_NAMES, SEARCH_DYN_TOOLS_NAME } from '../dyn-tools/types.js';
import { readDynToolSettings } from '../dyn-tools/settings.js';
import { tryCreateDynToolStore } from '../dyn-tools/store.js';
import { isPtcSession } from '../ptc/mode.js';

function searchDynToolsNeeded(
  settingsStore: WebSettingsReadStore | undefined,
  sessionId: string,
  settings: ReturnType<typeof readDynToolSettings>
): boolean {
  if (!settings.enabled || !settingsStore) return false;
  const dyn = tryCreateDynToolStore(settingsStore as Parameters<typeof tryCreateDynToolStore>[0]);
  if (!dyn) return false;
  return dyn.listActive(sessionId).length > settings.hydrateTopK;
}

export function filterToolsForSession(input: {
  env: NodeJS.ProcessEnv;
  tools: ToolContract<any>[];
  agent: AgentSpec;
  session: SessionRecord;
  settingsStore?: WebSettingsReadStore;
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
  if (!resolveWebSearchTemplate(input.settingsStore, input.env)) {
    tools = tools.filter((t) => t.name !== 'web_search');
  }

  const dynSettings = readDynToolSettings(input.settingsStore);
  const meta = new Set<string>(DYN_META_TOOL_NAMES);
  if (!dynSettings.enabled) {
    tools = tools.filter((t) => !meta.has(t.name));
  } else {
    const allowSave = dynSettings.allowSave || isPtcSession(input.session);
    const needSearch = searchDynToolsNeeded(input.settingsStore, input.session.id, dynSettings);
    const have = new Set(tools.map((t) => t.name));
    for (const t of assembled) {
      if (!meta.has(t.name) || have.has(t.name)) continue;
      if (t.name === 'save_as_tool' && !allowSave) continue;
      if (t.name === 'propose_tool' && !dynSettings.allowPropose) continue;
      if (t.name === SEARCH_DYN_TOOLS_NAME && !needSearch) continue;
      tools.push(t);
      have.add(t.name);
    }
    if (!allowSave) {
      tools = tools.filter((t) => t.name !== 'save_as_tool');
    }
    if (!dynSettings.allowPropose) {
      tools = tools.filter((t) => t.name !== 'propose_tool');
    }
    if (!needSearch) {
      tools = tools.filter((t) => t.name !== SEARCH_DYN_TOOLS_NAME);
    }
  }
  return { allowExternalAiTools, tools };
}

export function resolveTurnTools(input: {
  env: NodeJS.ProcessEnv;
  tools: ToolContract<any>[];
  agent: AgentSpec;
  session: SessionRecord;
  sessionId: string;
  systemPromptChars: number;
  settingsStore?: WebSettingsReadStore;
  /** Harvested ptc_cell tools for this turn (already materialized). */
  dynTools?: ToolContract<any>[];
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
  const names = new Set(filtered.tools.map((t) => t.name));
  const extras: ToolContract<any>[] = [];
  for (const tool of input.dynTools ?? []) {
    if (names.has(tool.name)) continue;
    extras.push(tool);
    names.add(tool.name);
  }
  const turnTools = extras.length > 0 ? [...filtered.tools, ...extras] : filtered.tools;
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
