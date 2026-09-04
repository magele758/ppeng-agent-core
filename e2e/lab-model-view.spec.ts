import { test, expect } from '@playwright/test';

const LONG_BASH_PROMPT = '跑一段长 bash dump';
const FOLLOWUP_PROMPT = 'hello 再看一眼';
const STORED_MARKER = 'MODEL_VIEW_BASH_MARKER-';
const STUB_TEXT = 'output dropped from context';

test.describe('Lab 模型所见', () => {
  test.afterEach(async ({ request }) => {
    await request.patch('/api/compact/settings', {
      data: { policy: 'keep_recent' }
    });
  });

  test('after_text_assistant 两轮后，开模型所见见占位、关开关见原文', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#panel-play')).toBeVisible();

    await page.locator('.composer-config-summary').click();
    const policy = page.getByLabel('工具结果压缩策略');
    await expect(policy).toBeVisible();
    await policy.selectOption('after_text_assistant');
    await expect(page.getByText(/已保存，立即生效/)).toBeVisible();

    await page.getByLabel('消息内容').fill(LONG_BASH_PROMPT);
    await page.getByRole('button', { name: '发送' }).click();

    const resultFold = page.locator('#playMessages .chat-tool-fold--result').first();
    await expect(resultFold).toBeVisible({ timeout: 60_000 });
    if (!(await resultFold.evaluate((el) => el instanceof HTMLDetailsElement && el.open))) {
      await resultFold.locator(':scope > summary').click();
    }
    await expect(resultFold.locator('.chat-tool-io__block--out')).toContainText(STORED_MARKER);

    await page.getByLabel('消息内容').fill(FOLLOWUP_PROMPT);
    await page.getByRole('button', { name: '发送' }).click();
    await expect(page.locator('#playMessages .chat-turn--user .chat-bubble__body').nth(1)).toContainText(
      FOLLOWUP_PROMPT,
      { timeout: 60_000 }
    );

    await page.getByLabel('模型所见').check();
    await expect(page.locator('.model-view-banner')).toContainText('仅模型视图');
    await expect(page.locator('#playMessages')).toContainText(STUB_TEXT);
    await expect(page.locator('#playMessages .chat-tool-fold__pill--model-view').first()).toBeVisible();
    await expect(
      page.locator('#playMessages .chat-tool-fold--result').first().locator('.chat-tool-io__block--out')
    ).not.toContainText(STORED_MARKER);

    await page.getByLabel('模型所见').uncheck();
    const storedFold = page.locator('#playMessages .chat-tool-fold--result').first();
    if (!(await storedFold.evaluate((el) => el instanceof HTMLDetailsElement && el.open))) {
      await storedFold.locator(':scope > summary').click();
    }
    await expect(storedFold.locator('.chat-tool-io__block--out')).toContainText(STORED_MARKER);
    await expect(page.locator('.model-view-banner')).toHaveCount(0);
  });
});
