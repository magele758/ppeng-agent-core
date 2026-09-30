import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SkillProposalStore } from '../packages/core/dist/skill-proposals/index.js';

const stateDir = process.env.PLAYWRIGHT_E2E_STATE_DIR;

test.describe('Skill proposals card', () => {
  test.skip(!stateDir, 'needs the e2e-run.mjs managed daemon state dir');

  test('enable switch, queued proposal shows up, approve installs the skill', async ({ page }) => {
    const store = new SkillProposalStore(stateDir!);
    store.create({
      name: 'e2e-release-checklist',
      description: 'Release checklist distilled from an e2e run',
      body: '# Release checklist\n\n1. Run the unit tests.\n2. Tag the release.\n',
      sessionId: 'sess_e2e_smoke'
    });

    await page.goto('/');
    await page.getByRole('button', { name: '工作台' }).click();
    await page.getByRole('tab', { name: /更多/ }).click();
    const card = page.locator('#card-skill-proposals');
    await expect(card.getByRole('heading', { name: '技能提案' })).toBeVisible({ timeout: 15_000 });

    const toggle = card.getByRole('checkbox', { name: /skill_propose/ });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(card.getByText('已保存，立即生效')).toBeVisible();
    await expect(toggle).toBeChecked();

    const row = card.getByTestId('skill-proposal-e2e-release-checklist');
    await expect(row).toBeVisible();
    await expect(row.getByText('来源会话：sess_e2e_smoke')).toBeVisible();
    const approve = row.getByRole('button', { name: '批准' });
    await expect(approve).toBeDisabled();

    await row.getByRole('button', { name: '查看完整内容' }).click();
    await expect(row.getByTestId('skill-proposal-body-e2e-release-checklist')).toContainText('Tag the release.');
    await expect(approve).toBeEnabled();
    await approve.click();

    await expect(card.getByText('已批准「e2e-release-checklist」', { exact: false })).toBeVisible();
    await expect(row).toHaveCount(0);

    const installed = join(stateDir!, 'skills', 'e2e-release-checklist', 'SKILL.md');
    expect(existsSync(installed)).toBe(true);
    expect(readFileSync(installed, 'utf8')).toContain('Tag the release.');

    const skills = await page.request.get('/api/skills');
    const body = (await skills.json()) as { skills?: Array<{ name: string; source?: string }> };
    expect(body.skills?.find((s) => s.name === 'e2e-release-checklist')?.source).toBe('user');
  });
});
