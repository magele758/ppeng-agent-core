/**
 * Shell Policy — from chrome-plugin-gemini lib/agent/shell-policy.js
 *
 * Hard stops for shell commands: GUI launchers, unbounded filesystem walks,
 * browse loops, and repeated identical searches.
 * Prevents agent from spinning in low-value exploration.
 */

export interface ShellPolicyConfig {
  repeatToolLimit: number;
  dirBrowseLimit: number;
  blockedShellStreak: number;
  searchShellLimit: number;
  archiveSearchStreak: number;
  similarSearchLimit: number;
}

export const DEFAULT_SHELL_POLICY_CONFIG: ShellPolicyConfig = {
  repeatToolLimit: 2,
  dirBrowseLimit: 8,
  blockedShellStreak: 3,
  searchShellLimit: 4,
  archiveSearchStreak: 2,
  similarSearchLimit: 2,
};

export interface PolicyDecision {
  blocked: boolean;
  reason?: string;
}

export interface HistoryEntry {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
}

// ============================================================================
// GUI Launch Detection
// ============================================================================

const GUI_OPEN_RE = /(?:^|[\s;&|`($'"])(?:\/(?:usr\/)?bin\/)?open\s+(?:(?:-[A-Za-z]+|--)\s+)*['"]?(?:\/|~|\.|\.\.\/|\$HOME)/i;
const GUI_OPEN_FLAG_RE = /(?:^|[\s;&|`($'"])(?:\/(?:usr\/)?bin\/)?open\s+-[WwAa]/i;
const GUI_XDG_RE = /\bxdg-open\b|\bgio\s+open\b|\bnautilus\b|\bdolphin\b|\bnemo\b|\bexplorer(?:\.exe)?\b/i;

export function isGuiLaunchCommand(cmd: string): boolean {
  return GUI_OPEN_RE.test(cmd) || GUI_OPEN_FLAG_RE.test(cmd) || GUI_XDG_RE.test(cmd);
}

// ============================================================================
// Unbounded Filesystem Walk Detection
// ============================================================================

const DIR_CMD_RE = /(?:^|[\s;&|`($])(?:\/(?:usr\/)?bin\/)?(?:ls|find|tree|du)\b/i;

export function isUnboundedFsWalk(cmd: string): boolean {
  if (!DIR_CMD_RE.test(cmd)) return false;
  // Penalize when no depth/maxdepth limit is present
  const hasDepthLimit = /--max-depth\s*=?\s*\d|-maxdepth\s+\d|-depth\s+\d/i.test(cmd);
  const hasPathSpecifier = /(?:\/(?:usr|etc|var|opt|home|root)\b|~\/|\$HOME\b)/.test(cmd);
  return hasPathSpecifier && !hasDepthLimit;
}

export function isDirectoryBrowseCommand(cmd: string): boolean {
  return DIR_CMD_RE.test(String(cmd ?? ''));
}

// ============================================================================
// Code Search Detection
// ============================================================================

const SEARCH_BIN_RE = /(?:^|[\s;&|`($])(?:\/(?:usr\/)?bin\/)?(?:rg|grep|egrep|fgrep|ag|ack|mdfind)\b|\bgit\s+grep\b/i;

export function isCodeSearchCommand(cmd: string): boolean {
  return SEARCH_BIN_RE.test(String(cmd ?? ''));
}

export function searchKeywords(cmd: string): string[] {
  const match = /(?:rg|grep|ag|ack)\s+(?:['"](.*?)['"]|(\S+))/.exec(cmd);
  if (!match) return [];
  const kw = match[1] ?? match[2] ?? '';
  return kw ? [kw.toLowerCase()] : [];
}

export function searchesAreSimilar(a: string, b: string): boolean {
  const kwA = searchKeywords(a);
  const kwB = searchKeywords(b);
  if (!kwA.length || !kwB.length) return false;
  return kwA.some((k) => kwB.includes(k) || kwB.some((kb) => kb.includes(k) || k.includes(kb)));
}

// ============================================================================
// Tool Call Fingerprinting
// ============================================================================

export function toolCallSignature(name: string, args: Record<string, unknown>): string {
  try {
    const sorted = Object.keys(args)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => { acc[k] = args[k]; return acc; }, {});
    return `${name}:${JSON.stringify(sorted)}`;
  } catch {
    return `${name}:{}`;
  }
}

// ============================================================================
// History Counting
// ============================================================================

export function countCompletedToolRuns(
  history: HistoryEntry[],
  name: string,
  args?: Record<string, unknown>
): number {
  if (!args) return history.filter((h) => h.name === name).length;
  const sig = toolCallSignature(name, args);
  return history.filter((h) => toolCallSignature(h.name, h.args) === sig).length;
}

export function countDirectoryBrowseRuns(history: HistoryEntry[]): number {
  return history.filter((h) => {
    const cmd = String(h.args?.['command'] ?? '');
    return isDirectoryBrowseCommand(cmd);
  }).length;
}

export function countCodeSearchRuns(history: HistoryEntry[]): number {
  return history.filter((h) => {
    const cmd = String(h.args?.['command'] ?? '');
    return isCodeSearchCommand(cmd);
  }).length;
}

export function countSimilarSearchRuns(history: HistoryEntry[], currentCmd: string): number {
  return history.filter((h) => {
    const cmd = String(h.args?.['command'] ?? '');
    return isCodeSearchCommand(cmd) && searchesAreSimilar(cmd, currentCmd);
  }).length;
}

/** Fold bash/exec tool_call parts into shell-policy history. */
export function shellHistoryFromFold(
  messages: Array<{ parts: ReadonlyArray<{ type: string; name?: string; input?: Record<string, unknown> }> }>
): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== 'tool_call') continue;
      const name = part.name ?? '';
      if (name !== 'bash' && name !== 'exec') continue;
      out.push({
        name,
        args: part.input ?? {},
        ok: true,
      });
    }
  }
  return out;
}

// ============================================================================
// Policy Check
// ============================================================================

export function shellPolicyBlock(cmd: string): PolicyDecision {
  if (isGuiLaunchCommand(cmd)) {
    return { blocked: true, reason: 'GUI launch commands are not allowed in the agent sandbox' };
  }
  if (isUnboundedFsWalk(cmd)) {
    return { blocked: true, reason: 'Unbounded filesystem walk — add --max-depth or -maxdepth N' };
  }
  return { blocked: false };
}

export function checkShellPolicy(
  cmd: string,
  history: HistoryEntry[],
  config: ShellPolicyConfig = DEFAULT_SHELL_POLICY_CONFIG
): PolicyDecision {
  // Static command checks
  const staticCheck = shellPolicyBlock(cmd);
  if (staticCheck.blocked) return staticCheck;

  // Directory browse loop
  if (isDirectoryBrowseCommand(cmd)) {
    const count = countDirectoryBrowseRuns(history);
    if (count >= config.dirBrowseLimit) {
      return { blocked: true, reason: `Directory browse limit reached (${count}/${config.dirBrowseLimit}) — stop exploring, read what you have` };
    }
  }

  // Repeated similar code searches
  if (isCodeSearchCommand(cmd)) {
    const totalSearches = countCodeSearchRuns(history);
    if (totalSearches >= config.searchShellLimit) {
      return { blocked: true, reason: `Code search limit reached (${totalSearches}/${config.searchShellLimit}) — read existing results before searching again` };
    }
    const similarSearches = countSimilarSearchRuns(history, cmd);
    if (similarSearches >= config.similarSearchLimit) {
      return { blocked: true, reason: `Similar search repeated ${similarSearches} times — use a different query or read existing results` };
    }
  }

  return { blocked: false };
}
