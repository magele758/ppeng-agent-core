# evolution-run-day 最近一次

[2026-03-30T17:11:04.932Z] 启动
[2026-03-30T17:11:04.933Z] inbox: /Users/penglei/developer/self-test-grounding/ppeng-agent-core/doc/evolution/inbox/2026-03-30.md
[2026-03-30T17:11:04.933Z] 解析: inbox 内共 148 条链接，本跑取前 3 条（EVOLUTION_MAX_ITEMS=3）
[2026-03-30T17:11:04.933Z] 策略: 目标分支=main, 测试=npm run test:unit, npm ci=执行, 构建=npx tsc -b packages/core packages/capability-gateway, 自动合并=否
[2026-03-30T17:11:04.933Z] 说明：每条会先抓取来源 URL 的正文摘录（供对照）；验证阶段在本仓库独立 worktree 跑白名单测试，不克隆外链仓库。
[2026-03-30T17:11:04.933Z] 并发: 3（EVOLUTION_CONCURRENCY，上限 3）
[2026-03-30T17:11:04.934Z] [1/3] ━━ 开始 ━━
[2026-03-30T17:11:04.934Z] [1/3] 标题: Show HN: ClamBot – AI agent that runs all LLM-generated code in a WASM sandbox
[2026-03-30T17:11:04.935Z] [1/3] 链接: https://github.com/clamguy/clambot
[2026-03-30T17:11:04.953Z] [2/3] ━━ 开始 ━━
[2026-03-30T17:11:04.953Z] [2/3] 标题: MCP Registry – Open-source discovery layer for 20 Model Context Protocol servers
[2026-03-30T17:11:04.953Z] [2/3] 链接: https://github.com/SirhanMacx/mcp-registry
[2026-03-30T17:11:04.953Z] [3/3] ━━ 开始 ━━
[2026-03-30T17:11:04.953Z] [3/3] 标题: The MCP Ecosystem: How Model Context Protocol Is Becoming the HTTP of AI Agents
[2026-03-30T17:11:04.953Z] [3/3] 链接: https://primitivesai.substack.com/p/the-mcp-ecosystem-how-a-protocol
[2026-03-30T17:11:06.448Z] [2/3] 来源正文已抓取 5778 字（1495ms）
[2026-03-30T17:11:06.448Z] [2/3] slug=mcp-registry-open-source-discovery-l-d215b555 → 分支 exp/evolution-2026-03-30-mcp-registry-open-source-discovery-l-d215b555，worktree /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555
[2026-03-30T17:11:06.469Z] [1/3] 来源正文已抓取 14000 字（1534ms）
[2026-03-30T17:11:06.469Z] [1/3] slug=show-hn-clambot-ai-agent-that-runs-a-85987e11 → 分支 exp/evolution-2026-03-30-show-hn-clambot-ai-agent-that-runs-a-85987e11，worktree /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-show-hn-clambot-ai-agent-that-runs-a-85987e11
[2026-03-30T17:11:06.525Z] [2/3] 清理旧 worktree/分支 (77ms)
[2026-03-30T17:11:06.538Z] [1/3] 清理旧 worktree/分支 (69ms)
[2026-03-30T17:11:06.598Z] [2/3] git worktree add → exit=0 (73ms)
[2026-03-30T17:11:06.598Z] [1/3] git worktree add → exit=0 (60ms)
[2026-03-30T17:11:06.598Z] [2/3] 已拷贝主仓 .env → worktree
[2026-03-30T17:11:06.598Z] [1/3] 已拷贝主仓 .env → worktree
[2026-03-30T17:11:06.598Z] [2/3] 已拷贝 gateway.config.json → worktree/gateway.config.json
[2026-03-30T17:11:06.600Z] [1/3] 已拷贝 gateway.config.json → worktree/gateway.config.json
[2026-03-30T17:11:12.173Z] [1/3] npm ci → exit=0 (5573ms)
[2026-03-30T17:11:12.191Z] [2/3] npm ci → exit=0 (5592ms)
[2026-03-30T17:11:13.824Z] [2/3] 构建「npx tsc -b packages/core packages/capability-gateway」→ exit=0 (1633ms)
[2026-03-30T17:11:13.900Z] [1/3] 构建「npx tsc -b packages/core packages/capability-gateway」→ exit=0 (1727ms)
[2026-03-30T17:11:14.722Z] [2/3] 测试命令「npm run test:unit」→ exit=1 (898ms)
[2026-03-30T17:11:14.723Z] [2/3] 测试失败摘录:
…(截断)…
ms: 6.735459
  type: 'test'
  ...
# Subtest: external AI tools are absent unless RAW_AGENT_EXTERNAL_AI_TOOLS is set
ok 19 - external AI tools are absent unless RAW_AGENT_EXTERNAL_AI_TOOLS is set
  ---
  duration_ms: 10.118458
  type: 'test'
  ...
