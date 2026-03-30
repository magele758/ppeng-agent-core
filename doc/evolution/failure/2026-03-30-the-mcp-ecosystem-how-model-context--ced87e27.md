---
status: failure
source_url: "https://primitivesai.substack.com/p/the-mcp-ecosystem-how-a-protocol"
source_title: "The MCP Ecosystem: How Model Context Protocol Is Becoming the HTTP of AI Agents"
experiment_branch: "exp/evolution-2026-03-30-the-mcp-ecosystem-how-model-context--ced87e27"
test_command: "npm run test:unit"
date_utc: "2026-03-30T17:07:06.127Z"
---

# 实验失败：The MCP Ecosystem: How Model Context Protocol Is Becoming the HTTP of AI Agents

## 来源
- [The MCP Ecosystem: How Model Context Protocol Is Becoming the HTTP of AI Agents](https://primitivesai.substack.com/p/the-mcp-ecosystem-how-a-protocol)

## 来源正文摘录（抓取）
_抓取来源正文失败：fetch failed_


## 分支
`exp/evolution-2026-03-30-the-mcp-ecosystem-how-model-context--ced87e27`

## 测试命令
`npm run test:unit`

## 失败输出（摘录）

```

added 53 packages in 8s

10 packages are looking for funding
  run `npm fund` for details

> my-raw-agent-sdk@0.1.0 test:unit
> node --test packages/core/test/*.test.js packages/capability-gateway/test/*.test.js

TAP version 13
# Subtest: feishu url_verification
ok 1 - feishu url_verification
  ---
  duration_ms: 1.476917
  type: 'test'
  ...
# Subtest: feishu extract group text
ok 2 - feishu extract group text
  ---
  duration_ms: 0.177875
  type: 'test'
  ...
# Subtest: mergeSkillsByName: agents override workspace on same name
ok 3 - mergeSkillsByName: agents override workspace on same name
  ---
  duration_ms: 0.306791
  type: 'test'
  ...
# Subtest: HybridModelRouterAdapter routes to VL when messages contain an image part
ok 4 - HybridModelRouterAdapter routes to VL when messages contain an image part
  ---
  duration_ms: 0.439625
  type: 'test'
  ...
# Subtest: HybridModelRouterAdapter last_user scope ignores images only in older turns
ok 5 - HybridModelRouterAdapter last_user scope ignores images only in older turns
  ---
  duration_ms: 0.112083
  type: 'test'
  ...
# (node:28744) ExperimentalWarning: SQLite is an experimental feature and might change at any time
# (Use `node --trace-warnings ...` to show where the warning was created)
# Subtest: chat session can do a simple reply through the raw loop
ok 6 - chat session can do a simple reply through the raw loop
  ---
  duration_ms: 46.483625
  type: 'test'
  ...
# Subtest: task sessions complete and bind an isolated workspace
ok 7 - task sessions complete and bind an isolated workspace
  ---
  duration_ms: 28.449125
  type: 'test'
  ...
# Subtest: approval blocks the session until the user approves the tool call
ok 8 - approval blocks the session until the user approves the tool call
  ---
  duration_ms: 25.003833
  type: 'test'
  ...
# Subtest: read_file can list a directory passed by path
ok 9 - read_file can list a directory passed by path
  ---
  duration_ms: 22.620541
  type: 'test'
  ...
# Subtest: tool execution errors are returned to the model instead of crashing the session
ok 10 - tool execution errors are returned to the model instead of crashing the session
  ---
  duration_ms: 28.354125
  type: 'test'
  ...
# Subtest: teammate sessions and mailbox messages can be created directly
ok 11 - teammate sessions and mailbox messages can be created directly
  ---
  duration_ms: 24.316167
  type: 'test'
  ...
# Subtest: parallel tool calls execute in one assistant message
ok 12 - parallel tool calls execute in one assistant message
  ---
  duration_ms: 21.685459
  type: 'test'
  ...
# Subtest: scratch memory is copied to subagent session
ok 13 - scratch memory is copied to subagent session
  ---
  duration_ms: 27.320292
  type: 'test'
  ...
# Subtest: read_file offset_line returns a window
ok 14 - read_file offset_line returns a window
  ---
  duration_ms: 30.236167
  type: 'test'
  ...
# Subtest: scheduler dequeue wakes sessions enqueued on task create
ok 15 - scheduler dequeue wakes sessions enqueued on task create
  ---
  duration_ms: 46.118375
  type: 'test'
  ...
# Subtest: harness_write_spec writes under repo when no workspace
ok 16 - harness_write_spec writes under repo when no workspace
  ---
  duration_ms: 18.285583
  type: 'test'
  ...
# Subtest: task_update merges metadata shallowly
ok 17 - task_update merges metadata shallowly
  ---
  duration_ms: 17.309125
  type: 'test'
  ...
# Subtest: createApproval idempotency key returns same pending row
ok 18 - createApproval idempotency key returns same pending row
  ---
  duration_ms: 10.435708
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

```

## 原因分析

测试命令非零退出（本仓库快照）。外链项目不会自动克隆；失败原因见上方测试摘录与 failure 文档中的完整输出。
