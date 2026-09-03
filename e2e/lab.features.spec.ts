import { test, expect } from '@playwright/test';

test.describe('Lab new surfaces', () => {
  test('workbench 更多 shows goal / sandbox / event-log / ingestion cards', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '工作台' }).click();
    await page.getByRole('tab', { name: /更多/ }).click();
    const more = page.locator('#panel-more');
    await expect(more).toBeVisible();
    await expect(more.getByRole('heading', { name: 'Goal 实体' })).toBeVisible({ timeout: 15_000 });
    await expect(more.getByRole('heading', { name: '沙箱' })).toBeVisible();
    await expect(more.getByRole('heading', { name: 'EventLog / Saga' })).toBeVisible();
    await expect(more.getByRole('heading', { name: '附件与浏览器' })).toBeVisible();
  });

  test('Teams tab shows DAG planner', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '工作台' }).click();
    await page.getByRole('tab', { name: /^Teams$/ }).click();
    await expect(page.locator('#panel-teams')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Teams DAG' })).toBeVisible();
  });

  test('composer execution mode and workspace picker are present', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('工作区')).toBeVisible();
    await page.locator('.composer-config-summary').click();
    await expect(page.locator('#composerConfigPanel')).toBeVisible();
    await expect(page.getByLabel('通用执行模式')).toBeVisible();
    await expect(page.getByText('自主度', { exact: false })).toBeVisible();
  });

  test('composer model picker does not show env fallback', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '选择可用模型' }).click();
    const panel = page.getByRole('listbox', { name: '可用模型' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('环境变量', { exact: false })).toHaveCount(0);
    await expect(panel.getByText('回退')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: '管理服务商…' })).toBeVisible();
  });
});
