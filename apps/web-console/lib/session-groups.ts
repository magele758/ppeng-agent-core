export type SessionDateBucket = 'today' | 'yesterday' | 'week' | 'month' | 'older' | `m:${string}`;

const NAMED_LABEL: Record<Exclude<SessionDateBucket, `m:${string}`>, string> = {
  today: '今天',
  yesterday: '昨天',
  week: '近 7 天',
  month: '近 30 天',
  older: '更早'
};

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function monthKey(at: number): `m:${string}` {
  const d = new Date(at);
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `m:${ym}`;
}

export function sessionGroupLabel(bucket: SessionDateBucket): string {
  if (bucket.startsWith('m:')) {
    const [year, month] = bucket.slice(2).split('-');
    return `${year}年${Number(month)}月`;
  }
  return NAMED_LABEL[bucket as Exclude<SessionDateBucket, `m:${string}`>] ?? '更早';
}

export function sessionActivityAt(session: { updatedAt?: string; createdAt?: string }): number | null {
  const raw = session.updatedAt || session.createdAt;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

export function sessionDateBucket(at: number | null, now = Date.now()): SessionDateBucket {
  if (at == null) return 'older';
  const today = startOfLocalDay(new Date(now));
  const day = startOfLocalDay(new Date(at));
  const diffDays = Math.round((today - day) / 86_400_000);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return 'week';
  if (diffDays < 30) return 'month';
  return monthKey(at);
}

export function groupSessionsByDate<T extends { updatedAt?: string; createdAt?: string }>(
  sessions: T[],
  now = Date.now()
): Array<{ bucket: SessionDateBucket; label: string; sessions: T[] }> {
  const named: SessionDateBucket[] = ['today', 'yesterday', 'week', 'month', 'older'];
  const map = new Map<SessionDateBucket, T[]>();
  for (const session of sessions) {
    const bucket = sessionDateBucket(sessionActivityAt(session), now);
    const list = map.get(bucket) ?? [];
    list.push(session);
    map.set(bucket, list);
  }
  const months = [...map.keys()]
    .filter((k): k is `m:${string}` => k.startsWith('m:'))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return [...named, ...months].flatMap((bucket) => {
    const list = map.get(bucket) ?? [];
    return list.length ? [{ bucket, label: sessionGroupLabel(bucket), sessions: list }] : [];
  });
}
