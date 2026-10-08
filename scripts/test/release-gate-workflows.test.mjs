import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workflows = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'workflows');
const read = (name) => readFileSync(join(workflows, name), 'utf8');

const ENFORCE_CONDITION = "(vars.RELEASE_GATE_ENFORCE == 'false' || needs.release-gate.result == 'success')";

for (const [file, job] of [
  ['publish-npm.yml', 'publish'],
  ['docker-nightly.yml', 'push']
]) {
  test(`${file}: ${job} is blocked by the release gate unless RELEASE_GATE_ENFORCE is 'false'`, () => {
    const src = read(file);
    const start = src.indexOf(`\n  ${job}:\n`, src.indexOf('\njobs:\n'));
    const jobBlock = src.slice(start, src.indexOf('\n    steps:', start));
    assert.match(jobBlock, /needs: .*release-gate/);
    assert.ok(jobBlock.includes(ENFORCE_CONDITION), `${job}.if must contain ${ENFORCE_CONDITION}`);
    assert.ok(jobBlock.includes('!cancelled()'), 'a cancelled run must never release');
    assert.doesNotMatch(src, /RELEASE_GATE_ENFORCE != 'true'/, 'observe-by-default condition is back');
    assert.match(src, /::warning title=Release gate BYPASSED::/);
    assert.match(src, /Release gate BYPASSED\*\*.*>> "\$GITHUB_STEP_SUMMARY"/);
  });
}

test('release-gate.yml keeps the required-check job name and the flaky-aware unit step', () => {
  const src = read('release-gate.yml');
  assert.match(src, /\n  gate:\n    name: Main release gate\n/);
  assert.match(src, /node scripts\/ci\/retry-failed-tests\.mjs --script test:unit/);
  assert.doesNotMatch(src, /run: npm run test:unit/, 'unit tests must go through the retry wrapper');
});

test('ci.yml exposes the gate as "Release gate / Main release gate"', () => {
  assert.match(read('ci.yml'), /\n  release-gate:\n    name: Release gate\n    uses: \.\/\.github\/workflows\/release-gate\.yml/);
});
