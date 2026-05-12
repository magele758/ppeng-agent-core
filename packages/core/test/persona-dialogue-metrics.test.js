import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLexicalDiversity,
  computePersonaDialogueMetrics,
  computePersonaTermRecall,
  extractDialogueTokens,
  personaSpecTerms
} from '../dist/model/persona-dialogue-metrics.js';

function makeMessage(role, parts) {
  return {
    id: `m_${Math.random().toString(36).slice(2)}`,
    sessionId: 's1',
    role,
    parts,
    createdAt: new Date().toISOString()
  };
}

const textPart = text => ({ type: 'text', text });

describe('extractDialogueTokens', () => {
  it('lowercases, splits punctuation, strips common function words', () => {
    const t = extractDialogueTokens('I need OLED, HDR10+, Wi-Fi MUST work.');
    assert.ok(t.includes('oled'));
    assert.ok(t.includes('hdr10'));
    assert.ok(t.includes('wifi'));
    assert.ok(t.includes('work'));
    assert.equal(t.includes('must'), false);
  });
});

describe('computeLexicalDiversity', () => {
  it('returns TTR = 1 for empty token list', () => {
    const x = computeLexicalDiversity([]);
    assert.equal(x.typeTokenRatio, 1);
    assert.equal(x.totalTokens, 0);
  });

  it('computes repetition penalty', () => {
    const x = computeLexicalDiversity(['a', 'a', 'b']);
    assert.equal(x.uniqueTokens, 2);
    assert.equal(x.totalTokens, 3);
    assert.ok(Math.abs(x.typeTokenRatio - 2 / 3) < 1e-9);
  });
});

describe('computePersonaDialogueMetrics', () => {
  it('scores persona term recall only on user text', () => {
    const spec = 'dealbreaker: under 800 dollars hdmi ports';
    const messages = [
      makeMessage('user', [
        textPart('Looking under 900 but need HDMI.')
      ]),
      makeMessage('assistant', [textPart('We have hdmi models under 850 dollars')])
    ];
    const m = computePersonaDialogueMetrics(messages, { personaSpecText: spec });
    assert.ok(m.lexicalAssistant.totalTokens >= 5);
    assert.equal(m.personaTermsConsidered, personaSpecTerms(spec).length);
    assert.ok(m.personaTermRecall !== undefined && m.personaTermRecall < 1);
    assert.ok(m.personaTermRecall !== undefined && m.personaTermRecall > 0);
  });

  it('full recall when user echoes constraints', () => {
    const spec = 'budget 500 vegan leather';
    const messages = [makeMessage('user', [textPart('budget 500, want vegan leather only')])];
    const rec = computePersonaDialogueMetrics(messages, { personaSpecText: spec });
    assert.equal(rec.personaTermRecall, 1);
  });

  it('omit recall when persona spec yields no substantive terms', () => {
    const messages = [
      makeMessage('user', [textPart('hello')]),
      makeMessage('assistant', [textPart('hello')])
    ];
    const m = computePersonaDialogueMetrics(messages, { personaSpecText: '%%%   @@' });
    assert.equal(m.personaTermRecall, undefined);
    assert.ok(m.lexicalUser.totalTokens <= 3);
  });
});

describe('computePersonaTermRecall', () => {
  it('is 1 for empty persona term list', () => {
    assert.equal(computePersonaTermRecall([], 'anything'), 1);
  });
});
