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

// ── Additional edge-case tests ──

// -- computeCognitiveMetrics edge cases --

test('computeCognitiveMetrics: single user message', () => {
  const messages = [makeMessage('user', [textPart('hello')])];
  const metrics = computeCognitiveMetrics(messages);
  assert.equal(metrics.toolSuccessRate, 1);
  assert.equal(metrics.messageComplexity > 0, true);
  assert.equal(metrics.consecutiveAssistantTurns, 0);
});

test('computeCognitiveMetrics: single assistant message', () => {
  const messages = [makeMessage('assistant', [textPart('hi there')])];
  const metrics = computeCognitiveMetrics(messages);
  assert.equal(metrics.consecutiveAssistantTurns, 1);
});

test('computeCognitiveMetrics: very long conversation (25+ messages)', () => {
  const messages = [];
  for (let i = 0; i < 25; i++) {
    messages.push(makeMessage('user', [textPart(`Question ${i}`)]));
    messages.push(makeMessage('assistant', [
      toolCallPart('read_file', { path: `/file${i}.ts` })
    ]));
    messages.push(makeMessage('tool', [
      toolResultPart('read_file', `content of file ${i}`, true)
    ]));
  }
  const metrics = computeCognitiveMetrics(messages);
  assert.equal(metrics.toolSuccessRate, 1);
  assert.ok(metrics.readWriteRatio >= 1);
  assert.ok(metrics.messageComplexity > 0);
});

test('computeCognitiveMetrics: only user messages (no tools)', () => {
  const messages = [
    makeMessage('user', [textPart('first message')]),
    makeMessage('user', [textPart('second message')]),
    makeMessage('user', [textPart('third message')])
  ];
  const metrics = computeCognitiveMetrics(messages);
  assert.equal(metrics.toolSuccessRate, 1);
  assert.equal(metrics.readWriteRatio, 1);
  assert.equal(metrics.errorRate, 0);
  assert.equal(metrics.consecutiveAssistantTurns, 0);
});

test('computeCognitiveMetrics: only assistant messages', () => {
  const messages = [
    makeMessage('assistant', [textPart('response 1')]),
    makeMessage('assistant', [textPart('response 2')]),
    makeMessage('assistant', [textPart('response 3')])
  ];
  const metrics = computeCognitiveMetrics(messages);
  assert.equal(metrics.consecutiveAssistantTurns, 3);
  assert.equal(metrics.toolSuccessRate, 1);
});

test('computeCognitiveMetrics: respects windowSize option', () => {
  const messages = [];
  // 10 error messages first
  for (let i = 0; i < 10; i++) {
    messages.push(makeMessage('assistant', [toolCallPart('run_tests', {})]));
    messages.push(makeMessage('tool', [toolResultPart('run_tests', 'Error: fail', false)]));
  }
  // Then 10 success messages
  for (let i = 0; i < 10; i++) {
    messages.push(makeMessage('assistant', [toolCallPart('read_file', {})]));
    messages.push(makeMessage('tool', [toolResultPart('read_file', 'ok', true)]));
  }
  // Window of 10 should only see the successes
  const metricsSmall = computeCognitiveMetrics(messages, { windowSize: 10 });
  assert.equal(metricsSmall.toolSuccessRate, 1);
  // Full window should see both
  const metricsFull = computeCognitiveMetrics(messages, { windowSize: 40 });
  assert.ok(metricsFull.toolSuccessRate < 1);
});

test('computeCognitiveMetrics: mixed read and write yields finite ratio', () => {
  const messages = [
    makeMessage('assistant', [toolCallPart('read_file', {})]),
    makeMessage('tool', [toolResultPart('read_file', 'data', true)]),
    makeMessage('assistant', [toolCallPart('write_file', {})]),
    makeMessage('tool', [toolResultPart('write_file', 'ok', true)])
  ];
  const metrics = computeCognitiveMetrics(messages);
  assert.ok(Number.isFinite(metrics.readWriteRatio));
  assert.equal(metrics.readWriteRatio, 1); // 1 read / 1 write
});

test('computeCognitiveMetrics: read-only yields Infinity readWriteRatio', () => {
  const messages = [
    makeMessage('assistant', [toolCallPart('read_file', {})]),
    makeMessage('tool', [toolResultPart('read_file', 'data', true)])
  ];
  const metrics = computeCognitiveMetrics(messages);
  assert.equal(metrics.readWriteRatio, Infinity);
});

