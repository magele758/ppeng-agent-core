#!/usr/bin/env node
/**
 * Headless Playwright 走查：逐个 section / 子页（zh + en）截图，收集 console 错误、
 * 原始 i18n key、中英混杂文案。每步独立 try/catch + 超时，单步失败不影响其余。
 *
 *   LAB_URL=http://127.0.0.1:23000 node scripts/ui-tour.mjs [outDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.env.LAB_URL || 'http://127.0.0.1:23000';
const OUT = process.argv[2] || '/opt/cursor/artifacts/screenshots';
const STEP_MS = 20_000;

const TOUR = [
  ['chat', []],
  ['agents', ['agents', 'bots', 'teams', 'skills']],
  ['tasks', ['queue', 'runs', 'inbox']],
  ['knowledge', ['memory', 'ingestion']],
  ['ops', ['trajectory', 'health']],
  ['settings', ['general', 'models', 'behavior', 'safety', 'tools', 'integrations']]
];

const KEY_RE =
  /\b(?:common|nav|play|more|memory|teams|ops|skillProposals|modelFallback|config|shell|settings|settingsEntries|agents|tasks|knowledge|auth)\.[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+\b/g;

fs.mkdirSync(OUT, { recursive: true });
const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms: ${label}`)), ms))]);

/** 在页面内运行：取主内容区可见文本节点，返回疑似 raw key / 混杂语言 */
function scanPage(locale) {
  const root = document.querySelector('main, .lab-content, #__next') || document.body;
  const skip = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'INPUT', 'OPTION', 'SVG', 'NOSCRIPT']);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || skip.has(el.tagName) || el.closest('code,pre,.mono,[data-user-content],.chat-turn,.msg-body')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
    const s = (n.textContent || '').replace(/\s+/g, ' ').trim();
    if (s) texts.push(s);
  }
  const rawKeys = [];
  const mixed = [];
  const cjk = /[\u4e00-\u9fff]/;
  // 允许在中文界面保留的英文专名/缩写
  const allowed =
    /^(Agent|Agents|Bot|Bots|Trace|Trajectory|Teams?|Swarm|Skills?|Memory|API|URL|MCP|SSE|Base URL|API Key|OpenAI|Anthropic|Token|Tokens|Docker|Jev|Langfuse|Feishu|WeCom|Webhook|CSV|JSON|LLM|VL|Goal|Sandbox|Cron|Bot ID|ID|OK|TaskMode|Planner|Agent Home|Evolution|Orchestration|DAG|Teams DAG|Gateway|Discovery|Compact)$/i;
  for (const s of texts) {
    for (const m of s.match(/\b[a-zA-Z]+(?:\.[A-Za-z0-9_]+){1,}\b/g) || []) {
      if (/^(common|nav|play|more|memory|teams|ops|skillProposals|modelFallback|config|shell|settings|settingsEntries|agents|tasks|knowledge|auth)\./.test(m)) rawKeys.push(m);
    }
    if (locale === 'zh') {
      const words = s.match(/[A-Za-z][A-Za-z'-]{2,}/g) || [];
      if (!cjk.test(s) && words.length >= 3 && !allowed.test(s)) mixed.push(s.slice(0, 120));
    } else if (cjk.test(s)) {
      mixed.push(s.slice(0, 120));
    }
  }
  return { rawKeys: [...new Set(rawKeys)], mixed: [...new Set(mixed)].slice(0, 20), textCount: texts.length };
}

async function main() {
  const browser = await chromium.launch();
  const report = { base: BASE, steps: [], consoleErrors: [], failedRequests: [] };
  for (const locale of ['zh', 'en']) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: path.join(OUT, 'video-tmp'), size: { width: 1280, height: 800 } }
    });
    await ctx.addInitScript((loc) => {
      localStorage.setItem('lab.locale', loc);
    }, locale);
    const page = await ctx.newPage();
    page.setDefaultTimeout(15_000);
    let where = 'boot';
    page.on('console', (m) => {
      if (m.type() === 'error') report.consoleErrors.push({ locale, where, text: m.text().slice(0, 300) });
    });
    page.on('pageerror', (e) => report.consoleErrors.push({ locale, where, text: `pageerror: ${e.message.slice(0, 300)}` }));
    page.on('response', (r) => {
      if (r.status() >= 400 && r.url().includes('/api/')) report.failedRequests.push({ locale, where, status: r.status(), url: r.url() });
    });

    const step = async (name, fn) => {
      where = `${locale}:${name}`;
      const rec = { locale, name, ok: true };
      try {
        await withTimeout(fn(), STEP_MS, name);
      } catch (e) {
        rec.ok = false;
        rec.error = String(e.message).slice(0, 300);
        try {
          await page.screenshot({ path: path.join(OUT, `${locale}-FAIL-${name.replace(/\W+/g, '-')}.png`), timeout: 5000 });
        } catch {}
      }
      report.steps.push(rec);
      return rec;
    };
    const shot = async (file) => {
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(OUT, `${locale}-${file}.png`), timeout: 10_000 });
    };
    const scan = async (rec) => {
      Object.assign(rec, await page.evaluate(scanPage, locale));
    };

    await step('boot', async () => {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await page.locator('#panel-play').waitFor();
    });

    for (const [section, subs] of TOUR) {
      const targets = subs.length ? subs : [null];
      for (const sub of targets) {
        const label = sub ? `${section}-${sub}` : section;
        const rec = await step(label, async () => {
          await page.evaluate((h) => {
            window.location.hash = h;
          }, sub ? `#/${section}/${sub}` : `#/${section}`);
          await page.locator(section === 'chat' ? '#panel-play' : `#section-${section}`).first().waitFor({ state: 'visible' });
          if (sub) await page.locator(`#section-${section}-${sub}, #section-${section}-search`).first().waitFor({ state: 'attached' });
          await shot(label);
        });
        if (rec.ok) await scan(rec).catch(() => {});
      }
    }

    await step('chat-send', async () => {
      await page.evaluate(() => (window.location.hash = '#/chat'));
      await page.locator('#panel-play').waitFor({ state: 'visible' });
      const input = page.locator('#playInput, textarea').first();
      await input.fill('hello');
      await input.press('Enter');
      await page.waitForTimeout(2500);
      await shot('chat-after-send');
    });
    await step('chat-session-settings', async () => {
      await page.locator('[aria-controls="composerConfigPanel"]').first().click();
      await page.locator('#composerConfigPanel').waitFor({ state: 'visible' });
      await shot('chat-session-settings');
      await page.keyboard.press('Escape');
    });
    await step('chat-create-menu', async () => {
      await page.locator('#panel-play').getByRole('button', { name: /新增|New$/ }).first().click();
      await shot('chat-create-menu');
      await page.keyboard.press('Escape');
    });

    await step('settings-advanced', async () => {
      await page.evaluate(() => {
        localStorage.setItem('lab.settings.advanced', '1');
        window.location.hash = '#/settings/behavior';
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      for (const cat of ['behavior', 'safety', 'tools', 'integrations', 'models']) {
        await page.evaluate((h) => (window.location.hash = h), `#/settings/${cat}`);
        await page.locator(`#section-settings-${cat}`).waitFor({ state: 'attached' });
        await shot(`settings-${cat}-advanced`);
      }
      await page.evaluate(() => localStorage.removeItem('lab.settings.advanced'));
    });
    await step('settings-search', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.evaluate(() => (window.location.hash = '#/settings/general'));
      await page.locator('#settingsSearch').fill(locale === 'zh' ? '网关' : 'gateway');
      await page.waitForTimeout(400);
      await shot('settings-search-gateway');
    });

    await ctx.close();
    const vid = await page.video()?.path().catch(() => null);
    if (vid && fs.existsSync(vid)) {
      fs.renameSync(vid, path.join(OUT, `tour-${locale}.webm`));
    }
  }
  await browser.close();
  fs.rmSync(path.join(OUT, 'video-tmp'), { recursive: true, force: true });
  fs.writeFileSync(path.join(OUT, 'tour-report.json'), JSON.stringify(report, null, 2));

  const bad = report.steps.filter((s) => !s.ok);
  console.log(`steps: ${report.steps.length}, failed: ${bad.length}`);
  for (const s of bad) console.log(`  FAIL ${s.locale}:${s.name} — ${s.error}`);
  for (const s of report.steps) {
    if (s.rawKeys?.length) console.log(`  RAW-KEY ${s.locale}:${s.name} ${s.rawKeys.join(', ')}`);
    if (s.mixed?.length) console.log(`  MIXED ${s.locale}:${s.name}\n     ${s.mixed.join('\n     ')}`);
  }
  const errs = new Map();
  for (const e of report.consoleErrors) errs.set(e.text, (errs.get(e.text) || 0) + 1);
  for (const [t, n] of errs) console.log(`  CONSOLE x${n}: ${t}`);
  const fr = new Map();
  for (const e of report.failedRequests) fr.set(`${e.status} ${e.url}`, (fr.get(`${e.status} ${e.url}`) || 0) + 1);
  for (const [t, n] of fr) console.log(`  HTTP x${n}: ${t}`);
}

main().catch((e) => {
  console.error('tour crashed', e);
  process.exit(1);
});
