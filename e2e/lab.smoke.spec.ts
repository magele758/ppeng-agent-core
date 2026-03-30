import { test, expect } from '@playwright/test';

test.describe('Agent Lab console', () => {
  test('loads home and title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Agent Lab/i);
    await expect(page.getByText('Agent Lab').first()).toBeVisible();
    await expect(page.getByRole('tab', { name: /对话 Playground/ })).toBeVisible();
  });

  test('switches main tabs', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: /会话与任务/ }).click();
    await expect(page.locator('#panel-ops')).toBeVisible();
    await expect(page.locator('#panel-play')).toBeHidden();

    await page.getByRole('tab', { name: /Trace 时间线/ }).click();
    await expect(page.locator('#panel-trace')).toBeVisible();
    await expect(page.locator('#panel-ops')).toBeHidden();

    await page.getByRole('tab', { name: /对话 Playground/ }).click();
    await expect(page.locator('#panel-play')).toBeVisible();
  });

  test('playground send shows user bubble after run', async ({ page }) => {
    await page.goto('/');
    const content = `e2e ${Date.now()}`;
    await page.getByLabel('消息内容').fill(content);
    await page.getByRole('button', { name: '发送' }).click();
    const box = page.locator('#playMessages');
    await expect(box.locator('.chat-turn--user .chat-bubble__body').first()).toContainText(content, {
      timeout: 60_000
    });
    await expect(page.locator('#playInput')).toHaveValue('');
  });
});
