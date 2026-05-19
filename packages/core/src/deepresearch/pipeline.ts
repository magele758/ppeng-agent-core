import { nowIso } from '../id.js';
import { ResearchStore } from './store.js';
import type { ResearchTask } from './types.js';

export interface ResearchPipelineDeps {
  store: ResearchStore;
}

export class ResearchPipeline {
  constructor(private readonly deps: ResearchPipelineDeps) {}

  async runTask(taskId: string): Promise<ResearchTask | undefined> {
    const task = this.deps.store.getTask(taskId);
    if (!task) return undefined;

    this.deps.store.updateTaskStatus(taskId, 'searching');
    const source = this.deps.store.addSource({
      taskId,
      kind: 'web',
      title: `Research: ${task.query.slice(0, 80)}`,
      fetchedAt: nowIso(),
      trustLevel: 'secondary'
    });

    this.deps.store.updateTaskStatus(taskId, 'extracting');
    const evidence = this.deps.store.addEvidence({
      taskId,
      sourceId: source.id,
      quote: `Automated research stub for: ${task.query}`,
      location: 'pipeline:v1',
      relevance: 0.7
    });

    this.deps.store.updateTaskStatus(taskId, 'synthesizing');
    this.deps.store.addClaim({
      taskId,
      text: `Preliminary finding for "${task.query}"`,
      confidence: 'medium',
      evidenceIds: [evidence.id]
    });

    return this.deps.store.updateTaskStatus(taskId, 'completed', {
      reportPath: `research/${taskId}.md`
    });
  }
}
