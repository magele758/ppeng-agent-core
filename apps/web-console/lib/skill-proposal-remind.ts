export const REMIND_MIN = 0;
export const REMIND_MAX = 1000;

/** Strict parse of the reminder interval draft; empty or non-integer input is invalid (never 0). */
export function parseRemindDraft(draft: string): number | null {
  const trimmed = draft.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= REMIND_MIN && n <= REMIND_MAX ? n : null;
}
