#!/usr/bin/env node
/**
 * 每日拉取 gateway.config 中的 RSS，更新 gateway 状态、写入 skills digest、并生成 doc/evolution/inbox/YYYY-MM-DD.md。
 * 不依赖 daemon；不调用 reloadWorkspaceSkills（需重启 daemon 或 gateway POST /learn/run）。
 *
 * 支持多种信息源：
 * - RSS feeds（gateway.config.json learn.feeds）
 * - 本地文件目录（EVOLUTION_LOCAL_SOURCES，git 不跟踪的私有资料）
 * - 历史归档目录（EVOLUTION_ARCHIVE_DIR，已爬取但未测试的资料）
 *
 * 用法：npm run evolution:learn
 * 环境：EVOLUTION_GATEWAY_CONFIG、RAW_AGENT_STATE_DIR（默认 .agent-state）
 *       EVOLUTION_LOCAL_SOURCES — 本地信息源目录（逗号分隔，如 .evolution/sources/,doc/evolution/archive/）
 *       EVOLUTION_ARCHIVE_DIR    — 历史归档目录（已爬取但未测试）
 */
import { readFileSync, existsSync, readdirSync, statSync, lstatSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
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

/**
 * 解析本地信息源文件，提取标题和链接。
 * 支持格式：
 * - Markdown 链接：`[文本](URL)`
 * - 论文格式：文件开头 `# 标题`，正文中有 `[Source (arXiv)](URL)`
 * - 列表格式：`- [标题](URL)`
 * - 纯 URL（每行一个）
 */
function parseLocalSourceFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const items = [];

  // 提取文件级标题（第一行 # 标题）
  let fileTitle = '';
  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    fileTitle = titleMatch[1].trim();
  }

  // 解析所有 Markdown 链接：[文本](URL)
  const mdLinkRegex = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  let match;
  while ((match = mdLinkRegex.exec(content)) !== null) {
    const linkText = match[1].trim();
    const link = match[2].trim();

    // 如果链接文本以 "Source" 开头，使用文件标题
    const title = /^Source/i.test(linkText) && fileTitle
      ? fileTitle
      : linkText || fileTitle || basename(link);

    items.push({ title, link });
  }

  // 如果没有 Markdown 链接，尝试纯 URL
  if (items.length === 0) {
    const urlRegex = /^(https?:\/\/[^\s]+)/gm;
    while ((match = urlRegex.exec(content)) !== null) {
      const link = match[1].trim();
      items.push({ title: fileTitle || basename(link), link });
    }
  }

  return items;
}

/**
 * 递归扫描目录，收集所有 .md 和 .txt 文件。
 */
