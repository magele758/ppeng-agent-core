/** Desktop pack targets: 3 OS × 2 arch = 6 artifacts. */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const DESKTOP_PLATFORMS = ['mac', 'win', 'linux'];
export const DESKTOP_ARCHES = ['x64', 'arm64'];

export const DESKTOP_TARGETS = [
  { id: 'mac-arm64', platform: 'mac', arch: 'arm64' },
  { id: 'mac-x64', platform: 'mac', arch: 'x64' },
  { id: 'win-x64', platform: 'win', arch: 'x64' },
  { id: 'win-arm64', platform: 'win', arch: 'arm64' },
  { id: 'linux-x64', platform: 'linux', arch: 'x64' },
  { id: 'linux-arm64', platform: 'linux', arch: 'arm64' }
];

/** GitHub-hosted runner + setup-node architecture for each pack target. */
export const DESKTOP_CI_RUNNERS = {
  'mac-arm64': { os: 'macos-14', node_arch: 'arm64' },
  'mac-x64': { os: 'macos-14', node_arch: 'x64' },
  'win-x64': { os: 'windows-latest', node_arch: 'x64' },
  'win-arm64': { os: 'windows-11-arm', node_arch: 'arm64' },
  'linux-x64': { os: 'ubuntu-latest', node_arch: 'x64' },
  'linux-arm64': { os: 'ubuntu-24.04-arm', node_arch: 'arm64' }
};

export function desktopCiMatrix(target = 'all') {
  const selected = target === 'all' || !target
    ? DESKTOP_TARGETS
    : DESKTOP_TARGETS.filter((row) => row.id === target);
  if (selected.length === 0) {
    throw new Error(`unknown desktop target: ${target}`);
  }
  return selected.map((row) => ({ ...row, ...DESKTOP_CI_RUNNERS[row.id] }));
}

const NODE_OS_TO_PLATFORM = {
  darwin: 'mac',
  win32: 'win',
  linux: 'linux'
};

const NODE_ARCH_TO_ELECTRON = {
  x64: 'x64',
  arm64: 'arm64',
  amd64: 'x64'
};

export function hostDesktopTarget() {
  const platform = NODE_OS_TO_PLATFORM[process.platform];
  const arch = NODE_ARCH_TO_ELECTRON[process.arch];
  if (!platform || !arch) {
    throw new Error(`unsupported host ${process.platform}/${process.arch}`);
  }
  return { id: `${platform}-${arch}`, platform, arch };
}

export function parseDesktopTarget(input = {}) {
  const host = hostDesktopTarget();
  const platform = normalizePlatform(input.platform ?? host.platform);
  const arch = normalizeArch(input.arch ?? host.arch);
  const id = `${platform}-${arch}`;
  if (!DESKTOP_TARGETS.some((row) => row.id === id)) {
    throw new Error(`unknown desktop target ${id}`);
  }
  return { id, platform, arch };
}

export function electronBuilderArgs(target) {
  return [`--${target.platform}`, `--${target.arch}`, '--publish', 'never'];
}

/** Workspace hoist puts the binary in the repo root, not apps/desktop. */
export function electronBuilderBinCandidates(desktopDir, repoRoot, platform = process.platform) {
  const name = platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
  return [
    join(desktopDir, 'node_modules', '.bin', name),
    join(repoRoot, 'node_modules', '.bin', name)
  ];
}

export function resolveElectronBuilderBin(desktopDir, repoRoot, platform = process.platform) {
  const found = electronBuilderBinCandidates(desktopDir, repoRoot, platform).find((path) => existsSync(path));
  if (!found) {
    throw new Error('electron-builder not found; run npm ci at the workspace root');
  }
  return found;
}

/** Linux AppImage ${arch} is x86_64; keep the published name as x64. */
export function normalizeDesktopArtifactName(fileName, target) {
  if (target.platform === 'linux' && target.arch === 'x64') {
    return fileName.replace(/-linux-x86_64\./, '-linux-x64.');
  }
  return fileName;
}

function normalizePlatform(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'mac' || value === 'macos' || value === 'darwin') return 'mac';
  if (value === 'win' || value === 'windows' || value === 'win32') return 'win';
  if (value === 'linux') return 'linux';
  throw new Error(`unknown desktop platform: ${raw}`);
}

function normalizeArch(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'x64' || value === 'amd64' || value === 'x86_64') return 'x64';
  if (value === 'arm64' || value === 'aarch64') return 'arm64';
  throw new Error(`unknown desktop arch: ${raw}`);
}
