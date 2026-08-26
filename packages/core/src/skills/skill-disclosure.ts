/**
 * Progressive disclosure helpers for SKILL.md bodies.
 *
 * Level 1 — metadata (name/description) always in routing shortlist
 * Level 2 — body sections until ## References / ## Scripts (or first fence of large blob)
 * Level 3 — references/ and scripts/ loaded only when the model reads those paths
 */

export interface SkillDisclosureResult {
  /** Body suitable for load_skill injection */
  disclosed: string;
  /** True when body was truncated for progressive disclosure */
  truncated: boolean;
  /** Hint appended for the model */
  hint?: string;
}

const CUT_MARKERS = [
  /^##\s+References\b/im,
  /^##\s+Scripts\b/im,
  /^##\s+Appendix\b/im,
  /^##\s+Deep Dive\b/im,
  /^##\s+详细参考\b/im
];

export function discloseSkillBody(
  body: string,
  options?: { maxChars?: number; progressive?: boolean }
): SkillDisclosureResult {
  const progressive = options?.progressive !== false;
  const maxChars = options?.maxChars && options.maxChars > 0 ? options.maxChars : 12_000;
  const raw = body.replace(/\r\n/g, '\n').trim();
  if (!progressive) {
    if (raw.length <= maxChars) return { disclosed: raw, truncated: false };
    return {
      disclosed: raw.slice(0, maxChars),
      truncated: true,
      hint: 'Skill body truncated by maxChars; use read_file on skill references for the rest.'
    };
  }

  let cutAt = raw.length;
  for (const re of CUT_MARKERS) {
    const m = re.exec(raw);
    if (m && m.index != null && m.index > 200 && m.index < cutAt) {
      cutAt = m.index;
    }
  }

  let disclosed = raw.slice(0, cutAt).trimEnd();
  let truncated = cutAt < raw.length;
  if (disclosed.length > maxChars) {
    disclosed = disclosed.slice(0, maxChars).trimEnd();
    truncated = true;
  }

  if (!truncated) {
    return { disclosed, truncated: false };
  }

  return {
    disclosed,
    truncated: true,
    hint:
      'Progressive disclosure: full References/Scripts sections omitted. Use read_file on the skill directory references/ or scripts/ when needed.'
  };
}

export function formatDisclosedSkillContent(result: SkillDisclosureResult): string {
  if (!result.hint) return result.disclosed;
  return `${result.disclosed}\n\n---\n[${result.hint}]`;
}
