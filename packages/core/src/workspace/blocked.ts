import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';

const HOME_SENSITIVE = ['.ssh', '.aws', '.gnupg', '.kube', '.docker'];
const ABS_PREFIXES = ['/etc', '/sys', '/proc', '/dev', '/root'];

export function blockedPrefixes(home = homedir()): string[] {
  const prefixes = [
    ...HOME_SENSITIVE.map((dir) => resolve(home, dir)),
    ...ABS_PREFIXES.map((p) => resolve(p))
  ];
  // macOS often realpath /etc → /private/etc
  if (process.platform === 'darwin') {
    prefixes.push(resolve('/private/etc'));
  }
  return [...new Set(prefixes)];
}

export function isBlockedPath(absPath: string, home = homedir()): boolean {
  const real = resolve(absPath);
  for (const prefix of blockedPrefixes(home)) {
    if (real === prefix || real.startsWith(prefix + sep)) return true;
  }
  return false;
}
