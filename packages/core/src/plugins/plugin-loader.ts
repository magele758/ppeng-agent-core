/**
 * Minimal plugin package contract (Claude/pi-inspired).
 * A plugin is a directory with plugin.json + optional agents/tools/skills/hooks.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentSpec, SkillSpec, ToolContract } from '../types.js';

export interface PluginManifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  /** Relative paths under the plugin root */
  agents?: string[];
  skills?: string[];
  /** Optional hook script paths keyed by phase */
  hooks?: Partial<
    Record<
      'session_start' | 'pre_tool_use' | 'post_tool_use' | 'stop' | 'pre_compact',
      string
    >
  >;
}

export interface LoadedPlugin {
  root: string;
  manifest: PluginManifest;
  agents: AgentSpec[];
  skills: SkillSpec[];
  /** Tool factories are rare; most plugins ship skills/agents only */
  tools: ToolContract<any>[];
  hookEnv: Record<string, string>;
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function loadAgentFile(path: string): AgentSpec | undefined {
  const raw = readJson<Partial<AgentSpec> & { id?: string }>(path);
  if (!raw?.id || !raw.name || !raw.role || !raw.instructions) return undefined;
  return {
    id: raw.id,
    name: raw.name,
    role: raw.role,
    instructions: raw.instructions,
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.map(String) : [],
    harnessRole: raw.harnessRole,
    autonomous: raw.autonomous,
    model: raw.model,
    allowedTools: raw.allowedTools,
    domainId: raw.domainId
  };
}

function loadSkillMd(path: string, pluginId: string): SkillSpec | undefined {
  try {
    const text = readFileSync(path, 'utf8');
    const fm = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/m.exec(text);
    let name = '';
    let description = '';
    let body = text;
    if (fm) {
      body = fm[2] ?? '';
      for (const line of (fm[1] ?? '').split('\n')) {
        const m = /^(\w+):\s*(.*)$/.exec(line.trim());
        if (!m) continue;
        if (m[1] === 'name') name = m[2]!.replace(/^["']|["']$/g, '');
        if (m[1] === 'description') description = m[2]!.replace(/^["']|["']$/g, '');
      }
    }
    if (!name) {
      const h = /^#\s+(.+)$/m.exec(body);
      name = h?.[1]?.trim() || path.split('/').slice(-2, -1)[0] || 'skill';
    }
    return {
      id: `${pluginId}/${name}`,
      name,
      description: description || name,
      content: body.trim(),
      source: 'workspace',
      skillPath: path
    };
  } catch {
    return undefined;
  }
}

export function loadPluginFromDir(root: string): LoadedPlugin | undefined {
  const manifestPath = join(root, 'plugin.json');
  const alt = join(root, '.ppeng-plugin', 'plugin.json');
  const path = existsSync(manifestPath) ? manifestPath : existsSync(alt) ? alt : '';
  if (!path) return undefined;
  const manifest = readJson<PluginManifest>(path);
  if (!manifest?.id || !manifest.name) return undefined;

  const agents: AgentSpec[] = [];
  for (const rel of manifest.agents ?? []) {
    const a = loadAgentFile(join(root, rel));
    if (a) agents.push(a);
  }
  // Auto-discover agents/*.json
  const agentsDir = join(root, 'agents');
  if (existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir)) {
      if (!f.endsWith('.json')) continue;
      const a = loadAgentFile(join(agentsDir, f));
      if (a && !agents.some((x) => x.id === a.id)) agents.push(a);
    }
  }

  const skills: SkillSpec[] = [];
  for (const rel of manifest.skills ?? []) {
    const s = loadSkillMd(join(root, rel), manifest.id);
    if (s) skills.push(s);
  }
  const skillsDir = join(root, 'skills');
  if (existsSync(skillsDir)) {
    for (const ent of readdirSync(skillsDir, { withFileTypes: true })) {
      const skillMd = ent.isDirectory()
        ? join(skillsDir, ent.name, 'SKILL.md')
        : ent.name === 'SKILL.md'
          ? join(skillsDir, ent.name)
          : '';
      if (skillMd && existsSync(skillMd)) {
        const s = loadSkillMd(skillMd, manifest.id);
        if (s && !skills.some((x) => x.name === s.name)) skills.push(s);
      }
    }
  }

  const hookEnv: Record<string, string> = {};
  const hookMap: Record<string, string> = {
    session_start: 'RAW_AGENT_HOOK_SESSION_START',
    pre_tool_use: 'RAW_AGENT_HOOK_PRE_TOOL',
    post_tool_use: 'RAW_AGENT_HOOK_POST_TOOL',
    stop: 'RAW_AGENT_HOOK_STOP',
    pre_compact: 'RAW_AGENT_HOOK_PRE_COMPACT'
  };
  for (const [phase, rel] of Object.entries(manifest.hooks ?? {})) {
    const abs = join(root, rel);
    if (existsSync(abs) && hookMap[phase]) {
      hookEnv[hookMap[phase]!] = abs;
    }
  }

  return { root, manifest, agents, skills, tools: [], hookEnv };
}

/**
 * Discover plugins under `dirs` (each child directory with plugin.json).
 */
export function discoverPlugins(dirs: string[]): LoadedPlugin[] {
  const out: LoadedPlugin[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => join(dir, d.name));
    } catch {
      continue;
    }
    // Also allow the dir itself to be a plugin root
    const self = loadPluginFromDir(dir);
    if (self) out.push(self);
    for (const child of entries) {
      const p = loadPluginFromDir(child);
      if (p) out.push(p);
    }
  }
  return out;
}

export function mergePlugins(plugins: LoadedPlugin[]): {
  agents: AgentSpec[];
  skills: SkillSpec[];
  hookEnv: Record<string, string>;
} {
  const agents: AgentSpec[] = [];
  const skills: SkillSpec[] = [];
  const hookEnv: Record<string, string> = {};
  for (const p of plugins) {
    for (const a of p.agents) {
      const i = agents.findIndex((x) => x.id === a.id);
      if (i >= 0) agents[i] = a;
      else agents.push(a);
    }
    for (const s of p.skills) {
      const i = skills.findIndex((x) => x.name === s.name);
      if (i >= 0) skills[i] = s;
      else skills.push(s);
    }
    Object.assign(hookEnv, p.hookEnv);
  }
  return { agents, skills, hookEnv };
}

/** Parse RAW_AGENT_PLUGINS_DIR (colon/comma-separated). */
export function pluginDirsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.RAW_AGENT_PLUGINS_DIR?.trim();
  if (!raw) return [];
  return raw.split(/[:;,]/).map((s) => s.trim()).filter(Boolean);
}
