#!/usr/bin/env node
/**
 * 获取 arXiv 论文的元数据和摘要。
 * 用法：node scripts/arxiv-fetch.mjs <arxiv_url_or_id>
 *
 * 输出 JSON：
 * {
 *   "id": "2501.06322",
 *   "title": "...",
 *   "authors": ["..."],
 *   "abstract": "...",
 *   "categories": ["cs.AI", ...],
 *   "published": "2025-01-15",
 *   "pdf_url": "https://arxiv.org/pdf/2501.06322"
 * }
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dir, '..');
loadDotenv({ path: join(repoRoot, '.env') });

const ARXIV_API = 'http://export.arxiv.org/api/query';
const ARXIV_API_ALT = 'https://export.arxiv.org/api/query'; // 备用 HTTPS 端点
const CACHE_DIR = join(repoRoot, '.evolution', 'arxiv-cache');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RETRY_DELAYS = [3000, 10000, 20000]; // 重试延迟：3s, 10s, 20s
const REQUEST_DELAY_MS = 3000; // 每次请求间隔 3s（arXiv 官方建议）

/**
 * 从 arXiv URL 或 ID 提取论文 ID
 */
function parseArxivId(input) {
  // https://arxiv.org/abs/2501.06322 -> 2501.06322
  // https://arxiv.org/pdf/2501.06322 -> 2501.06322
  // 2501.06322 -> 2501.06322
  const match = input.match(/(\d{4}\.\d{4,5}(?:v\d+)?)/);
  return match ? match[1] : null;
}

/**
 * 延迟函数
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 尝试从多个端点获取数据
 */
async function fetchWithFallback(arxivId) {
  const endpoints = [ARXIV_API, ARXIV_API_ALT];
  const url = `${ARXIV_API}?id_list=${arxivId}`;

  for (let i = 0; i < RETRY_DELAYS.length + 1; i++) {
    for (const endpoint of endpoints) {
      try {
        const res = await fetch(`${endpoint}?id_list=${arxivId}`, {
          headers: { 'User-Agent': 'ppeng-agent-evolution/1.0' }
        });

        if (res.ok) {
          return await res.text();
        }

        // 速率限制或服务不可用，等待后重试
        if (res.status === 429 || res.status === 503) {
          const waitMs = RETRY_DELAYS[Math.min(i, RETRY_DELAYS.length - 1)];
          console.error(`arXiv API 返回 ${res.status}，${waitMs / 1000} 秒后重试...`);
          await delay(waitMs);
          break; // 换到下一轮重试
        }

        throw new Error(`arXiv API error: ${res.status}`);
      } catch (e) {
        if (e.message.includes('fetch failed') || e.message.includes('ECONN')) {
          const waitMs = RETRY_DELAYS[Math.min(i, RETRY_DELAYS.length - 1)];
          console.error(`网络错误，${waitMs / 1000} 秒后重试...`);
          await delay(waitMs);
          break;
        }
        throw e;
      }
    }
  }

  throw new Error('arXiv API 多次重试后仍失败');
}

/**
 * 从 arXiv API 获取论文元数据（带重试和速率限制）
 */
async function fetchFromArxivApi(arxivId) {
  // 请求前延迟，避免触发速率限制
  await delay(REQUEST_DELAY_MS);

  const xml = await fetchWithFallback(arxivId);

  // 简单解析 XML（不依赖外部库）
  const entry = xml.match(/<entry[\s\S]*?<\/entry>/)?.[0] || '';
  if (!entry) {
    throw new Error('No entry found in arXiv response');
  }

  const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim().replace(/\s+/g, ' ') || '';
  const abstract = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim().replace(/\s+/g, ' ') || '';
  const published = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.slice(0, 10) || '';

  const authors = [];
  const authorRegex = /<author>[\s\S]*?<name>(.*?)<\/name>[\s\S]*?<\/author>/g;
  let authorMatch;
  while ((authorMatch = authorRegex.exec(entry)) !== null) {
    authors.push(authorMatch[1].trim());
  }

  const categories = [];
  const catRegex = /<category[^>]*term="([^"]+)"/g;
  let catMatch;
  while ((catMatch = catRegex.exec(entry)) !== null) {
    categories.push(catMatch[1]);
  }

  return {
    id: arxivId,
    title,
    authors,
    abstract,
    categories,
    published,
    pdf_url: `https://arxiv.org/pdf/${arxivId}`,
    abs_url: `https://arxiv.org/abs/${arxivId}`,
    fetched_at: new Date().toISOString()
  };
}

/**
 * 获取论文元数据（带缓存）
 */
async function fetchArxivPaper(input) {
  const arxivId = parseArxivId(input);
  if (!arxivId) {
    throw new Error(`Invalid arXiv ID or URL: ${input}`);
  }

  // 检查缓存
  const cacheFile = join(CACHE_DIR, `${arxivId}.json`);
  if (existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
      const age = Date.now() - new Date(cached.fetched_at).getTime();
      if (age < CACHE_TTL_MS) {
        return { ...cached, from_cache: true };
      }
    } catch {}
  }

  // 从 API 获取
  const paper = await fetchFromArxivApi(arxivId);

  // 写入缓存
  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cacheFile, JSON.stringify(paper, null, 2), 'utf8');
  } catch {}

  return { ...paper, from_cache: false };
}

// CLI 入口
async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node scripts/arxiv-fetch.mjs <arxiv_url_or_id>');
    process.exit(1);
  }

  try {
    const paper = await fetchArxivPaper(input);
    console.log(JSON.stringify(paper, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();

export { fetchArxivPaper, parseArxivId };
