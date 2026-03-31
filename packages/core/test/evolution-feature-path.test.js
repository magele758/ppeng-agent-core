/**
 * 验证 evolution-run-day.mjs 的变更分类门禁逻辑：
 * 只有 packages/ 或 apps/ 下的非测试源码文件才计入"实际功能改动"。
 *
 * isFeaturePath 与 scripts/evolution-run-day.mjs 中的实现保持一致，
 * 若修改了该函数请同步更新此处。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

function isFeaturePath(p) {
  if (!/^(packages|apps)[/\\]/.test(p)) return false;
  if (/[/\\]test[/\\]/i.test(p)) return false;
  if (/[/\\]__tests__[/\\]/i.test(p)) return false;
  if (/\.(test|spec)\.[jt]sx?$/.test(p)) return false;
  return true;
}

// ── 应判定为功能源码 ────────────────────────────────────────────────────────

test('isFeaturePath: packages/core/src/foo.ts 是功能文件', () => {
  assert.equal(isFeaturePath('packages/core/src/foo.ts'), true);
});

test('isFeaturePath: packages/core/dist/foo.js 是功能文件', () => {
  assert.equal(isFeaturePath('packages/core/dist/foo.js'), true);
});

test('isFeaturePath: apps/daemon/src/server.ts 是功能文件', () => {
  assert.equal(isFeaturePath('apps/daemon/src/server.ts'), true);
});

test('isFeaturePath: apps/cli/index.mjs 是功能文件', () => {
  assert.equal(isFeaturePath('apps/cli/index.mjs'), true);
});

test('isFeaturePath: packages/core/foo.js 根目录下源码是功能文件', () => {
  assert.equal(isFeaturePath('packages/core/foo.js'), true);
});

// ── 应判定为非功能（仅测试）──────────────────────────────────────────────────

test('isFeaturePath: packages/core/test/foo.test.js 是测试文件', () => {
  assert.equal(isFeaturePath('packages/core/test/foo.test.js'), false);
});

test('isFeaturePath: packages/core/test/foo.spec.ts 是测试文件', () => {
  assert.equal(isFeaturePath('packages/core/test/foo.spec.ts'), false);
});

test('isFeaturePath: packages/core/src/__tests__/bar.ts 是测试文件', () => {
  assert.equal(isFeaturePath('packages/core/src/__tests__/bar.ts'), false);
});

test('isFeaturePath: packages/core/src/bar.test.ts 是测试文件（*.test.*）', () => {
  assert.equal(isFeaturePath('packages/core/src/bar.test.ts'), false);
});

test('isFeaturePath: packages/core/src/bar.spec.js 是测试文件（*.spec.*）', () => {
  assert.equal(isFeaturePath('packages/core/src/bar.spec.js'), false);
});

// ── 应判定为非功能（根目录 / 文档）──────────────────────────────────────────

test('isFeaturePath: README.md 不是功能文件', () => {
  assert.equal(isFeaturePath('README.md'), false);
});

test('isFeaturePath: doc/evolution/foo.md 不是功能文件', () => {
  assert.equal(isFeaturePath('doc/evolution/foo.md'), false);
});

test('isFeaturePath: scripts/foo.mjs 不在 packages/apps 下，不是功能文件', () => {
  assert.equal(isFeaturePath('scripts/foo.mjs'), false);
});

test('isFeaturePath: .evolution/source-excerpt.txt 不是功能文件', () => {
  assert.equal(isFeaturePath('.evolution/source-excerpt.txt'), false);
});

// ── 变更分类综合场景 ─────────────────────────────────────────────────────────

test('仅含测试文件变更时 hasFeatureChanges 应为 false', () => {
  const paths = [
    'packages/core/test/foo.test.js',
    'packages/core/test/bar.spec.ts',
  ];
  const featurePaths = paths.filter(isFeaturePath);
  assert.equal(featurePaths.length, 0, '不应有功能路径');
});

test('同时含功能源码和测试文件时 hasFeatureChanges 应为 true', () => {
  const paths = [
    'packages/core/src/my-feature.ts',
    'packages/core/test/my-feature.test.js',
  ];
  const featurePaths = paths.filter(isFeaturePath);
  assert.equal(featurePaths.length, 1, '应有 1 个功能路径');
  assert.equal(featurePaths[0], 'packages/core/src/my-feature.ts');
});

test('仅含文档变更时 hasFeatureChanges 应为 false', () => {
  const paths = ['README.md', 'doc/evolution/inbox/2026-03-31.md'];
  const featurePaths = paths.filter(isFeaturePath);
  assert.equal(featurePaths.length, 0, '不应有功能路径');
});
