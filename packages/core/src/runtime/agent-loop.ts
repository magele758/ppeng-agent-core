/**
 * Explicit step-level control for the self-built agent loop.
 *
 * One kernel: daemon `runSession` and SDK `step()` / async iteration share
 * the same packing + model + tools path. Steer only affects the next shot.
 */

import type { MessagePart, SessionMessage, SessionRecord } from '../types.js';
import type { EnqueueSteerOptions } from '../session/step-inbox.js';

export type AgentStepEvent =
  | { type: 'turn_prepared'; messages: SessionMessage[]; foldSeqs: number[] }
  | {
      type: 'model_done';
      stopReason: string;
      finishReason?: string;
      truncated?: boolean;
      assistant?: { parts: MessagePart[] };
    }
  | { type: 'tools_done'; results: Array<{ ok: boolean; content: string; name?: string }> }
  | { type: 'waiting_approval'; approvalIds?: string[] }
  | { type: 'compacted'; replaced: { startSeq: number; endSeq: number } }
  | { type: 'ended'; reason: string };

export interface AgentLoopHost {
  getSession(sessionId: string): SessionRecord | undefined;
  foldMessages(sessionId: string): SessionMessage[];
  enqueueSteer(sessionId: string, text: string, opts?: EnqueueSteerOptions): void;
  abortSession(sessionId: string): void;
  startRun(
    sessionId: string,
    latch: AgentLoopLatch,
    options?: { onModelStreamChunk?: (chunk: unknown) => void }
  ): Promise<SessionRecord>;
}

export class AgentLoopLatch {
  mode: 'run' | 'step';
  private queue: AgentStepEvent[] = [];
  private eventWaiters: Array<(ev: AgentStepEvent) => void> = [];
  private resumeResolver: (() => void) | null = null;
  closed = false;

  private terminalEmitted = false;

  constructor(mode: 'run' | 'step') {
    this.mode = mode;
  }

  waitForEvent(): Promise<AgentStepEvent> {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift()!);
    }
    return new Promise((resolve) => {
      this.eventWaiters.push(resolve);
    });
  }

  resume(): void {
    const r = this.resumeResolver;
    this.resumeResolver = null;
    r?.();
  }

  close(): void {
    this.closed = true;
    this.resume();
    if (this.terminalEmitted) return;
    const end: AgentStepEvent = { type: 'ended', reason: 'closed' };
    this.terminalEmitted = true;
    while (this.eventWaiters.length > 0) {
      this.eventWaiters.shift()!(end);
    }
    if (this.queue.length === 0) this.queue.push(end);
  }

  async emit(ev: AgentStepEvent): Promise<void> {
    if (ev.type === 'ended' || ev.type === 'waiting_approval') {
      this.terminalEmitted = true;
    }
    if (this.eventWaiters.length > 0) {
      const w = this.eventWaiters.shift()!;
      w(ev);
    } else {
      this.queue.push(ev);
    }
    const pause =
      this.mode === 'step' &&
      ev.type !== 'ended' &&
      ev.type !== 'waiting_approval' &&
      !this.closed;
    if (pause) {
      await new Promise<void>((resolve) => {
        this.resumeResolver = resolve;
      });
    }
  }
}

export class AgentLoopHandle implements AsyncIterable<AgentStepEvent> {
  private latch: AgentLoopLatch | null = null;
  private runPromise: Promise<SessionRecord> | null = null;

  constructor(
    private readonly host: AgentLoopHost,
    readonly sessionId: string
  ) {}

  /**
   * Run one phase: prepareTurnInput → model → (optional) tools, then return
   * control. Finer events (turn_prepared, model_done, …) are yielded one at a
   * time so callers can stop at model_done.
   */
  async step(): Promise<AgentStepEvent> {
    this.ensureStarted('step');
    const latch = this.latch!;
    const eventPromise = latch.waitForEvent();
    latch.resume();
    return eventPromise;
  }

  /** Run continuously until end / waiting_approval / abort. */
  async run(): Promise<SessionRecord> {
    if (this.latch?.mode === 'step' && this.runPromise) {
      this.latch.mode = 'run';
      this.latch.resume();
      return this.runPromise;
    }
    this.ensureStarted('run');
    return this.runPromise!;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AgentStepEvent> {
    this.ensureStarted(this.latch?.mode ?? 'step');
    const latch = this.latch!;
    while (!latch.closed) {
      const eventPromise = latch.waitForEvent();
      latch.resume();
      const ev = await eventPromise;
      yield ev;
      if (ev.type === 'ended' || ev.type === 'waiting_approval') return;
    }
  }

  async steer(text: string, opts?: EnqueueSteerOptions): Promise<void> {
    this.host.enqueueSteer(this.sessionId, text, opts);
  }

  async abort(): Promise<void> {
    this.host.abortSession(this.sessionId);
    this.latch?.close();
  }

  async fold(): Promise<SessionMessage[]> {
    return this.host.foldMessages(this.sessionId);
  }

  private ensureStarted(mode: 'run' | 'step'): void {
    if (this.latch && this.runPromise) return;
    this.latch = new AgentLoopLatch(mode);
    this.runPromise = this.host.startRun(this.sessionId, this.latch).finally(() => {
      this.latch?.close();
    });
    void this.runPromise.catch(() => {
      /* surfaced via step()/run() */
    });
  }
}

export function createAgentLoop(host: AgentLoopHost, sessionId: string): AgentLoopHandle {
  return new AgentLoopHandle(host, sessionId);
}
