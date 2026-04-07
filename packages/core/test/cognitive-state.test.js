import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCognitiveMetrics,
  detectCognitivePhase,
  getEpisodicSelectionParams,
  formatCognitiveStateForPrompt,
  computeCognitiveState
} from '../dist/model/cognitive-state.js';
import {
  selectEpisodicMessagesWithCognitiveState
} from '../dist/model/episodic-selection.js';

function makeMessage(role, parts, createdAt = new Date().toISOString()) {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    sessionId: 'session_1',
    role,
    parts,
    createdAt
  };
}

function textPart(text) {
  return { type: 'text', text };
}

function toolCallPart(name, input = {}) {
  return { type: 'tool_call', toolCallId: `tc_${Math.random().toString(36).slice(2)}`, name, input };
}

function toolResultPart(name, content, ok = true) {
  return { type: 'tool_result', toolCallId: `tc_${Math.random().toString(36).slice(2)}`, name, content, ok };
}

test('computeCognitiveMetrics returns default values for empty messages', () => {
  const metrics = computeCognitiveMetrics([]);
  assert.equal(metrics.toolSuccessRate, 1);
  assert.equal(metrics.readWriteRatio, 1);
  assert.equal(metrics.messageComplexity, 0);
  assert.equal(metrics.errorRate, 0);
});

test('computeCognitiveMetrics detects read operations', () => {
  const messages = [
    makeMessage('assistant', [toolCallPart('read_file', { path: '/src/index.ts' })]),
    makeMessage('tool', [toolResultPart('read_file', 'file content', true)])
  ];
  const metrics = computeCognitiveMetrics(messages);
  assert.ok(metrics.readWriteRatio >= 1);
});

test('computeCognitiveMetrics detects write operations', () => {
  const messages = [
    makeMessage('assistant', [toolCallPart('write_file', { path: '/src/test.ts' })]),
    makeMessage('tool', [toolResultPart('write_file', 'written', true)])
  ];
  const metrics = computeCognitiveMetrics(messages);
  assert.ok(metrics.readWriteRatio < 1);
});

test('computeCognitiveMetrics detects error patterns', () => {
  const messages = [
    makeMessage('assistant', [toolCallPart('run_tests', {})]),
    makeMessage('tool', [toolResultPart('run_tests', 'Error: Test failed', false)])
  ];
  const metrics = computeCognitiveMetrics(messages);
  assert.ok(metrics.errorRate > 0);
  assert.ok(metrics.toolSuccessRate < 1);
});

test('detectCognitivePhase identifies exploration phase', () => {
  const messages = [
    makeMessage('user', [textPart('What does this codebase do?')]),
    makeMessage('assistant', [toolCallPart('glob', { pattern: '**/*.ts' })]),
    makeMessage('tool', [toolResultPart('glob', 'found 10 files', true)]),
    makeMessage('assistant', [toolCallPart('read_file', { path: '/src/index.ts' })]),
    makeMessage('tool', [toolResultPart('read_file', 'file content', true)])
  ];
  const state = detectCognitivePhase(messages, computeCognitiveMetrics(messages));
  assert.equal(state.phase, 'exploration');
});

test('detectCognitivePhase identifies implementation phase', () => {
  const messages = [
    makeMessage('user', [textPart('Add a new feature')]),
    makeMessage('assistant', [toolCallPart('write_file', { path: '/src/feature.ts' })]),
    makeMessage('tool', [toolResultPart('write_file', 'created', true)]),
    makeMessage('assistant', [toolCallPart('edit_file', { path: '/src/index.ts' })]),
    makeMessage('tool', [toolResultPart('edit_file', 'updated', true)])
  ];
  const state = detectCognitivePhase(messages, computeCognitiveMetrics(messages));
  assert.equal(state.phase, 'implementation');
});

test('detectCognitivePhase identifies debugging phase from errors', () => {
  const messages = [
    makeMessage('user', [textPart('Fix the tests')]),
    makeMessage('assistant', [toolCallPart('run_tests', {})]),
    makeMessage('tool', [toolResultPart('run_tests', 'Error: 3 tests failed', false)]),
    makeMessage('assistant', [toolCallPart('run_tests', {})]),
    makeMessage('tool', [toolResultPart('run_tests', 'Error: still failing', false)])
  ];
  const metrics = computeCognitiveMetrics(messages);
  const state = detectCognitivePhase(messages, metrics);
  assert.equal(state.phase, 'debugging');
  assert.ok(state.metrics.errorRate > 0);
});

