/**
 * Explicit step-level control for the self-built agent loop.
 *
 * One kernel: daemon `runSession` and SDK `step()` / async iteration share
 * the same packing + model + tools path. Steer only affects the next shot
 * unless the host opts into tool-launch drain.
 */

import type { MessagePart, SessionMessage, SessionRecord } from '../types.js';
import type { EnqueueSteerOptions } from '../session/step-inbox.js';
import type { SteerAck } from '../session/steer-ack.js';
import type { RunOutcome } from '../session/run-outcome.js';
import type { RunInterruptState } from '../session/interrupt.js';
import type { SteerDrainPolicy } from '../session/steer-drain.js';

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
  | { type: 'waiting_approval'; approvalIds?: string[]; interrupt?: RunInterruptState }
  | { type: 'compacted'; replaced: { startSeq: number; endSeq: number } }
  | { type: 'ended'; reason: string; outcome?: RunOutcome }
  | { type: 'abort' };

function isLatchTerminal(ev: AgentStepEvent): boolean {
  switch (ev.type) {
    case 'ended':
    case 'waiting_approval':
    case 'abort':
      return true;
    case 'turn_prepared':
    case 'model_done':
    case 'tools_done':
    case 'compacted':
      return false;
    default: {
      const _never: never = ev;
      return _never;
    }
  }
}

export interface AgentLoopHost {
  getSession(sessionId: string): SessionRecord | undefined;
  foldMessages(sessionId: string): SessionMessage[];
  enqueueSteer(sessionId: string, text: string, opts?: EnqueueSteerOptions): SteerAck;
  abortSession(sessionId: string): void;
  startRun(
    sessionId: string,
    latch: AgentLoopLatch,
    options?: { onModelStreamChunk?: (chunk: unknown) => void; steerDrainPolicy?: SteerDrainPolicy }
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
    if (isLatchTerminal(ev)) {
      this.terminalEmitted = true;
    }
    if (this.eventWaiters.length > 0) {
      const w = this.eventWaiters.shift()!;
      w(ev);
    } else {
      this.queue.push(ev);
    }
    const pause = this.mode === 'step' && !isLatchTerminal(ev) && !this.closed;
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
  /** Cooperative, one-shot. Consumed by the next `step()` as `{type:'abort'}`. */
  private abortRequested = false;

  constructor(
    private readonly host: AgentLoopHost,
    readonly sessionId: string,
    private readonly loopOptions?: { steerDrainPolicy?: SteerDrainPolicy }
  ) {}

  /**
   * Run one phase: prepareTurnInput → model → (optional) tools, then return
   * control. Finer events (turn_prepared, model_done, …) are yielded one at a
   * time so callers can stop at model_done.
   *
   * Abort is not sticky: after this method emits `{type:'abort'}`, the next
   * `step()` may start a new turn.
   */
  async step(): Promise<AgentStepEvent> {
    if (this.abortRequested) {
      return this.consumeAbort();
    }
    this.ensureStarted('step');
    const latch = this.latch!;
    const eventPromise = latch.waitForEvent();
    latch.resume();
    const ev = await eventPromise;
    if (this.abortRequested) {
      return this.consumeAbort();
    }
    return ev;
  }

  /** Run continuously until end / waiting_approval / abort. */
  async run(): Promise<SessionRecord> {
    if (this.abortRequested) {
      await this.consumeAbort();
      return this.host.getSession(this.sessionId) as SessionRecord;
    }
    if (this.latch?.mode === 'step' && this.runPromise && !this.latch.closed) {
      this.latch.mode = 'run';
      this.latch.resume();
      return this.runPromise;
    }
    this.ensureStarted('run');
    return this.runPromise!;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AgentStepEvent> {
    while (true) {
      if (this.abortRequested) {
        yield await this.consumeAbort();
        return;
      }
      this.ensureStarted(this.latch?.mode ?? 'step');
      const latch = this.latch!;
      const eventPromise = latch.waitForEvent();
      latch.resume();
      const ev = await eventPromise;
      if (this.abortRequested) {
        yield await this.consumeAbort();
        return;
      }
      yield ev;
      if (isLatchTerminal(ev)) return;
    }
  }

  async steer(text: string, opts?: EnqueueSteerOptions): Promise<SteerAck> {
    this.abortRequested = false;
    return this.host.enqueueSteer(this.sessionId, text, opts);
  }

  async abort(): Promise<void> {
    this.abortRequested = true;
    this.host.abortSession(this.sessionId);
    this.latch?.close();
  }

  /** Read-only fold of the current surface. Does not claim inbox. */
  async fold(): Promise<SessionMessage[]> {
    return this.host.foldMessages(this.sessionId);
  }

  private async consumeAbort(): Promise<AgentStepEvent> {
    this.abortRequested = false;
    this.latch?.close();
    const pending = this.runPromise;
    this.latch = null;
    this.runPromise = null;
    if (pending) {
      try {
        await pending;
      } catch {
        /* surfaced as abort */
      }
    }
    return { type: 'abort' };
  }

  private ensureStarted(mode: 'run' | 'step'): void {
    if (this.latch && this.runPromise && !this.latch.closed) return;
    const latch = new AgentLoopLatch(mode);
    this.latch = latch;
    this.runPromise = this.host
      .startRun(this.sessionId, latch, {
        steerDrainPolicy: this.loopOptions?.steerDrainPolicy
      })
      .finally(() => {
        latch.close();
      });
    void this.runPromise.catch(() => {
      /* surfaced via step()/run() */
    });
  }
}

export function createAgentLoop(
  host: AgentLoopHost,
  sessionId: string,
  options?: { steerDrainPolicy?: SteerDrainPolicy }
): AgentLoopHandle {
  return new AgentLoopHandle(host, sessionId, options);
}
