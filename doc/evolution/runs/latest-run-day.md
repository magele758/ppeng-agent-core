# evolution-run-day 最近一次

[2026-03-30T17:06:53.910Z] 启动
[2026-03-30T17:06:53.911Z] inbox: /Users/penglei/developer/self-test-grounding/ppeng-agent-core/doc/evolution/inbox/2026-03-30.md
[2026-03-30T17:06:53.911Z] 解析: inbox 内共 148 条链接，本跑取前 3 条（EVOLUTION_MAX_ITEMS=3）
[2026-03-30T17:06:53.911Z] 策略: 目标分支=main, 测试=npm run test:unit, npm ci=执行, 构建=npx tsc -b packages/core packages/capability-gateway, 自动合并=否
[2026-03-30T17:06:53.911Z] 说明：每条会先抓取来源 URL 的正文摘录（供对照）；验证阶段在本仓库独立 worktree 跑白名单测试，不克隆外链仓库。
[2026-03-30T17:06:53.911Z] 并发: 3（EVOLUTION_CONCURRENCY，上限 3）
[2026-03-30T17:06:53.912Z] [1/3] ━━ 开始 ━━
[2026-03-30T17:06:53.912Z] [1/3] 标题: Show HN: ClamBot – AI agent that runs all LLM-generated code in a WASM sandbox
[2026-03-30T17:06:53.912Z] [1/3] 链接: https://github.com/clamguy/clambot
[2026-03-30T17:06:53.931Z] [2/3] ━━ 开始 ━━
[2026-03-30T17:06:53.931Z] [2/3] 标题: MCP Registry – Open-source discovery layer for 20 Model Context Protocol servers
[2026-03-30T17:06:53.931Z] [2/3] 链接: https://github.com/SirhanMacx/mcp-registry
[2026-03-30T17:06:53.932Z] [3/3] ━━ 开始 ━━
[2026-03-30T17:06:53.932Z] [3/3] 标题: The MCP Ecosystem: How Model Context Protocol Is Becoming the HTTP of AI Agents
[2026-03-30T17:06:53.932Z] [3/3] 链接: https://primitivesai.substack.com/p/the-mcp-ecosystem-how-a-protocol
[2026-03-30T17:06:54.321Z] [3/3] 来源正文抓取失败或为空: fetch failed（389ms）
[2026-03-30T17:06:54.321Z] [3/3] slug=the-mcp-ecosystem-how-model-context--ced87e27 → 分支 exp/evolution-2026-03-30-the-mcp-ecosystem-how-model-context--ced87e27，worktree /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-the-mcp-ecosystem-how-model-context--ced87e27
[2026-03-30T17:06:54.417Z] [3/3] 清理旧 worktree/分支 (96ms)
[2026-03-30T17:06:54.480Z] [3/3] git worktree add → exit=0 (63ms)
[2026-03-30T17:06:55.305Z] [1/3] 来源正文已抓取 14000 字（1392ms）
[2026-03-30T17:06:55.305Z] [1/3] slug=show-hn-clambot-ai-agent-that-runs-a-85987e11 → 分支 exp/evolution-2026-03-30-show-hn-clambot-ai-agent-that-runs-a-85987e11，worktree /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-show-hn-clambot-ai-agent-that-runs-a-85987e11
[2026-03-30T17:06:55.382Z] [1/3] 清理旧 worktree/分支 (77ms)
[2026-03-30T17:06:55.410Z] [2/3] 来源正文已抓取 5826 字（1479ms）
[2026-03-30T17:06:55.410Z] [2/3] slug=mcp-registry-open-source-discovery-l-d215b555 → 分支 exp/evolution-2026-03-30-mcp-registry-open-source-discovery-l-d215b555，worktree /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555
[2026-03-30T17:06:55.455Z] [1/3] git worktree add → exit=0 (73ms)
[2026-03-30T17:06:55.458Z] [2/3] 清理旧 worktree/分支 (48ms)
[2026-03-30T17:06:55.639Z] [2/3] git worktree add → exit=0 (181ms)
[2026-03-30T17:07:01.637Z] [1/3] npm ci → exit=0 (6182ms)
[2026-03-30T17:07:01.646Z] [2/3] npm ci → exit=0 (6007ms)
[2026-03-30T17:07:02.253Z] [3/3] npm ci → exit=0 (7773ms)
[2026-03-30T17:07:03.540Z] [1/3] 构建「npx tsc -b packages/core packages/capability-gateway」→ exit=0 (1903ms)
[2026-03-30T17:07:03.548Z] [2/3] 构建「npx tsc -b packages/core packages/capability-gateway」→ exit=0 (1902ms)
[2026-03-30T17:07:03.640Z] [3/3] 构建「npx tsc -b packages/core packages/capability-gateway」→ exit=0 (1386ms)
[2026-03-30T17:07:04.677Z] [1/3] 测试命令「npm run test:unit」→ exit=1 (1137ms)
[2026-03-30T17:07:04.677Z] [1/3] 测试失败摘录:
…(截断)…
 5.677208
  type: 'test'
  ...