// -- detectCognitivePhase boundaries --

test('detectCognitivePhase: identifies planning phase', () => {
  const messages = [
    makeMessage('user', [textPart('Plan the implementation')]),
    makeMessage('assistant', [toolCallPart('create_todo', { title: 'step 1' })]),
    makeMessage('tool', [toolResultPart('create_todo', 'created', true)]),
    makeMessage('assistant', [toolCallPart('plan', { steps: ['a', 'b'] })]),
    makeMessage('tool', [toolResultPart('plan', 'planned', true)])
  ];
  const metrics = computeCognitiveMetrics(messages);
  const state = detectCognitivePhase(messages, metrics);
  assert.equal(state.phase, 'planning');
});

test('detectCognitivePhase: identifies completion phase', () => {
  const messages = [
    makeMessage('user', [textPart('Wrap up')]),
    makeMessage('assistant', [toolCallPart('commit', { message: 'done' })]),
    makeMessage('tool', [toolResultPart('commit', 'committed', true)]),
    makeMessage('assistant', [toolCallPart('create_pr', { title: 'feat' })]),
    makeMessage('tool', [toolResultPart('create_pr', 'PR created', true)])
  ];
  const metrics = computeCognitiveMetrics(messages);
  const state = detectCognitivePhase(messages, metrics);
  assert.equal(state.phase, 'completion');
});

test('detectCognitivePhase: idle on empty messages', () => {
  const metrics = computeCognitiveMetrics([]);
  const state = detectCognitivePhase([], metrics);
  assert.equal(state.phase, 'idle');
  assert.equal(state.confidence, 1);
  assert.equal(state.contextStrategy, 'full');
});

test('detectCognitivePhase: debugging from high consecutive assistant turns + errors', () => {
  const messages = [];
  messages.push(makeMessage('user', [textPart('fix it')]));
  for (let i = 0; i < 8; i++) {
    messages.push(makeMessage('assistant', [toolCallPart('bash', { cmd: 'npm test' })]));
    messages.push(makeMessage('tool', [toolResultPart('bash', 'Error: test failed', false)]));
  }
  const metrics = computeCognitiveMetrics(messages);
  assert.ok(metrics.consecutiveAssistantTurns === 0); // tool messages break the streak
  assert.ok(metrics.errorRate > 0.2);
  const state = detectCognitivePhase(messages, metrics);
  assert.equal(state.phase, 'debugging');
});

test('detectCognitivePhase: exploration from high readWriteRatio', () => {
  const messages = [
    makeMessage('user', [textPart('explore the code')]),
    makeMessage('assistant', [toolCallPart('search', { q: 'auth' })]),
    makeMessage('tool', [toolResultPart('search', 'found 5 results', true)]),
    makeMessage('assistant', [toolCallPart('read_file', { path: 'a.ts' })]),
    makeMessage('tool', [toolResultPart('read_file', 'content a', true)]),
    makeMessage('assistant', [toolCallPart('read_file', { path: 'b.ts' })]),
    makeMessage('tool', [toolResultPart('read_file', 'content b', true)]),
    makeMessage('assistant', [toolCallPart('grep', { pattern: 'login' })]),
    makeMessage('tool', [toolResultPart('grep', 'match', true)])
  ];
  const metrics = computeCognitiveMetrics(messages);
  assert.ok(metrics.readWriteRatio > 3);
  const state = detectCognitivePhase(messages, metrics);
  assert.equal(state.phase, 'exploration');
});

test('detectCognitivePhase: confidence is between 0 and 1', () => {
  const messages = [
    makeMessage('user', [textPart('do something')]),
    makeMessage('assistant', [toolCallPart('read_file', {})]),
    makeMessage('tool', [toolResultPart('read_file', 'ok', true)])
  ];
  const metrics = computeCognitiveMetrics(messages);
  const state = detectCognitivePhase(messages, metrics);
  assert.ok(state.confidence >= 0 && state.confidence <= 1);
});

// -- getEpisodicSelectionParams for each strategy --

test('getEpisodicSelectionParams: full strategy defaults', () => {
  const params = getEpisodicSelectionParams({
    phase: 'idle',
    confidence: 0.5,
    metrics: { toolSuccessRate: 1, readWriteRatio: 1, messageComplexity: 0, errorRate: 0, timeSinceUserMs: 0, consecutiveAssistantTurns: 0 },
    contextStrategy: 'full',
    reason: 'idle'
  });
  assert.equal(params.includeInitialContext, true);
  assert.equal(params.prioritizeErrors, false);
  assert.equal(params.summaryWeight, 0.5);
});

