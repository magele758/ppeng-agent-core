import { test, expect, type Page } from '@playwright/test';

async function openBotSettings(page: Page, name: string) {
  await page.goto('/');
  await page.locator('#playSurfaceBot').click();
  await page.locator('#sessionListMini').getByText(name, { exact: false }).first().click();
  await page.locator('.composer-config-summary').click();
  await expect(page.locator('#composerConfigPanel')).toBeVisible();
}

test.describe('Bot permission settings', () => {
  test('permission tier saves, bypass asks for confirmation, and reload shows the stored value', async ({
    page,
    request
  }) => {
    const name = `E2E Policy ${Date.now()}`;
    const created = await request.post('/api/bots', { data: { name } });
    expect(created.status()).toBe(201);
    const { bot } = (await created.json()) as { bot: { id: string; canonicalSessionId: string } };
    const opened = await request.post(`/api/bots/${bot.id}/open`);
    const { session } = (await opened.json()) as { session: { id: string } };

    await openBotSettings(page, name);
    const select = page.getByLabel('Bot 权限档');
    await expect(select).toBeEnabled();
    await expect(select).toHaveValue('auto');
    await expect(select.locator('option')).toHaveCount(5);

    await select.selectOption('ask');
    await expect
      .poll(async () => {
        const res = await request.get(`/api/sessions/${session.id}`);
        return ((await res.json()) as { session: { metadata: { permissionMode?: string } } }).session
          .metadata.permissionMode;
      })
      .toBe('ask');

    await select.selectOption('bypass');
    const confirm = page.getByRole('alertdialog', { name: '把这个 Bot 切到 bypass？' });
    await expect(confirm).toBeVisible();
    const stillAsk = await request.get(`/api/sessions/${session.id}`);
    expect(
      ((await stillAsk.json()) as { session: { metadata: { permissionMode?: string } } }).session
        .metadata.permissionMode
    ).toBe('ask');

    await confirm.getByRole('button', { name: '取消' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(select).toHaveValue('ask');

    await select.selectOption('bypass');
    await page.getByRole('button', { name: '确认使用 bypass' }).click();
    await expect(page.getByText('这条 Bot 会话处于 bypass')).toBeVisible();

    await request.post(`/api/bots/${bot.id}/open`);
    await openBotSettings(page, name);
    await expect(page.getByLabel('Bot 权限档')).toHaveValue('bypass');
  });

  test('saving an allowlist without TodoWrite / load_skill shows a warning', async ({ page, request }) => {
    const name = `E2E Tools ${Date.now()}`;
    const created = await request.post('/api/bots', { data: { name } });
    expect(created.status()).toBe(201);
    const tools = ((await (await request.get('/api/tools')).json()) as { tools: { name: string }[] }).tools;
    const narrow = tools.map((tool) => tool.name).find((n) => n !== 'TodoWrite' && n !== 'load_skill')!;

    await openBotSettings(page, name);
    const list = page.getByLabel('允许使用的工具');
    await list.selectOption([narrow]);
    await page.getByRole('button', { name: '保存允许名单' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'TodoWrite' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'load_skill' })).toBeVisible();
  });
});
