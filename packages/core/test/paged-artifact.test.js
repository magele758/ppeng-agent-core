import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createPagedArtifact,
  maybeArchiveToolResult,
  readPagedArtifactPage,
  searchPagedArtifact
} from '../dist/artifact/index.js';

const stateDir = mkdtempSync(join(tmpdir(), 'ppeng-art-'));
after(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe('paged artifact', () => {
  it('pages and searches by handle', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line-${i} token-${i % 3}`);
    const content = lines.join('\n');
    const manifest = createPagedArtifact({
      stateDir,
      sessionId: 'sess-1',
      sourceTool: 'bash',
      content,
      pageSizeChars: 80
    });
    assert.ok(manifest.handle);
    assert.ok(manifest.totalPages >= 2);

    const page1 = readPagedArtifactPage({
      stateDir,
      sessionId: 'sess-1',
      handle: manifest.handle,
      page: 1
    });
    assert.equal(page1.page, 1);
    assert.equal(page1.hasNext, true);
    assert.match(page1.content, /line-0/);

    const found = searchPagedArtifact({
      stateDir,
      sessionId: 'sess-1',
      handle: manifest.handle,
      query: 'token-2',
      mode: 'substring'
    });
    assert.ok(found.matches.length > 0);
    assert.ok(found.matches[0].page >= 1);
    assert.match(found.matches[0].preview, /token-2/);
  });

  it('archives oversized tool results and skips retrieve tools', () => {
    const store = {
      getDaemonControl() {
        return { enabled: true, toolResultArchiveChars: 2000, archivePreviewChars: 80, pageSizeChars: 1000 };
      },
      setDaemonControl() {}
    };
    const long = 'R'.repeat(3000);
    const archived = maybeArchiveToolResult({
      stateDir,
      sessionId: 'sess-2',
      toolName: 'bash',
      content: long,
      settingsStore: store
    });
    assert.match(archived, /Artifact Handle:/);
    assert.ok(archived.length < long.length);

    const skipped = maybeArchiveToolResult({
      stateDir,
      sessionId: 'sess-2',
      toolName: 'retrieve_tool_result',
      content: long,
      settingsStore: store
    });
    assert.equal(skipped, long);
  });
});
