import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DESKTOP_TARGETS,
  electronBuilderArgs,
  electronBuilderBinCandidates,
  parseDesktopTarget,
  resolveElectronBuilderBin
} from '../../lib/desktop-targets.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('desktop matrix is six platform/arch pairs', () => {
  assert.deepEqual(
    DESKTOP_TARGETS.map((row) => row.id).sort(),
    ['linux-arm64', 'linux-x64', 'mac-arm64', 'mac-x64', 'win-arm64', 'win-x64']
  );
});

test('parseDesktopTarget accepts amd64 alias and electron-builder flags', () => {
  const linuxAmd = parseDesktopTarget({ platform: 'linux', arch: 'amd64' });
  assert.deepEqual(linuxAmd, { id: 'linux-x64', platform: 'linux', arch: 'x64' });
  assert.deepEqual(electronBuilderArgs(linuxAmd), ['--linux', '--x64', '--publish', 'never']);
  assert.deepEqual(electronBuilderArgs(parseDesktopTarget({ platform: 'windows', arch: 'aarch64' })), [
    '--win',
    '--arm64',
    '--publish',
    'never'
  ]);
  assert.throws(() => parseDesktopTarget({ platform: 'solaris', arch: 'x64' }), /unknown desktop platform/);
});

test('electron-builder bin resolution includes workspace-hoisted path', () => {
  const desktopDir = join(repoRoot, 'apps', 'desktop');
  const linuxBins = electronBuilderBinCandidates(desktopDir, repoRoot, 'linux');
  assert.equal(linuxBins[0], join(desktopDir, 'node_modules', '.bin', 'electron-builder'));
  assert.equal(linuxBins[1], join(repoRoot, 'node_modules', '.bin', 'electron-builder'));
  const winBins = electronBuilderBinCandidates(desktopDir, repoRoot, 'win32');
  assert.ok(winBins.every((path) => path.endsWith('electron-builder.cmd')));
  assert.ok(existsSync(resolveElectronBuilderBin(desktopDir, repoRoot)));
});

test('electron-builder config lists x64 and arm64 for mac, win, and linux', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'apps', 'desktop', 'package.json'), 'utf8'));
  for (const os of ['mac', 'win', 'linux']) {
    const arches = new Set(
      (pkg.build[os].target ?? []).flatMap((row) => (Array.isArray(row.arch) ? row.arch : []))
    );
    assert.deepEqual([...arches].sort(), ['arm64', 'x64'], `${os} targets`);
  }
});
