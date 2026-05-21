#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadReleaseConfig } from './config.mjs';

const PHASES = ['learn','build','deploy_candidate','observe','fix','promote','rollback'];

export function createEmptyReport(releaseRunId, patch = {}) {
  const now = new Date().toISOString();
  return {
    release_run_id: releaseRunId,
    started_at: now,
    updated_at: now,
    phase: 'learn',
    inbox_items: [],
    candidate: { git_sha: '', image_tags: { daemon: '', web: '' } },
    gates: { g0: 'pending', g1: 'pending', g2: 'pending', g3: 'pending' },
    reviews: [],
    fix_loops: [],
    observation: { bake_started_at: '', e2e_url: '', anomalies: [] },
    outcome: 'in_progress',
    links: { orchestration_run: '', showcase: '' },
    events: [],
    ...patch
  };
}

export function reportPaths(repoRoot, releaseRunId) {
  const dir = join(repoRoot, 'doc', 'evolution', 'reports');
  return { dir, json: join(dir, `${releaseRunId}.json`), md: join(dir, `${releaseRunId}.md`) };
}

export function loadReport(repoRoot, releaseRunId) {
  const { json } = reportPaths(repoRoot, releaseRunId);
  if (!existsSync(json)) return null;
  return JSON.parse(readFileSync(json, 'utf8'));
}

export function saveReport(repoRoot, report) {
  const paths = reportPaths(repoRoot, report.release_run_id);
  mkdirSync(paths.dir, { recursive: true });
  report.updated_at = new Date().toISOString();
  writeFileSync(paths.json, JSON.stringify(report, null, 2) + '\n', 'utf8');
  writeFileSync(paths.md, reportToMarkdown(report), 'utf8');
  return paths;
}

export function appendReportEvent(report, type, detail = {}) {
  report.events = report.events ?? [];
  report.events.push({ at: new Date().toISOString(), type, ...detail });
  return report;
}

export function setGate(report, gate, status, detail) {
  report.gates = report.gates ?? {};
  report.gates[gate] = status;
  appendReportEvent(report, `gate_${gate}`, { status, detail });
  return report;
}

export function setPhase(report, phase) {
  if (!PHASES.includes(phase)) throw new Error(`Invalid phase: ${phase}`);
  report.phase = phase;
  appendReportEvent(report, 'phase', { phase });
  return report;
}

export function aggregateFromRunsJsonl(repoRoot, dateIso = new Date().toISOString().slice(0, 10)) {
  const path = join(repoRoot, 'doc', 'evolution', 'runs', `${dateIso}.jsonl`);
  if (!existsSync(path)) return { inbox_items: [], run_events: [] };
  const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
  const run_events = [];
  const inboxMap = new Map();
  for (const line of lines) {
    try {
      const ev = JSON.parse(line);
      run_events.push(ev);
      const title = ev.title ?? ev.source_title ?? ev.item_title ?? '';
      const key = title || ev.item_id || ev.run_id || String(run_events.length);
      if (!inboxMap.has(key)) {
        inboxMap.set(key, {
          title: title || key,
          capability_tags: ev.capability_tags ?? [],
          risk_level: ev.risk_level ?? 'unknown',
          status: ev.status ?? ev.type ?? ''
        });
      }
    } catch { /* skip */ }
  }
  return { inbox_items: [...inboxMap.values()], run_events };
}

export function listReports(repoRoot, limit = 20) {
  const dir = join(repoRoot, 'doc', 'evolution', 'reports');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        return { release_run_id: r.release_run_id, started_at: r.started_at, phase: r.phase, outcome: r.outcome, gates: r.gates };
      } catch {
        return { release_run_id: f.replace(/\.json$/, ''), error: true };
      }
    })
    .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))
    .slice(0, limit);
}

export function reportToMarkdown(report) {
  const cfg = loadReleaseConfig();
  const lines = [
    `# 进化发布报告 \`${report.release_run_id}\``,
    '',
    `- **阶段**: ${report.phase}`,
    `- **结果**: ${report.outcome}`,
    `- **开始**: ${report.started_at}`,
    `- **更新**: ${report.updated_at ?? ''}`,
    '',
    '## 门禁',
    '',
    '| 关卡 | 状态 |',
    '|------|------|',
    ...['g0', 'g1', 'g2', 'g3'].map((g) => `| ${g.toUpperCase()} | ${report.gates?.[g] ?? 'pending'} |`),
    '',
    '## Candidate',
    '',
    `- Git SHA: \`${report.candidate?.git_sha ?? ''}\``,
    `- Daemon 镜像: \`${report.candidate?.image_tags?.daemon ?? ''}\``,
    `- Web 镜像: \`${report.candidate?.image_tags?.web ?? ''}\``,
    '',
    '## Inbox 条目',
    ''
  ];
  if (!report.inbox_items?.length) lines.push('_（无）_');
  else for (const item of report.inbox_items) {
    lines.push(`- **${item.title}** — risk=${item.risk_level}, tags=${JSON.stringify(item.capability_tags ?? [])}`);
  }
  lines.push('', '## 修复循环', '');
  if (!report.fix_loops?.length) lines.push('_（无）_');
  else for (const f of report.fix_loops) {
    lines.push(`- 第 ${f.attempt} 轮: agent=${f.coding_agent}, tests=${f.tests}`);
  }
  lines.push('', '## 观测', '');
  lines.push(`- Bake 开始: ${report.observation?.bake_started_at || '—'}`);
  lines.push(`- E2E URL: ${report.observation?.e2e_url || cfg.candidateWebUrl || '—'}`);
  if (report.observation?.anomalies?.length) {
    lines.push('', '### 异常', '');
    for (const a of report.observation.anomalies) lines.push(`- ${a}`);
  }
  lines.push('', '## 事件时间线', '');
  for (const ev of report.events ?? []) {
    lines.push(`- \`${ev.at}\` **${ev.type}** ${ev.detail ? JSON.stringify(ev.detail) : ''}`);
  }
  lines.push('');
  return lines.join('\n');
}
