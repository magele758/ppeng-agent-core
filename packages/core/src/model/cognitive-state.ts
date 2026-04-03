/**
 * Cognitive state modeling for session context adaptation.
 *
 * Inspired by the GCSD paper (arXiv:2603.10034) on dynamic participant cognitive
 * state modeling for personalized interaction. This module tracks the "cognitive
 * phase" of an agent session and provides signals to adapt context selection.
 *
 * Key concepts:
 * - Sessions progress through phases: exploration → planning → implementation → debugging → completion
 * - Different phases benefit from different context selection strategies
 * - Engagement signals (tool success rate, message complexity) indicate cognitive load
 */

import type { SessionMessage, SessionRecord } from '../types.js';

/** Cognitive phases detected in agent sessions. */
export type CognitivePhase =
  | 'exploration'  // Initial context gathering, reading files, understanding codebase
  | 'planning'     // Breaking down tasks, creating todos, designing approach
  | 'implementation' // Writing code, editing files, making changes
  | 'debugging'    // Fixing errors, running tests, iterating on failures
  | 'completion'   // Finalizing, committing, creating PRs, summarizing
  | 'idle';        // No clear activity pattern

/** Metrics that inform cognitive state detection. */
export interface CognitiveMetrics {
  /** Ratio of successful tool calls in recent messages. */
  toolSuccessRate: number;
  /** Ratio of read operations vs write operations. */
  readWriteRatio: number;
  /** Average message complexity (length, part count). */
  messageComplexity: number;
  /** Rate of error patterns in recent tool results. */
  errorRate: number;
  /** Time since last user message (ms). */
  timeSinceUserMs: number;
  /** Number of consecutive assistant turns without user input. */
  consecutiveAssistantTurns: number;
}

/** Detected cognitive state for a session. */
export interface CognitiveState {
  phase: CognitivePhase;
  confidence: number;
  metrics: CognitiveMetrics;
  /** Suggested context selection strategy for this phase. */
  contextStrategy: 'full' | 'recent' | 'error-focused' | 'summary-weighted';
  /** Reason for phase detection. */
  reason: string;
}

/** Tools that indicate specific phases. */
const PHASE_INDICATOR_TOOLS = {
  exploration: new Set(['read_file', 'glob', 'grep', 'list_directory', 'search', 'web_fetch']),
  planning: new Set(['create_task', 'update_task', 'create_todo', 'plan']),
  implementation: new Set(['write_file', 'edit_file', 'create_file', 'mkdir', 'apply_patch']),
  debugging: new Set(['run_tests', 'run_command', 'bash', 'execute', 'fix', 'retry']),
  completion: new Set(['commit', 'create_pr', 'push', 'summarize', 'mark_complete'])
};

/** Error patterns that indicate debugging phase. */
const ERROR_PATTERNS = [
  /error/i,
  /failed/i,
  /exception/i,
  /cannot/i,
  /unable to/i,
  /not found/i,
  /invalid/i,
  /timeout/i
];

/**
 * Analyzes recent messages to extract cognitive metrics.
 */
