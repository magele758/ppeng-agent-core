#!/usr/bin/env node
/**
 * Normalize research CLI output → research-decision.txt (PROCEED/SKIP + reason).
 * Used by evolution-research.sh so bash and Cursor paths share parseResearchDecisionOutput.
 */
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import {
  computeSourceAvailability,
  parseResearchDecisionOutput,
  writeResearchDecisionFile
} from './research-gate.mjs';

function excerptForAvailability() {
  const excerptFile = process.env.EVOLUTION_SOURCE_EXCERPT_FILE || '';
  return excerptFile && existsSync(excerptFile) ? readFileSync(excerptFile, 'utf8').trim() : '';
}

function readAvailability() {
  const excerptText = excerptForAvailability();
  const sourceTitle = (process.env.EVOLUTION_SOURCE_TITLE || '').trim();
  const sourceUrl = (process.env.EVOLUTION_SOURCE_URL || '').trim();
  const minFull = Math.max(
    120,
    Number.parseInt(String(process.env.EVOLUTION_RESEARCH_FULL_EXCERPT_MIN_CHARS || '500'), 10) || 500
  );
  const hasArxivBlock = /\b##\s*arXiv\b/i.test(excerptText);
  return computeSourceAvailability({
    excerptText,
    sourceTitle,
    sourceUrl,
    hasArxivBlock,
    minFullChars: minFull
  });
}

function unparsedDefault() {
  return (process.env.EVOLUTION_RESEARCH_UNPARSED_DEFAULT || 'proceed').toLowerCase() === 'skip' ? 'skip' : 'proceed';
}

function main() {
  const rawPath = process.env.EVOLUTION_RESEARCH_RAW_FILE || process.argv[2];
  const outPath = process.env.EVOLUTION_RESEARCH_DECISION_FILE;
  if (!rawPath || !outPath) {
    console.error('research-write-decision: need EVOLUTION_RESEARCH_RAW_FILE (or argv[2]) and EVOLUTION_RESEARCH_DECISION_FILE');
    process.exit(1);
  }
  const raw = readFileSync(rawPath, 'utf8');
  const availability = readAvailability();
  const parsed = parseResearchDecisionOutput(raw, {
    availability,
    unparsedDefault: unparsedDefault()
  });
  writeResearchDecisionFile(outPath, parsed);
  if (process.env.EVOLUTION_RESEARCH_DELETE_RAW_FILE === '1') {
    try {
      unlinkSync(rawPath);
    } catch {
      /* ok */
    }
  }
}

main();
