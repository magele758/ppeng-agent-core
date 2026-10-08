/**
 * Model adapters are implemented once, in `@ppeng/agent-loop` (covered by its
 * upstream replay fixtures). Core keeps its historical export names and binds
 * the adapters it constructs to `process.env` for LLM prompt-debug logging.
 */

import {
  AnthropicMessagesAdapter,
  OpenAICompatibleAdapter as LoopOpenAICompatibleAdapter,
  type AnthropicMessagesAdapterOptions,
  type OpenAICompatibleAdapterOptions
} from '@ppeng/agent-loop/model';

export {
  HEURISTIC_LONG_BASH_COMMAND,
  HEURISTIC_LONG_BASH_MARKER,
  HeuristicModelAdapter,
  HybridModelRouterAdapter,
  createModelAdapterFromEnv,
  normalizeOpenAiHttpKind,
  runOpenAiVisionTurn,
  textSummaryFromParts
} from '@ppeng/agent-loop/model';
export type { OpenAiHttpKind } from '@ppeng/agent-loop/model';

export class OpenAICompatibleAdapter extends LoopOpenAICompatibleAdapter {
  constructor(options: OpenAICompatibleAdapterOptions) {
    super({ ...options, env: options.env ?? process.env });
  }
}

export class AnthropicCompatibleAdapter extends AnthropicMessagesAdapter {
  constructor(options: AnthropicMessagesAdapterOptions) {
    super({ ...options, env: options.env ?? process.env });
  }
}
