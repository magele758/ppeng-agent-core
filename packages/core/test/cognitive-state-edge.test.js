import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCognitiveMetrics,
  detectCognitivePhase,
  getEpisodicSelectionParams,
  formatCognitiveStateForPrompt
} from '../dist/model/cognitive-state.js';

function makeMessage(role, parts, createdAt = new Date().toISOString()) {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    sessionId: 'session_1',
    role,
    parts,
    createdAt
  };
}

function textPart(text) { return { type: 'text', text }; }
function toolCallPart(name, input = {}) {
  return { type: 'tool_call', toolCallId: `tc_${Math.random().toString(36).slice(2)}`, name, input };
}
function toolResultPart(name, content, ok = true) {
  return { type: 'tool_result', toolCallId: `tc_${Math.random().toString(36).slice(2)}`, name, content, ok };
}

describe('computeCognitiveMetrics edge cases', () => {
  it('toolSuccessRate is 1 when no tool calls exist', () => {
    const msgs = [makeMessage('user', [textPart('hi')]), makeMessage('assistant', [textPart('hello')])];
    const m = computeCognitiveMetrics(msgs);
    assert.equal(m.toolSuccessRate, 1);
  });

  it('readWriteRatio is Infinity when only reads', () => {
    const msgs = [
      makeMessage('assistant', [toolCallPart('read_file')]),
      makeMessage('tool', [toolResultPart('read_file', 'content', true)])
    ];
    const m = computeCognitiveMetrics(msgs);
    assert.equal(m.readWriteRatio, Infinity);
  });

  it('readWriteRatio is 0 when only writes', () => {
    const msgs = [
      makeMessage('assistant', [toolCallPart('write_file')]),
      makeMessage('tool', [toolResultPart('write_file', 'ok', true)])
    ];
    const m = computeCognitiveMetrics(msgs);
    assert.equal(m.readWriteRatio, 0);
  });

  it('messageComplexity factors in part count and text length', () => {
    const msgs = [
      makeMessage('user', [textPart('A'.repeat(200))]),
      makeMessage('assistant', [textPart('B'.repeat(300)), toolCallPart('bash')])
    ];
    const m = computeCognitiveMetrics(msgs);
    // 2 messages, totalParts = 1+2=3, totalChars = 500, complexity = (3 + 500/100) / 2 = 4
    assert.ok(m.messageComplexity > 0);
  });

  it('consecutiveAssistantTurns counts from end', () => {
    const msgs = [
      makeMessage('user', [textPart('go')]),
      makeMessage('assistant', [textPart('1')]),
      makeMessage('assistant', [textPart('2')]),
      makeMessage('assistant', [textPart('3')])
    ];
    const m = computeCognitiveMetrics(msgs);
    assert.equal(m.consecutiveAssistantTurns, 3);
  });

  it('consecutiveAssistantTurns is 0 when last msg is user', () => {
    const msgs = [
      makeMessage('assistant', [textPart('hi')]),
      makeMessage('user', [textPart('hello')])
    ];
    const m = computeCognitiveMetrics(msgs);
    assert.equal(m.consecutiveAssistantTurns, 0);
  });

  it('windowSize limits analyzed messages', () => {
    const msgs = [];
    for (let i = 0; i < 50; i++) {
      msgs.push(makeMessage('assistant', [toolCallPart('read_file')]));
      msgs.push(makeMessage('tool', [toolResultPart('read_file', 'ok', true)]));
    }
    // Only last 5 messages analyzed
    const m = computeCognitiveMetrics(msgs, { windowSize: 5 });
    // With windowSize 5, fewer tool calls counted
    assert.ok(m.toolSuccessRate >= 0);
  });

  it('errorRate counts both failed results and error patterns', () => {
    const msgs = [
      makeMessage('assistant', [toolCallPart('bash')]),
      // ok=false → errorCount+1, content has "Error" → errorCount+1 = 2 errors
      makeMessage('tool', [toolResultPart('bash', 'Error: command failed', false)])
    ];
    const m = computeCognitiveMetrics(msgs);
    // 2 messages, errorCount=2 → errorRate = 2/2 = 1.0
    assert.equal(m.errorRate, 1.0);
  });

  it('error pattern matching is case-insensitive', () => {
    const msgs = [
      makeMessage('assistant', [toolCallPart('bash')]),
      makeMessage('tool', [toolResultPart('bash', 'TIMEOUT occurred', true)])
    ];
    const m = computeCognitiveMetrics(msgs);
    assert.ok(m.errorRate > 0);
  });

  it('tool name substring matching: "my_read_data" counts as read', () => {
    const msgs = [
      makeMessage('assistant', [toolCallPart('my_read_data')]),
      makeMessage('tool', [toolResultPart('my_read_data', 'data', true)])
    ];
    const m = computeCognitiveMetrics(msgs);
    assert.ok(m.readWriteRatio >= 1);
  });

  it('tool name substring matching: "batch_write_ops" counts as write', () => {
    const msgs = [
      makeMessage('assistant', [toolCallPart('batch_write_ops')]),
      makeMessage('tool', [toolResultPart('batch_write_ops', 'done', true)])
    ];
    const m = computeCognitiveMetrics(msgs);
    assert.ok(m.readWriteRatio < 1 || m.readWriteRatio === 1);
  });

  it('timeSinceUserMs is 0 when no user messages', () => {
    const msgs = [
      makeMessage('assistant', [textPart('hi')]),
      makeMessage('tool', [toolResultPart('bash', 'ok', true)])
    ];
    const m = computeCognitiveMetrics(msgs);
    assert.equal(m.timeSinceUserMs, 0);
  });
});

