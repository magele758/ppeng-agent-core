import { test, expect } from '@playwright/test';

test.describe('Agent Lab console', () => {
  test('loads home and title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Agent Home/i);
    // Playground 是常驻主视图；品牌/状态/运维控件收进右侧工作台抽屉
    await expect(page.locator('#panel-play')).toBeVisible();
    await expect(page.locator('header.topbar')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '工作台' })).toBeVisible();
  });

  test('chat and bot surfaces coexist', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#playSurfaceChat')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#botSelect')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '新增' })).toBeVisible();

    await page.locator('#playSurfaceBot').click();
    await expect(page.locator('#playSurfaceBot')).toHaveAttribute('aria-selected', 'true');
    const botSelect = page.locator('#botSelect');
    await expect(botSelect).toBeVisible();
    await expect(botSelect).toHaveValue('');
    await expect(botSelect.locator('option').first()).toHaveText('选择 Bot');
    await expect(page.locator('.chat-composer-dock').getByRole('button', { name: '新建 Bot' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '新增' }).click();
    await page.getByRole('menuitem', { name: /新建 Bot/ }).click();
    await expect(page.locator('#composerBotForm')).toBeVisible();
    await expect(page.getByLabel('Bot 名称')).toBeVisible();
    await expect(page.getByLabel('Bot 标题')).toBeVisible();
    await expect(page.getByLabel('Bot 说明')).toBeVisible();

    await page.locator('#playSurfaceChat').click();
    await expect(page.locator('#botSelect')).toHaveCount(0);
  });

  test('model setup dialog opens from workbench', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '工作台' }).click();
    await page.locator('#btnModelSetup').click();
    const dialog = page.getByRole('dialog', { name: '配置模型' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('group', { name: '常用服务商' })).toBeVisible();
    await expect(dialog.getByPlaceholder('https://api.example.com/v1')).toBeVisible();
    await expect(dialog.getByPlaceholder('不会完整回显')).toBeVisible();
    await dialog.getByRole('button', { name: '关闭' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('ops tab shows session trajectory workspace', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '工作台' }).click();
    await page.getByRole('tab', { name: /会话轨迹/ }).click();
    await expect(page.locator('#panel-ops').getByRole('heading', { name: '会话' })).toBeVisible();
    await expect(page.locator('#panel-ops').getByRole('heading', { name: 'Trajectory' })).toBeVisible();
    await expect(page.locator('#listSessions')).toBeVisible();
    await expect(page.locator('#traceTimeline')).toBeVisible();
  });

  test('switches workbench tabs', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '工作台' }).click();

    await page.getByRole('tab', { name: /会话轨迹/ }).click();
    await expect(page.locator('#panel-ops')).toBeVisible();

    await page.getByRole('tab', { name: /^Teams$/ }).click();
    await expect(page.locator('#panel-teams')).toBeVisible();
    await expect(page.locator('#panel-ops')).toBeHidden();

    await page.getByRole('tab', { name: /会话轨迹/ }).click();
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
