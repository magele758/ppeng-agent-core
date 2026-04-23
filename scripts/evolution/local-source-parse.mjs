/**
 * 解析 `EVOLUTION_LOCAL_SOURCES` 下的 .md / .txt：抽取 http 链接、arXiv 等；若无外联链接则
 * 以整篇文件为一条，`link` 为 `file://` 绝对 URL（与 evolution-run-day 的本地摘录配合）。
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SKIP_DIR_NAMES = new Set(['.obsidian', '.git', 'node_modules', '.trash']);

/** 递归扫描时跳过 Obsidian/工具目录，避免全库无意义暴扫 */
export function shouldSkipScanDirEntry(entryName, isDirectory) {
  if (!isDirectory) return false;
  if (SKIP_DIR_NAMES.has(entryName)) return true;
  if (entryName.startsWith('.')) return true;
  return false;
}

export function fileUriForLocalPath(filePath) {
  return pathToFileURL(resolve(filePath)).href;
}

/**
 * 解析本地信息源文件，提取标题和链接。
 * 支持格式：
 * - Markdown 链接：`[文本](URL)`
 * - 论文格式：文件开头 `# 标题`，正文中有 `[Source (arXiv)](URL)`
 * - 列表格式：`- [标题](URL)`
 * - 纯 URL（每行一个）
 * - 正文中的 arXiv 编号
 * - **无外联时**：以整篇为一条，`link` 为 `file://` 指向本文件
 */
export function parseLocalSourceFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const items = [];
  const seenLinks = new Set();

  const push = (title, link) => {
    if (!link || seenLinks.has(link)) return;
    seenLinks.add(link);
    items.push({ title, link });
  };

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

    const title = /^Source/i.test(linkText) && fileTitle
      ? fileTitle
      : linkText || fileTitle || basename(link);

    push(title, link);
  }

  // 正文中的 arXiv ID
  const arxivIdRegex = /\bar[Xx]iv:\s*([0-9]{4}\.[0-9]{4,5})\b/g;
  while ((match = arxivIdRegex.exec(content)) !== null) {
    const id = match[1];
    const link = `https://arxiv.org/abs/${id}`;
    const title = fileTitle ? `${fileTitle} (arXiv:${id})` : `arXiv:${id}`;
    push(title, link);
  }

  // 裸 arxiv abs 路径
  const arxivAbsRegex = /https?:\/\/arxiv\.org\/abs\/([0-9]{4}\.[0-9]{4,5})/gi;
  while ((match = arxivAbsRegex.exec(content)) !== null) {
    const id = match[1];
    const link = `https://arxiv.org/abs/${id}`;
    push(fileTitle || `arXiv:${id}`, link);
  }

  // 如果没有 Markdown 链接，尝试纯 URL
  if (items.length === 0) {
    const urlRegex = /^(https?:\/\/[^\s]+)/gm;
    while ((match = urlRegex.exec(content)) !== null) {
      const link = match[1].trim();
      push(fileTitle || basename(link), link);
    }
  }

  if (items.length === 0) {
    const baseName = basename(filePath).replace(/\.(md|txt)$/i, '') || 'note';
    const title = fileTitle || baseName;
    const link = fileUriForLocalPath(filePath);
    items.push({ title, link });
  }

  return items;
}

/**
 * 供 evolution-learn 使用的目录扫描（与旧版行为一致，增加目录跳过规则）。
 */
export function scanDirRecursive(absDir) {
  const files = [];
  const entries = readdirSync(absDir);
  for (const entry of entries) {
    const fullPath = join(absDir, entry);
    const stat = lstatSync(fullPath);
    if (stat.isDirectory()) {
      if (shouldSkipScanDirEntry(entry, true)) continue;
      files.push(...scanDirRecursive(fullPath));
    } else if (stat.isFile() && (entry.endsWith('.md') || entry.endsWith('.txt'))) {
      files.push(fullPath);
    }
  }
  return files;
}
