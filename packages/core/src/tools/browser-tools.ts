import { envBool } from '../env.js';
import type { ToolContract, RunContext, ToolExecutionResult } from '../types.js';

/**
 * Optional browser tools (Playwright via npx). Gated by optional tool group `browser`
 * and env RAW_AGENT_BROWSER_TOOLS=1. Default off — keeps core schema narrow.
 */

export interface BrowserToolServices {
  /** Run a browser action; implementations may use Playwright CLI or MCP. */
  runBrowserAction: (
    context: RunContext,
    action: BrowserAction
  ) => Promise<ToolExecutionResult>;
}

export type BrowserAction =
  | { kind: 'navigate'; url: string }
  | { kind: 'snapshot' }
  | { kind: 'click'; selector: string }
  | { kind: 'type'; selector: string; text: string };

export function browserToolsFeatureEnabled(env: NodeJS.ProcessEnv): boolean {
  return envBool(env, 'RAW_AGENT_BROWSER_TOOLS', false);
}

export function createBrowserTools(services: BrowserToolServices): ToolContract<any>[] {
  const navigate: ToolContract<{ url: string }> = {
    name: 'browser_navigate',
    description:
      'Navigate the optional browser session to a URL (requires browser optional tool group + RAW_AGENT_BROWSER_TOOLS).',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url']
    },
    approvalMode: 'auto',
    sideEffectLevel: 'system',
    needsApproval: () => true,
    async execute(context, args) {
      return services.runBrowserAction(context, { kind: 'navigate', url: args.url });
    }
  };

  const snapshot: ToolContract<Record<string, never>> = {
    name: 'browser_snapshot',
    description: 'Capture accessibility/text snapshot of the current browser page.',
    inputSchema: { type: 'object', properties: {} },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context) {
      return services.runBrowserAction(context, { kind: 'snapshot' });
    }
  };

  const click: ToolContract<{ selector: string }> = {
    name: 'browser_click',
    description: 'Click an element by CSS selector in the browser session.',
    inputSchema: {
      type: 'object',
      properties: { selector: { type: 'string' } },
      required: ['selector']
    },
    approvalMode: 'auto',
    sideEffectLevel: 'system',
    needsApproval: () => true,
    async execute(context, args) {
      return services.runBrowserAction(context, { kind: 'click', selector: args.selector });
    }
  };

  const typeTool: ToolContract<{ selector: string; text: string }> = {
    name: 'browser_type',
    description: 'Type text into an element by CSS selector.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        text: { type: 'string' }
      },
      required: ['selector', 'text']
    },
    approvalMode: 'auto',
    sideEffectLevel: 'system',
    needsApproval: () => true,
    async execute(context, args) {
      return services.runBrowserAction(context, {
        kind: 'type',
        selector: args.selector,
        text: args.text
      });
    }
  };

  return [navigate, snapshot, click, typeTool];
}

/** Default stub executor used when Playwright is not installed. */
export async function defaultBrowserAction(
  _context: RunContext,
  action: BrowserAction
): Promise<ToolExecutionResult> {
  return {
    ok: false,
    content: JSON.stringify(
      {
        error: 'browser_backend_unavailable',
        message:
          'Browser tools are enabled but no Playwright backend is configured. Install playwright and set RAW_AGENT_BROWSER_BACKEND=playwright, or connect an MCP browser server.',
        action
      },
      null,
      2
    )
  };
}
