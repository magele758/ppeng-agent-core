import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DESKTOP_TARGETS,
  electronBuilderArgs,
  electronBuilderBinCandidates,
  normalizeDesktopArtifactName,
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

test('electron-builder config leaves arch to CLI flags', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'apps', 'desktop', 'package.json'), 'utf8'));
  assert.deepEqual(pkg.build.mac.target, ['dmg']);
  assert.deepEqual(pkg.build.win.target, ['nsis']);
  assert.deepEqual(pkg.build.linux.target, ['AppImage']);
});

test('normalizeDesktopArtifactName maps linux AppImage x86_64 to x64', () => {
  assert.equal(
    normalizeDesktopArtifactName('RawAgent-0.1.0-linux-x86_64.AppImage', { id: 'linux-x64', platform: 'linux', arch: 'x64' }),
    'RawAgent-0.1.0-linux-x64.AppImage'
  );
  assert.equal(
    normalizeDesktopArtifactName('RawAgent-0.1.0-linux-arm64.AppImage', { id: 'linux-arm64', platform: 'linux', arch: 'arm64' }),
    'RawAgent-0.1.0-linux-arm64.AppImage'
  );
});
