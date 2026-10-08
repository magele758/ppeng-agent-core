import { readFileSync } from 'node:fs';

/**
 * True while `pid` is a live process. A killed grandchild is reparented and may
 * linger as a zombie that still answers `kill(pid, 0)`, so on Linux the
 * `/proc/<pid>/stat` state is checked too.
 */
export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform !== 'linux') return true;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z';
  } catch {
    return false;
  }
}
