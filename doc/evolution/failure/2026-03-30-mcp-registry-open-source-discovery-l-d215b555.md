---
status: failure
source_url: "https://github.com/SirhanMacx/mcp-registry"
source_title: "MCP Registry – Open-source discovery layer for 20 Model Context Protocol servers"
experiment_branch: "exp/evolution-2026-03-30-mcp-registry-open-source-discovery-l-d215b555"
test_command: "npm run test:unit"
date_utc: "2026-03-30T17:02:51.200Z"
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

added 53 packages in 6s

10 packages are looking for funding
  run `npm fund` for details

> my-raw-agent-sdk@0.1.0 test:unit
> node --test packages/core/test/*.test.js packages/capability-gateway/test/*.test.js

TAP version 13
# node:internal/modules/esm/resolve:274
#     throw new ERR_MODULE_NOT_FOUND(
#           ^
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/capability-gateway/dist/im-handlers.js' imported from /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/capability-gateway/test/feishu-parse.test.js
#     at finalizeResolution (node:internal/modules/esm/resolve:274:11)
#     at moduleResolve (node:internal/modules/esm/resolve:859:10)
#     at defaultResolve (node:internal/modules/esm/resolve:983:11)
#     at \#cachedDefaultResolve (node:internal/modules/esm/loader:731:20)
#     at ModuleLoader.resolve (node:internal/modules/esm/loader:708:38)
#     at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:310:38)
#     at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
#   code: 'ERR_MODULE_NOT_FOUND',
#   url: 'file:///Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/capability-gateway/dist/im-handlers.js'
# }
# Node.js v22.21.1
# Subtest: packages/capability-gateway/test/feishu-parse.test.js
not ok 1 - packages/capability-gateway/test/feishu-parse.test.js
  ---
  duration_ms: 69.91275
  type: 'test'
  location: '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/capability-gateway/test/feishu-parse.test.js:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
# node:internal/modules/esm/resolve:274
#     throw new ERR_MODULE_NOT_FOUND(
#           ^
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/dist/builtin-skills.js' imported from /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/test/builtin-skills.test.js
#     at finalizeResolution (node:internal/modules/esm/resolve:274:11)
#     at moduleResolve (node:internal/modules/esm/resolve:859:10)
#     at defaultResolve (node:internal/modules/esm/resolve:983:11)
#     at \#cachedDefaultResolve (node:internal/modules/esm/loader:731:20)
#     at ModuleLoader.resolve (node:internal/modules/esm/loader:708:38)
#     at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:310:38)
#     at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
#   code: 'ERR_MODULE_NOT_FOUND',
#   url: 'file:///Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/dist/builtin-skills.js'
# }
# Node.js v22.21.1
# Subtest: packages/core/test/builtin-skills.test.js
not ok 2 - packages/core/test/builtin-skills.test.js
  ---
  duration_ms: 71.182541
  type: 'test'
  location: '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/test/builtin-skills.test.js:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
# node:internal/modules/esm/resolve:274
#     throw new ERR_MODULE_NOT_FOUND(
#           ^
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/dist/model-adapters.js' imported from /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/test/hybrid-router.test.js
#     at finalizeResolution (node:internal/modules/esm/resolve:274:11)
#     at moduleResolve (node:internal/modules/esm/resolve:859:10)
#     at defaultResolve (node:internal/modules/esm/resolve:983:11)
#     at \#cachedDefaultResolve (node:internal/modules/esm/loader:731:20)
#     at ModuleLoader.resolve (node:internal/modules/esm/loader:708:38)
#     at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:310:38)
#     at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
#   code: 'ERR_MODULE_NOT_FOUND',
#   url: 'file:///Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/dist/model-adapters.js'
# }
# Node.js v22.21.1
# Subtest: packages/core/test/hybrid-router.test.js
not ok 3 - packages/core/test/hybrid-router.test.js
  ---
  duration_ms: 68.328833
  type: 'test'
  location: '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/test/hybrid-router.test.js:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
# node:internal/modules/esm/resolve:274
#     throw new ERR_MODULE_NOT_FOUND(
#           ^
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/dist/runtime.js' imported from /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/test/runtime.test.js
#     at finalizeResolution (node:internal/modules/esm/resolve:274:11)
#     at moduleResolve (node:internal/modules/esm/resolve:859:10)
#     at defaultResolve (node:internal/modules/esm/resolve:983:11)
#     at \#cachedDefaultResolve (node:internal/modules/esm/loader:731:20)
#     at ModuleLoader.resolve (node:internal/modules/esm/loader:708:38)
#     at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:310:38)
#     at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
#   code: 'ERR_MODULE_NOT_FOUND',
#   url: 'file:///Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/dist/runtime.js'
# }
# Node.js v22.21.1
# Subtest: packages/core/test/runtime.test.js
not ok 4 - packages/core/test/runtime.test.js
  ---
  duration_ms: 71.115375
  type: 'test'
  location: '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/test/runtime.test.js:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
# node:internal/modules/esm/resolve:274
#     throw new ERR_MODULE_NOT_FOUND(
#           ^
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/dist/self-heal-policy.js' imported from /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/test/self-heal-policy.test.js
#     at finalizeResolution (node:internal/modules/esm/resolve:274:11)
#     at moduleResolve (node:internal/modules/esm/resolve:859:10)
#     at defaultResolve (node:internal/modules/esm/resolve:983:11)
#     at \#cachedDefaultResolve (node:internal/modules/esm/loader:731:20)
#     at ModuleLoader.resolve (node:internal/modules/esm/loader:708:38)
#     at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:310:38)
#     at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
#   code: 'ERR_MODULE_NOT_FOUND',
#   url: 'file:///Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/dist/self-heal-policy.js'
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

```

## 原因分析

测试命令非零退出（本仓库快照）。外链项目不会自动克隆；失败原因见上方测试摘录与 failure 文档中的完整输出。
