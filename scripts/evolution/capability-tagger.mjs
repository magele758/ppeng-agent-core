#!/usr/bin/env node
/**
 * Rule-based capability tagger for evolution inbox items.
 * Pure regex — no model required.
 *
 * Supported tags:
 *   runtime, web-console, evolution, domain-agents, security, cost-capacity,
 *   contracts, deployment, agent-quality, memory, multi-user, deepresearch,
 *   swarm, skills, subagent
 *
 * CLI:
 *   node capability-tagger.mjs --title "K8s Helm deployment"
 *   node capability-tagger.mjs --json '{"title":"...","url":"...","summary":"..."}'
 */
import { fileURLToPath } from 'node:url';

/**
 * Tag an inbox item based on title, URL, and summary.
 * Case-insensitive; multiple tags possible.
 *
 * @param {{ title?: string, url?: string, summary?: string }} item
 * @returns {string[]} capability tags
 */
export function tagCapabilities(item) {
  const title   = String(item?.title   ?? '');
  const url     = String(item?.url     ?? '');
  const summary = String(item?.summary ?? '');
  const text    = `${title} ${url} ${summary}`;
  const tagSet  = new Set();

  // Compound rule: arxiv.org URL + cs.CR in title → security
  if (/arxiv\.org/i.test(url) && /cs\.CR/.test(title)) {
    tagSet.add('security');
  }

  const add = (re, tag) => { if (re.test(text)) tagSet.add(tag); };

  add(/k8s|kubernetes|helm|docker|container|deploy/i,             'deployment');
  add(/security|vulnerability|cve|exploit|pentest|rbac|auth(?!or)/i, 'security');
  add(/memory|recall|retrieval|embedding|vector|rag/i,            'memory');
  add(/multi.?user|tenant|acl|permission/i,                       'multi-user');
  add(/research|arxiv|paper|survey|literature/i,                  'deepresearch');
  add(/swarm|multi.?agent|team|coordinator|orchestrat/i,          'swarm');
  add(/skill|tool.?call|function.?call|tool.?use/i,               'skills');
  add(/subagent|spawn|delegate|sub.?agent/i,                      'subagent');
  add(/evolution|self.?improv|self.?heal|continuous.?learn/i,     'evolution');
  add(/web|ui|ux|frontend|next\.?js|react|console|dashboard/i,   'web-console');
  add(/cost|budget|token|billing|latency|throughput|capacity/i,   'cost-capacity');
  add(/contract|api.?schema|openapi|mcp|sse|webhook/i,            'contracts');
  add(/domain.?agent|sre|stock/i,                                 'domain-agents');
  add(/runtime|session|daemon|agent.?loop/i,                      'runtime');

  return [...tagSet];
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let item = { title: '', url: '', summary: '' };
  let jsonInput = false;

  for (let i = 0; i < args.length; i++) {
    const a    = args[i];
    const next = args[i + 1];
    if      (a === '--title'   && next !== undefined) { item.title   = next; i++; }
    else if (a === '--url'     && next !== undefined) { item.url     = next; i++; }
    else if (a === '--summary' && next !== undefined) { item.summary = next; i++; }
    else if (a === '--json'    && next !== undefined) {
      try   { item = JSON.parse(next); }
      catch (e) { console.error(`capability-tagger: JSON parse error: ${e.message}`); process.exitCode = 1; }
      jsonInput = true;
      i++;
    }
  }

  if (!process.exitCode) {
    const tags = tagCapabilities(item);
    if (jsonInput) {
      console.log(JSON.stringify(tags));
    } else {
      console.log(tags.length > 0 ? tags.join('\n') : '(no tags)');
    }
  }
}
