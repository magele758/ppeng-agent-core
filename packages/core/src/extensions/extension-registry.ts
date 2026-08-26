/**
 * In-process extension registry (pi-inspired phase model).
 * Complements env-script lifecycle hooks: handlers are composable JS functions
 * registered at Runtime construction (or via plugins later).
 */

export type ExtensionPhase =
  | 'session_start'
  | 'before_turn'
  | 'after_tool'
  | 'on_compact'
  | 'stop';

export interface ExtensionContext {
  phase: ExtensionPhase;
  sessionId: string;
  agentId?: string;
  tool?: string;
  input?: unknown;
  ok?: boolean;
  content?: string;
  /** Free-form bag (turn index, compact reason, …) */
  meta?: Record<string, unknown>;
}

export interface ExtensionResult {
  /** Block the current action (before_turn / after_tool pre-equivalent) */
  block?: boolean;
  message?: string;
  systemMessage?: string;
  /** Mutate tool input when phase is after_tool is N/A; for before_turn unused */
  input?: unknown;
}

export type ExtensionHandlerFn = (
  ctx: ExtensionContext
) => void | ExtensionResult | Promise<void | ExtensionResult>;

export interface ExtensionSpec {
  id: string;
  /** Optional human label */
  name?: string;
  handlers: Partial<Record<ExtensionPhase, ExtensionHandlerFn>>;
}

export class ExtensionRegistry {
  private readonly extensions: ExtensionSpec[] = [];

  register(ext: ExtensionSpec): void {
    const i = this.extensions.findIndex((e) => e.id === ext.id);
    if (i >= 0) this.extensions[i] = ext;
    else this.extensions.push(ext);
  }

  list(): Array<{ id: string; name?: string; phases: ExtensionPhase[] }> {
    return this.extensions.map((e) => ({
      id: e.id,
      name: e.name,
      phases: Object.keys(e.handlers) as ExtensionPhase[]
    }));
  }

  /**
   * Run all handlers for a phase in registration order.
   * First `block: true` wins; systemMessages are concatenated.
   */
  async run(phase: ExtensionPhase, ctx: Omit<ExtensionContext, 'phase'>): Promise<ExtensionResult> {
    const full: ExtensionContext = { ...ctx, phase };
    const out: ExtensionResult = {};
    const messages: string[] = [];
    for (const ext of this.extensions) {
      const fn = ext.handlers[phase];
      if (!fn) continue;
      try {
        const r = await fn(full);
        if (!r) continue;
        if (r.block) {
          return {
            block: true,
            message: r.message ?? `blocked by extension ${ext.id}`,
            systemMessage: [r.systemMessage, ...messages].filter(Boolean).join('\n') || undefined,
            input: r.input
          };
        }
        if (r.systemMessage) messages.push(r.systemMessage);
        if (r.message && !out.message) out.message = r.message;
        if (r.input !== undefined) out.input = r.input;
      } catch (e) {
        messages.push(`[extension:${ext.id}] ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (messages.length) out.systemMessage = messages.join('\n');
    return out;
  }
}

export function createExtensionRegistry(initial?: ExtensionSpec[]): ExtensionRegistry {
  const reg = new ExtensionRegistry();
  for (const e of initial ?? []) reg.register(e);
  return reg;
}
