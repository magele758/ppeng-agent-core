#!/usr/bin/env node
/**
 * 从 doc/evolution/{success,failure,no-op,skip,superseded} 解析 Markdown，
 * 生成 evolution-showcase/dist/data/evolution.json 并复制静态资源到 dist/。
 *
 * 环境变量：加载根目录 .env（无展示专用必填项；JSON 不含 Git 提交/分支字段）。
 *
 * 参数：
 *   --max-no-op <n>  仅保留最近 n 条 no-op（按 date_utc），默认不截断
 *   --out <dir>      输出目录，默认 <repo>/evolution-showcase/dist
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { parse as parseYaml } from 'yaml';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dir, '..');
loadDotenv({ path: join(repoRoot, '.env') });
const STATIC_DIR = join(repoRoot, 'evolution-showcase', 'static');

const EVOLUTION_SECTIONS = ['success', 'failure', 'no-op', 'skip', 'superseded'];

function parseArgs(argv) {
  let maxNoOp = Infinity;
  let outDir = join(repoRoot, 'evolution-showcase', 'dist');
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max-no-op' && argv[i + 1]) {
      maxNoOp = Number(argv[++i]);
      if (!Number.isFinite(maxNoOp) || maxNoOp < 0) maxNoOp = Infinity;
    } else if (a === '--out' && argv[i + 1]) {
      outDir = argv[++i];
    }
  }
  return { maxNoOp, outDir };
}

function listMarkdownFiles(dir) {
  const out = [];
  try {
    if (!statSync(dir).isDirectory()) return out;
  } catch {
    return out;
  }
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listMarkdownFiles(p));
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function splitFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw.trim() };
  let meta = {};
  try {
    meta = parseYaml(m[1]) || {};
  } catch {
    meta = {};
  }
  return { meta, body: m[2].trim() };
}

function stripMdNoise(s) {
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/[#*_>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSummary(body, status) {
  const takeUntilNextHeading = (startIdx) => {
    const rest = body.slice(startIdx);
    const next = rest.search(/\n## /);
    const chunk = next === -1 ? rest : rest.slice(0, next);
    return stripMdNoise(chunk).slice(0, 520);
  };

  const evalIdx = body.indexOf('## 评估结论');
  if (evalIdx !== -1) {
    const s = takeUntilNextHeading(evalIdx + '## 评估结论'.length);
    if (s.length > 40) return s;
  }

  const changeIdx = body.indexOf('## 变更分类');
  if (changeIdx !== -1) {
    const s = takeUntilNextHeading(changeIdx + '## 变更分类'.length);
    if (s.length > 40) return s;
  }

  const agentSummary = body.match(
    /(?:^|\n)(?:##\s+)?Summary[:\s]*\n([\s\S]*?)(?=\n## |\n```|\n# |\Z)/i
  );
  if (agentSummary?.[1]) {
    const s = stripMdNoise(agentSummary[1]).slice(0, 520);
    if (s.length > 40) return s;
  }

  const firstH1 = body.match(/^#\s+[^\n]+/m);
  const afterH1 = firstH1 ? body.slice(body.indexOf(firstH1[0]) + firstH1[0].length) : body;
  const plain = stripMdNoise(afterH1.slice(0, 1200));
  return plain.slice(0, 400) || '(无摘要)';
}

/**
 * 公开 JSON 前脱敏：避免日志/摘要里的绝对路径暴露本机用户名与目录。
 */
function sanitizeForPublish(text, repoAbs) {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  const unixRepo = repoAbs.replace(/\\/g, '/');
  if (unixRepo.length > 0) {
    out = out.split(unixRepo).join('<repo>');
  }
  out = out.replace(/\/Users\/[^/\s]+/g, '~');
  out = out.replace(/\/home\/[^/\s]+/g, '~');
  out = out.replace(/\b[A-Za-z]:\\Users\\[^\\]+/g, '~');
  return out;
}

const OUTCOME_LABELS = {
  success: '成功',
  failure: '失败',
  'no-op': '未采纳',
  skip: '无改动跳过',
  superseded: '已取代'
};

function extractHeadingSection(body, title) {
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^##\\s+${esc}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n##\\s|$)`, 'm');
  const m = body.match(re);
  return m ? m[1].trim() : '';
}

