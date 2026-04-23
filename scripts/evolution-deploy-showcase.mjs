#!/usr/bin/env node
/**
 * 手动：构建展示站并同步到 EVOLUTION_SHOWCASE_DEPLOY_DIR（不要求 EVOLUTION_SHOWCASE_AUTO_DEPLOY）。
 * 用法：npm run evolution:showcase-deploy
 */
import { deployShowcase } from './evolution/showcase-deploy.mjs';

const trace = (msg) => console.log(`evolution-showcase-deploy: ${msg}`);

deployShowcase({ trace, manual: true })
  .then((r) => {
    if (r?.ok === false && r?.skipped === 'no_deploy_dir') {
      console.error('evolution-showcase-deploy: 请设置 EVOLUTION_SHOWCASE_DEPLOY_DIR');
      process.exitCode = 1;
    } else if (r?.ok === false && ['bad_dir', 'not_git', 'build_failed', 'no_dist', 'git_add', 'git_commit', 'git_push'].includes(r.skipped)) {
      process.exitCode = 1;
    }
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
