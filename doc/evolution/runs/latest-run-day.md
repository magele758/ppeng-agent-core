# evolution-run-day 最近一次

[2026-03-30T17:02:40.859Z] 启动
[2026-03-30T17:02:40.860Z] inbox: /Users/penglei/developer/self-test-grounding/ppeng-agent-core/doc/evolution/inbox/2026-03-30.md
[2026-03-30T17:02:40.860Z] 解析: inbox 内共 148 条链接，本跑取前 3 条（EVOLUTION_MAX_ITEMS=3）
[2026-03-30T17:02:40.861Z] 策略: 目标分支=main, 测试=npm run test:unit, npm ci=执行, 自动合并=否
[2026-03-30T17:02:40.861Z] 说明：每条会先抓取来源 URL 的正文摘录（供对照）；验证阶段在本仓库独立 worktree 跑白名单测试，不克隆外链仓库。
[2026-03-30T17:02:40.861Z] 并发: 3（EVOLUTION_CONCURRENCY，上限 3）
[2026-03-30T17:02:40.862Z] [1/3] ━━ 开始 ━━
[2026-03-30T17:02:40.862Z] [1/3] 标题: Show HN: ClamBot – AI agent that runs all LLM-generated code in a WASM sandbox
[2026-03-30T17:02:40.862Z] [1/3] 链接: https://github.com/clamguy/clambot
[2026-03-30T17:02:40.880Z] [2/3] ━━ 开始 ━━
[2026-03-30T17:02:40.880Z] [2/3] 标题: MCP Registry – Open-source discovery layer for 20 Model Context Protocol servers
[2026-03-30T17:02:40.880Z] [2/3] 链接: https://github.com/SirhanMacx/mcp-registry
[2026-03-30T17:02:40.881Z] [3/3] ━━ 开始 ━━
[2026-03-30T17:02:40.881Z] [3/3] 标题: The MCP Ecosystem: How Model Context Protocol Is Becoming the HTTP of AI Agents
[2026-03-30T17:02:40.881Z] [3/3] 链接: https://primitivesai.substack.com/p/the-mcp-ecosystem-how-a-protocol
[2026-03-30T17:02:41.674Z] [3/3] 来源正文抓取失败或为空: fetch failed（793ms）
[2026-03-30T17:02:41.674Z] [3/3] slug=the-mcp-ecosystem-how-model-context--ced87e27 → 分支 exp/evolution-2026-03-30-the-mcp-ecosystem-how-model-context--ced87e27，worktree /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-the-mcp-ecosystem-how-model-context--ced87e27
[2026-03-30T17:02:41.745Z] [3/3] 清理旧 worktree/分支 (71ms)
[2026-03-30T17:02:41.806Z] [3/3] git worktree add → exit=0 (61ms)
[2026-03-30T17:02:42.414Z] [1/3] 来源正文已抓取 14000 字（1552ms）
[2026-03-30T17:02:42.414Z] [1/3] slug=show-hn-clambot-ai-agent-that-runs-a-85987e11 → 分支 exp/evolution-2026-03-30-show-hn-clambot-ai-agent-that-runs-a-85987e11，worktree /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-show-hn-clambot-ai-agent-that-runs-a-85987e11
[2026-03-30T17:02:42.486Z] [1/3] 清理旧 worktree/分支 (72ms)
[2026-03-30T17:02:42.575Z] [1/3] git worktree add → exit=0 (89ms)
[2026-03-30T17:02:42.786Z] [2/3] 来源正文已抓取 5778 字（1906ms）
[2026-03-30T17:02:42.786Z] [2/3] slug=mcp-registry-open-source-discovery-l-d215b555 → 分支 exp/evolution-2026-03-30-mcp-registry-open-source-discovery-l-d215b555，worktree /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555
[2026-03-30T17:02:42.831Z] [2/3] 清理旧 worktree/分支 (45ms)
[2026-03-30T17:02:42.887Z] [2/3] git worktree add → exit=0 (56ms)
[2026-03-30T17:02:49.024Z] [3/3] npm ci → exit=0 (7218ms)
[2026-03-30T17:02:49.100Z] [2/3] npm ci → exit=0 (6213ms)
[2026-03-30T17:02:49.270Z] [1/3] npm ci → exit=0 (6695ms)
[2026-03-30T17:02:49.683Z] [2/3] 测试命令「npm run test:unit」→ exit=1 (583ms)
[2026-03-30T17:02:49.683Z] [2/3] 测试失败摘录:
…(截断)…
er/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/dist/self-heal-policy.js'
# }
# Node.js v22.21.1
# Subtest: packages/core/test/self-heal-policy.test.js
not ok 5 - packages/core/test/self-heal-policy.test.js
  ---
  duration_ms: 70.099792
  type: 'test'
  location: '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/test/self-heal-policy.test.js:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
# node:internal/modules/esm/resolve:274
#     throw new ERR_MODULE_NOT_FOUND(
#           ^
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/dist/token-estimate.js' imported from /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/test/token-estimate.test.js
#     at finalizeResolution (node:internal/modules/esm/resolve:274:11)
#     at moduleResolve (node:internal/modules/esm/resolve:859:10)
#     at defaultResolve (node:internal/modules/esm/resolve:983:11)
#     at \#cachedDefaultResolve (node:internal/modules/esm/loader:731:20)
#     at ModuleLoader.resolve (node:internal/modules/esm/loader:708:38)
#     at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:310:38)
#     at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
#   code: 'ERR_MODULE_NOT_FOUND',
#   url: 'file:///Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/dist/token-estimate.js'
# }
# Node.js v22.21.1
# Subtest: packages/core/test/token-estimate.test.js
not ok 6 - packages/core/test/token-estimate.test.js
  ---
  duration_ms: 70.965208
  type: 'test'
  location: '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/test/token-estimate.test.js:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
