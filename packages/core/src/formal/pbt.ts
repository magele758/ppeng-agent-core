/**
 * Tiny seeded property-based helpers. No extra dependency.
 * Passing these tests is not a formal proof.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  if (!items.length) throw new Error('pick: empty');
  return items[Math.floor(rng() * items.length)]!;
}

export function times(n: number, fn: (i: number) => void): void {
  for (let i = 0; i < n; i += 1) fn(i);
}
