import { test, expect } from '@playwright/test';

test.describe('Swarm API golden path', () => {
  test('create swarm, start, scheduler tick completes run', async ({ request }) => {
    const createRes = await request.post('/api/swarm/runs', {
      data: {
        goal: `e2e-swarm-${Date.now()}`,
        strategy: 'pipeline',
        budget: { maxTeammates: 2, maxTurnsPerAgent: 8, maxDurationMs: 120_000 }
      }
    });
    expect(createRes.ok()).toBeTruthy();
    const { run } = await createRes.json();
    expect(run.id).toBeTruthy();

    const startRes = await request.post(`/api/swarm/runs/${run.id}/start`, {
      data: {
        tasks: [{ title: 'E2E implement task', requiredRole: 'implementer' }]
      }
    });
    expect(startRes.ok()).toBeTruthy();

    let terminal = false;
    for (let i = 0; i < 12; i += 1) {
      await request.post('/api/scheduler/run');
      const statusRes = await request.get(`/api/swarm/runs/${run.id}`);
      expect(statusRes.ok()).toBeTruthy();
      const body = await statusRes.json();
      if (body.run.status === 'completed' || body.run.status === 'failed') {
        terminal = true;
        expect(body.run.status).toBe('completed');
        const tasks = body.tasks ?? [];
        expect(tasks.some((t: { status: string }) => t.status === 'done')).toBeTruthy();
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    expect(terminal).toBeTruthy();
  });
});