function scanDirRecursive(absDir, baseDir = absDir) {
  const files = [];
  const entries = readdirSync(absDir);

  for (const entry of entries) {
    const fullPath = join(absDir, entry);
    const stat = lstatSync(fullPath);

    if (stat.isDirectory()) {
      // 递归扫描子目录
      files.push(...scanDirRecursive(fullPath, baseDir));
    } else if (stat.isFile() && (entry.endsWith('.md') || entry.endsWith('.txt'))) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * 扫描本地信息源目录，收集所有条目。
 * 支持递归扫描子目录。
 */
function scanLocalSources(dirs) {
  const items = [];
  for (const dir of dirs) {
    const absDir = dir.startsWith('/') ? dir : join(repoRoot, dir);
    if (!existsSync(absDir)) {
      console.log(`evolution-learn: 本地源目录不存在，跳过: ${absDir}`);
      continue;
    }

    // 递归扫描所有子目录
    const files = scanDirRecursive(absDir);
    for (const filePath of files) {
      try {
        const fileItems = parseLocalSourceFile(filePath);
        // 计算相对路径用于日志
        const relPath = filePath.replace(absDir, dir).replace(/^\//, '');
        items.push(...fileItems);
        console.log(`evolution-learn: 本地源 ${relPath} → ${fileItems.length} 条`);
      } catch (e) {
        console.error(`evolution-learn: 解析本地源失败 ${filePath}: ${e.message}`);
      }
    }
  }
  return items;
}

/**
 * 扫描历史归档目录，找出已爬取但未测试的条目。
 * 归档文件格式：YYYY-MM-DD-*.md（类似 success/failure 格式）
 * 提取 source_url 和 source_title 字段。
 */
function scanArchiveDir(archiveDir) {
  if (!archiveDir) return [];

  const absDir = archiveDir.startsWith('/') ? archiveDir : join(repoRoot, archiveDir);
  if (!existsSync(absDir)) {
    console.log(`evolution-learn: 归档目录不存在，跳过: ${absDir}`);
    return [];
  }

  const items = [];
  const files = readdirSync(absDir).filter((f) => f.endsWith('.md'));

  for (const file of files) {
    const filePath = join(absDir, file);
    try {
      const content = readFileSync(filePath, 'utf8');

      // 提取 YAML frontmatter 中的 source_url 和 source_title
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        const urlMatch = frontmatter.match(/source_url:\s*"?([^"\n]+)"?/);
        const titleMatch = frontmatter.match(/source_title:\s*"?([^"\n]+)"?/);

        if (urlMatch && titleMatch) {
          const link = urlMatch[1].trim();
          const title = titleMatch[1].trim();
          // 检查状态，只提取已爬取但未测试的（status: pending 或 research_only）
          const statusMatch = frontmatter.match(/status:\s*(\w+)/);
          const status = statusMatch ? statusMatch[1] : 'unknown';

          if (status === 'pending' || status === 'research_only' || status === 'archived') {
            items.push({ title, link, source: 'archive', originalFile: file });
          }
        }
      }
    } catch (e) {
      console.error(`evolution-learn: 解析归档文件失败 ${filePath}: ${e.message}`);
    }
  }

  if (items.length > 0) {
    console.log(`evolution-learn: 归档目录 ${absDir} → ${items.length} 条待验证`);
  }
  return items;
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

  // ── 1. RSS feeds ──────────────────────────────────────────────────────
  for (const feedUrl of learn.feeds) {
    try {
      const items = await fetchFeedItems(feedUrl, maxPer);
      feedOk += 1;
      for (const it of items) {
        if (!it.link || seen.has(it.link)) continue;
        seen.add(it.link);
        newForDigest.push({ title: it.title, link: it.link, source: 'rss' });
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

  // ── 2. 本地信息源目录 ─────────────────────────────────────────────────
  const localSourceDirs = (process.env.EVOLUTION_LOCAL_SOURCES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (localSourceDirs.length > 0) {
    const localItems = scanLocalSources(localSourceDirs);
    for (const it of localItems) {
      if (!seen.has(it.link)) {
        seen.add(it.link);
        newForDigest.push({ ...it, source: 'local' });
        state.rollingItems.unshift({
          title: it.title,
          link: it.link,
          fetchedAt: new Date().toISOString(),
          source: 'local'
        });
      }
    }
  }

  // ── 3. 历史归档目录（已爬取但未测试）─────────────────────────────────
  const archiveDir = process.env.EVOLUTION_ARCHIVE_DIR?.trim();
  if (archiveDir) {
    const archiveItems = scanArchiveDir(archiveDir);
    for (const it of archiveItems) {
      if (!seen.has(it.link)) {
        seen.add(it.link);
        newForDigest.push({ ...it, source: 'archive' });
        state.rollingItems.unshift({
          title: it.title,
          link: it.link,
          fetchedAt: new Date().toISOString(),
          source: 'archive'
        });
      }
    }
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

  // 按来源分组统计
  const rssCount = newForDigest.filter((i) => i.source === 'rss').length;
  const localCount = newForDigest.filter((i) => i.source === 'local').length;
  const archiveCount = newForDigest.filter((i) => i.source === 'archive').length;

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
    `new_count: ${newForDigest.length}`,
    `source_rss: ${rssCount}`,
    `source_local: ${localCount}`,
    `source_archive: ${archiveCount}`
  ];
  const inboxPath = join(inboxDir, `${today}.md`);
  await writeFile(inboxPath, inboxLines.join('\n'), 'utf8');

  console.log(`evolution-learn: inbox ${inboxPath}`);
  console.log(`evolution-learn: digest ${digestPath} (new ${newForDigest.length}: rss=${rssCount}, local=${localCount}, archive=${archiveCount})`);
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