export function computeCognitiveMetrics(
  messages: SessionMessage[],
  options?: { windowSize?: number }
): CognitiveMetrics {
  const window = options?.windowSize ?? 20;
  const recent = messages.slice(-window);

  if (recent.length === 0) {
    return {
      toolSuccessRate: 1,
      readWriteRatio: 1,
      messageComplexity: 0,
      errorRate: 0,
      timeSinceUserMs: 0,
      consecutiveAssistantTurns: 0
    };
  }

  let toolCalls = 0;
  let successfulTools = 0;
  let readOps = 0;
  let writeOps = 0;
  let errorCount = 0;
  let totalParts = 0;
  let totalChars = 0;
  let lastUserTime = 0;
  let consecutiveAssistant = 0;

  // Count consecutive assistant turns from the end
  for (let i = recent.length - 1; i >= 0; i--) {
    const msg = recent[i];
    if (msg?.role === 'assistant') {
      consecutiveAssistant++;
    } else {
      break;
    }
  }

  for (const msg of recent) {
    if (!msg) continue;

    totalParts += msg.parts.length;

    if (msg.role === 'user') {
      lastUserTime = Date.parse(msg.createdAt);
      for (const part of msg.parts) {
        if (part.type === 'text' && part.text) {
          totalChars += part.text.length;
        }
      }
    }

    if (msg.role === 'assistant') {
      for (const part of msg.parts) {
        if (part.type === 'text' && part.text) {
          totalChars += part.text.length;
        }
        if (part.type === 'tool_call') {
          toolCalls++;
          const name = part.name.toLowerCase();

          // Classify tool usage
          if (PHASE_INDICATOR_TOOLS.exploration.has(name) || name.includes('read') || name.includes('search') || name.includes('find')) {
            readOps++;
          }
          if (PHASE_INDICATOR_TOOLS.implementation.has(name) || name.includes('write') || name.includes('edit') || name.includes('create')) {
            writeOps++;
          }
        }
      }
    }

    if (msg.role === 'tool') {
      for (const part of msg.parts) {
        if (part.type === 'tool_result') {
          if (part.ok) {
            successfulTools++;
          } else {
            errorCount++;
          }
          // Check for error patterns in content
          if (part.content) {
            for (const pattern of ERROR_PATTERNS) {
              if (pattern.test(part.content)) {
                errorCount++;
                break;
              }
            }
          }
        }
      }
    }
  }

  const now = Date.now();
  const timeSinceUser = lastUserTime > 0 ? now - lastUserTime : 0;

  return {
    toolSuccessRate: toolCalls > 0 ? successfulTools / toolCalls : 1,
    readWriteRatio: writeOps > 0 ? readOps / writeOps : readOps > 0 ? Infinity : 1,
    messageComplexity: recent.length > 0 ? (totalParts + totalChars / 100) / recent.length : 0,
    errorRate: recent.length > 0 ? errorCount / recent.length : 0,
    timeSinceUserMs: timeSinceUser,
    consecutiveAssistantTurns: consecutiveAssistant
  };
}

/**
 * Detects the cognitive phase based on metrics and message patterns.
 */
export function detectCognitivePhase(
  messages: SessionMessage[],
  metrics: CognitiveMetrics
): CognitiveState {
  if (messages.length === 0) {
    return {
      phase: 'idle',
      confidence: 1,
      metrics,
      contextStrategy: 'full',
      reason: 'No messages in session'
    };
  }

  const recent = messages.slice(-20);

  // Count phase-indicative tool calls
  const phaseScores: Record<CognitivePhase, number> = {
    exploration: 0,
    planning: 0,
    implementation: 0,
    debugging: 0,
    completion: 0,
    idle: 0
  };

  // Analyze tool patterns
  for (const msg of recent) {
    if (msg?.role === 'assistant') {
      for (const part of msg.parts) {
        if (part.type === 'tool_call') {
          const name = part.name.toLowerCase();

          for (const [phase, tools] of Object.entries(PHASE_INDICATOR_TOOLS)) {
            if (tools.has(name)) {
              phaseScores[phase as CognitivePhase] += 1;
            }
            // Partial match for tool names containing phase keywords
            if (name.includes(phase.slice(0, 4))) {
              phaseScores[phase as CognitivePhase] += 0.5;
            }
          }
        }
      }
    }
  }

  // Apply metric-based adjustments
  // High error rate strongly indicates debugging
  if (metrics.errorRate > 0.2) {
    phaseScores.debugging += metrics.errorRate * 10;
  }

  // Low tool success rate indicates debugging
  if (metrics.toolSuccessRate < 0.7) {
    phaseScores.debugging += (1 - metrics.toolSuccessRate) * 5;
  }

  // High read/write ratio indicates exploration
  if (metrics.readWriteRatio > 3) {
    phaseScores.exploration += metrics.readWriteRatio;
  }

  // Low read/write ratio indicates implementation
  if (metrics.readWriteRatio < 0.5 && metrics.readWriteRatio > 0) {
    phaseScores.implementation += 2;
  }

  // Many consecutive assistant turns without user might indicate debugging or implementation
  if (metrics.consecutiveAssistantTurns > 5) {
    phaseScores.debugging += 2;
    phaseScores.implementation += 1;
  }

  // Find the highest scoring phase
  let maxPhase: CognitivePhase = 'exploration';
  let maxScore = 0;

  for (const [phase, score] of Object.entries(phaseScores)) {
    if (score > maxScore) {
      maxScore = score;
      maxPhase = phase as CognitivePhase;
    }
  }

  // Calculate confidence based on score dominance
  const totalScore = Object.values(phaseScores).reduce((a, b) => a + b, 0);
  const confidence = totalScore > 0 ? maxScore / totalScore : 0.5;

  // Determine context strategy based on phase
  const contextStrategy = getContextStrategyForPhase(maxPhase, metrics);

  // Build reason string
  const reasons: string[] = [];
  if (phaseScores.debugging > 0) reasons.push(`debugging score: ${phaseScores.debugging.toFixed(1)}`);
  if (phaseScores.exploration > 0) reasons.push(`exploration score: ${phaseScores.exploration.toFixed(1)}`);
  if (phaseScores.implementation > 0) reasons.push(`implementation score: ${phaseScores.implementation.toFixed(1)}`);
  if (metrics.errorRate > 0.1) reasons.push(`error rate: ${(metrics.errorRate * 100).toFixed(0)}%`);

  return {
    phase: maxScore > 0 ? maxPhase : 'exploration',
    confidence,
    metrics,
    contextStrategy,
    reason: reasons.length > 0 ? reasons.join('; ') : 'default to exploration'
  };
}

