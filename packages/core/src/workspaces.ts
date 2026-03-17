import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createId, nowIso } from './id.js';
import type { WorkspaceRecord, WorkspaceMode } from './types.js';

function sanitizeName(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'task';
}

export class WorkspaceManager {
  constructor(
    private readonly workspaceRoot: string,
    private readonly sourceRoot: string
  ) {}

  async createForTask(taskId: string, hint?: string): Promise<WorkspaceRecord> {
    await mkdir(this.workspaceRoot, { recursive: true });

    const name = sanitizeName(hint ?? taskId);
    const rootPath = join(this.workspaceRoot, `${name}-${taskId.slice(-6)}`);
    const gitDir = join(this.sourceRoot, '.git');
    const hasGit = existsSync(gitDir);

    let mode: WorkspaceMode = 'directory-copy';
    if (hasGit) {
      const branch = `wt/${name}-${taskId.slice(-6)}`;
      const result = spawnSync('git', ['worktree', 'add', '-b', branch, rootPath, 'HEAD'], {
        cwd: this.sourceRoot,
        encoding: 'utf8'
      });
      if (result.status === 0) {
        mode = 'git-worktree';
      }
    }

    if (!existsSync(rootPath)) {
      await mkdir(rootPath, { recursive: true });
      await this.copyDirectory(this.sourceRoot, rootPath);
      mode = 'directory-copy';
    }

    return {
      id: createId('ws'),
      taskId,
      name,
      mode,
      sourcePath: this.sourceRoot,
      rootPath,
      status: 'active',
      createdAt: nowIso()
    };
  }

  async archive(workspace: WorkspaceRecord): Promise<void> {
    if (workspace.mode === 'git-worktree') {
      spawnSync('git', ['worktree', 'remove', '--force', workspace.rootPath], {
        cwd: this.sourceRoot,
        encoding: 'utf8'
      });
      return;
    }

    await rm(workspace.rootPath, { recursive: true, force: true });
  }

  private async copyDirectory(from: string, to: string): Promise<void> {
    const destinationName = basename(to);
    const entries = await readdir(from, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === destinationName || entry.name === '.agent-state' || entry.name === 'node_modules') {
        continue;
      }

      const sourcePath = join(from, entry.name);
      const destinationPath = join(to, entry.name);
      const normalizedRelative = relative(resolve(from), resolve(sourcePath)).replaceAll('\\', '/');
      if (normalizedRelative.startsWith('dist/')) {
        continue;
      }

      await cp(sourcePath, destinationPath, {
        recursive: true,
        force: true,
        filter: (source) => {
          const normalized = source.replaceAll('\\', '/');
          return !normalized.includes('/.agent-state/') &&
            !normalized.includes('/node_modules/') &&
            !normalized.includes(`/${destinationName}/`) &&
            !normalized.includes('/dist/')
            ? true
            : false;
        }
      });
    }
  }

  async ensureExists(rootPath: string): Promise<void> {
    await stat(rootPath);
  }
}