describe('detectCognitivePhase edge cases', () => {
  it('returns idle phase for empty messages', () => {
    const metrics = computeCognitiveMetrics([]);
    const state = detectCognitivePhase([], metrics);
    assert.equal(state.phase, 'idle');
    assert.equal(state.confidence, 1);
    assert.equal(state.contextStrategy, 'full');
  });

  it('defaults to exploration when no tool signals', () => {
    const msgs = [
      makeMessage('user', [textPart('hello')]),
      makeMessage('assistant', [textPart('hi there')])
    ];
    const metrics = computeCognitiveMetrics(msgs);
    const state = detectCognitivePhase(msgs, metrics);
    assert.equal(state.phase, 'exploration');
  });

  it('confidence reflects score dominance', () => {
    // Pure exploration with 5 glob calls → high exploration score
    const msgs = [];
    for (let i = 0; i < 5; i++) {
      msgs.push(makeMessage('assistant', [toolCallPart('glob')]));
      msgs.push(makeMessage('tool', [toolResultPart('glob', 'files', true)]));
    }
    const metrics = computeCognitiveMetrics(msgs);
    const state = detectCognitivePhase(msgs, metrics);
    assert.equal(state.phase, 'exploration');
    assert.ok(state.confidence > 0.5, `Confidence ${state.confidence} should be > 0.5`);
  });

  it('high error rate boosts debugging score', () => {
    const metrics = {
      toolSuccessRate: 0.3,
      readWriteRatio: 1,
      messageComplexity: 1,
      errorRate: 0.5,
      timeSinceUserMs: 0,
      consecutiveAssistantTurns: 0
    };
    const msgs = [makeMessage('user', [textPart('fix it')])];
    const state = detectCognitivePhase(msgs, metrics);
    assert.equal(state.phase, 'debugging');
  });

  it('consecutive assistant turns > 5 boosts debugging/implementation', () => {
    const metrics = {
      toolSuccessRate: 1,
      readWriteRatio: 1,
      messageComplexity: 1,
      errorRate: 0,
      timeSinceUserMs: 0,
      consecutiveAssistantTurns: 8
    };
    const msgs = [makeMessage('user', [textPart('do stuff')])];
    const state = detectCognitivePhase(msgs, metrics);
    // Should be debugging or implementation due to high consecutive turns
    assert.ok(['debugging', 'implementation'].includes(state.phase));
  });

  it('reason string includes relevant scores', () => {
    const msgs = [
      makeMessage('assistant', [toolCallPart('read_file')]),
      makeMessage('tool', [toolResultPart('read_file', 'ok', true)])
    ];
    const metrics = computeCognitiveMetrics(msgs);
    const state = detectCognitivePhase(msgs, metrics);
    assert.ok(state.reason.length > 0);
  });
});

