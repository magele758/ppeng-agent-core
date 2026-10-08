import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateModule,
  functionRanges,
  mergeReports,
  parseShard,
  ratchetThresholds,
  renderMarkdown,
  resolveMutateEntries,
  shardRanges,
  skipPatternArg,
  tallyMutants,
} from '../mutation/mutation-lib.mjs';

const m = (status, id = String(Math.random())) => ({
  id,
  status,
  mutatorName: 'X',
  replacement: 'y',
  location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
});

test('tallyMutants: score = detected / (detected + undetected), ignored and errors excluded', () => {
  const t = tallyMutants([m('Killed'), m('Timeout'), m('Survived'), m('NoCoverage'), m('Ignored'), m('RuntimeError'), m('CompileError')]);
  assert.equal(t.killed, 1);
  assert.equal(t.timeout, 1);
  assert.equal(t.survived, 1);
  assert.equal(t.noCoverage, 1);
  assert.equal(t.ignored, 1);
  assert.equal(t.errors, 2);
  assert.equal(t.score, 50);
  assert.equal(tallyMutants([m('Killed'), m('Killed'), m('Survived')]).score, 66.66);
  assert.equal(tallyMutants([m('Ignored')]).score, null);
});

test('evaluateModule: pass needs a score at or above the threshold and no pending mutants', () => {
  assert.equal(evaluateModule({ id: 'a', threshold: 50, mutants: [m('Killed'), m('Survived')] }).pass, true);
  assert.equal(evaluateModule({ id: 'a', threshold: 51, mutants: [m('Killed'), m('Survived')] }).pass, false);
  assert.equal(evaluateModule({ id: 'a', threshold: 0, mutants: [m('Killed'), m('Pending')] }).pass, false);
  assert.equal(evaluateModule({ id: 'a', threshold: 0, mutants: [] }).pass, false);
});

test('mergeReports concatenates shard mutants per file and drops exact duplicates', () => {
  const a = { schemaVersion: '2', files: { 'f.js': { language: 'javascript', source: 's', mutants: [m('Killed', '1')] } } };
  const b = { schemaVersion: '2', files: { 'f.js': { language: 'javascript', source: 's', mutants: [m('Survived', '1'), m('Killed', '2')] } } };
  b.files['f.js'].mutants[0].location = { start: { line: 9, column: 1 }, end: { line: 9, column: 3 } };
  const merged = mergeReports([a, b, a]);
  assert.equal(merged.files['f.js'].mutants.length, 3);
  assert.equal(tallyMutants(merged.files['f.js'].mutants).score, 66.66);
});

const SRC = [
  'const A = 1;', // 1
  'function one() {', // 2
  '  return 1;', // 3
  '}', // 4
  'export class Store {', // 5
  '  get(x) {', // 6
  '    return x;', // 7
  '  }', // 8
  '  set(x) {', // 9
  '    this.x = x;', // 10
  '  }', // 11
  '}', // 12
  'function two() {', // 13
  '  return 2;', // 14
  '}', // 15
  '',
].join('\n');

test('shardRanges never cuts a top-level statement and covers every line exactly once', () => {
  for (const count of [1, 2, 3, 4, 10]) {
    const ranges = shardRanges('f.js', SRC, count);
    assert.ok(ranges.length <= count);
    assert.equal(ranges[0][0], 1);
    assert.equal(ranges.at(-1)[1], SRC.split('\n').length);
    for (let i = 1; i < ranges.length; i += 1) assert.equal(ranges[i][0], ranges[i - 1][1] + 1);
    const cutPoints = new Set(ranges.map(([, end]) => end));
    for (const bad of [2, 3, 5, 6, 7, 8, 9, 10, 11, 13, 14]) assert.ok(!cutPoints.has(bad), `cut inside a statement at ${bad} (count ${count})`);
  }
  assert.deepEqual(shardRanges('f.js', SRC, 3), [[1, 4], [5, 12], [13, 16]]);
});

test('functionRanges finds functions and class methods by name and refuses unknown names', () => {
  assert.deepEqual(functionRanges('f.js', SRC, ['two', 'set', 'one']), [[13, 15], [9, 11], [2, 4]]);
  assert.throws(() => functionRanges('f.js', SRC, ['missing']), /functions not found: missing/);
});

test('resolveMutateEntries: whole files are sliced per shard, function entries only in shard 1', () => {
  const read = () => SRC;
  const entries = ['a.js', { file: 'b.js', functions: ['get'] }];
  assert.deepEqual(resolveMutateEntries(entries, read), ['a.js', 'b.js:6-8']);
  assert.deepEqual(resolveMutateEntries(entries, read, { index: 1, count: 3 }), ['a.js:1-4', 'b.js:6-8']);
  assert.deepEqual(resolveMutateEntries(entries, read, { index: 3, count: 3 }), ['a.js:13-16']);
});

test('parseShard and skipPatternArg', () => {
  assert.deepEqual(parseShard('2/3'), { index: 2, count: 3 });
  assert.equal(parseShard(undefined), undefined);
  assert.throws(() => parseShard('4/3'), /out of range/);
  assert.throws(() => parseShard('x'), /look like/);
  assert.deepEqual(skipPatternArg([]), []);
  const [arg] = skipPatternArg(['a (b) c', 'd/e']);
  assert.equal(arg, '--test-skip-pattern=/a \\(b\\) c|d\\/e/');
  const re = new RegExp(arg.slice('--test-skip-pattern=/'.length, -1));
  assert.ok(re.test('a (b) c'));
  assert.ok(re.test('d/e'));
  assert.ok(!re.test('a b c'));
});

test('ratchetThresholds only raises to the floor of the score unless decreases are allowed', () => {
  const config = { modules: { a: { threshold: 70 }, b: { threshold: 90 }, c: { threshold: 10 } } };
  const changes = ratchetThresholds(config, [
    { id: 'a', score: 83.9 },
    { id: 'b', score: 85 },
    { id: 'c', score: null },
  ]);
  assert.deepEqual(changes, [{ id: 'a', from: 70, to: 83 }]);
  assert.equal(config.modules.b.threshold, 90);
  ratchetThresholds(config, [{ id: 'b', score: 85 }], { allowDecrease: true });
  assert.equal(config.modules.b.threshold, 85);
});

test('renderMarkdown marks failing modules and lists undetected mutants', () => {
  const md = renderMarkdown({
    pass: false,
    modules: [
      { id: 'ok', score: 90, threshold: 80, pass: true, killed: 9, timeout: 0, survived: 1, noCoverage: 0, ignored: 0, errors: 0, undetected: [] },
      {
        id: 'low',
        score: 50,
        threshold: 80,
        pass: false,
        killed: 1,
        timeout: 0,
        survived: 1,
        noCoverage: 0,
        ignored: 0,
        errors: 0,
        undetected: [{ where: 'src/x.ts:3', mutator: 'BooleanLiteral', replacement: 'a | b', status: 'Survived' }],
      },
    ],
  });
  assert.match(md, /Mutation testing FAILED/);
  assert.match(md, /\| low ❌ \| 50\.00% \| 80% \|/);
  assert.match(md, /src\/x\.ts:3 \| BooleanLiteral \| `a \\\| b`/);
  assert.doesNotMatch(md, /ok: \d+ undetected/);
});
