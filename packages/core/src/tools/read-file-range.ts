import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const LARGE_FILE_BYTES = 512 * 1024;

export async function shouldStreamReadFile(absPath: string): Promise<boolean> {
  const s = await stat(absPath);
  return s.isFile() && s.size > LARGE_FILE_BYTES;
}

/** Read line range [offsetLine, offsetLine + limit) without loading entire file. Line numbers 0-based. */
export async function readFileLineRange(
  absPath: string,
  offsetLine: number,
  limit: number
): Promise<{ lines: string[]; totalHint?: number; truncated: boolean }> {
  const stream = createReadStream(absPath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const lines: string[] = [];
  let lineNo = 0;
  let truncated = false;
  const endExclusive = offsetLine + limit;

  for await (const line of rl) {
    if (lineNo >= offsetLine && lineNo < endExclusive) {
      lines.push(line);
    }
    if (lineNo >= endExclusive) {
      truncated = true;
      break;
    }
    lineNo += 1;
  }

  return { lines, truncated };
}

export { LARGE_FILE_BYTES };
