/**
 * PM2：定时或手动触发 evolution 夜间管线（见 scripts/evolution-nightly-wrap.sh）。
 *
 * 依赖：npm i -g pm2
 * 启动：npm run evolution:pm2:start
 * 仅当次触发（无 cron）：EVOLUTION_PM2_CRON= npm run evolution:pm2:start
 *
 * 调度表达式：在 .env 中设 EVOLUTION_PM2_CRON（标准 5 段 cron），或启动前 export。
 * 修改 .env 后需 `npm run evolution:pm2:restart` 才会更新 cron_restart。
 */
const path = require('path');
const root = __dirname;

try {
  require('dotenv').config({ path: path.join(root, '.env') });
} catch (_) {
  /* optional dep resolution when pm2 cwd 异常 */
}

const cronRaw = process.env.EVOLUTION_PM2_CRON;
const cron = cronRaw != null ? String(cronRaw).trim() : '30 6 * * *';

const app = {
  name: 'evolution-nightly',
  cwd: root,
  script: 'bash',
  args: ['scripts/evolution-nightly-wrap.sh'],
  autorestart: false,
  time: true,
};

if (cron) {
  app.cron_restart = cron;
}

module.exports = { apps: [app] };
