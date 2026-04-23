#!/usr/bin/env node
/**
 * Lightweight agent eval: run cases against a running daemon, optional LLM judge.
 *
 * Usage:
 *   AGENT_EVAL_BASE_URL=http://127.0.0.1:7070 node scripts/agent-eval.mjs
 *   AGENT_EVAL_CASES=scripts/agent-eval/sample-cases.json node scripts/agent-eval.mjs
 *
 * Judge (optional): set AGENT_EVAL_JUDGE_URL + AGENT_EVAL_JUDGE_KEY + AGENT_EVAL_JUDGE_MODEL
 * for OpenAI-compatible /chat/completions; otherwise only expectSubstring checks run.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = (process.env.AGENT_EVAL_BASE_URL ?? 'http://127.0.0.1:7070').replace(/\/$/, '');
const defaultCases = join(dirname(fileURLToPath(import.meta.url)), 'agent-eval', 'sample-cases.json');
const casesPath = process.env.AGENT_EVAL_CASES ?? defaultCases;
const judgeUrl = process.env.AGENT_EVAL_JUDGE_URL?.trim();
const judgeKey = process.env.AGENT_EVAL_JUDGE_KEY?.trim();
const judgeModel = process.env.AGENT_EVAL_JUDGE_MODEL?.trim();

async function chatOnce(prompt, agentId) {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: prompt,
      title: 'eval',
      agentId: agentId || 'general',
      autoRun: true,
      background: false
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`chat HTTP ${res.status}: ${text.slice(0, 400)}`);
  const data = JSON.parse(text);
  const messages = data.messages ?? [];
  const last = messages.filter((m) => m.role === 'assistant').pop();
  const parts = last?.parts ?? [];
  const out = parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim();
  return { sessionId: data.session?.id, output: out || String(data.latestAssistant ?? '') };
}

async function llmJudge(caseRow, output) {
  if (!judgeUrl || !judgeKey || !judgeModel) return null;
  const sys =
    'You score agent outputs for eval. Reply with JSON only: {"score":1-5,"reason":"one sentence"}';
  const user = `Task:\n${caseRow.prompt}\n\nAgent output:\n${output.slice(0, 8000)}`;
  const res = await fetch(`${judgeUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${judgeKey}`
    },
    body: JSON.stringify({
      model: judgeModel,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ],
      temperature: 0
    })
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`judge HTTP ${res.status}: ${raw.slice(0, 300)}`);
  const parsed = JSON.parse(raw);
  const content = parsed.choices?.[0]?.message?.content?.trim() ?? '';
  try {
    return JSON.parse(content);
  } catch {
    return { score: null, reason: content };
  }
}

const cases = JSON.parse(readFileSync(casesPath, 'utf8'));
if (!Array.isArray(cases)) {
  console.error('cases file must be a JSON array');
  process.exit(1);
}

let failed = 0;
for (const c of cases) {
  const id = String(c.id ?? 'case');
  process.stdout.write(`— ${id} … `);
  try {
    const { output } = await chatOnce(String(c.prompt ?? ''), c.agentId);
    let ok = true;
    if (c.expectSubstring && !output.includes(String(c.expectSubstring))) {
      ok = false;
    }
    const judge = await llmJudge(c, output).catch(() => null);
    if (judge && typeof judge.score === 'number' && judge.score < 3) {
      ok = false;
    }
    if (!ok) {
      failed += 1;
      console.log('FAIL');
      console.log(output.slice(0, 500));
      if (judge) console.log('judge:', judge);
    } else {
      console.log('ok' + (judge ? ` (judge ${judge.score})` : ''));
    }
  } catch (e) {
    failed += 1;
    console.log('ERROR', e instanceof Error ? e.message : e);
  }
}

process.exit(failed > 0 ? 1 : 0);