# Subtest: external AI tools are registered when RAW_AGENT_EXTERNAL_AI_TOOLS=1
ok 20 - external AI tools are registered when RAW_AGENT_EXTERNAL_AI_TOOLS=1
  ---
  duration_ms: 9.121
  type: 'test'
  ...
# Subtest: normalizeSelfHealPolicy defaults
not ok 21 - normalizeSelfHealPolicy defaults
  ---
  duration_ms: 0.708833
  type: 'test'
  location: '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/test/self-heal-policy.test.js:9:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    true !== false
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: false
  actual: true
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/test/self-heal-policy.test.js:13:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.start (node:internal/test_runner/test:944:17)
    startSubtestAfterBootstrap (node:internal/test_runner/harness:296:17)
  ...
# Subtest: npmScriptForSelfHealPolicy presets
ok 22 - npmScriptForSelfHealPolicy presets
  ---
  duration_ms: 0.099292
  type: 'test'
  ...
# Subtest: custom npm script validation
ok 23 - custom npm script validation
  ---
  duration_ms: 0.117083
  type: 'test'
  ...
# Subtest: normalizeSelfHealPolicy caps maxFixIterations
ok 24 - normalizeSelfHealPolicy caps maxFixIterations
  ---
  duration_ms: 0.051542
  type: 'test'
  ...
# Subtest: estimateTokensFromText is positive for non-empty
ok 25 - estimateTokensFromText is positive for non-empty
  ---
  duration_ms: 0.362792
  type: 'test'
  ...
# Subtest: estimateMessageTokens sums roles and parts
ok 26 - estimateMessageTokens sums roles and parts
  ---
  duration_ms: 0.0715
  type: 'test'
  ...
# Subtest: estimateMessageTokens counts image parts
ok 27 - estimateMessageTokens counts image parts
  ---
  duration_ms: 0.050084
  type: 'test'
  ...
1..27
# tests 27
# suites 0
# pass 26
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 397.267459

[2026-03-30T17:11:14.723Z] [1/3] 测试命令「npm run test:unit」→ exit=1 (823ms)
[2026-03-30T17:11:14.723Z] [1/3] 测试失败摘录:
…(截断)…
on_ms: 6.804125
  type: 'test'
  ...
# Subtest: external AI tools are absent unless RAW_AGENT_EXTERNAL_AI_TOOLS is set
ok 19 - external AI tools are absent unless RAW_AGENT_EXTERNAL_AI_TOOLS is set
  ---
  duration_ms: 10.023292
  type: 'test'
  ...
# Subtest: external AI tools are registered when RAW_AGENT_EXTERNAL_AI_TOOLS=1
ok 20 - external AI tools are registered when RAW_AGENT_EXTERNAL_AI_TOOLS=1
  ---
  duration_ms: 8.74075
  type: 'test'
  ...
# Subtest: normalizeSelfHealPolicy defaults
not ok 21 - normalizeSelfHealPolicy defaults
  ---
  duration_ms: 0.669
  type: 'test'
  location: '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-show-hn-clambot-ai-agent-that-runs-a-85987e11/packages/core/test/self-heal-policy.test.js:9:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    true !== false
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: false
  actual: true
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-show-hn-clambot-ai-agent-that-runs-a-85987e11/packages/core/test/self-heal-policy.test.js:13:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.start (node:internal/test_runner/test:944:17)
    startSubtestAfterBootstrap (node:internal/test_runner/harness:296:17)
  ...
# Subtest: npmScriptForSelfHealPolicy presets
ok 22 - npmScriptForSelfHealPolicy presets
  ---
  duration_ms: 0.096166
  type: 'test'
  ...
# Subtest: custom npm script validation
ok 23 - custom npm script validation
  ---
  duration_ms: 0.107958
  type: 'test'
  ...
# Subtest: normalizeSelfHealPolicy caps maxFixIterations
ok 24 - normalizeSelfHealPolicy caps maxFixIterations
  ---
  duration_ms: 0.05
  type: 'test'
  ...
# Subtest: estimateTokensFromText is positive for non-empty
ok 25 - estimateTokensFromText is positive for non-empty
  ---
  duration_ms: 0.372542
  type: 'test'
  ...
# Subtest: estimateMessageTokens sums roles and parts
ok 26 - estimateMessageTokens sums roles and parts
  ---
  duration_ms: 0.074958
  type: 'test'
  ...
# Subtest: estimateMessageTokens counts image parts
ok 27 - estimateMessageTokens counts image parts
  ---
  duration_ms: 0.049416
  type: 'test'
  ...
1..27
# tests 27
# suites 0
# pass 26
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 397.298875