test('getEpisodicSelectionParams: error-focused strategy prioritizes errors', () => {
  const params = getEpisodicSelectionParams({
    phase: 'debugging',
    confidence: 0.9,
    metrics: { toolSuccessRate: 0.3, readWriteRatio: 1, messageComplexity: 5, errorRate: 0.5, timeSinceUserMs: 0, consecutiveAssistantTurns: 0 },
    contextStrategy: 'error-focused',
    reason: 'errors'
  });
  assert.equal(params.prioritizeErrors, true);
  assert.equal(params.minRecentMessages, 16);
  assert.equal(params.includeInitialContext, false);
  assert.equal(params.summaryWeight, 0.3);
});

test('getEpisodicSelectionParams: recent strategy', () => {
  const params = getEpisodicSelectionParams({
    phase: 'implementation',
    confidence: 0.8,
    metrics: { toolSuccessRate: 0.9, readWriteRatio: 0.5, messageComplexity: 3, errorRate: 0, timeSinceUserMs: 0, consecutiveAssistantTurns: 0 },
    contextStrategy: 'recent',
    reason: 'impl'
  });
  assert.equal(params.minRecentMessages, 12);
  assert.equal(params.includeInitialContext, true);
  assert.equal(params.prioritizeErrors, false);
  assert.equal(params.summaryWeight, 0.5);
});

test('getEpisodicSelectionParams: summary-weighted strategy', () => {
  const params = getEpisodicSelectionParams({
    phase: 'exploration',
    confidence: 0.7,
    metrics: { toolSuccessRate: 1, readWriteRatio: 5, messageComplexity: 2, errorRate: 0, timeSinceUserMs: 0, consecutiveAssistantTurns: 0 },
    contextStrategy: 'summary-weighted',
    reason: 'exploring'
  });
  assert.equal(params.minRecentMessages, 8);
  assert.equal(params.summaryWeight, 0.7);
  assert.equal(params.includeInitialContext, true);
});

// -- formatCognitiveStateForPrompt edge cases --

test('formatCognitiveStateForPrompt: exploration phase', () => {
  const formatted = formatCognitiveStateForPrompt({
    phase: 'exploration',
    confidence: 0.6,
    metrics: { toolSuccessRate: 1, readWriteRatio: 5, messageComplexity: 2, errorRate: 0, timeSinceUserMs: 0, consecutiveAssistantTurns: 0 },
    contextStrategy: 'summary-weighted',
    reason: 'test'
  });
  assert.ok(formatted.includes('exploration'));
  assert.ok(formatted.includes('60%'));
  assert.ok(formatted.includes('Gathering information'));
});

test('formatCognitiveStateForPrompt: implementation phase', () => {
  const formatted = formatCognitiveStateForPrompt({
    phase: 'implementation',
    confidence: 0.9,
    metrics: { toolSuccessRate: 0.95, readWriteRatio: 0.5, messageComplexity: 4, errorRate: 0.05, timeSinceUserMs: 0, consecutiveAssistantTurns: 1 },
    contextStrategy: 'recent',
    reason: 'test'
  });
  assert.ok(formatted.includes('implementation'));
  assert.ok(formatted.includes('90%'));
  assert.ok(formatted.includes('Making changes'));
});

test('formatCognitiveStateForPrompt: idle phase', () => {
  const formatted = formatCognitiveStateForPrompt({
    phase: 'idle',
    confidence: 1,
    metrics: { toolSuccessRate: 1, readWriteRatio: 1, messageComplexity: 0, errorRate: 0, timeSinceUserMs: 0, consecutiveAssistantTurns: 0 },
    contextStrategy: 'full',
    reason: 'no messages'
  });
  assert.ok(formatted.includes('idle'));
  assert.ok(formatted.includes('Waiting for direction'));
});

test('formatCognitiveStateForPrompt: no error warning when errorRate <= 0.1', () => {
  const formatted = formatCognitiveStateForPrompt({
    phase: 'implementation',
    confidence: 0.8,
    metrics: { toolSuccessRate: 0.95, readWriteRatio: 1, messageComplexity: 3, errorRate: 0.05, timeSinceUserMs: 0, consecutiveAssistantTurns: 1 },
    contextStrategy: 'recent',
    reason: 'test'
  });
  assert.ok(!formatted.includes('⚠️'));
});

