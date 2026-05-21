import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEmptyReport,
  saveReport,
  loadReport,
  setGate,
  reportToMarkdown
} from '../report-builder.mjs';
import { createReleaseRunId } from '../config.mjs';

test('createReleaseRunId format', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rel-test-'));
  const id = createReleaseRunId(dir);
  assert.match(id, /^rel_\d{8}_\d{3}$/);
});

test('save and load report roundtrip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rel-test-'));
  const report = createEmptyReport('rel_20260521_001');
  setGate(report, 'g0', 'pass', 'ok');
  const paths = saveReport(dir, report);
  assert.ok(existsSync(paths.json));
  assert.ok(existsSync(paths.md));
  const loaded = loadReport(dir, 'rel_20260521_001');
  assert.equal(loaded.gates.g0, 'pass');
  const md = readFileSync(paths.md, 'utf8');
  assert.ok(md.includes('rel_20260521_001'));
  assert.ok(md.includes('G0'));
});

test('reportToMarkdown includes gates table', () => {
  const report = createEmptyReport('rel_20260521_002');
  const md = reportToMarkdown(report);
  assert.ok(md.includes('| G0 | pending |'));
});
