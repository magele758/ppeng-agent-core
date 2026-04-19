/**
 * Day-scoped progress persistence for multi-round evolution runs.
 *
 * Stored at `.evolution/runs/{utc-date}-progress.json`. New day → fresh file.
 * Tolerates legacy `totalItemsProcessed` field (renamed to totalSuccessItems).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { utcDateString } from './inbox-loader.mjs';

export function getProgressFilePath(repoRoot) {
  return join(repoRoot, '.evolution', 'runs', `${utcDateString(new Date())}-progress.json`);
}

export function loadProgress(repoRoot) {
  const path = getProgressFilePath(repoRoot);
  const empty = () => ({
    date: utcDateString(new Date()),
    roundsCompleted: 0,
    totalItemsFinished: 0,
    totalSuccessItems: 0,
    lastRunTime: null
  });
  if (!existsSync(path)) return empty();
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (data.date !== utcDateString(new Date())) return empty();
    const totalSuccessItems = data.totalSuccessItems ?? data.totalItemsProcessed ?? 0;
    return {
      ...data,
      totalItemsFinished: data.totalItemsFinished ?? 0,
      totalSuccessItems
    };
  } catch {
    return empty();
  }
}

export function saveProgress(repoRoot, progress) {
  const path = getProgressFilePath(repoRoot);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ts = progress.totalSuccessItems ?? 0;
  writeFileSync(
    path,
    JSON.stringify(
      {
        ...progress,
        totalSuccessItems: ts,
        // Keep the legacy key around for downstream readers (e.g. older dashboards).
        totalItemsProcessed: ts,
        lastRunTime: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
  );
}