# Subtest: external AI tools are absent unless RAW_AGENT_EXTERNAL_AI_TOOLS is set
ok 19 - external AI tools are absent unless RAW_AGENT_EXTERNAL_AI_TOOLS is set
  ---
  duration_ms: 9.9405
  type: 'test'
  ...
# Subtest: external AI tools are registered when RAW_AGENT_EXTERNAL_AI_TOOLS=1
ok 20 - external AI tools are registered when RAW_AGENT_EXTERNAL_AI_TOOLS=1
  ---
  duration_ms: 13.391416
  type: 'test'
  ...
# Subtest: normalizeSelfHealPolicy defaults
not ok 21 - normalizeSelfHealPolicy defaults
  ---
  duration_ms: 0.715875
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
  duration_ms: 0.113375
  type: 'test'
  ...
# Subtest: custom npm script validation
ok 23 - custom npm script validation
  ---
  duration_ms: 0.117375
  type: 'test'
  ...
# Subtest: normalizeSelfHealPolicy caps maxFixIterations
ok 24 - normalizeSelfHealPolicy caps maxFixIterations
  ---
  duration_ms: 0.051458
  type: 'test'
  ...
# Subtest: estimateTokensFromText is positive for non-empty
ok 25 - estimateTokensFromText is positive for non-empty
  ---
  duration_ms: 0.428166
  type: 'test'
  ...
# Subtest: estimateMessageTokens sums roles and parts
ok 26 - estimateMessageTokens sums roles and parts
  ---
  duration_ms: 0.077167
  type: 'test'
  ...
# Subtest: estimateMessageTokens counts image parts
ok 27 - estimateMessageTokens counts image parts
  ---
  duration_ms: 0.052709
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
# duration_ms 475.693333

[2026-03-30T17:07:04.713Z] [2/3] 测试命令「npm run test:unit」→ exit=1 (1165ms)
[2026-03-30T17:07:04.713Z] [2/3] 测试失败摘录:
…(截断)…
306583
  type: 'test'
  ...
# Subtest: external AI tools are absent unless RAW_AGENT_EXTERNAL_AI_TOOLS is set
ok 19 - external AI tools are absent unless RAW_AGENT_EXTERNAL_AI_TOOLS is set
  ---
  duration_ms: 11.506709
  type: 'test'
  ...
# Subtest: external AI tools are registered when RAW_AGENT_EXTERNAL_AI_TOOLS=1
ok 20 - external AI tools are registered when RAW_AGENT_EXTERNAL_AI_TOOLS=1
  ---
  duration_ms: 10.843167
  type: 'test'
  ...
# Subtest: normalizeSelfHealPolicy defaults
not ok 21 - normalizeSelfHealPolicy defaults
  ---
  duration_ms: 0.667583
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
  duration_ms: 0.096292
  type: 'test'
  ...
