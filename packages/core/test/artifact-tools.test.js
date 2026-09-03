import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPagedArtifact } from '../dist/artifact/index.js';
import { createArtifactTools } from '../dist/tools/artifact-tools.js';

test('artifact tools are read-only and page/search a handle', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'art-tools-'));
  try {
    const tools = createArtifactTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ['read_artifact_page', 'search_artifact_content']
    );
    assert.ok(tools.every((t) => t.approvalMode === 'never' && t.ptc?.kind === 'read'));

    const ctx = { stateDir, session: { id: 'sess-1' } };
    const empty = await tools.find((t) => t.name === 'read_artifact_page').execute(ctx, { handle: '' });
    assert.equal(empty.ok, false);
    assert.match(empty.content, /必填/);

    const content = Array.from({ length: 30 }, (_, i) => `line-${i} token-${i % 3}`).join('\n');
    const manifest = createPagedArtifact({
      stateDir,
      sessionId: 'sess-1',
      sourceTool: 'bash',
      content,
      pageSizeChars: 80
    });
    const page = await tools
      .find((t) => t.name === 'read_artifact_page')
      .execute(ctx, { handle: manifest.handle, page: 1 });
    assert.equal(page.ok, true);
    const parsed = JSON.parse(page.content);
    assert.equal(parsed.success, true);
    assert.equal(parsed.content_mode, 'paged_artifact_page');

    const search = await tools
      .find((t) => t.name === 'search_artifact_content')
      .execute(ctx, { handle: manifest.handle, query: 'token-2' });
    assert.equal(search.ok, true);
    const hits = JSON.parse(search.content);
    assert.ok(hits.matches?.length > 0);
    assert.ok(hits.matches[0].page >= 1);

    const missing = await tools
      .find((t) => t.name === 'read_artifact_page')
      .execute(ctx, { handle: 'no-such' });
    assert.equal(missing.ok, false);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});
