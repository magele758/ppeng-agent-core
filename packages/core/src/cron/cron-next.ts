import { ValidationError } from '../errors.js';

/**
 * 5-field cron (minute hour dom month dow), local time.
 * Supports *, n, n-m, star/n, n-m/n, n/n, and comma lists.
 * DOM + DOW both restricted → match if either matches (vixie).
 * DOW 7 is Sunday (same as 0).
 */

export type Cron5 = {
  minute: Set<number> | null;
  hour: Set<number> | null;
  dom: Set<number> | null;
  month: Set<number> | null;
  dow: Set<number> | null;
};

const MAX_SCAN_MINUTES = 366 * 24 * 60;

function parseField(
  raw: string,
  min: number,
  max: number,
  opts?: { sevenIsSunday?: boolean }
): Set<number> | null {
  const t = raw.trim();
  if (!t) throw new ValidationError('cron field is empty');
  if (t === '*') return null;
  const out = new Set<number>();
  for (const chunk of t.split(',')) {
    const m = chunk.match(/^(?:\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/);
    if (!m) throw new ValidationError(`invalid cron field: ${chunk}`);
    const step = m[3] ? Number(m[3]) : 1;
    if (!Number.isInteger(step) || step <= 0) {
      throw new ValidationError(`invalid cron step: ${chunk}`);
    }
    let start: number;
    let end: number;
    if (m[1] === undefined) {
      start = min;
      end = max;
    } else if (m[2] === undefined) {
      start = Number(m[1]);
      end = chunk.includes('/') ? max : start;
    } else {
      start = Number(m[1]);
      end = Number(m[2]);
    }
    if (opts?.sevenIsSunday) {
      if (start === 7) start = 0;
      if (end === 7) end = 0;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      throw new ValidationError(`invalid cron field: ${chunk}`);
    }
    if (start < min || end < min || start > max || end > max) {
      throw new ValidationError(`cron field out of range ${min}-${max}: ${chunk}`);
    }
    if (start <= end) {
      for (let n = start; n <= end; n += step) out.add(n);
    } else if (opts?.sevenIsSunday && start === 0 && end === 0) {
      out.add(0);
    } else {
      throw new ValidationError(`invalid cron range: ${chunk}`);
    }
  }
  if (out.size === 0) throw new ValidationError(`cron field matches nothing: ${t}`);
  return out;
}

export function parseCron5(expr: string): Cron5 {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new ValidationError('cron must have 5 fields (minute hour day-of-month month day-of-week)');
  }
  return {
    minute: parseField(parts[0]!, 0, 59),
    hour: parseField(parts[1]!, 0, 23),
    dom: parseField(parts[2]!, 1, 31),
    month: parseField(parts[3]!, 1, 12),
    dow: parseField(parts[4]!, 0, 7, { sevenIsSunday: true })
  };
}

function fieldMatches(set: Set<number> | null, value: number): boolean {
  return set == null || set.has(value);
}

export function cron5Matches(cron: Cron5, date: Date): boolean {
  if (!fieldMatches(cron.minute, date.getMinutes())) return false;
  if (!fieldMatches(cron.hour, date.getHours())) return false;
  if (!fieldMatches(cron.month, date.getMonth() + 1)) return false;
  const domOk = fieldMatches(cron.dom, date.getDate());
  const dowOk = fieldMatches(cron.dow, date.getDay());
  if (cron.dom != null && cron.dow != null) return domOk || dowOk;
  return domOk && dowOk;
}

/** First matching local minute strictly after `from`. */
export function nextCronRunAt(expr: string, from: Date = new Date()): Date {
  const cron = parseCron5(expr);
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < MAX_SCAN_MINUTES; i += 1) {
    if (cron5Matches(cron, d)) return d;
    d.setMinutes(d.getMinutes() + 1);
  }
  throw new ValidationError('cron does not match any time in the next year');
}
