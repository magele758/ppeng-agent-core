#!/usr/bin/env node
/**
 * 每日拉取 gateway.config 中的 RSS，更新 gateway 状态、写入 skills digest、并生成 doc/evolution/inbox/YYYY-MM-DD.md。
 * 不依赖 daemon；不调用 reloadWorkspaceSkills（需重启 daemon 或 gateway POST /learn/run）。
 *
 * 用法：npm run evolution:learn
 * 环境：EVOLUTION_GATEWAY_CONFIG、RAW_AGENT_STATE_DIR（默认 .agent-state）
 */
import { readFileSync, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dir, '..');
loadDotenv({ path: join(repoRoot, '.env') });

const MAX_SEEN = 8000;
const MAX_ROLLING = 300;
const DEFAULT_MAX_PER_FEED = 12;

function utcDateString(d) {
  return d.toISOString().slice(0, 10);
}

function loadGatewayJson() {
  const envPath = process.env.EVOLUTION_GATEWAY_CONFIG?.trim();
  const candidates = [
    envPath,
    join(repoRoot, 'gateway.config.json'),
    join(repoRoot, 'gateway.config.example.json')
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, 'utf8'));
    }
  }
  throw new Error('evolution-learn: no gateway.config.json / gateway.config.example.json found');
}

async function main() {
  const { fetchFeedItems } = await import(pathToFileURL(join(repoRoot, 'packages/capability-gateway/dist/feed.js')).href);
  const { readGatewayState, writeGatewayState } = await import(
    pathToFileURL(join(repoRoot, 'packages/capability-gateway/dist/state.js')).href
  );
  const { buildDigestMarkdown } = await import(pathToFileURL(join(repoRoot, 'packages/capability-gateway/dist/learn.js')).href);

  const cfg = loadGatewayJson();
  const learn = cfg.learn;
  if (!learn?.feeds?.length) {
    console.error('evolution-learn: configure learn.feeds in gateway config');
    process.exitCode = 1;
    return;
  }

  const stateDir = process.env.RAW_AGENT_STATE_DIR?.trim() || '.agent-state';
  const gatewayDir = join(repoRoot, stateDir, 'gateway');
  await mkdir(gatewayDir, { recursive: true });

  const maxPer = learn.maxItemsPerFeed ?? DEFAULT_MAX_PER_FEED;
  let state = await readGatewayState(gatewayDir);
  const seen = new Set(state.seenLinks);
  const newForDigest = [];
  let feedOk = 0;
  let feedFail = 0;

  for (const feedUrl of learn.feeds) {
    try {
      const items = await fetchFeedItems(feedUrl, maxPer);
      feedOk += 1;
      for (const it of items) {
        if (!it.link || seen.has(it.link)) continue;
        seen.add(it.link);
        newForDigest.push({ title: it.title, link: it.link });
        state.rollingItems.unshift({
          title: it.title,
          link: it.link,
          fetchedAt: new Date().toISOString()
        });
      }
    } catch (e) {
      feedFail += 1;
      const msg = e instanceof Error ? e.message : String(e);
      const cause = e instanceof Error && 'cause' in e && e.cause ? ` (${String(e.cause)})` : '';
      console.error(`evolution-learn: feed skip — ${feedUrl}\n  → ${msg}${cause}`);
    }
  }

  if (feedFail > 0) {
    console.error(`evolution-learn: ${feedFail}/${learn.feeds.length} feed(s) failed (TLS/HTTP/network); others still applied.`);
  }

  state.rollingItems = state.rollingItems.slice(0, MAX_ROLLING);
  state.seenLinks = [...seen].slice(-MAX_SEEN);

  const today = utcDateString(new Date());
  const md = buildDigestMarkdown(
    today,
    newForDigest,
    state.rollingItems.slice(0, 80).map((r) => ({ title: r.title, link: r.link }))
  );
  state.lastDigestMarkdown = md;
  state.lastLearnRunDateUtc = today;

  const subdir = (learn.skillsSubdir || 'skills').replace(/^\/+|\/+$/g, '');
  const skillDir = join(repoRoot, subdir, 'agent-tech-digest');
  await mkdir(skillDir, { recursive: true });
  const digestPath = join(skillDir, 'SKILL.md');
  await writeFile(digestPath, md, 'utf8');

  await writeGatewayState(gatewayDir, state);

  const inboxDir = join(repoRoot, 'doc', 'evolution', 'inbox');
  await mkdir(inboxDir, { recursive: true });
  const inboxLines = [
    `# Evolution inbox ${today}`,
    '',
    '## 今日新条目',
    ...(newForDigest.length
      ? newForDigest.map((i) => `- [${i.title}](${i.link})`)
      : ['_（无新链接，仍已刷新滚动摘要）_']),
    '',
    '## 近期滚动（参考）',
    ...state.rollingItems.slice(0, 20).map((r) => `- [${r.title}](${r.link})`),
    '',
    '---',
    `digest_written: ${digestPath}`,
    `new_count: ${newForDigest.length}`
  ];
  const inboxPath = join(inboxDir, `${today}.md`);
  await writeFile(inboxPath, inboxLines.join('\n'), 'utf8');

  console.log(`evolution-learn: inbox ${inboxPath}`);
  console.log(`evolution-learn: digest ${digestPath} (new ${newForDigest.length})`);
  if (feedOk === 0 && learn.feeds.length > 0) {
    console.error(
      'evolution-learn: all feeds failed — check proxy/VPN or remove unreachable URLs (e.g. huggingface.co) from gateway.config.json learn.feeds'
    );
    process.exitCode = 1;
  }
  console.log('evolution-learn: restart daemon or POST gateway /learn/run to reload skills in runtime');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});