[2026-03-30T17:11:15.448Z] [3/3] 来源正文抓取失败或为空: fetch failed（10495ms）
[2026-03-30T17:11:15.448Z] [3/3] slug=the-mcp-ecosystem-how-model-context--ced87e27 → 分支 exp/evolution-2026-03-30-the-mcp-ecosystem-how-model-context--ced87e27，worktree /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-the-mcp-ecosystem-how-model-context--ced87e27
[2026-03-30T17:11:15.518Z] [3/3] 清理旧 worktree/分支 (70ms)
[2026-03-30T17:11:15.592Z] [3/3] git worktree add → exit=0 (74ms)
[2026-03-30T17:11:15.592Z] [3/3] 已拷贝主仓 .env → worktree
[2026-03-30T17:11:15.592Z] [3/3] 已拷贝 gateway.config.json → worktree/gateway.config.json
[2026-03-30T17:11:15.728Z] [2/3] worktree 已移除
[2026-03-30T17:11:15.728Z] [2/3] 结果: 失败（测试非零）→ 已写 doc/evolution/failure/
[2026-03-30T17:11:15.730Z] [1/3] worktree 已移除
[2026-03-30T17:11:15.730Z] [1/3] 结果: 失败（测试非零）→ 已写 doc/evolution/failure/
[2026-03-30T17:11:19.802Z] [3/3] npm ci → exit=0 (4210ms)
[2026-03-30T17:11:21.040Z] [3/3] 构建「npx tsc -b packages/core packages/capability-gateway」→ exit=0 (1238ms)
[2026-03-30T17:11:21.600Z] [3/3] 测试命令「npm run test:unit」→ exit=1 (560ms)
[2026-03-30T17:11:21.600Z] [3/3] 测试失败摘录:
…(截断)…
ms: 4.248125
  type: 'test'
  ...
# Subtest: external AI tools are absent unless RAW_AGENT_EXTERNAL_AI_TOOLS is set
ok 19 - external AI tools are absent unless RAW_AGENT_EXTERNAL_AI_TOOLS is set
  ---
  duration_ms: 3.75875
  type: 'test'
  ...
# Subtest: external AI tools are registered when RAW_AGENT_EXTERNAL_AI_TOOLS=1
ok 20 - external AI tools are registered when RAW_AGENT_EXTERNAL_AI_TOOLS=1
  ---
  duration_ms: 3.802125
  type: 'test'
  ...
# Subtest: normalizeSelfHealPolicy defaults
not ok 21 - normalizeSelfHealPolicy defaults
  ---
  duration_ms: 0.664334
  type: 'test'
  location: '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-the-mcp-ecosystem-how-model-context--ced87e27/packages/core/test/self-heal-policy.test.js:9:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    true !== false
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: false
  actual: true
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-the-mcp-ecosystem-how-model-context--ced87e27/packages/core/test/self-heal-policy.test.js:13:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.start (node:internal/test_runner/test:944:17)
    startSubtestAfterBootstrap (node:internal/test_runner/harness:296:17)
  ...
# Subtest: npmScriptForSelfHealPolicy presets
ok 22 - npmScriptForSelfHealPolicy presets
  ---
  duration_ms: 0.094959
  type: 'test'
  ...
# Subtest: custom npm script validation
ok 23 - custom npm script validation
  ---
  duration_ms: 0.109542
  type: 'test'
  ...
# Subtest: normalizeSelfHealPolicy caps maxFixIterations
ok 24 - normalizeSelfHealPolicy caps maxFixIterations
  ---
  duration_ms: 0.050958
  type: 'test'
  ...
# Subtest: estimateTokensFromText is positive for non-empty
ok 25 - estimateTokensFromText is positive for non-empty
  ---
  duration_ms: 0.359
  type: 'test'
  ...
# Subtest: estimateMessageTokens sums roles and parts
ok 26 - estimateMessageTokens sums roles and parts
  ---
  duration_ms: 0.069708
  type: 'test'
  ...
# Subtest: estimateMessageTokens counts image parts
ok 27 - estimateMessageTokens counts image parts
  ---
  duration_ms: 0.049709
  type: 'test'
  ...
1..27
# tests 27
# suites 0
# pass 26
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 243.740375

[2026-03-30T17:11:22.263Z] [3/3] worktree 已移除
[2026-03-30T17:11:22.263Z] [3/3] 结果: 失败（测试非零）→ 已写 doc/evolution/failure/
[2026-03-30T17:11:22.297Z] 全部条目处理完毕
[2026-03-30T17:11:22.297Z] 可读摘要 → doc/evolution/runs/latest-run-day.md

（终端亦有相同时间戳行；设 `EVOLUTION_NO_RUN_LOG=1` 可禁用本文件）
