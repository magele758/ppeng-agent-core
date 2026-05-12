import { writeFileSync } from 'node:fs';

const VALID_SKIP_TYPES = new Set(['SUPERSEDED', 'DUPLICATE', 'IRRELEVANT', 'OUTDATED', 'TOO_COMPLEX']);

/** @typedef {'full' | 'weak' | 'none'} SourceAvailability */

/**
 * Classify how much primary-source text we have for research.
 * `full` — long excerpt (and/or arXiv block); `weak` — title+URL and/or short excerpt; `none` — no signal.
 */
export function computeSourceAvailability({
  excerptText = '',
  sourceTitle = '',
  sourceUrl = '',
  hasArxivBlock = false,
  minFullChars = 500
}) {
  const ex = String(excerptText || '').trim();
  const title = String(sourceTitle || '').trim();
  const url = String(sourceUrl || '').trim();
  const arxiv = Boolean(hasArxivBlock) || /\barxiv\b/i.test(ex) || /##\s*arXiv/i.test(ex);
  if (arxiv || ex.length >= minFullChars) return 'full';
  if (ex.length > 0 || (title.length >= 3 && url.length >= 8)) return 'weak';
  return 'none';
}

function cleanLine(line) {
  return String(line || '')
    .replace(/\r/g, '')
    .replace(/^[\s>*`#-]+/, '')
    .replace(/[*_`]/g, '')
    .trim();
}

function normalizeSkipType(raw = '') {
  const upper = raw.trim().toUpperCase();
  return VALID_SKIP_TYPES.has(upper) ? upper : '';
}

function inferSkipType(raw = '') {
  const match = raw.toUpperCase().match(/\b(SUPERSEDED|DUPLICATE|IRRELEVANT|OUTDATED|TOO_COMPLEX)\b/);
  return match ? match[1] : 'IRRELEVANT';
}

/** @param {{ decision: string, skipType?: string, reason?: string }} parsed */
export function writeResearchDecisionFile(path, parsed) {
  const lines = [parsed.decision];
  if (parsed.decision === 'SKIP' && parsed.skipType) lines.push(parsed.skipType);
  if (parsed.reason) lines.push(String(parsed.reason).trim());
  writeFileSync(path, lines.filter(Boolean).join('\n') + '\n', 'utf8');
}

