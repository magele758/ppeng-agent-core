#!/usr/bin/env node
/**
 * 部署冒烟（黑盒）：对已运行的 daemon + Lab 控制台跑 readiness / 鉴权 / 页面 / 代理 / 对话 / SSE。
 * 用于 docker-nightly 推镜像前、release-orchestrator 部署 Candidate 后，也可手动对任意环境跑。
 *
 *   node scripts/deploy-smoke.mjs --daemon-url http://127.0.0.1:37070 --web-url http://127.0.0.1:33815 --token "$TOKEN"
 *
 * stdout 为 JSON 摘要，stderr 为人读摘要；设置了 GITHUB_STEP_SUMMARY 时追加 Markdown 表格。
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  SMOKE_USAGE,
  formatHuman,
  formatMarkdown,
  parseSmokeArgs,
  runDeploySmoke
} from './lib/deploy-smoke-lib.mjs';

async function main() {
  const { options, errors, help } = parseSmokeArgs(process.argv.slice(2), process.env);
  if (help) {
    console.log(SMOKE_USAGE);
    return 0;
  }
  if (errors.length) {
    console.error(`deploy-smoke: ${errors.join('; ')}\n\n${SMOKE_USAGE}`);
    return 2;
  }

  const summary = await runDeploySmoke(options);
  const json = JSON.stringify(summary, null, 2);
  console.error(formatHuman(summary));
  console.log(json);
  if (options.jsonOut) {
    mkdirSync(dirname(options.jsonOut), { recursive: true });
    writeFileSync(options.jsonOut, `${json}\n`, 'utf8');
  }
  const stepSummary = process.env.GITHUB_STEP_SUMMARY?.trim();
  if (stepSummary) appendFileSync(stepSummary, formatMarkdown(summary));
  return summary.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