test('formatCognitiveStateForPrompt: shows consecutive assistant turns warning', () => {
  const formatted = formatCognitiveStateForPrompt({
    phase: 'debugging',
    confidence: 0.7,
    metrics: { toolSuccessRate: 0.5, readWriteRatio: 1, messageComplexity: 5, errorRate: 0.2, timeSinceUserMs: 0, consecutiveAssistantTurns: 6 },
    contextStrategy: 'error-focused',
    reason: 'test'
  });
  assert.ok(formatted.includes('6 consecutive assistant turns'));
  assert.ok(formatted.includes('⚠️')); // error rate > 0.1
});

test('formatCognitiveStateForPrompt: completion phase', () => {
  const formatted = formatCognitiveStateForPrompt({
    phase: 'completion',
    confidence: 0.95,
    metrics: { toolSuccessRate: 1, readWriteRatio: 1, messageComplexity: 2, errorRate: 0, timeSinceUserMs: 0, consecutiveAssistantTurns: 0 },
    contextStrategy: 'recent',
    reason: 'test'
  });
  assert.ok(formatted.includes('completion'));
  assert.ok(formatted.includes('Finalizing'));
});

test('formatCognitiveStateForPrompt: planning phase', () => {
  const formatted = formatCognitiveStateForPrompt({
    phase: 'planning',
    confidence: 0.75,
    metrics: { toolSuccessRate: 1, readWriteRatio: 1, messageComplexity: 3, errorRate: 0, timeSinceUserMs: 0, consecutiveAssistantTurns: 0 },
    contextStrategy: 'summary-weighted',
    reason: 'test'
  });
  assert.ok(formatted.includes('planning'));
  assert.ok(formatted.includes('75%'));
  assert.ok(formatted.includes('Breaking down tasks'));
});

// -- computeCognitiveState realistic sessions --

test('computeCognitiveState: debugging session with failed tests', () => {
  const session = {
    id: 's_debug',
    title: 'Fix failing tests',
    mode: 'chat',
    status: 'running',
    agentId: 'a1',
    todo: [],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const messages = [
    makeMessage('user', [textPart('Fix the test failures')]),
    makeMessage('assistant', [toolCallPart('run_tests', {})]),
    makeMessage('tool', [toolResultPart('run_tests', 'Error: 5 tests failed', false)]),
    makeMessage('assistant', [toolCallPart('read_file', { path: 'test.js' })]),
    makeMessage('tool', [toolResultPart('read_file', 'test content', true)]),
    makeMessage('assistant', [toolCallPart('edit_file', { path: 'test.js' })]),
    makeMessage('tool', [toolResultPart('edit_file', 'updated', true)]),
    makeMessage('assistant', [toolCallPart('run_tests', {})]),
    makeMessage('tool', [toolResultPart('run_tests', 'Error: 2 tests still failing', false)])
  ];
  const state = computeCognitiveState(session, messages);
  assert.equal(state.phase, 'debugging');
  assert.ok(state.metrics.errorRate > 0);
});

test('computeCognitiveState: exploration session reading many files', () => {
  const session = {
    id: 's_explore',
    title: 'Understand codebase',
    mode: 'chat',
    status: 'running',
    agentId: 'a1',
    todo: [],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const messages = [
    makeMessage('user', [textPart('How does auth work?')]),
    makeMessage('assistant', [toolCallPart('glob', { pattern: '**/*.ts' })]),
    makeMessage('tool', [toolResultPart('glob', 'found 20 files', true)]),
    makeMessage('assistant', [toolCallPart('read_file', { path: 'auth.ts' })]),
    makeMessage('tool', [toolResultPart('read_file', 'auth code', true)]),
    makeMessage('assistant', [toolCallPart('read_file', { path: 'middleware.ts' })]),
    makeMessage('tool', [toolResultPart('read_file', 'middleware code', true)]),
    makeMessage('assistant', [toolCallPart('search', { q: 'jwt' })]),
    makeMessage('tool', [toolResultPart('search', 'found jwt usage', true)])
  ];
  const state = computeCognitiveState(session, messages);
  assert.equal(state.phase, 'exploration');
  assert.ok(state.contextStrategy === 'summary-weighted');
});
