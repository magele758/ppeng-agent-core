import { test, expect } from '@playwright/test';

test.describe('Agent Lab console', () => {
  test('loads home and title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Agent Home/i);
    await expect(page.getByText('Agent Home').first()).toBeVisible();
    // Playground 是常驻主视图（工作台其余面板走抽屉）
    await expect(page.locator('#panel-play')).toBeVisible();
    await expect(page.getByRole('button', { name: '配置模型' }).first()).toBeVisible();
  });

  test('composer shows Bot select next to model', async ({ page }) => {
    await page.goto('/');
    const botSelect = page.locator('#botSelect');
    await expect(botSelect).toBeVisible();
    await expect(botSelect).toHaveValue('');
    await expect(botSelect.locator('option').first()).toHaveText('无 Bot');
    await expect(page.getByRole('button', { name: '新建 Bot' })).toBeVisible();
    await page.getByRole('button', { name: '新建 Bot' }).click();
    await expect(page.locator('#composerBotForm')).toBeVisible();
    await expect(page.getByLabel('Bot 名称')).toBeVisible();
    await expect(page.getByLabel('Bot 标题')).toBeVisible();
    await expect(page.getByLabel('Bot 说明')).toBeVisible();
  });

  test('model setup dialog opens from composer', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '配置模型' }).first().click();
    const dialog = page.getByRole('dialog', { name: '配置模型' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('group', { name: '常用服务商' })).toBeVisible();
    await expect(dialog.getByPlaceholder('https://api.example.com/v1')).toBeVisible();
    await expect(dialog.getByPlaceholder('不会完整回显')).toBeVisible();
    await dialog.getByRole('button', { name: '关闭' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('ops tab shows swarm panel', async ({ page }) => {
    await page.goto('/');
    // 工作台面板在抽屉里，先打开（默认落到「会话与任务」），再切到 ops
    await page.getByRole('button', { name: '工作台' }).click();
    await page.getByRole('tab', { name: /会话与任务/ }).click();
    await expect(page.getByRole('heading', { name: 'Swarm' })).toBeVisible();
  });

  test('switches workbench tabs', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '工作台' }).click();

    await page.getByRole('tab', { name: /会话与任务/ }).click();
    await expect(page.locator('#panel-ops')).toBeVisible();

    await page.getByRole('tab', { name: /^Trace$/ }).click();
    await expect(page.locator('#panel-trace')).toBeVisible();
    await expect(page.locator('#panel-ops')).toBeHidden();

    await page.getByRole('tab', { name: /会话与任务/ }).click();
    await expect(page.locator('#panel-ops')).toBeVisible();
    // 抽屉打开时，常驻的 Playground 仍在 DOM 中
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
