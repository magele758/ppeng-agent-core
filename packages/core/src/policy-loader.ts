import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ApprovalPolicy, ApprovalPolicyRule } from './approval-policy.js';

export interface BashCommandPatternRule {
  /** Substring or regex (if starts and ends with /) */
  pattern: string;
  when?: 'always' | 'auto';
}

export interface PathApprovalRule {
  /** Glob for tool name, e.g. write_* or exact write_file */
  toolPattern: string;
  match: 'glob' | 'exact';
  /** Relative path prefix under workspace */
  pathPrefix: string;
  when: 'always';
}

export interface FileApprovalPolicy extends ApprovalPolicy {
  bashCommandPatterns?: BashCommandPatternRule[];
  pathRules?: PathApprovalRule[];
}

const POLICY_FILES = ['.raw-agent-policy.yaml', '.raw-agent-policy.yml'];

export async function loadPolicyFromRepo(repoRoot: string): Promise<FileApprovalPolicy | undefined> {
  for (const name of POLICY_FILES) {
    const p = join(repoRoot, name);
    try {
      const raw = await readFile(p, 'utf8');
      const doc = parseYaml(raw) as Record<string, unknown>;
      if (!doc || typeof doc !== 'object') {
        return undefined;
      }
      const policy: FileApprovalPolicy = {};
      if (typeof doc.defaultRisky === 'boolean') {
        policy.defaultRisky = doc.defaultRisky;
      }
      if (Array.isArray(doc.rules)) {
        policy.rules = doc.rules as ApprovalPolicyRule[];
      }
      if (Array.isArray(doc.bashCommandPatterns)) {
        policy.bashCommandPatterns = doc.bashCommandPatterns as BashCommandPatternRule[];
      }
      if (Array.isArray(doc.pathRules)) {
        policy.pathRules = doc.pathRules as PathApprovalRule[];
      }
      return policy;
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === 'ENOENT') {
        continue;
      }
      throw e;
    }
  }
  return undefined;
}

export function mergeApprovalPolicies(
  file: FileApprovalPolicy | undefined,
  env: ApprovalPolicy | undefined
): FileApprovalPolicy | undefined {
  if (!file && !env) {
    return undefined;
  }
  const rules = [...(file?.rules ?? []), ...(env?.rules ?? [])];
  const out: FileApprovalPolicy = {
    defaultRisky: env?.defaultRisky ?? file?.defaultRisky,
    rules: rules.length ? rules : undefined,
    bashCommandPatterns: file?.bashCommandPatterns?.length ? [...file.bashCommandPatterns] : undefined,
    pathRules: file?.pathRules?.length ? [...file.pathRules] : undefined
  };
  return out;
}

function matchPatternOrRegex(pattern: string, value: string): boolean {
  const t = pattern.trim();
  if (t.startsWith('/') && t.endsWith('/') && t.length > 2) {
    try {
      const re = new RegExp(t.slice(1, -1));
      return re.test(value);
    } catch {
      return false;
    }
  }
  return value.includes(t);
}

/** True => force approval for bash command */
export function filePolicyRequiresBashApproval(policy: FileApprovalPolicy | undefined, command: string): boolean {
  if (!policy?.bashCommandPatterns?.length) {
    return false;
  }
  for (const rule of policy.bashCommandPatterns) {
    if (matchPatternOrRegex(rule.pattern, command) && rule.when !== 'auto') {
      return true;
    }
  }
  return false;
}

function matchToolPat(pattern: string, toolName: string, kind: 'glob' | 'exact'): boolean {
  if (kind === 'exact') {
    return pattern === toolName;
  }
  const re = new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`
  );
  return re.test(toolName);
}

function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** True => force approval for file-targeting tools */
export function filePolicyRequiresPathApproval(
  policy: FileApprovalPolicy | undefined,
  toolName: string,
  relativePath: string
): boolean {
  if (!policy?.pathRules?.length) {
    return false;
  }
  const norm = normalizeRelPath(relativePath);
  for (const rule of policy.pathRules) {
    if (!matchToolPat(rule.toolPattern, toolName, rule.match)) {
      continue;
    }
    const prefix = normalizeRelPath(rule.pathPrefix);
    if (norm === prefix || norm.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)) {
      return rule.when === 'always';
    }
  }
  return false;
}
