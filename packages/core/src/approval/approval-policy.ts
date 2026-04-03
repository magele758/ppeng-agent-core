import type { RunContext } from '../types.js';

export interface ApprovalPolicyRule {
  toolPattern: string;
  match: 'glob' | 'exact';
  when?: 'always' | 'auto';
}

export interface ApprovalPolicy {
  /** When true, every tool with approvalMode auto requires approval (unless a rule sets when=auto). */
  defaultRisky?: boolean;
  rules?: ApprovalPolicyRule[];
}

function matchTool(pattern: string, toolName: string, kind: 'glob' | 'exact'): boolean {
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

/** Parse JSON from env RAW_AGENT_APPROVAL_POLICY */
export function parseApprovalPolicyFromEnv(env: NodeJS.ProcessEnv): ApprovalPolicy | undefined {
  const raw = env.RAW_AGENT_APPROVAL_POLICY?.trim();
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as ApprovalPolicy;
  } catch {
    return undefined;
  }
}

/**
 * Returns true if policy forces approval regardless of tool.needsApproval.
 */
export function policyRequiresApproval(policy: ApprovalPolicy | undefined, toolName: string): boolean {
  if (!policy?.rules?.length) {
    return false;
  }
  for (const rule of policy.rules) {
    if (!matchTool(rule.toolPattern, toolName, rule.match)) {
      continue;
    }
    if (rule.when === 'always') {
      return true;
    }
  }
  return false;
}

/**
 * If policy says when=auto for this tool, defer to tool.needsApproval only (return false here).
 */
export function policySkipsAutoApproval(policy: ApprovalPolicy | undefined, toolName: string): boolean {
  if (!policy?.rules?.length) {
    return false;
  }
  for (const rule of policy.rules) {
    if (!matchTool(rule.toolPattern, toolName, rule.match)) {
      continue;
    }
    if (rule.when === 'auto') {
      return true;
    }
  }
  return false;
}

export function contextHasApprovalPolicy(context: RunContext): ApprovalPolicy | undefined {
  const meta = context.session.metadata as { approvalPolicy?: ApprovalPolicy };
  return meta.approvalPolicy;
}
