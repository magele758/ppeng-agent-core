import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { shouldStreamReadFile, readFileLineRange, LARGE_FILE_BYTES } from '../dist/tools/read-file-range.js';

/**
 * Helper function to create a temp file with random suffix
 */
function createTempFilePath() {
  return `${tmpdir()}/read-file-range-test-${Math.random().toString(36).slice(2)}.txt`;
}

/**
 * Helper function to create a file with specific content
 */
function createTestFile(path, content) {
  writeFileSync(path, content);
  return path;
}

/**
 * Helper function to create a file with specific number of lines
 */
function createFileWithLines(path, lineCount) {
  const lines = Array.from({ length: lineCount }, (_, i) => `line ${i}`);
  createTestFile(path, lines.join('\n'));
  return path;
}

/**
 * Helper function to create a file of specific size
 */
function createFileWithSize(path, sizeInBytes) {
  const content = 'x'.repeat(sizeInBytes);
  createTestFile(path, content);
  return path;
}

describe('read-file-range', () => {
  describe('LARGE_FILE_BYTES constant', () => {
    it('equals 512 * 1024', () => {
      assert.strictEqual(LARGE_FILE_BYTES, 512 * 1024);
    });
  });

  describe('shouldStreamReadFile', () => {
    let tempFile;

    afterEach(() => {
      if (tempFile) {
        try {
          unlinkSync(tempFile);
        } catch (e) {
          // File may have already been deleted
        }
      }
    });

    it('returns false for small files', async () => {
      tempFile = createFileWithSize(createTempFilePath(), 1000);
      assert.strictEqual(await shouldStreamReadFile(tempFile), false);
    });

    it('returns true for files > 512KB', async () => {
      tempFile = createFileWithSize(createTempFilePath(), LARGE_FILE_BYTES + 1000);
      assert.strictEqual(await shouldStreamReadFile(tempFile), true);
    });

    it('returns false for files exactly at boundary (uses > not >=)', async () => {
      tempFile = createFileWithSize(createTempFilePath(), LARGE_FILE_BYTES);
      // shouldStreamReadFile uses s.size > LARGE_FILE_BYTES (strict greater)
      assert.strictEqual(await shouldStreamReadFile(tempFile), false);
    });

    it('returns false for file just below boundary', async () => {
      tempFile = createFileWithSize(createTempFilePath(), LARGE_FILE_BYTES - 1);
      assert.strictEqual(await shouldStreamReadFile(tempFile), false);
    });
  });

  describe('readFileLineRange', () => {
    let tempFile;

    afterEach(() => {
      if (tempFile) {
        try {
          unlinkSync(tempFile);
        } catch (e) {
          // File may have already been deleted
        }
      }
    });

    it('reads first N lines (offset=0)', async () => {
      tempFile = createFileWithLines(createTempFilePath(), 10);
      const result = await readFileLineRange(tempFile, 0, 3);
      assert.deepStrictEqual(result.lines, ['line 0', 'line 1', 'line 2']);
      assert.strictEqual(result.truncated, true);
    });

    it('reads middle section (offset > 0)', async () => {
      tempFile = createFileWithLines(createTempFilePath(), 10);
      const result = await readFileLineRange(tempFile, 3, 3);
      assert.deepStrictEqual(result.lines, ['line 3', 'line 4', 'line 5']);
      assert.strictEqual(result.truncated, true);
    });

    it('sets truncated=true when more lines exist after range', async () => {
      tempFile = createFileWithLines(createTempFilePath(), 10);
      const result = await readFileLineRange(tempFile, 0, 5);
      assert.strictEqual(result.truncated, true);
    });

    it('sets truncated=false when range covers end of file', async () => {
      tempFile = createFileWithLines(createTempFilePath(), 10);
      const result = await readFileLineRange(tempFile, 7, 3);
      assert.deepStrictEqual(result.lines, ['line 7', 'line 8', 'line 9']);
      assert.strictEqual(result.truncated, false);
    });

    it('returns empty array when offset > total lines', async () => {
      tempFile = createFileWithLines(createTempFilePath(), 5);
      const result = await readFileLineRange(tempFile, 10, 5);
      assert.deepStrictEqual(result.lines, []);
      assert.strictEqual(result.truncated, false);
    });

    it('returns empty array when offset equals total lines', async () => {
      tempFile = createFileWithLines(createTempFilePath(), 5);
      const result = await readFileLineRange(tempFile, 5, 5);
      assert.deepStrictEqual(result.lines, []);
      assert.strictEqual(result.truncated, false);
    });

    it('handles single-line files', async () => {
      tempFile = createFileWithLines(createTempFilePath(), 1);
      const result = await readFileLineRange(tempFile, 0, 5);
      assert.deepStrictEqual(result.lines, ['line 0']);
      assert.strictEqual(result.truncated, false);
    });

    it('handles empty files', async () => {
      tempFile = createTestFile(createTempFilePath(), '');
      const result = await readFileLineRange(tempFile, 0, 5);
      assert.deepStrictEqual(result.lines, []);
      assert.strictEqual(result.truncated, false);
    });

    it('reads partial range at end of file', async () => {
      tempFile = createFileWithLines(createTempFilePath(), 10);
      const result = await readFileLineRange(tempFile, 8, 5);
      assert.deepStrictEqual(result.lines, ['line 8', 'line 9']);
      assert.strictEqual(result.truncated, false);
    });

    it('handles limit of 0', async () => {
      tempFile = createFileWithLines(createTempFilePath(), 10);
      const result = await readFileLineRange(tempFile, 5, 0);
      assert.deepStrictEqual(result.lines, []);
      assert.strictEqual(result.truncated, true);
    });
  });
});
