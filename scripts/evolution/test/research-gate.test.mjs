import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeSourceAvailability,
  parseResearchDecisionOutput,
  writeResearchDecisionFile
} from '../research-gate.mjs';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('computeSourceAvailability: none without signals', () => {
  assert.equal(computeSourceAvailability({ excerptText: '', sourceTitle: '', sourceUrl: '' }), 'none');
});

test('computeSourceAvailability: weak from title+url', () => {
  assert.equal(
    computeSourceAvailability({
      excerptText: '',
      sourceTitle: 'Some AI post',
      sourceUrl: 'https://example.com/a'
    }),
    'weak'
  );
});

test('computeSourceAvailability: full from long excerpt', () => {
  const ex = 'x'.repeat(600);
  assert.equal(computeSourceAvailability({ excerptText: ex, minFullChars: 500 }), 'full');
});

test('parseResearchDecisionOutput: markdown PROCEED line', () => {
  const raw = `Here is my analysis.\n\n**PROCEED**\npackages/core/foo.ts — add retry wrapper\n`;
  const p = parseResearchDecisionOutput(raw, { availability: 'full' });
  assert.equal(p.decision, 'PROCEED');
  assert.ok(p.reason.includes('foo') || p.reason.includes('packages'));
});

test('parseResearchDecisionOutput: verdict line', () => {
  const raw = `Decision: PROCEED\nImprove gateway timeout handling\n`;
  const p = parseResearchDecisionOutput(raw, { availability: 'full' });
  assert.equal(p.decision, 'PROCEED');
});

test('parseResearchDecisionOutput: unparsedDefault skip', () => {
  const raw = 'No clear decision here, just rambling about the weather.';
  const p = parseResearchDecisionOutput(raw, { availability: 'full', unparsedDefault: 'skip' });
  assert.equal(p.decision, 'SKIP');
});

test('parseResearchDecisionOutput: availability none short-circuits', () => {
  const p = parseResearchDecisionOutput('PROCEED\nshould ignore', { availability: 'none' });
  assert.equal(p.decision, 'SKIP');
});

test('writeResearchDecisionFile round-trip shape', () => {
  const p = join(tmpdir(), `evolution-research-gate-test-${Date.now()}.txt`);
  writeResearchDecisionFile(p, { decision: 'SKIP', skipType: 'IRRELEVANT', reason: 'n/a' });
  const body = readFileSync(p, 'utf8');
  unlinkSync(p);
  const lines = body.trim().split('\n');
  assert.equal(lines[0], 'SKIP');
  assert.equal(lines[1], 'IRRELEVANT');
});
