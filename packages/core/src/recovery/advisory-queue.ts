/**
 * Per-run advisory queue — drafts are drained into the next turn as a system
 * (or optional user-prefix) message. Mirrors ai-agent-node AdvisoryInjector enqueue.
 */

export interface AdvisoryDraft {
  id: string;
  text: string;
  source: 'risk' | 'recovery' | 'evolving' | 'goal';
  createdAt: string;
}

export class AdvisoryQueue {
  private readonly queue: AdvisoryDraft[] = [];
  private seq = 0;

  enqueue(text: string, source: AdvisoryDraft['source']): AdvisoryDraft {
    const draft: AdvisoryDraft = {
      id: `adv_${++this.seq}`,
      text: text.trim().slice(0, 600),
      source,
      createdAt: new Date().toISOString()
    };
    this.queue.push(draft);
    return draft;
  }

  get size(): number {
    return this.queue.length;
  }

  /** Drain all pending advisories as a single combined text (or undefined). */
  drainCombined(): string | undefined {
    if (this.queue.length === 0) return undefined;
    const texts = this.queue.map((d) => d.text);
    this.queue.length = 0;
    return texts.join('\n\n');
  }

  peek(): AdvisoryDraft[] {
    return [...this.queue];
  }
}