# Subtest: custom npm script validation
ok 23 - custom npm script validation
  ---
  duration_ms: 0.112292
  type: 'test'
  ...
# Subtest: normalizeSelfHealPolicy caps maxFixIterations
ok 24 - normalizeSelfHealPolicy caps maxFixIterations
  ---
  duration_ms: 0.049209
  type: 'test'
  ...
# Subtest: estimateTokensFromText is positive for non-empty
ok 25 - estimateTokensFromText is positive for non-empty
  ---
  duration_ms: 0.372208
  type: 'test'
  ...
# Subtest: estimateMessageTokens sums roles and parts
ok 26 - estimateMessageTokens sums roles and parts
  ---
  duration_ms: 0.071917
  type: 'test'
  ...
# Subtest: estimateMessageTokens counts image parts
ok 27 - estimateMessageTokens counts image parts
  ---
  duration_ms: 0.063166
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
# duration_ms 511.547916

[2026-03-30T17:07:04.714Z] [3/3] 测试命令「npm run test:unit」→ exit=1 (1074ms)
[2026-03-30T17:07:04.715Z] [3/3] 测试失败摘录:
…(截断)…
.435708
  type: 'test'
  ...
# Subtest: external AI tools are absent unless RAW_AGENT_EXTERNAL_AI_TOOLS is set
ok 19 - external AI tools are absent unless RAW_AGENT_EXTERNAL_AI_TOOLS is set
  ---
  duration_ms: 9.296459
  type: 'test'
  ...
# Subtest: external AI tools are registered when RAW_AGENT_EXTERNAL_AI_TOOLS=1
ok 20 - external AI tools are registered when RAW_AGENT_EXTERNAL_AI_TOOLS=1
  ---
  duration_ms: 10.311584
  type: 'test'
  ...
# Subtest: normalizeSelfHealPolicy defaults
not ok 21 - normalizeSelfHealPolicy defaults
  ---
  duration_ms: 0.666666
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
  duration_ms: 0.096083
  type: 'test'
  ...
# Subtest: custom npm script validation
ok 23 - custom npm script validation
  ---
  duration_ms: 0.113375
  type: 'test'
  ...
# Subtest: normalizeSelfHealPolicy caps maxFixIterations
ok 24 - normalizeSelfHealPolicy caps maxFixIterations
  ---
  duration_ms: 0.050458
  type: 'test'
  ...
# Subtest: estimateTokensFromText is positive for non-empty
ok 25 - estimateTokensFromText is positive for non-empty
  ---
  duration_ms: 0.366375
  type: 'test'
  ...
# Subtest: estimateMessageTokens sums roles and parts
ok 26 - estimateMessageTokens sums roles and parts
  ---
  duration_ms: 0.071625
  type: 'test'
  ...
# Subtest: estimateMessageTokens counts image parts
ok 27 - estimateMessageTokens counts image parts
  ---
  duration_ms: 0.049875
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
# duration_ms 513.654792

[2026-03-30T17:07:06.123Z] [2/3] worktree 已移除
[2026-03-30T17:07:06.123Z] [2/3] 结果: 失败（测试非零）→ 已写 doc/evolution/failure/
[2026-03-30T17:07:06.127Z] [3/3] worktree 已移除
[2026-03-30T17:07:06.127Z] [3/3] 结果: 失败（测试非零）→ 已写 doc/evolution/failure/
[2026-03-30T17:07:06.127Z] [1/3] worktree 已移除
[2026-03-30T17:07:06.127Z] [1/3] 结果: 失败（测试非零）→ 已写 doc/evolution/failure/
[2026-03-30T17:07:06.182Z] 全部条目处理完毕
[2026-03-30T17:07:06.182Z] 可读摘要 → doc/evolution/runs/latest-run-day.md

（终端亦有相同时间戳行；设 `EVOLUTION_NO_RUN_LOG=1` 可禁用本文件）