/**
 * Determines the optimal context selection strategy for a phase.
 */
function getContextStrategyForPhase(
  phase: CognitivePhase,
  metrics: CognitiveMetrics
): CognitiveState['contextStrategy'] {
  switch (phase) {
    case 'exploration':
      // Exploration benefits from broader context including earlier messages
      return 'summary-weighted';

    case 'planning':
      // Planning needs balanced context - summaries plus recent state
      return 'summary-weighted';

    case 'implementation':
      // Implementation focuses on recent context - what's being worked on
      return 'recent';

    case 'debugging':
      // Debugging needs error context and recent tool interactions
      return 'error-focused';

    case 'completion':
      // Completion needs recent context plus any summaries
      return 'recent';

    case 'idle':
    default:
      return 'full';
  }
}

/**
 * Adjusts episodic selection parameters based on cognitive state.
 */
export function getEpisodicSelectionParams(
  state: CognitiveState
): {
  minRecentMessages: number;
  includeInitialContext: boolean;
  prioritizeErrors: boolean;
  summaryWeight: number;
} {
  switch (state.contextStrategy) {
    case 'error-focused':
      // When debugging, prioritize recent messages and error context
      return {
        minRecentMessages: 16,
        includeInitialContext: false,
        prioritizeErrors: true,
        summaryWeight: 0.3
      };

    case 'recent':
      // Focus on recent activity
      return {
        minRecentMessages: 12,
        includeInitialContext: true,
        prioritizeErrors: false,
        summaryWeight: 0.5
      };

    case 'summary-weighted':
      // Include more historical context via summaries
      return {
        minRecentMessages: 8,
        includeInitialContext: true,
        prioritizeErrors: false,
        summaryWeight: 0.7
      };

    case 'full':
    default:
      return {
        minRecentMessages: 8,
        includeInitialContext: true,
        prioritizeErrors: false,
        summaryWeight: 0.5
      };
  }
}

/**
 * Main entry point: computes cognitive state for a session.
 */
export function computeCognitiveState(
  session: SessionRecord,
  messages: SessionMessage[]
): CognitiveState {
  const metrics = computeCognitiveMetrics(messages);
  return detectCognitivePhase(messages, metrics);
}

/**
 * Formats cognitive state for inclusion in system prompt.
 */
export function formatCognitiveStateForPrompt(state: CognitiveState): string {
  const phaseDescriptions: Record<CognitivePhase, string> = {
    exploration: 'Gathering information and understanding context',
    planning: 'Breaking down tasks and planning approach',
    implementation: 'Making changes and writing code',
    debugging: 'Fixing errors and resolving issues',
    completion: 'Finalizing and wrapping up',
    idle: 'Waiting for direction'
  };

  const strategyDescriptions: Record<CognitiveState['contextStrategy'], string> = {
    full: 'full context available',
    recent: 'focused on recent activity',
    'error-focused': 'prioritizing error context and recent tool interactions',
    'summary-weighted': 'including historical summaries for context'
  };

  const lines = [
    `Session phase: ${state.phase} (${(state.confidence * 100).toFixed(0)}% confidence)`,
    `Phase description: ${phaseDescriptions[state.phase]}`,
    `Context strategy: ${strategyDescriptions[state.contextStrategy]}`
  ];

  if (state.metrics.errorRate > 0.1) {
    lines.push(`⚠️ Recent error rate: ${(state.metrics.errorRate * 100).toFixed(0)}%`);
  }

  if (state.metrics.consecutiveAssistantTurns > 3) {
    lines.push(`ℹ️ ${state.metrics.consecutiveAssistantTurns} consecutive assistant turns`);
  }

  return lines.join('\n');
}