function tryParseProceedFromLine(line) {
  const s = cleanLine(line);
  if (!s) return null;
  if (/^PROCEED\b/i.test(s)) {
    return { rest: s.replace(/^PROCEED\b[:\s-]*/i, '').trim() };
  }
  if (/^(?:\*{1,2}|#{1,6}\s*)PROCEED\b/i.test(s)) {
    return { rest: s.replace(/^(?:\*{1,2}|#{1,6}\s*)PROCEED\b[:\s-]*/i, '').trim() };
  }
  const lead = s.match(/^(?:final\s+)?(?:decision|verdict|conclusion|recommendation)\s*[:=]\s*PROCEED\b/i);
  if (lead) {
    return { rest: s.slice(lead[0].length).replace(/^[:\s-]+/, '').trim() };
  }
  return null;
}

function tryParseSkipFromLine(line) {
  const s = cleanLine(line);
  if (!s) return null;
  const m = s.match(
    /^SKIP\b[:\s-]*(SUPERSEDED|DUPLICATE|IRRELEVANT|OUTDATED|TOO_COMPLEX)?[:\s-]*(.*)$/i
  );
  if (m) {
    return {
      skipType: normalizeSkipType(m[1] || '') || inferSkipType(line),
      rest: (m[2] || '').trim()
    };
  }
  const lead = s.match(/^(?:\*{1,2}|#{1,6}\s*)SKIP\b[:\s-]*/i);
  if (lead) {
    const tail = s.slice(lead[0].length).trim();
    const m2 = tail.match(/^(SUPERSEDED|DUPLICATE|IRRELEVANT|OUTDATED|TOO_COMPLEX)?[:\s-]*(.*)$/i);
    if (m2) {
      return {
        skipType: normalizeSkipType(m2[1] || '') || inferSkipType(tail),
        rest: (m2[2] || tail).trim()
      };
    }
  }
  const verdict = s.match(/^(?:final\s+)?(?:decision|verdict|conclusion)\s*[:=]\s*SKIP\b/i);
  if (verdict) {
    const tail = s.slice(verdict[0].length).replace(/^[:\s-]+/, '').trim();
    const m3 = tail.match(/^(SUPERSEDED|DUPLICATE|IRRELEVANT|OUTDATED|TOO_COMPLEX)?[:\s-]*(.*)$/i);
    if (m3) {
      return {
        skipType: normalizeSkipType(m3[1] || '') || inferSkipType(tail),
        rest: (m3[2] || tail).trim()
      };
    }
    return { skipType: inferSkipType(tail), rest: tail };
  }
  return null;
}

export function parseResearchDecisionOutput(rawOutput, options = {}) {
  const raw = String(rawOutput || '').trim();
  const availability =
    options.availability ??
    (options.hasUsableExcerpt === false ? 'none' : undefined) ??
    'full';
  const unparsedDefault = (options.unparsedDefault || 'proceed').toLowerCase() === 'skip' ? 'skip' : 'proceed';

  if (availability === 'none') {
    return {
      decision: 'SKIP',
      skipType: 'IRRELEVANT',
      reason: 'no source excerpt, title/url, or arXiv material; cannot evaluate.'
    };
  }

  if (/Cannot use this model:/i.test(raw)) {
    return {
      decision: 'SKIP',
      skipType: 'OUTDATED',
      reason: cleanLine(raw.split('\n').find((line) => /Cannot use this model:/i.test(line)) || raw)
    };
  }

  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const cleanedLines = lines.map(cleanLine).filter(Boolean);

  for (let i = 0; i < cleanedLines.length; i++) {
    const line = cleanedLines[i];

    const proceedTry = tryParseProceedFromLine(line);
    if (proceedTry) {
      const reasonLines = [];
      if (proceedTry.rest) reasonLines.push(proceedTry.rest);
      for (let j = i + 1; j < Math.min(cleanedLines.length, i + 6); j++) {
        if (/^(PROCEED|SKIP)\b/i.test(cleanedLines[j])) break;
        reasonLines.push(cleanedLines[j]);
      }
      return {
        decision: 'PROCEED',
        skipType: '',
        reason:
          reasonLines.join('\n').trim() || 'agent identified a concrete implementation opportunity.'
      };
    }

    const skipTry = tryParseSkipFromLine(line);
    if (skipTry) {
      const reasonLines = [];
      if (skipTry.rest) reasonLines.push(skipTry.rest);
      for (let j = i + 1; j < Math.min(cleanedLines.length, i + 6); j++) {
        if (/^(PROCEED|SKIP)\b/i.test(cleanedLines[j])) break;
        reasonLines.push(cleanedLines[j]);
      }
      return {
        decision: 'SKIP',
        skipType: skipTry.skipType,
        reason: reasonLines.join('\n').trim() || 'research gate rejected the item.'
      };
    }
  }

  const fallbackSkipType = inferSkipType(raw);
  if (/\bSKIP\b/i.test(raw)) {
    return {
      decision: 'SKIP',
      skipType: fallbackSkipType,
      reason: cleanedLines.slice(0, 8).join('\n') || 'research output indicates skip.'
    };
  }

  if (unparsedDefault === 'skip') {
    return {
      decision: 'SKIP',
      skipType: 'IRRELEVANT',
      reason: `unparsed research output (EVOLUTION_RESEARCH_UNPARSED_DEFAULT=skip):\n${cleanedLines.slice(0, 8).join('\n')}`.trim()
    };
  }

  return {
    decision: 'PROCEED',
    skipType: '',
    reason: `unparsed research output (treated as PROCEED; set EVOLUTION_RESEARCH_UNPARSED_DEFAULT=skip to reject):\n${cleanedLines.slice(0, 8).join('\n')}`.trim()
  };
}
