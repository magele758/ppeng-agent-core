/**
 * Multi-root defaulting for `RunContext.workspaceRoots`.
 * No fs, no sqlite — path strings only.
 */

export interface WorkspaceRootSpec {
  alias: string;
  path: string;
  primary?: boolean;
}

export function defaultWorkspaceRoots(
  workspaceRoot: string | undefined,
  repoRoot: string
): WorkspaceRootSpec[] {
  return [{ alias: 'repo', path: workspaceRoot ?? repoRoot, primary: true }];
}
