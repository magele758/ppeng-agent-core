import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertPortableMini } from '../npm-artifacts.mjs';

test('packed mini checker follows static reexports and catches side-effect Node imports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mini-portable-test-'));
  try {
    const main = join(dir, 'mini.js'), child = join(dir, 'child.js');
    writeFileSync(main, "export * from './child.js';\n");
    writeFileSync(child, 'export const portable = true;');
    assert.equal(assertPortableMini(main).size, 2);
    for (const imp of ["import 'node:fs';", "export * from 'fs';", "import fs from 'node:fs';"]) {
      writeFileSync(child, imp); assert.throws(() => assertPortableMini(main), /Node builtin/);
    }
    writeFileSync(child, "import 'unknown-dependency';");
    assert.throws(() => assertPortableMini(main), /unverified external/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
