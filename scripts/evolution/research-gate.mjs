const VALID_SKIP_TYPES = new Set(['SUPERSEDED', 'DUPLICATE', 'IRRELEVANT', 'OUTDATED', 'TOO_COMPLEX']);

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

export function parseResearchDecisionOutput(rawOutput, options = {}) {
  const raw = String(rawOutput || '').trim();
  const { hasUsableExcerpt = true } = options;

  if (!hasUsableExcerpt) {
    return {
      decision: 'SKIP',
      skipType: 'IRRELEVANT',
      reason: 'source excerpt is empty or fetch failed; cannot evaluate safely.'
    };
  }

  if (/Cannot use this model:/i.test(raw)) {
    return {
      decision: 'SKIP',
      skipType: 'OUTDATED',
      reason: cleanLine(raw.split('\n').find((line) => /Cannot use this model:/i.test(line)) || raw)
    };
  }

  const lines = raw.split('\n').map(cleanLine).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^PROCEED\b/i.test(line)) {
      const reasonLines = [];
      const inlineReason = line.replace(/^PROCEED\b[:\s-]*/i, '').trim();
      if (inlineReason) reasonLines.push(inlineReason);
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        if (/^(PROCEED|SKIP)\b/i.test(lines[j])) break;
        reasonLines.push(lines[j]);
      }
      return {
        decision: 'PROCEED',
        skipType: '',
        reason: reasonLines.join('\n').trim() || 'agent identified a concrete implementation opportunity.'
      };
    }

    const skipMatch = line.match(/^SKIP\b[:\s-]*(SUPERSEDED|DUPLICATE|IRRELEVANT|OUTDATED|TOO_COMPLEX)?[:\s-]*(.*)$/i);
    if (skipMatch) {
      const skipType = normalizeSkipType(skipMatch[1] || '') || inferSkipType(line);
      const reasonLines = [];
      const inlineReason = (skipMatch[2] || '').trim();
      if (inlineReason) reasonLines.push(inlineReason);
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        if (/^(PROCEED|SKIP)\b/i.test(lines[j])) break;
        reasonLines.push(lines[j]);
      }
      return {
        decision: 'SKIP',
        skipType,
        reason: reasonLines.join('\n').trim() || 'research gate rejected the item.'
      };
    }
  }

  const fallbackSkipType = inferSkipType(raw);
  if (/\bSKIP\b/i.test(raw)) {
    return {
      decision: 'SKIP',
      skipType: fallbackSkipType,
      reason: lines.slice(0, 6).join('\n') || 'research output indicates skip.'
    };
  }

  return {
    decision: 'PROCEED',
    skipType: '',
    reason: `unparsed research output:\n${lines.slice(0, 6).join('\n')}`.trim()
  };
}
