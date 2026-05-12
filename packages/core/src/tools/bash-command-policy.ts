/**
 * Whether a bash tool invocation should require explicit human approval before execution.
 * Covers destructive SCM, publishing, privilege escalation, and RCE-prone idioms often seen
 * alongside compromised registry packages or trojaned install instructions.
 */
export function bashCommandNeedsApproval(command: string): boolean {
  const lower = command.toLowerCase();

  const riskySubstrings = [
    'rm ',
    'git reset',
    'git checkout',
    'git clean',
    'npm publish',
    'pnpm publish',
    'yarn publish',
    'sudo '
  ];
  if (riskySubstrings.some((t) => lower.includes(t))) return true;

  // Pipe remote or fetched bytes straight into an interactive shell.
  if (/\|\s*sh\b/.test(lower)) return true;
  if (/\|\s*bash\b/.test(lower)) return true;
  if (/\|\s*zsh\b/.test(lower)) return true;

  // bash <(curl …) / wget process substitution
  if (/<\(\s*(curl|wget)\b/.test(lower)) return true;

  return false;
}
