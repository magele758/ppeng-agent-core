#!/usr/bin/env node
/**
 * 可选「真模型」冒烟：需配置 OpenAI 兼容或 Anthropic 兼容环境变量。
 * CI 中仅在配置了对应 Secrets 时运行。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawAgentRuntime } from '../packages/core/dist/runtime.js';

/** 未设置时跳过（避免本地误跑）；CI 里会显式设为 openai-compatible / anthropic-compatible */
const provider = process.env.RAW_AGENT_MODEL_PROVIDER ?? 'heuristic';

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`Missing ${name} for remote smoke (${provider})`);
  }
  return v;
}

async function main() {
  if (provider === 'heuristic') {
    console.log('remote-smoke: skip (RAW_AGENT_MODEL_PROVIDER=heuristic)');
    return;
  }

  if (provider === 'anthropic-compatible') {
    requireEnv('RAW_AGENT_API_KEY');
    requireEnv('RAW_AGENT_MODEL_NAME');
    requireEnv('RAW_AGENT_ANTHROPIC_URL');
  } else {
    requireEnv('RAW_AGENT_API_KEY');
    requireEnv('RAW_AGENT_MODEL_NAME');
    requireEnv('RAW_AGENT_BASE_URL');
  }

  const repoRoot = mkdtempSync(join(tmpdir(), 'ppeng-remote-repo-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'ppeng-remote-state-'));

  const runtime = new RawAgentRuntime({ repoRoot, stateDir });
  const session = runtime.createChatSession({
    title: 'CI remote smoke',
    message: 'Reply with exactly the two letters OK and nothing else.'
  });

  await runtime.runSession(session.id);
  const text = runtime.getLatestAssistantText(session.id) ?? '';

  if (!text.includes('OK')) {
    console.error('remote-smoke: expected assistant to contain OK, got:', text.slice(0, 500));
    process.exit(1);
  }

  console.log('remote-smoke: OK (adapter:', runtime.modelAdapter.name + ')');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
