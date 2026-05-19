#!/usr/bin/env node
/**
 * Print builtin tool names from packages/core/src/tools/builtin-tools.ts (for doc sync).
 * Usage: node scripts/doc-sync-tools.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'packages/core/src/tools/builtin-tools.ts'), 'utf8');
const names = [...src.matchAll(/name:\s*'([^']+)'/g)]
  .map((m) => m[1])
  .filter((n) => n !== 'raw-agent');
console.log(`Builtin tools (${names.length}):`);
for (const n of names) console.log(`- ${n}`);
