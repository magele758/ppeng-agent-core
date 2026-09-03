import type { PtcAgentSpec } from './types.js';

class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly cap: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.cap) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active = Math.max(0, this.active - 1);
  }
}

export interface PtcAgentHookOptions {
  concurrencyCap?: number;
  maxCalls?: number;
  signal?: AbortSignal;
  spawn: (spec: PtcAgentSpec) => Promise<string>;
}

function parseAgentSpec(raw: unknown): PtcAgentSpec {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('agent() expects { task, angle?, agent?, role?, title? }');
  }
  const source = raw as Record<string, unknown>;
  const task = typeof source.task === 'string' ? source.task.trim() : '';
  if (!task) throw new Error('agent() requires a non-empty task');
  const allowedTools = Array.isArray(source.allowed_tools)
    ? source.allowed_tools.map(String).map((s) => s.trim()).filter(Boolean)
    : undefined;
  return {
    task,
    angle: typeof source.angle === 'string' ? source.angle.trim() : undefined,
    agent: typeof source.agent === 'string' ? source.agent.trim() : undefined,
    role: typeof source.role === 'string' ? source.role.trim() : undefined,
    title: typeof source.title === 'string' ? source.title.trim() : undefined,
    allowed_tools: allowedTools,
    model: typeof source.model === 'string' ? source.model.trim() : undefined
  };
}

/** Agent failures are isolated so one rejected Promise.all branch does not cancel siblings. */
export function createPtcAgentHook(options: PtcAgentHookOptions): (raw: unknown) => Promise<unknown> {
  const semaphore = new Semaphore(Math.max(1, Math.floor(options.concurrencyCap ?? 16)));
  const maxCalls = Math.max(1, Math.floor(options.maxCalls ?? 64));
  let calls = 0;

  return async (raw: unknown) => {
    const spec = parseAgentSpec(raw);
    calls += 1;
    if (calls > maxCalls) {
      return { ok: false as const, error: `PTC agent() call budget exceeded (${maxCalls})` };
    }
    if (options.signal?.aborted) return { ok: false as const, error: 'PTC cell aborted' };

    await semaphore.acquire();
    try {
      if (options.signal?.aborted) return { ok: false as const, error: 'PTC cell aborted' };
      const content = await options.spawn(spec);
      return {
        ok: true as const,
        content,
        angle: spec.angle,
        agent: spec.agent ?? spec.role
      };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
        angle: spec.angle,
        agent: spec.agent ?? spec.role
      };
    } finally {
      semaphore.release();
    }
  };
}