test('getEpisodicSelectionParams returns different strategies for different phases', () => {
  const baseMetrics = {
    toolSuccessRate: 0.8,
    readWriteRatio: 1,
    messageComplexity: 5,
    errorRate: 0.1,
    timeSinceUserMs: 5000,
    consecutiveAssistantTurns: 2
  };

  const explorationParams = getEpisodicSelectionParams({
    phase: 'exploration',
    confidence: 0.8,
    metrics: baseMetrics,
    contextStrategy: 'summary-weighted',
    reason: 'test'
  });

  const debuggingParams = getEpisodicSelectionParams({
    phase: 'debugging',
    confidence: 0.8,
    metrics: { ...baseMetrics, errorRate: 0.3 },
    contextStrategy: 'error-focused',
    reason: 'test'
  });

  const implementationParams = getEpisodicSelectionParams({
    phase: 'implementation',
    confidence: 0.8,
    metrics: baseMetrics,
    contextStrategy: 'recent',
    reason: 'test'
  });

  // Exploration should have more summary weight
  assert.ok(explorationParams.summaryWeight >= implementationParams.summaryWeight);
  // Debugging should prioritize errors
  assert.ok(debuggingParams.prioritizeErrors);
  // Implementation should focus on recent
  assert.ok(implementationParams.minRecentMessages >= explorationParams.minRecentMessages);
});

test('formatCognitiveStateForPrompt produces readable output', () => {
  const state = {
    phase: 'debugging',
    confidence: 0.85,
    metrics: {
      toolSuccessRate: 0.6,
      readWriteRatio: 1,
      messageComplexity: 5,
      errorRate: 0.3,
      timeSinceUserMs: 5000,
      consecutiveAssistantTurns: 3
    },
    contextStrategy: 'error-focused',
    reason: 'high error rate'
  };
  const formatted = formatCognitiveStateForPrompt(state);
  assert.ok(formatted.includes('debugging'));
  assert.ok(formatted.includes('85%'));
  assert.ok(formatted.includes('error'));
});

test('selectEpisodicMessagesWithCognitiveState returns cognitive phase', () => {
  const messages = [];
  for (let i = 0; i < 30; i++) {
    messages.push(makeMessage('user', [textPart(`Message ${i}`)]));
    messages.push(makeMessage('assistant', [textPart(`Response ${i}`)]));
  }

  const result = selectEpisodicMessagesWithCognitiveState(messages, 24000);
  assert.ok(result.selected.length > 0);
  assert.ok(result.selected.length <= messages.length);
  assert.ok(typeof result.cognitivePhase === 'string');
  assert.ok(typeof result.cognitiveConfidence === 'number');
});

test('selectEpisodicMessagesWithCognitiveState prioritizes error messages in debugging', () => {
  const messages = [
    makeMessage('user', [textPart('Initial request')]),
    makeMessage('assistant', [toolCallPart('read_file', {})]),
    makeMessage('tool', [toolResultPart('read_file', 'content', true)]),
  ];

  // Add many messages to trigger selection
  for (let i = 0; i < 20; i++) {
    messages.push(makeMessage('assistant', [toolCallPart('run_tests', {})]));
    messages.push(makeMessage('tool', [toolResultPart('run_tests', `Error: test ${i} failed`, false)]));
  }

  const result = selectEpisodicMessagesWithCognitiveState(messages, 12000);
  // Should detect debugging phase
  assert.equal(result.cognitivePhase, 'debugging');
});

test('computeCognitiveState integrates with session record', () => {
  const session = {
    id: 'session_1',
    title: 'Test Session',
    mode: 'chat',
    status: 'running',
    agentId: 'agent_1',
    todo: [],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const messages = [
    makeMessage('user', [textPart('Hello')]),
    makeMessage('assistant', [textPart('Hi there!')])
  ];

  const state = computeCognitiveState(session, messages);
  assert.ok(state.phase);
  assert.ok(state.confidence >= 0 && state.confidence <= 1);
  assert.ok(state.metrics);
  assert.ok(state.contextStrategy);
});
