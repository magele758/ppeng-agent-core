/**
 * Inbox / processed-slug bookkeeping for evolution-run-day.
 *
 * - Parses the markdown inbox file (one bullet per RSS / archive item).
 * - Picks today's inbox file or falls back to the most recent one.
 * - Reads the success / failure / skip / no-op / superseded directories to
 *   build the set of slugs already handled, so a re-run skips them.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function utcDateString(d) {
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD_HH-MM in UTC; safe for branch names + worktree dirs (no `:`). */
export function utcDateTimeString(d) {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)}_${iso.slice(11, 13)}-${iso.slice(14, 16)}`;
}

export function makeSlug(title, link) {
  const h = createHash('sha256').update(link).digest('hex').slice(0, 8);
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'exp';
  return `${base}-${h}`.replace(/[/\\]/g, '-');
}

function normalizeInboxText(text) {
  // Undo evolution-learn bug where nested `.map()` arrays were `join`ed as one line.
  return text.replace(/\)\s*,\s*-\s*\[/g, ')\n- [');
}

function normalizeInboxTitle(title) {
  return title.replace(/\s+/g, ' ').trim();
}

function sliceInboxSection(text, section = 'all') {
  if (section === 'all') return text;
  const headings = {
    new: '## 今日新条目',
    rolling: '## 近期滚动（参考）'
  };
  const heading = headings[section];
  if (!heading) return text;
  const start = text.indexOf(heading);
  if (start === -1) return '';
  const rest = text.slice(start + heading.length);
  const nextHeading = rest.search(/\n##\s+/);
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

export function parseInboxItems(text, options = {}) {
  const { section = 'all' } = options;
  const normalized = sliceInboxSection(normalizeInboxText(text), section);
  const items = [];
  const re = /^-\s*\[([^\]]*)\]\(([^)]+)\)/gm;
  let m;
  while ((m = re.exec(normalized)) !== null) {
    const title = normalizeInboxTitle(m[1]);
    const link = m[2].trim();
    if (title && link) items.push({ title, link });
  }
  return items;
}

export function dedupeInboxItems(items) {
  const seenLinks = new Set();
  const seenSlugs = new Set();
  const deduped = [];
  for (const item of items) {
    if (!item?.title || !item?.link) continue;
    const slug = makeSlug(item.title, item.link);
    if (seenLinks.has(item.link) || seenSlugs.has(slug)) continue;
    seenLinks.add(item.link);
    seenSlugs.add(slug);
    deduped.push({ title: normalizeInboxTitle(item.title), link: item.link.trim() });
  }
  return deduped;
}

/** Today's inbox file if present, else the most recent dated file. */
export function pickInboxFile(repoRoot) {
  const inboxDir = join(repoRoot, 'doc', 'evolution', 'inbox');
  if (!existsSync(inboxDir)) return null;
  const today = utcDateString(new Date());
  const todayPath = join(inboxDir, `${today}.md`);
  if (existsSync(todayPath)) return todayPath;
  const files = readdirSync(inboxDir).filter((f) => f.endsWith('.md')).sort().reverse();
  if (files.length === 0) return null;
  return join(inboxDir, files[0]);
}

/**
 * Walk success / failure / skip / no-op / superseded result dirs and return a
 * Set of slugs already processed. File name format: YYYY-MM-DD-<slug>.md
 */
export function loadProcessedSlugs(repoRoot) {
  const processed = new Set();
  for (const dir of ['success', 'failure', 'skip', 'no-op', 'superseded']) {
    const dirPath = join(repoRoot, 'doc', 'evolution', dir);
    if (!existsSync(dirPath)) continue;
    try {
      for (const f of readdirSync(dirPath)) {
        if (!f.endsWith('.md')) continue;
        const slug = f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
        if (slug) processed.add(slug);
      }
    } catch {
      /* dir vanished mid-read */
    }
  }
  return processed;
}
