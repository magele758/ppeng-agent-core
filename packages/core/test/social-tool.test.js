import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createBuiltinTools } from '../dist/tools/builtin-tools.js';
import { SOCIAL_POST_SCHEDULE_METADATA_KEY, SOCIAL_POST_TASK_KIND } from '../dist/social-schedule.js';

describe('schedule_social_post tool', () => {
  it('creates a task with structured metadata', async () => {
    let createdTaskInput = null;
    const mockServices = {
      createTask: async (input) => {
        createdTaskInput = input;
        return { id: 'task_123', ...input };
      },
      // Other services not used by this tool
    };

    const tools = createBuiltinTools(mockServices);
    const tool = tools.find(t => t.name === 'schedule_social_post');
    assert.ok(tool);

    const context = {
      agent: { id: 'agent_1' },
      session: { id: 'session_1' },
      task: { id: 'parent_task_1' }
    };

    const args = {
      body: 'Hello social world',
      channels: ['x', 'linkedin'],
      publish_at: '2026-04-18T12:00:00Z',
      first_comment: 'First!'
    };

    const result = await tool.execute(context, args);
    assert.equal(result.ok, true);
    
    const parsedContent = JSON.parse(result.content);
    assert.equal(parsedContent.taskId, 'task_123');
    assert.equal(parsedContent.schedule.body, 'Hello social world');

    assert.ok(createdTaskInput);
    assert.equal(createdTaskInput.title, '[Social] Hello social world');
    assert.equal(createdTaskInput.metadata.kind, SOCIAL_POST_TASK_KIND);
    const schedule = createdTaskInput.metadata[SOCIAL_POST_SCHEDULE_METADATA_KEY];
    assert.equal(schedule.body, 'Hello social world');
    assert.deepEqual(schedule.channels, ['x', 'linkedin']);
    assert.equal(schedule.publishAt, '2026-04-18T12:00:00.000Z');
    assert.equal(schedule.firstComment, 'First!');
    assert.equal(schedule.approval, 'pending_approval');
  });

  it('returns error if validation fails', async () => {
    const mockServices = {
      createTask: async () => { throw new Error('Should not be called'); }
    };

    const tools = createBuiltinTools(mockServices);
    const tool = tools.find(t => t.name === 'schedule_social_post');

    const context = {
      agent: { id: 'agent_1' },
      session: { id: 'session_1' }
    };

    // Missing body
    const result = await tool.execute(context, {
      body: '',
      channels: ['x'],
      publish_at: '2026-04-18T12:00:00Z'
    });
    assert.equal(result.ok, false);
    assert.ok(result.content.includes('body is required'));
  });
});