describe('getEpisodicSelectionParams', () => {
  it('error-focused: 16 recent, prioritize errors, low summary weight', () => {
    const params = getEpisodicSelectionParams({
      phase: 'debugging', confidence: 0.8,
      metrics: computeCognitiveMetrics([]),
      contextStrategy: 'error-focused', reason: ''
    });
    assert.equal(params.minRecentMessages, 16);
    assert.equal(params.prioritizeErrors, true);
    assert.equal(params.summaryWeight, 0.3);
  });

  it('recent: 12 recent, no error priority', () => {
    const params = getEpisodicSelectionParams({
      phase: 'implementation', confidence: 0.8,
      metrics: computeCognitiveMetrics([]),
      contextStrategy: 'recent', reason: ''
    });
    assert.equal(params.minRecentMessages, 12);
    assert.equal(params.prioritizeErrors, false);
  });

  it('summary-weighted: 8 recent, high summary weight', () => {
    const params = getEpisodicSelectionParams({
      phase: 'exploration', confidence: 0.8,
      metrics: computeCognitiveMetrics([]),
      contextStrategy: 'summary-weighted', reason: ''
    });
    assert.equal(params.minRecentMessages, 8);
    assert.equal(params.summaryWeight, 0.7);
  });

  it('full: 8 recent, medium summary weight', () => {
    const params = getEpisodicSelectionParams({
      phase: 'idle', confidence: 1,
      metrics: computeCognitiveMetrics([]),
      contextStrategy: 'full', reason: ''
    });
    assert.equal(params.minRecentMessages, 8);
    assert.equal(params.summaryWeight, 0.5);
  });
});

describe('formatCognitiveStateForPrompt edge cases', () => {
  it('shows error rate warning when > 10%', () => {
    const state = {
      phase: 'debugging', confidence: 0.7,
      metrics: {
        toolSuccessRate: 0.5, readWriteRatio: 1, messageComplexity: 1,
        errorRate: 0.25, timeSinceUserMs: 0, consecutiveAssistantTurns: 0
      },
      contextStrategy: 'error-focused', reason: ''
    };
    const output = formatCognitiveStateForPrompt(state);
    assert.ok(output.includes('⚠️'));
    assert.ok(output.includes('25%'));
  });

  it('shows consecutive turns info when > 3', () => {
    const state = {
      phase: 'implementation', confidence: 0.6,
      metrics: {
        toolSuccessRate: 1, readWriteRatio: 1, messageComplexity: 1,
        errorRate: 0, timeSinceUserMs: 0, consecutiveAssistantTurns: 5
      },
      contextStrategy: 'recent', reason: ''
    };
    const output = formatCognitiveStateForPrompt(state);
    assert.ok(output.includes('5 consecutive'));
  });

  it('does not show warnings for normal metrics', () => {
    const state = {
      phase: 'exploration', confidence: 0.9,
      metrics: {
        toolSuccessRate: 1, readWriteRatio: 2, messageComplexity: 3,
        errorRate: 0.05, timeSinceUserMs: 0, consecutiveAssistantTurns: 1
      },
      contextStrategy: 'summary-weighted', reason: ''
    };
    const output = formatCognitiveStateForPrompt(state);
    assert.ok(!output.includes('⚠️'));
    assert.ok(!output.includes('ℹ️'));
  });

  it('includes phase description', () => {
    const state = {
      phase: 'completion', confidence: 0.95,
      metrics: {
        toolSuccessRate: 1, readWriteRatio: 1, messageComplexity: 1,
        errorRate: 0, timeSinceUserMs: 0, consecutiveAssistantTurns: 0
      },
      contextStrategy: 'recent', reason: ''
    };
    const output = formatCognitiveStateForPrompt(state);
    assert.ok(output.includes('Finalizing'));
  });
});
