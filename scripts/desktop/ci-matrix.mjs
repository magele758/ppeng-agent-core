#!/usr/bin/env node
/** Print GitHub Actions matrix JSON for Desktop artifacts. */
import { appendFileSync } from 'node:fs';
import { desktopCiMatrix } from '../lib/desktop-targets.mjs';

const target = process.env.TARGET || process.argv[2] || 'all';
const include = desktopCiMatrix(target);
const json = JSON.stringify(include);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `include=${json}\n`);
} else {
  console.log(json);
}
