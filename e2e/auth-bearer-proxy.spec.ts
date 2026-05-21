import { test, expect } from '@playwright/test';

const probeDaemon = process.env.PLAYWRIGHT_AUTH_PROBE_DAEMON_ORIGIN?.replace(/\/$/, '').trim() ?? '';

/** 仅 e2e-run 自拉起栈时注入（对外部 PLAYWRIGHT_BASE_URL 的手工跑法则整段不出现） */
if (probeDaemon) {
  test.describe('Lab middleware injects Bearer for daemon AUTH', () => {
    test('direct daemon denies protected route without Bearer', async ({ request }) => {
      const res = await request.get(`${probeDaemon}/api/orchestration/runs`);
      expect(res.status()).toBe(401);
    });

    test('same path via Next origin succeeds', async ({ request, baseURL }) => {
      const res = await request.get(`${baseURL}/api/orchestration/runs`);
      expect(res.status()).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(Array.isArray(body.runs)).toBeTruthy();
    });
  });
}
