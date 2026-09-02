#!/usr/bin/env node
/**
 * Offline A/B: evict tool results after the model has consumed them.
 * Usage: node scripts/experiment-tool-result-evict.mjs [--json]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { formatExperimentReport, runToolResultEvictExperiment } from '../packages/core/dist/session/tool-result-evict-experiment.js';

const report = runToolResultEvictExperiment();
const text = formatExperimentReport(report);
const asJson = process.argv.includes('--json');

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(`${text}\n`);
}

const outDir = process.env.EXPERIMENT_OUT_DIR;
if (outDir) {
  await mkdir(outDir, { recursive: true });
  await writeFile(`${outDir}/tool-result-evict-experiment.txt`, `${text}\n`);
  await writeFile(`${outDir}/tool-result-evict-experiment.json`, `${JSON.stringify(report, null, 2)}\n`);
}
