# 测试与能力矩阵

迭代时对照下表补充/更新用例，避免功能静默回归。

## 命令一览

| 命令 | 说明 |
|------|------|
| `npm run build` | TypeScript 构建 |
| `npm run test:unit` | Core / capability-gateway 单元测试 |
| `npm run test:regression` | 临时 daemon + HTTP 黑盒（heuristic，无密钥） |
| `npm run test:e2e` | 启动临时 daemon + Playwright 浏览器用例 |
| `npm run test:e2e:install` | 安装 Playwright 浏览器（CI / 新机器） |
| `npm run test:remote` | 真模型进程内冒烟（`heuristic` 时跳过；需 env） |
| `npm run ci` | `build` + `unit` + `regression` + `e2e` |

### `.env` 与真模型：分工

| 脚本 | 作用 | 是否读 `.env` |
|------|------|----------------|
| `npm run test:remote` | **进程内** `RawAgentRuntime` 一次会话，校验远程适配器能返回含 `OK` 的回复 | 否；需你在 shell 里 export 变量 |
| `npm run test:e2e` | **HTTP + 浏览器**：默认自启 daemon，`heuristic` | 否；透传当前 shell 的 `RAW_AGENT_*`（若你设了则覆盖 heuristic） |

**推荐本地加载 `.env`（勿提交密钥）：**

```bash
set -a && source .env && set +a   # bash/zsh
npm run test:remote                 # 真模型适配器冒烟
```

对 **Playwright**：若希望 E2E 连已运行的 daemon（且该进程已由 `.env` 拉起）：

```bash
set -a && source .env && set +a
export PLAYWRIGHT_BASE_URL='http://127.0.0.1:7070'
node scripts/e2e-run.mjs   # 检测到 PLAYWRIGHT_BASE_URL 时不再自启临时 daemon，直接跑 test
```

若 `PLAYWRIGHT_BASE_URL` 已设置但 daemon 未启动，用例会失败。

仓库默认 **CI 不加载 `.env`**：`test:regression` / `test:e2e` 使用 `heuristic`。

## 能力矩阵 ↔ 自动化

| 能力 | `test:regression` | `test:e2e` | `test:unit` | 备注 |
|------|-------------------|------------|---------------|------|
| `/api/health`、`/api/version` | ✓ | — | 部分 | |
| `POST /api/chat` | ✓ | — | | |
| `GET /api/sessions` | ✓ | — | | |
| `GET /api/sessions/:id` + `messages` | ✓ | — | | |
| `POST /api/sessions/:id/messages` | ✓ | — | | |
| `POST /api/chat/stream`（首块 SSE） | ✓ | — | | |
| 非法 JSON → 400 | ✓ | — | | |
| Task 创建 + `run` | ✓ | — | | |
| `POST /api/scheduler/run` | ✓ | — | | |
| `GET /api/agents` | ✓ | — | | |
| `GET /api/mailbox/all` | ✓ | — | | |
| `GET /api/traces` 无 session → 400 | ✓ | — | | |
| 静态目录穿越 → 404 | ✓ | — | | |
| 未知 API → 404 | ✓ | — | | |
| 静态首页 `/`（Agent Lab HTML） | ✓ | ✓ `lab.smoke` | | |
| 控制台 Tab 切换 | — | ✓ | | |
| Playground 发送消息（启发式） | — | ✓ | | |
| 运行时 / session 循环 | — | — | ✓ `runtime.test.js` 等 | |
| 飞书 Gateway 解析 | — | — | ✓ `feishu-parse` | 不设 mock 不进 HTTP E2E |

## Playwright 规格文件

| 文件 | 内容 |
|------|------|
| [`e2e/lab.smoke.spec.ts`](../e2e/lab.smoke.spec.ts) | 首页、Tab、Playground 发送 |

## PR 约定建议

- 新增或修改 **HTTP 行为**：在 [`scripts/regression-test.mjs`](../scripts/regression-test.mjs) 增加断言。
- 新增或修改 **控制台交互**：在 `e2e/` 增加或更新用例。
- 复杂业务逻辑：继续用 **单元测试** 优先。
