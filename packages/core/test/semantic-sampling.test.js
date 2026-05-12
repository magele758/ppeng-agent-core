import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clusterOpenAnswerSamples,
  normalizeOpenAnswerKey,
  normalizedClusterEntropy,
  selfConsistencyConfidence,
  summarizeOpenAnswerSamples
} from '../dist/evolving/semantic-sampling.js';

test('normalizeOpenAnswerKey folds case, NFKC, and punctuation', () => {
  assert.equal(normalizeOpenAnswerKey('  Hello,  World!!  '), 'hello world');
  assert.equal(normalizeOpenAnswerKey('café'), normalizeOpenAnswerKey('caf\u0065\u0301'));
});

test('clusterOpenAnswerSamples merges equivalent strings', () => {
  const c = clusterOpenAnswerSamples(['Paris', '  paris ', 'London', 'PARIS']);
  assert.equal(c.length, 2);
  assert.equal(c[0].key, 'paris');
  assert.equal(c[0].count, 3);
  assert.equal(c[1].key, 'london');
  assert.equal(c[1].count, 1);
});

test('selfConsistencyConfidence is majority mass', () => {
  assert.equal(selfConsistencyConfidence([]), 0);
  assert.equal(selfConsistencyConfidence(['a', 'b']), 0.5);
  assert.equal(selfConsistencyConfidence(['x', 'x', 'y']), 2 / 3);
});

test('normalizedClusterEntropy is 0 for single cluster', () => {
  assert.equal(normalizedClusterEntropy(['a', 'A', ' a ']), 0);
});

test('normalizedClusterEntropy peaks when uniform across buckets', () => {
  const e = normalizedClusterEntropy(['a', 'b', 'c']);
  assert.ok(e > 0.99);
});

test('summarizeOpenAnswerSamples returns stable shape', () => {
  const s = summarizeOpenAnswerSamples(['yes!', 'Yes', 'no']);
  assert.equal(s.nonEmptyCount, 3);
  assert.equal(s.distinctClusters, 2);
  assert.ok(Math.abs(s.sem1MajorityShare - 2 / 3) < 1e-9);
  assert.ok(s.normalizedEntropy > 0 && s.normalizedEntropy <= 1);
});
