---
status: failure
source_url: "https://github.com/SirhanMacx/mcp-registry"
source_title: "MCP Registry – Open-source discovery layer for 20 Model Context Protocol servers"
experiment_branch: "exp/evolution-2026-03-30-mcp-registry-open-source-discovery-l-d215b555"
test_command: "npm run test:unit"
date_utc: "2026-03-30T17:11:15.728Z"
---

# 实验失败：MCP Registry – Open-source discovery layer for 20 Model Context Protocol servers

## 来源
- [MCP Registry – Open-source discovery layer for 20 Model Context Protocol servers](https://github.com/SirhanMacx/mcp-registry)

## 来源正文摘录（抓取）
```
GitHub - SirhanMacx/mcp-registry: Community registry for Model Context Protocol (MCP) servers — verified install commands, tool listings, structured metadata · GitHub Skip to content Navigation Menu Toggle navigation Sign in Appearance settings Platform AI CODE CREATION GitHub Copilot Write better code with AI GitHub Spark Build and deploy intelligent apps GitHub Models Manage and compare prompts MCP Registry New Integrate external tools DEVELOPER WORKFLOWS Actions Automate any workflow Codespaces Instant dev environments Issues Plan and track work Code Review Manage code changes APPLICATION SECURITY GitHub Advanced Security Find and fix vulnerabilities Code security Secure your code as you build Secret protection Stop leaks before they start EXPLORE Why GitHub Documentation Blog Changelog Marketplace View all features Solutions BY COMPANY SIZE Enterprises Small and medium teams Startups Nonprofits BY USE CASE App Modernization DevSecOps DevOps CI/CD View all use cases BY INDUSTRY Healthcare Financial services Manufacturing Government View all industries View all solutions Resources EXPLORE BY TOPIC AI Software Development DevOps Security View all topics EXPLORE BY TYPE Customer stories Events &amp; webinars Ebooks &amp; reports Business insights GitHub Skills SUPPORT &amp; SERVICES Documentation Customer support Community forum Trust center Partners View all resources Open Source COMMUNITY GitHub Sponsors Fund open source developers PROGRAMS Security Lab Maintainer Community Accelerator GitHub Stars Archive Program REPOSITORIES Topics Trending Collections Enterprise ENTERPRISE SOLUTIONS Enterprise platform AI-powered developer platform AVAILABLE ADD-ONS GitHub Advanced Security Enterprise-grade security features Copilot for Business Enterprise-grade AI features Premium Support Enterprise-grade 24/7 support Pricing Search or jump to... Search code, repositories, users, issues, pull requests... --> Search Clear Search syntax tips Provide feedback --> We read every piece of feedback, and take your input very seriously. Include my email address so I can be contacted Cancel Submit feedback Saved searches Use saved searches to filter your results more quickly --> Name Query To see all available qualifiers, see our documentation . Cancel Create saved search Sign in Sign up Appearance settings Resetting focus You signed in with another tab or window. Reload to refresh your session. You signed out in another tab or window. Reload to refresh your session. You switched accounts on another tab or window. Reload to refresh your session. Dismiss alert {{ message }} SirhanMacx / mcp-registry Public Notifications You must be signed in to change notification settings Fork 1 Star 4 Code Issues 0 Pull requests 0 Actions Projects Security 0 Insights Additional navigation options Code Issues Pull requests Actions Projects Security Insights SirhanMacx/mcp-registry main Branches Tags Go to file Code Open more actions menu Folders and files Name Name Last commit message Last commit date Latest commit History 2 Commits 2 Commits .github .github dist dist registry registry schema schema scripts scripts web web CONTRIBUTING.md CONTRIBUTING.md README.md README.md View all files Repository files navigation README Contributing MCP Registry 🔌 The missing discovery layer for Model Context Protocol servers. Problem: MCP is growing fast but finding servers is chaos. There's no canonical registry, no search, no compatibility metadata — just scattered GitHub repos and random awesome-lists. Solution: A community-maintained, searchable registry with structured metadata for every MCP server. What's here registry/ — Structured JSON entries for each MCP server schema/ — JSON schema for registry entries web/ — Static site for browsing/searching (no backend needed) scripts/ — Validation and build tools Entry format { "id" : " sqlite-mcp " , "name" : " SQLite MCP Server " , "description" : " Read/write SQLite databases from any MCP-compatible agent " , "author" : " someone " , "repo" : " https://github.com/someone/sqlite-mcp " , "install" : " npx sqlite-mcp " , "protocol_version" : " 2024-11-05 " , "tools" : [ " query " , " execute " , " list_tables " , " describe_table " ], "prompts" : [], "resources" : [ " sqlite:///{path} " ], "tags" : [ " database " , " sqlite " , " storage " ], "verified" : false , "submitted" : " 2026-03-22 " } Why this matters MCP is becoming the standard way for AI agents to access tools. But right now: Finding servers requires hours of GitHub searching No way to know if a server is maintained or abandoned No compatibility metadata (which clients work with it?) No usage stats or community validation This registry changes that. Contributing Submit a PR adding your server to registry/ . One JSON file per server. The schema validates automatically. Status 🟡 Early — seeding initial entries. PRs welcome. Related Machina Market — Premium MCP server packs (catalog.json for agent-native purchase) MCP Spec MCP SDK About Community registry for Model Context Protocol (MCP) servers — verified install commands, tool listings, structured metadata Topics open-source registry tools mcp ai-agents claude llm model-context-protocol Resources Readme Contributing Contributing Uh oh! There was an error while loading. Please reload this page . Activity Stars 4 stars Watchers 0 watching Forks 1 fork Report repository Releases No releases published Packages 0 &nbsp; &nbsp; &nbsp; Uh oh! There was an error while loading. Please reload this page . Contributors 1 minduploadedcrab Languages HTML 86.8% Python 13.2% Footer &copy; 2026 GitHub,&nbsp;Inc. Footer navigation Terms Privacy Security Status Community Docs Contact Manage cookies Do not share my personal information You can’t perform that action at this time.
```


## 分支
`exp/evolution-2026-03-30-mcp-registry-open-source-discovery-l-d215b555`

## 测试命令
`npm run test:unit`

## 失败输出（摘录）

```

added 53 packages in 5s

10 packages are looking for funding
  run `npm fund` for details

> my-raw-agent-sdk@0.1.0 test:unit
> node --test packages/core/test/*.test.js packages/capability-gateway/test/*.test.js

TAP version 13
# Subtest: feishu url_verification
ok 1 - feishu url_verification
  ---
  duration_ms: 0.556292
  type: 'test'
  ...
# Subtest: feishu extract group text
ok 2 - feishu extract group text
  ---
  duration_ms: 1.223875
  type: 'test'
  ...
# Subtest: mergeSkillsByName: agents override workspace on same name
ok 3 - mergeSkillsByName: agents override workspace on same name
  ---
  duration_ms: 0.305459
  type: 'test'
  ...
# Subtest: HybridModelRouterAdapter routes to VL when messages contain an image part
ok 4 - HybridModelRouterAdapter routes to VL when messages contain an image part
  ---
  duration_ms: 0.417542
  type: 'test'
  ...
# Subtest: HybridModelRouterAdapter last_user scope ignores images only in older turns
ok 5 - HybridModelRouterAdapter last_user scope ignores images only in older turns
  ---
  duration_ms: 0.110084
  type: 'test'
  ...
# (node:41123) ExperimentalWarning: SQLite is an experimental feature and might change at any time
# (Use `node --trace-warnings ...` to show where the warning was created)
# Subtest: chat session can do a simple reply through the raw loop
ok 6 - chat session can do a simple reply through the raw loop
  ---
  duration_ms: 47.394959
  type: 'test'
  ...
# Subtest: task sessions complete and bind an isolated workspace
ok 7 - task sessions complete and bind an isolated workspace
  ---
  duration_ms: 21.728875
  type: 'test'
  ...
# Subtest: approval blocks the session until the user approves the tool call
ok 8 - approval blocks the session until the user approves the tool call
  ---
  duration_ms: 17.659167
  type: 'test'
  ...
# Subtest: read_file can list a directory passed by path
ok 9 - read_file can list a directory passed by path
  ---
  duration_ms: 15.582084
  type: 'test'
  ...
# Subtest: tool execution errors are returned to the model instead of crashing the session
ok 10 - tool execution errors are returned to the model instead of crashing the session
  ---
  duration_ms: 20.460042
  type: 'test'
  ...
# Subtest: teammate sessions and mailbox messages can be created directly
ok 11 - teammate sessions and mailbox messages can be created directly
  ---
  duration_ms: 17.015875
  type: 'test'
  ...
# Subtest: parallel tool calls execute in one assistant message
ok 12 - parallel tool calls execute in one assistant message
  ---
  duration_ms: 17.6165
  type: 'test'
  ...
# Subtest: scratch memory is copied to subagent session
ok 13 - scratch memory is copied to subagent session
  ---
  duration_ms: 16.627042
  type: 'test'
  ...
# Subtest: read_file offset_line returns a window
ok 14 - read_file offset_line returns a window
  ---
  duration_ms: 14.501625
  type: 'test'
  ...
# Subtest: scheduler dequeue wakes sessions enqueued on task create
ok 15 - scheduler dequeue wakes sessions enqueued on task create
  ---
  duration_ms: 41.605917
  type: 'test'
  ...
# Subtest: harness_write_spec writes under repo when no workspace
ok 16 - harness_write_spec writes under repo when no workspace
  ---
  duration_ms: 19.158833
  type: 'test'
  ...
# Subtest: task_update merges metadata shallowly
ok 17 - task_update merges metadata shallowly
  ---
  duration_ms: 10.348584
  type: 'test'
  ...
# Subtest: createApproval idempotency key returns same pending row
ok 18 - createApproval idempotency key returns same pending row
  ---
  duration_ms: 6.735459
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

```

## 原因分析

测试命令非零退出（本仓库快照）。外链项目不会自动克隆；失败原因见上方测试摘录与 failure 文档中的完整输出。
