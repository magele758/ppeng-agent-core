# ppeng-agent-core 项目全面 Review

> 审查时间: 2026-04-03 ~ 08 | 代码库: ~15K 行 TS 源码 + 818 单元测试 + 3 E2E | 22 次改进提交

---

## 一、项目概览

这是一个**自研的多 Agent 运行时框架**，核心理念类似 Claude Code 的本地 daemon 模式。架构为：

```
┌─────────────────────────────────────────────────────────┐
│  Agent Lab (Next.js 15)  │    CLI    │  IM Gateway     │
├──────────────────────────┴──────────┴─────────────────┤
│                 HTTP Daemon (server.ts)                  │
├─────────────────────────────────────────────────────────┤
│           RawAgentRuntime (packages/core)                │
│  ┌──────────┬───────────┬──────────┬────────────────┐  │
│  │ Storage  │ Model     │ Tools    │ Self-Heal      │  │
│  │ (SQLite) │ Adapters  │ System   │ (git worktree) │  │
│  ├──────────┼───────────┼──────────┼────────────────┤  │
│  │ Skills   │ Workspaces│ Mailbox  │ Evolution      │  │
│  │ Router   │ (worktree)│ (Agents) │ Pipeline       │  │
│  └──────────┴───────────┴──────────┴────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Monorepo 结构**（npm workspaces）：
- `packages/core` — 运行时核心（runtime.ts 1574 行，已拆分 prompt-builder + self-heal-scheduler + McpManager + skill-matcher）
- `packages/capability-gateway` — IM 网关 + RSS 学习
- `apps/daemon` — HTTP 服务层（776 行）
- `apps/cli` — 命令行客户端（332 行）
- `apps/web-console` — Next.js 15 Agent Lab 前端

---

## 二、优秀的设计（Strengths）

### ✅ 1. 架构分层清晰，职责分明

**核心层（core）完全不依赖 HTTP**，daemon 只是薄包装。这意味着：
- 可轻松换 transport（WebSocket, gRPC）
- CLI 可直接调 daemon API，也可未来嵌入 core
- 测试可以绕过 HTTP 直接测 runtime

**评分：⭐⭐⭐⭐⭐**

### ✅ 2. 零外部运行时依赖的极简主义

整个项目**仅 4 个 runtime 依赖**：`@modelcontextprotocol/sdk`, `dotenv`, `vscode-jsonrpc`, `yaml`。
- 使用 Node.js 22 内置 `node:sqlite`，无需 `better-sqlite3`
- 使用 Node.js 内置 `node:test` 测试框架
- RSS 解析手写（无 xml2js）
- HTTP server 用 `node:http`（无 Express/Fastify）

这极大降低了依赖链的安全风险和维护成本。

**评分：⭐⭐⭐⭐⭐**

### ✅ 3. Self-Heal 自愈机制设计精巧

```
主仓 → git worktree → 跑白名单测试 → 失败 → Agent 修复 → 重测 → 可选合并 → 重启握手
```

- 隔离在 worktree 中，不影响主仓
- 支持 policy 配置（测试白名单、自动合并策略）
- supervisor.mjs 自动拉起崩溃的 daemon
- 与 daemon 有 restart-request 握手协议

这是工程上非常成熟的自动化修复设计。

**评分：⭐⭐⭐⭐⭐**

### ✅ 4. Evolution 管线——自动学习 + 代码演进

```
RSS 订阅 → inbox 收录 → worktree 隔离 → Agent 代码改进 → 构建测试 → 可选自动合并
```

- 5 路并发、互斥锁串行合并
- slug 追踪防重复
- 支持多种 Agent 后端（Claude、Codex、Gemini）
- 完整的观测 UI（`/evolution` 页面）

这是一个非常有前瞻性的"代码自进化"系统。

**评分：⭐⭐⭐⭐⭐**

### ✅ 5. Skill 系统设计灵活

- 仓库 `skills/` + 用户 `~/.agents/` 双源合并
- 支持 `legacy` / `hybrid` 两种路由模式
- 运行时动态 `load_skill` 按需加载
- 有 `strict` 模式限制只加载当轮 shortlist

**评分：⭐⭐⭐⭐**

### ✅ 6. 多 Agent 协作体系完整

- Mailbox 消息系统实现 Agent 间通信
- Teammate spawn 机制
- 审批（Approval）工作流
- TeamGraph SVG 可视化拓扑
- 背景任务 + 调度器

**评分：⭐⭐⭐⭐**

### ✅ 7. 安全意识到位

- Path traversal 防护（static serving + evolution API）
- DOMPurify 对 Markdown 渲染做 XSS 防护
- Body size limit 防 DoS
- Feishu 加密事件解密
- CORS 可配置白名单
- 审批策略 + 文件级策略加载
- TypeScript 零 `any` 使用（整个项目 0 处 `as any`）
- 零 TODO/FIXME/HACK 注释

**评分：⭐⭐⭐⭐⭐**

### ✅ 8. CI/CD 设计合理

- 每次 push/PR 跑 build → unit → regression → e2e
- 可选 remote model smoke（需 secrets）
- `heuristic` adapter 实现零密钥测试
- Playwright E2E 自动启停 daemon + Next
- Evolution 有 cron 调度示例

**评分：⭐⭐⭐⭐**

### ✅ 9. SSE 流式传输 + 乐观 UI

- 流式 token 输出体验好
- 用户消息立即上屏（乐观更新）
- 推理/工具调用折叠展开
- RAF 调度滚动，流畅无卡顿

**评分：⭐⭐⭐⭐**

### ✅ 10. 配置体系全面

- `.env.example` 有 9.5KB，覆盖约 50+ 配置项
- `gateway.config.json` 声明式渠道配置
- 多层级策略合并（env → file → repo policy）

**评分：⭐⭐⭐⭐**

---

## 三、可以改进的地方（Areas for Improvement）

### ⚠️ 1. runtime.ts 仍是最大文件（1574 行）——但已合理化

`RawAgentRuntime` 经过 3 轮拆分（SelfHealScheduler、PromptBuilder、McpManager），从 2465 行降至 1574 行。
每个方法已控制在 <100 行，剩余功能（tool execution ~314 行、background/subagent ~170 行、message management ~173 行）与 `this.store` 和回调函数深度耦合，进一步拆分反而会增加复杂度。

**当前评估**：作为中央协调器，1574 行在合理范围内。方法粒度良好。

**已完成的拆分**：
```
runtime.ts (1574 LOC) — 门面协调
├── model/prompt-builder.ts (200 LOC) — 系统 prompt 构建
├── self-heal/self-heal-scheduler.ts (350 LOC) — 自愈状态机
├── mcp/mcp-manager.ts (253 LOC) — MCP 连接管理
├── skills/skill-matcher.ts (765 LOC) — 技能评分/匹配
└── skills/skill-router.ts (357 LOC) — 技能路由编排
```

**影响：已解决** | **状态：✅ 完成**

### ⚠️ 2. AgentLabApp.tsx 过于庞大（1395 行）——**单组件承载全部 UI**

22 个 `useState` + 多个 `useRef` + 全部 5 个 tab 逻辑都在一个组件里：
- 没有使用状态管理库
- 没有自定义 Hook 抽取逻辑
- 没有按 tab/feature 拆分组件

**建议**：
```
components/
├── AgentLabApp.tsx          （布局壳 + tab 切换）
├── PlayPanel/               （聊天面板 + 流式逻辑）
├── OpsPanel/                （任务/审批/调度）
├── TeamsPanel/              （团队拓扑）
├── TracePanel/              （追踪事件）
├── hooks/
│   ├── useSessionRefresh.ts
│   ├── useStreamChat.ts
│   └── useScrollToBottom.ts
```

**影响：可维护性 / 可扩展性** | **优先级：高**

### ⚠️ 3. server.ts（776 行）——路由全在一个函数中

`handleApi()` 是一个 ~550 行的函数，包含所有 API 路由的分支逻辑。没有路由抽象。

**建议**：引入轻量路由分发或按领域拆分 handler：
```typescript
// 按领域拆分
const handlers = {
  sessions: handleSessionRoutes,
  tasks: handleTaskRoutes,
  selfHeal: handleSelfHealRoutes,
  agents: handleAgentRoutes,
  approvals: handleApprovalRoutes,
};
```

**影响：可读性 / 可维护性** | **优先级：中**

### ⚠️ 4. storage.ts（1622 行）——SQL 全部手写

每个 CRUD 都是手写 SQL，大量重复的行映射代码（`row.xxx as xxx`），缺乏：
- 类型安全的查询构建
- 自动行映射
- 迁移管理（目前是 `migrateSchema` 手动 ALTER TABLE + 重命名策略）

**建议**：
- 考虑 `drizzle-orm` 或 `kysely`——它们是零运行时依赖的类型安全 SQL builder
- 或至少抽取通用的 `mapRow<T>()` 和 `upsert<T>()` 工具函数
- 迁移管理用版本号 + 迁移脚本

**影响：可维护性 / 减少 bug** | **优先级：中**

### ⚠️ 5. 测试覆盖大幅提升，仍有提升空间

- 单元测试从 0 → **818 个**（46 个测试文件），覆盖核心运行时的绝大部分模块
- `capability-gateway` 仅 3 个测试文件
- `apps/daemon` 无单元测试（仅靠回归集成测试）
- `apps/cli` 无测试
- 前端 0 单元测试（仅 1 个 E2E 冒烟）
- 剩余测试缺口：`prompt-builder.ts` (~30%)、`tool-hooks.ts` (~40%)、`os-sandbox.ts execute()` 方法

**建议**：
- 补充 prompt-builder 的 `buildDynamicContext`/`buildSystemPrompt` 测试
- 为 gateway 的 IM handlers、channels、learn 补充单元测试
- 前端补充组件快照测试或 Vitest 单元测试
- 目标测试覆盖率 > 60%

**影响：可靠性** | **优先级：中**

### ⚠️ 6. 前端无状态管理 + 无 CSS 方案

- 22 个 `useState` + refs 手动同步，容易产生 stale closure
- CSS 放在 `legacy-vanilla/styles.css`（1702 行），与 Next.js App Router 不搭
- 没有 CSS Modules / Tailwind / CSS-in-JS
- 没有主题切换能力（硬编码暗色主题）

**建议**：
- 考虑 Zustand（极小，与极简主义风格匹配）
- CSS 迁移到 CSS Modules 或 Tailwind
- 把 `legacy-vanilla/` 真正清理掉

**影响：前端可维护性** | **优先级：中**

### ⚠️ 7. 错误处理不够结构化

- Error 类型没有统一的错误码体系
- `error instanceof Error ? error.message : String(error)` 重复出现 ~20 次
- 没有自定义 Error 类（如 `SessionNotFoundError`, `PayloadTooLargeError`）
- `console.error` 仅 4 处，大量错误可能被静默吞掉

**建议**：
```typescript
class AppError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}
class NotFoundError extends AppError { ... }
class ValidationError extends AppError { ... }
```

**影响：调试效率 / 可观测性** | **优先级：中**

### ⚠️ 8. 日志系统缺失

- 全部用 `console.log` / `console.error`
- 没有日志级别（debug/info/warn/error）
- 没有结构化日志（JSON 格式）
- 没有请求 ID 追踪
- 生产环境无法做日志采集和分析

**建议**：引入轻量 logger（可以是自写的 20 行 JSON logger，保持极简主义）

**影响：可观测性 / 生产运维** | **优先级：中**

---

## 四、不好的地方（Problems / Anti-patterns）

### ❌ 1. 编译产物提交到 Git

```
apps/daemon/dist/
apps/cli/dist/
packages/core/dist/   (可能)
```

`.gitignore` 中有 `dist/` 但如果曾被提交过，`git rm --cached` 才会停止跟踪。AGENTS.md 也提到了这个问题（关于 `skills/agent-tech-digest/SKILL.md`）。

**建议**：确认 dist/ 确实不在 git 中，如在则清理。

### ❌ 2. 根 `package.json` 混淆了 workspace root 和 package 的角色

```json
"dependencies": {
  "@modelcontextprotocol/sdk": "^1.29.0",
  "dotenv": "^17.3.1",
  "vscode-jsonrpc": "^8.2.1",
  "yaml": "^2.8.3"
}
```

这些依赖应放在实际使用它们的 workspace package 中（如 `packages/core`），而非根 `package.json`。根只应有 `devDependencies`（TypeScript、Playwright 等）。

**影响**：依赖归属不清，phantom dependency 风险。

### ~~❌ 3. `3d-running-horse.html` 在项目根目录~~ ✅ 已删除

### ~~❌ 4. gateway.config.json（含实际配置）不在 .gitignore 中~~ ✅ 已修复

`gateway.config.json` 已 `git rm --cached` 并加入 `.gitignore`，`.gitignore` 也已去重。

### ❌ 5. 缺乏 API 文档 / OpenAPI Spec

50+ 个 REST API 端点，全部在 `server.ts` 代码中，没有：
- OpenAPI / Swagger 文档
- API 类型共享（前端手写了 `types.ts`，与后端类型无同步机制）
- 请求/响应类型验证（无 Zod / AJV）

前后端类型不一致是潜在 bug 源头。

### ❌ 6. 前端手写 API fetch 无类型安全

`lib/api.ts` 返回 `Promise<unknown>`，所有调用处都是手动类型断言，无编译期保障。

### ~~❌ 7. Self-Heal 状态机逻辑嵌在 runtime.ts 中~~ ✅ 已提取

`SelfHealScheduler` 已提取为独立模块（`self-heal/self-heal-scheduler.ts`，350 LOC），runtime.ts 通过依赖注入委托。

---

## 五、代码质量指标汇总

| 指标 | 值 | 评价 |
|------|------|------|
| TypeScript 严格度 | 零 `any` | ⭐⭐⭐⭐⭐ |
| 代码注释 | 极少（代码自解释风格） | ⭐⭐⭐⭐ |
| TODO/FIXME/HACK | 0 处 | ⭐⭐⭐⭐⭐ |
| 依赖数量 | core 仅 1 prod dep (sharp) | ⭐⭐⭐⭐⭐ |
| 测试覆盖 | 818 tests / 46 files | ⭐⭐⭐⭐ |
| 最大文件行数 | 1574 行 (runtime.ts) | ⭐⭐⭐ |
| CI/CD | build→unit→regression→e2e | ⭐⭐⭐⭐ |
| 文档 | README + 8 docs + AGENTS.md | ⭐⭐⭐⭐ |
| 安全实践 | 完善（沙盒+审批+SSRF防护） | ⭐⭐⭐⭐⭐ |
| 错误处理一致性 | 6 个 AppError 子类贯穿全栈 | ⭐⭐⭐⭐⭐ |
| 目录组织 | 7 个域子目录 + 12 store 文件 | ⭐⭐⭐⭐ |

---

## 六、改进实施记录

> 以下改进已在 2026-04-03 ~ 05 期间通过 12 次提交完成，65+ 文件变更。

### ✅ 已完成的改进

| # | 原始建议 | 状态 | 提交 | 影响 |
|---|---------|------|------|------|
| 1 | 🔴 拆分 runtime.ts | ✅ 完成 | `6aad883` | 提取 SelfHealScheduler（350 行）、PromptBuilder（200 行），runtime 2465→1850 行（-25%） |
| 2 | 🔴 补充测试 | ✅ 完成 | 多次提交 | 0→405 单元测试 + 3 E2E；覆盖 errors/env/storage/runtime/prompt-builder/feed/learn/self-heal-scheduler/tool-orchestration/policy-loader/web-fetch/episodic-selection/skill-registry 等 |
| 3 | 🟡 拆分 AgentLabApp.tsx | ✅ 完成 | `6aad883` | 提取 PlayPanel/OpsPanel/TeamsPanel/TracePanel/MorePanel + usePlayChat hook，1395→423 行（-70%） |
| 4 | 🟡 建立错误类型体系 | ✅ 完成 | `6aad883`+`c00ccf1`+`fbb9811` | errors.ts（6 个 AppError 子类），server.ts 15 处 + runtime.ts 13 处全部整合 |
| 5 | 🟢 清理杂项 | ✅ 完成 | `fadf234` | 删 3d-running-horse.html、gitignore gateway.config.json |
| 6 | — 目录重构 | ✅ 完成 | `fadf234` | core/src 38 文件平铺→6 域子目录（tools/self-heal/model/skills/mcp/approval） |
| 7 | — DRY 改进 | ✅ 完成 | `03ffe43`+`254a747` | envInt/envBool 去重、createExternalCliTool 工厂、sortAgentsById 共享 |
| 8 | — 并发安全 | ✅ 完成 | `fbb9811` | session 级锁防重复执行、destroy() 清理 MCP/进程资源 |
| 9 | — 可靠性修复 | ✅ 完成 | `95b960f`+`967f7f9` | 确定性 idempotency hash（深层排序）、MCP 错误可见性、安全输入提取 |
| 10 | — 深度测试覆盖 | ✅ 完成 | `77e8c19` | +71 测试：self-heal 调度器状态机（35）、storage 边界用例（32+）、approval/bg-job/workspace/daemon-control |
| 11 | — 广度测试 + SSRF 修复 | ✅ 完成 | `430729c` | +88 测试：tool-orchestration(20)/policy-loader(27)/web-fetch(17)/episodic-selection(15)/skill-registry(16)；修复 IPv6 SSRF 绕过漏洞 |
| 12 | — 结构化日志 + API 类型共享 + storage 拆分 | ✅ 完成 | `94bdfcc` | logger.ts（零依赖、namespace 支持、level 过滤）替代 11 处 console 调用；api-types.ts 共享 Pick 类型到 web-console；session-memory-store.ts 提取（300 行，10 方法），storage.ts 1622→1382 行（-15%）+5 logger 测试 |
| 13 | — storage 深度拆分 + 新测试 | ✅ 完成 | `8b94e81` | storage-helpers.ts 集中 5 个工具函数；task-store.ts（196 LOC）+ self-heal-store.ts（185 LOC）提取；storage.ts 1382→1084 行（-22%）；+59 测试（trace/read-file-range/image-assets） |
| 14 | — storage 全面拆分 | ✅ 完成 | `accae6b` | mail-store(103)/approval-store(107)/background-job-store(81)/misc-store(145) 提取；approval 内联映射 DRY 为 mapApprovalRow；storage.ts 1084→802 行（累计 -51%） |

| 15 | — 二次拆分 + 深度测试 | ✅ 完成 | `fb77c6c`~`a730c70` | 文件整理（sandbox/model/stores 子目录迁移）；McpManager 提取（253 LOC）；skill-router → skill-matcher(765) + router(357)；runtime.ts 1850→1574 行（-15%）；+349 测试（runtime-helpers 37 / runtime-integration 28 / mcp-manager 15 / external-ai-tools 36 / image-assets +14 / otel 8 / cognitive-state +27 / tool-hooks +10 / episodic-selection +21 / prompt-builder +33 / policy-loader +14 + prompt-builder 修复） |

### 当前代码指标

| 指标 | 改进前 | 改进后 |
|------|--------|--------|
| runtime.ts 行数 | 2,465 | 1,574 (-36%) |
| AgentLabApp.tsx 行数 | 1,395 | 423 |
| 单元测试数 | 0 | **921** |
| E2E 测试数 | 3 | 3（全部通过） |
| core/src 子目录数 | 0（全平铺） | 7（tools/self-heal/model/skills/mcp/approval/stores/sandbox） |
| 错误类型 | 无（泛 Error） | 6 个 AppError 子类 |
| storage.ts 行数 | 1,622 | 802（-51%，12 个 domain store 提取） |
| 结构化日志 | 无（console.*） | logger.ts（namespace + level 过滤） |
| API 类型共享 | 手动重复 | api-types.ts Pick 投影 |
| skill-router.ts | 1,097 行单文件 | matcher(765) + router(357) |
| MCP 管理 | 嵌在 runtime | mcp-manager.ts (253 LOC) 独立模块 |

### 🔮 后续可考虑的改进

| 优先级 | 建议 | 说明 |
|--------|------|------|
| 🟡 | 前端测试 | web-console 零单元测试；可用 Vitest + React Testing Library |
| 🟡 | gateway 测试补充 | IM handlers、channels、learn 模块仅 3 个测试文件 |
| 🟡 | daemon 集成测试 | 路由逻辑无单元测试，仅靠 E2E 覆盖 |
| 🟡 | session+message store 拆分 | storage.ts 剩余 ~800 行中约 150 行，注意 appendMessage 耦合 |
| 🟢 | 沙盒隔离方案 | 详见 `doc/sandbox-technology-research.md`，推荐 Docker + --experimental-permission |
| 🟢 | OpenAPI Spec | 50+ REST API 端点无文档/类型验证 |
| 🟢 | CSS 方案升级 | legacy CSS 应迁移到 CSS Modules 或 Tailwind |

---

## 七、最终评价

### 优势定位
这个项目在**架构理念和工程品味**上表现出色。零依赖极简主义、Self-Heal 自愈、Evolution 自进化管线这三个特色功能展现了深厚的工程功底和前瞻性思维。代码质量高（零 any cast、零 TODO），安全意识到位。

### 改进后的状态
经过 22 次迭代提交，项目已显著改善：
- **runtime.ts** 从 2465 行降至 1574 行（-36%），拆出 5 个子模块
- **测试覆盖**从零到 **921 个**，46 个测试文件覆盖核心路径、状态机、存储边界、安全策略、SSRF 防护、日志系统、MCP 管理、外部 AI 工具、图片资产、OpenTelemetry、认知状态、情景记忆、工具钩子、审批策略加载
- **结构化错误体系**贯穿全栈，从 runtime 到 HTTP 层一致
- **目录结构**清晰反映领域边界（7 个域子目录 + 12 个 store 文件）
- **并发安全**保障 session 不被重复执行
- **资源管理**有明确的 destroy() 生命周期

### 剩余改进空间
- 前端测试（web-console 零单元测试）
- capability-gateway 仅 3 个测试文件
- daemon/cli 无单元测试
- os-sandbox `execute()` 方法未测试（需平台特定工具）
- prompt-builder `buildDynamicContext` 测试中的 store mock 可更精细化

### 总评

> **一个有极强工程品味的项目，具备独特的自愈和自进化能力。经过 22 次迭代提交，代码结构、错误处理、测试覆盖、并发安全、可观测性和类型共享都有了质的提升。921 个单元测试全面覆盖运行时、调度器状态机、存储层、安全策略（approval/SSRF）、技能系统、工具编排、情景记忆压缩、日志系统、MCP 管理、外部 AI 工具集成、图片资产处理、OpenTelemetry 链路追踪等。主要技术债务已清理，核心模块拆分到位（runtime -36%、storage -51%），剩余改进属于锦上添花。**
