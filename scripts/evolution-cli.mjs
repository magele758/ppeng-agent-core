#!/usr/bin/env node
/**
 * 统一 Evolution 管线入口。
 *
 * 用法：node scripts/evolution-cli.mjs [options]
 *   或：npm run evolution -- [options]
 *
 * 选项：
 *   --learn                  先执行 learn（拉 RSS → inbox）
 *   --learn-only             仅执行 learn，不跑 run-day
 *   --pipeline-build         learn 前先编译 capability-gateway（等价于旧 evolution:pipeline）
 *   --agent <cli>            实现 agent：cursor | claude | codex | full | multi（默认 claude）
 *   --model <name>           cursor agent 模型（默认 composer-2-fast）
 *   --review <cli>           review agent：cursor | codex | none（默认 none）
 *   --review-model <name>    review 模型（仅 cursor review，默认与 --model 相同）
 *   --concurrency <n>        并发 worktree 数（默认 3，上限 5）
 *   --items <n>              最多处理 inbox 条目数（不设 = 全部）
 *   --merge                  测试通过后自动合并到目标分支
 *   --target-branch <b>      合并目标分支（默认 main）
 *   --skip-rebase            跳过测试后 rebase（不推荐）
 *   -h, --help               打印此帮助
 *
 * 示例：
 *   npm run evolution -- --learn --agent cursor --review codex
 *   npm run evolution -- --learn --agent claude
 *   npm run evolution -- --learn --agent cursor --model claude-opus-4-7-thinking-max --review cursor
 *   npm run evolution -- --pipeline-build --learn --agent cursor --review codex --concurrency 5 --merge
 *   npm run evolution -- --learn-only
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dir, '..');
loadDotenv({ path: join(repoRoot, '.env') });

// ── arg parsing ──────────────────────────────────────────────────────────────

const HELP = `
Usage: npm run evolution -- [options]

  --learn                  先执行 learn（拉 RSS → inbox）
  --learn-only             仅执行 learn，不跑 run-day
  --pipeline-build         learn 前先编译 capability-gateway
  --agent <cli>            实现 agent: cursor | claude | codex | full | multi  (默认 claude)
  --model <name>           cursor agent 模型 (默认 composer-2-fast)
  --review <cli>           review agent: cursor | codex | none  (默认 none)
  --review-model <name>    review 模型，仅 cursor review 时 (默认同 --model)
  --concurrency <n>        并发数 (默认 3，上限 5)
  --items <n>              最多处理 inbox 条目数
  --merge                  自动合并到目标分支
  --target-branch <b>      合并目标分支 (默认 main)
  --skip-rebase            跳过 rebase 步骤
  -h, --help               打印此帮助

Examples:
  npm run evolution -- --learn --agent cursor --review codex
  npm run evolution -- --learn --agent claude
  npm run evolution -- --pipeline-build --learn --agent cursor --model claude-opus-4-7-thinking-max --review cursor --concurrency 5 --merge
  npm run evolution -- --learn-only
`.trim();

const VALID_AGENTS  = new Set(['cursor', 'claude', 'codex', 'full', 'multi']);
const VALID_REVIEWS = new Set(['cursor', 'codex', 'none']);

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    learn: false,
    learnOnly: false,
    pipelineBuild: false,
    agent: 'claude',
    model: 'composer-2-fast',
    review: 'none',
    reviewModel: null,
    concurrency: null,
    items: null,
    merge: false,
    targetBranch: null,
    skipRebase: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => {
      if (i + 1 >= args.length) { console.error(`error: ${a} 需要一个值`); process.exit(1); }
      return args[++i];
    };
    switch (a) {
      case '--learn':          opts.learn = true; break;
      case '--learn-only':     opts.learnOnly = true; opts.learn = true; break;
      case '--pipeline-build': opts.pipelineBuild = true; break;
      case '--merge':          opts.merge = true; break;
      case '--skip-rebase':    opts.skipRebase = true; break;
      case '-h': case '--help': console.log(HELP); process.exit(0); break;
      case '--agent': {
        const v = next();
        if (!VALID_AGENTS.has(v)) { console.error(`error: --agent 须为 ${[...VALID_AGENTS].join('|')}`); process.exit(1); }
        opts.agent = v;
        break;
      }
      case '--model':         opts.model = next(); break;
      case '--review': {
        const v = next();
        if (!VALID_REVIEWS.has(v)) { console.error(`error: --review 须为 ${[...VALID_REVIEWS].join('|')}`); process.exit(1); }
        opts.review = v;
        break;
      }
      case '--review-model':   opts.reviewModel = next(); break;
      case '--concurrency': {
        const n = parseInt(next(), 10);
        if (isNaN(n) || n < 1 || n > 5) { console.error('error: --concurrency 须为 1~5'); process.exit(1); }
        opts.concurrency = n;
        break;
      }
      case '--items': {
        const n = parseInt(next(), 10);
        if (isNaN(n) || n < 1) { console.error('error: --items 须为正整数'); process.exit(1); }
        opts.items = n;
        break;
      }
      case '--target-branch': opts.targetBranch = next(); break;
      default:
        console.error(`error: 未知参数 ${a}，运行 --help 查看帮助`);
        process.exit(1);
    }
  }
  return opts;
}

// ── env builder ──────────────────────────────────────────────────────────────

const SCRIPTS = join(repoRoot, 'scripts');

function buildEnv(opts) {
  const env = { ...process.env };

  // agent
  const agentScripts = {
    cursor: `bash ${SCRIPTS}/evolution-agent-cursor.sh`,
    claude: `bash ${SCRIPTS}/evolution-agent-claude.sh`,
    codex:  `bash ${SCRIPTS}/evolution-agent-codex.sh`,
    full:   `bash ${SCRIPTS}/evolution-agent-full.sh`,
    multi:  `bash ${SCRIPTS}/evolution-agent-multi.sh`,
  };
  env.EVOLUTION_AGENT_CMD = agentScripts[opts.agent];

  // cursor agent: 跳过 plan（cursor 自己规划），用 cursor 做研究
  if (opts.agent === 'cursor') {
    env.EVOLUTION_SKIP_PLAN = '1';
    env.EVOLUTION_RESEARCH_CMD = `bash ${SCRIPTS}/evolution-research-cursor.sh`;
  }

  // model
  if (opts.agent === 'cursor' || opts.review === 'cursor') {
    env.EVOLUTION_CURSOR_AGENT_MODEL = opts.model;
    env.EVOLUTION_CURSOR_AGENT_REVIEW_MODEL = opts.reviewModel ?? opts.model;
  }

  // review
  if (opts.review === 'codex') {
    env.EVOLUTION_REVIEW_CMD  = `bash ${SCRIPTS}/evolution-codex-prompt.sh`;
    // refine 走实现 agent（review 不过则由同一 agent 精炼）
    env.EVOLUTION_REFINE_CMD  = agentScripts[opts.agent];
    env.EVOLUTION_REBASE_CONFLICT_CMD = `bash ${SCRIPTS}/evolution-rebase-conflict-codex.sh`;
  } else if (opts.review === 'cursor') {
    env.EVOLUTION_REVIEW_CMD  = `bash ${SCRIPTS}/evolution-agent-cursor.sh`;
    env.EVOLUTION_REFINE_CMD  = `bash ${SCRIPTS}/evolution-agent-cursor.sh`;
    env.EVOLUTION_REBASE_CONFLICT_CMD = `bash ${SCRIPTS}/evolution-agent-cursor.sh`;
  }
  // review === 'none': 不设，run-day 默认跳过 review

  // misc
  if (opts.concurrency) env.EVOLUTION_CONCURRENCY = String(opts.concurrency);
  if (opts.items)       env.EVOLUTION_MAX_ITEMS    = String(opts.items);
  if (opts.merge)       env.EVOLUTION_AUTO_MERGE   = '1';
  if (opts.targetBranch) env.EVOLUTION_TARGET_BRANCH = opts.targetBranch;
  if (opts.skipRebase)  env.EVOLUTION_SKIP_REBASE  = '1';

  return env;
}

// ── runner ───────────────────────────────────────────────────────────────────

function sh(cmd, env) {
  return new Promise((resolve, reject) => {
    console.log(`\n[evolution] ${cmd}`);
    const child = spawn('bash', ['-c', cmd], { cwd: repoRoot, env, stdio: 'inherit' });
    child.on('close', code => code === 0 ? resolve() : reject(Object.assign(new Error(`exit ${code}`), { code })));
  });
}

async function main() {
  const opts = parseArgs(process.argv);
  const env  = buildEnv(opts);

  // ── summary ─────────────────────────────────────────────────────────────
  const reviewLabel = opts.review === 'none' ? '(跳过)' : opts.review;
  const modelLabel  = (opts.agent === 'cursor' || opts.review === 'cursor')
    ? ` model=${opts.model}${opts.reviewModel && opts.reviewModel !== opts.model ? `/review=${opts.reviewModel}` : ''}`
    : '';
  console.log(`[evolution] 配置: agent=${opts.agent}${modelLabel} review=${reviewLabel} concurrency=${opts.concurrency ?? 3}${opts.merge ? ' auto-merge' : ''}`);

  // ── 1. optional build ────────────────────────────────────────────────────
  if (opts.pipelineBuild) {
    const buildCmd = process.env.EVOLUTION_PIPELINE_BUILD_CMD ?? 'npx tsc -b packages/capability-gateway';
    await sh(buildCmd, env);
  }

  // ── 2. learn ─────────────────────────────────────────────────────────────
  if (opts.learn) {
    await sh('node scripts/evolution-learn.mjs', env);
    if (opts.learnOnly) {
      console.log('[evolution] --learn-only 完成，退出。');
      return;
    }
  }

  // ── 3. run-day ───────────────────────────────────────────────────────────
  await sh('node scripts/evolution-run-day.mjs', env);
}

main().catch(err => {
  console.error('[evolution] 失败:', err.message);
  process.exit(err.code ?? 1);
});