1..6
# tests 6
# suites 0
# pass 0
# fail 6
# cancelled 0
# skipped 0
# todo 0
# duration_ms 81.222

[2026-03-30T17:02:49.684Z] [3/3] 测试命令「npm run test:unit」→ exit=1 (660ms)
[2026-03-30T17:02:49.684Z] [3/3] 测试失败摘录:
…(截断)…
self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-the-mcp-ecosystem-how-model-context--ced87e27/packages/core/dist/self-heal-policy.js'
# }
# Node.js v22.21.1
# Subtest: packages/core/test/self-heal-policy.test.js
not ok 5 - packages/core/test/self-heal-policy.test.js
  ---
  duration_ms: 66.475375
  type: 'test'
  location: '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-the-mcp-ecosystem-how-model-context--ced87e27/packages/core/test/self-heal-policy.test.js:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
# node:internal/modules/esm/resolve:274
#     throw new ERR_MODULE_NOT_FOUND(
#           ^
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-the-mcp-ecosystem-how-model-context--ced87e27/packages/core/dist/token-estimate.js' imported from /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-the-mcp-ecosystem-how-model-context--ced87e27/packages/core/test/token-estimate.test.js
#     at finalizeResolution (node:internal/modules/esm/resolve:274:11)
#     at moduleResolve (node:internal/modules/esm/resolve:859:10)
#     at defaultResolve (node:internal/modules/esm/resolve:983:11)
#     at \#cachedDefaultResolve (node:internal/modules/esm/loader:731:20)
#     at ModuleLoader.resolve (node:internal/modules/esm/loader:708:38)
#     at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:310:38)
#     at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
#   code: 'ERR_MODULE_NOT_FOUND',
#   url: 'file:///Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-the-mcp-ecosystem-how-model-context--ced87e27/packages/core/dist/token-estimate.js'
# }
# Node.js v22.21.1
# Subtest: packages/core/test/token-estimate.test.js
not ok 6 - packages/core/test/token-estimate.test.js
  ---
  duration_ms: 65.357959
  type: 'test'
  location: '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-the-mcp-ecosystem-how-model-context--ced87e27/packages/core/test/token-estimate.test.js:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
1..6
# tests 6
# suites 0
# pass 0
# fail 6
# cancelled 0
# skipped 0
# todo 0
# duration_ms 80.531375

[2026-03-30T17:02:49.892Z] [1/3] 测试命令「npm run test:unit」→ exit=1 (622ms)
[2026-03-30T17:02:49.892Z] [1/3] 测试失败摘录:
…(截断)…
self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-show-hn-clambot-ai-agent-that-runs-a-85987e11/packages/core/dist/self-heal-policy.js'
# }
# Node.js v22.21.1
# Subtest: packages/core/test/self-heal-policy.test.js
not ok 5 - packages/core/test/self-heal-policy.test.js
  ---
  duration_ms: 48.851917
  type: 'test'
  location: '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-show-hn-clambot-ai-agent-that-runs-a-85987e11/packages/core/test/self-heal-policy.test.js:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
# node:internal/modules/esm/resolve:274
#     throw new ERR_MODULE_NOT_FOUND(
#           ^
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-show-hn-clambot-ai-agent-that-runs-a-85987e11/packages/core/dist/token-estimate.js' imported from /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-show-hn-clambot-ai-agent-that-runs-a-85987e11/packages/core/test/token-estimate.test.js
#     at finalizeResolution (node:internal/modules/esm/resolve:274:11)
#     at moduleResolve (node:internal/modules/esm/resolve:859:10)
#     at defaultResolve (node:internal/modules/esm/resolve:983:11)
#     at \#cachedDefaultResolve (node:internal/modules/esm/loader:731:20)
#     at ModuleLoader.resolve (node:internal/modules/esm/loader:708:38)
#     at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:310:38)
#     at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
#   code: 'ERR_MODULE_NOT_FOUND',
#   url: 'file:///Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-show-hn-clambot-ai-agent-that-runs-a-85987e11/packages/core/dist/token-estimate.js'
# }
# Node.js v22.21.1
# Subtest: packages/core/test/token-estimate.test.js
not ok 6 - packages/core/test/token-estimate.test.js
  ---
  duration_ms: 48.234333
  type: 'test'
  location: '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-show-hn-clambot-ai-agent-that-runs-a-85987e11/packages/core/test/token-estimate.test.js:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
1..6
# tests 6
# suites 0
# pass 0
# fail 6
# cancelled 0
# skipped 0
# todo 0
# duration_ms 58.200708

[2026-03-30T17:02:51.199Z] [2/3] worktree 已移除
[2026-03-30T17:02:51.199Z] [2/3] 结果: 失败（测试非零）→ 已写 doc/evolution/failure/
[2026-03-30T17:02:51.202Z] [3/3] worktree 已移除
[2026-03-30T17:02:51.202Z] [3/3] 结果: 失败（测试非零）→ 已写 doc/evolution/failure/
[2026-03-30T17:02:51.283Z] [1/3] worktree 已移除
[2026-03-30T17:02:51.283Z] [1/3] 结果: 失败（测试非零）→ 已写 doc/evolution/failure/
[2026-03-30T17:02:51.314Z] 全部条目处理完毕
[2026-03-30T17:02:51.314Z] 可读摘要 → doc/evolution/runs/latest-run-day.md

（终端亦有相同时间戳行；设 `EVOLUTION_NO_RUN_LOG=1` 可禁用本文件）