/** 研究阶段判定 PROCEED 时的说明（来自 Agent 日志「研究结论=PROCEED →」） */
function extractProceedNarrative(body, repoAbs) {
  const marker = /研究结论=PROCEED\s*→\s*/;
  const idx = body.search(marker);
  if (idx === -1) return '';
  const tail = body.slice(idx).replace(/^[\s\S]*?研究结论=PROCEED\s*→\s*/, '');
  const lines = [];
  for (const line of tail.split(/\r?\n/)) {
    if (/^```/.test(line)) break;
    if (/^(##\s|evolution-agent|evolution-research)/.test(line)) break;
    if (line.trim() === '' && lines.length > 0) break;
    lines.push(line);
  }
  const raw = lines.join('\n').trim();
  if (!raw) return '';
  return sanitizeForPublish(stripMdNoise(raw), repoAbs).slice(0, 1200);
}

function buildReasonFields(section, body, meta, repoAbs) {
  let reasonChosen = '';
  let reasonSkipped = '';
  let reasonFailed = '';

  if (section === 'success') {
    reasonChosen = extractProceedNarrative(body, repoAbs);
    if (!reasonChosen) {
      const inspired = body.match(/\bInspired by[\s\S]{20,520}?(?=\n\n|\n##|\n###)/i);
      if (inspired) {
        reasonChosen = sanitizeForPublish(stripMdNoise(inspired[0]), repoAbs).slice(0, 800);
      }
    }
    if (!reasonChosen) {
      const impl = body.match(/\bImplemented [^\n]+(?:\n(?![#\n`])[^\n]+){0,4}/i);
      if (impl) {
        reasonChosen = sanitizeForPublish(stripMdNoise(impl[0]), repoAbs).slice(0, 800);
      }
    }
  }

  if (section === 'failure') {
    const raw = extractHeadingSection(body, '原因分析');
    reasonFailed = raw ? sanitizeForPublish(stripMdNoise(raw), repoAbs).slice(0, 1600) : '';
  }

  if (section === 'no-op' || section === 'superseded') {
    const raw = extractHeadingSection(body, '评估结论');
    reasonSkipped = raw ? sanitizeForPublish(stripMdNoise(raw), repoAbs).slice(0, 1600) : '';
  }

  if (section === 'skip') {
    const fm = typeof meta.skip_reason === 'string' ? meta.skip_reason.trim() : '';
    const sec = extractHeadingSection(body, '跳过原因');
    const merged = [fm, sec].filter(Boolean).join('\n');
    reasonSkipped = merged ? sanitizeForPublish(stripMdNoise(merged), repoAbs).slice(0, 1600) : '';
  }

  return { reasonChosen, reasonSkipped, reasonFailed };
}

function collapseWs(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function toRecord(section, absPath, body, meta, repoAbs) {
  const base = absPath.split(/[/\\]/).pop().replace(/\.md$/, '');
  const title =
    typeof meta.source_title === 'string' && meta.source_title.trim()
      ? meta.source_title.trim()
      : base.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-[a-f0-9]{8}$/, '');

  const { reasonChosen, reasonSkipped, reasonFailed } = buildReasonFields(section, body, meta, repoAbs);
  let rawSummary = extractSummary(body, meta.status ?? section);
  let summary = sanitizeForPublish(rawSummary, repoAbs);
  if (reasonSkipped && summary) {
    const a = collapseWs(summary);
    const b = collapseWs(reasonSkipped);
    if (a === b || (b.length > 40 && a.startsWith(b.slice(0, Math.min(100, b.length))))) {
      summary = '';
    }
  }

  const skipTag =
    typeof meta.skip_type === 'string' && meta.skip_type.trim() ? meta.skip_type.trim() : '';

  return {
    id: base,
    outcome: section,
    outcomeLabel: OUTCOME_LABELS[section] || section,
    skipTag,
    title,
    sourceUrl: meta.source_url ?? '',
    dateUtc: meta.date_utc ?? null,
    reasonChosen,
    reasonSkipped,
    reasonFailed,
    summary
  };
}

function main() {
  const { maxNoOp, outDir } = parseArgs(process.argv);

  const rows = [];
  for (const section of EVOLUTION_SECTIONS) {
    const dir = join(repoRoot, 'doc', 'evolution', section);
    for (const abs of listMarkdownFiles(dir)) {
      const raw = readFileSync(abs, 'utf8');
      const { meta, body } = splitFrontmatter(raw);
      rows.push({ section, item: toRecord(section, abs, body, meta, repoRoot) });
    }
  }

  let items = rows.map((r) => r.item);
  if (Number.isFinite(maxNoOp)) {
    const noOpRows = rows.filter((r) => r.section === 'no-op');
    if (maxNoOp < noOpRows.length) {
      noOpRows.sort((a, b) => String(b.item.dateUtc || '').localeCompare(String(a.item.dateUtc || '')));
      const drop = new Set(noOpRows.slice(maxNoOp).map((r) => r.item.id));
      items = rows.filter((r) => r.section !== 'no-op' || !drop.has(r.item.id)).map((r) => r.item);
    }
  }

  items.sort((a, b) => String(b.dateUtc || '').localeCompare(String(a.dateUtc || '')));

  const payload = {
    generatedAt: new Date().toISOString(),
    items
  };

  const dataDir = join(outDir, 'data');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'evolution.json'), JSON.stringify(payload, null, 2), 'utf8');

  mkdirSync(outDir, { recursive: true });
  cpSync(STATIC_DIR, outDir, { recursive: true, force: true });

  console.log(
    `evolution-showcase: wrote ${items.length} items → ${join(dataDir, 'evolution.json')} + static → ${outDir}`
  );
}

main();
