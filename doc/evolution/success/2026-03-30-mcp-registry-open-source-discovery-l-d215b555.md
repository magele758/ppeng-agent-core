---
status: success
source_url: "https://github.com/SirhanMacx/mcp-registry"
source_title: "MCP Registry – Open-source discovery layer for 20 Model Context Protocol servers"
experiment_branch: "exp/evolution-2026-03-30-mcp-registry-open-source-discovery-l-d215b555"
test_command: "npm run test:unit"
merged: false
merge_commit: ""
date_utc: "2026-03-30T17:29:24.068Z"
---

# 实验成功：MCP Registry – Open-source discovery layer for 20 Model Context Protocol servers

## 来源
- [MCP Registry – Open-source discovery layer for 20 Model Context Protocol servers](https://github.com/SirhanMacx/mcp-registry)

## 来源正文摘录（抓取）
```
GitHub - SirhanMacx/mcp-registry: Community registry for Model Context Protocol (MCP) servers — verified install commands, tool listings, structured metadata · GitHub Skip to content Navigation Menu Toggle navigation Sign in Appearance settings Platform AI CODE CREATION GitHub Copilot Write better code with AI GitHub Spark Build and deploy intelligent apps GitHub Models Manage and compare prompts MCP Registry New Integrate external tools DEVELOPER WORKFLOWS Actions Automate any workflow Codespaces Instant dev environments Issues Plan and track work Code Review Manage code changes APPLICATION SECURITY GitHub Advanced Security Find and fix vulnerabilities Code security Secure your code as you build Secret protection Stop leaks before they start EXPLORE Why GitHub Documentation Blog Changelog Marketplace View all features Solutions BY COMPANY SIZE Enterprises Small and medium teams Startups Nonprofits BY USE CASE App Modernization DevSecOps DevOps CI/CD View all use cases BY INDUSTRY Healthcare Financial services Manufacturing Government View all industries View all solutions Resources EXPLORE BY TOPIC AI Software Development DevOps Security View all topics EXPLORE BY TYPE Customer stories Events &amp; webinars Ebooks &amp; reports Business insights GitHub Skills SUPPORT &amp; SERVICES Documentation Customer support Community forum Trust center Partners View all resources Open Source COMMUNITY GitHub Sponsors Fund open source developers PROGRAMS Security Lab Maintainer Community Accelerator GitHub Stars Archive Program REPOSITORIES Topics Trending Collections Enterprise ENTERPRISE SOLUTIONS Enterprise platform AI-powered developer platform AVAILABLE ADD-ONS GitHub Advanced Security Enterprise-grade security features Copilot for Business Enterprise-grade AI features Premium Support Enterprise-grade 24/7 support Pricing Search or jump to... Search code, repositories, users, issues, pull requests... --> Search Clear Search syntax tips Provide feedback --> We read every piece of feedback, and take your input very seriously. Include my email address so I can be contacted Cancel Submit feedback Saved searches Use saved searches to filter your results more quickly --> Name Query To see all available qualifiers, see our documentation . Cancel Create saved search Sign in Sign up Appearance settings Resetting focus You signed in with another tab or window. Reload to refresh your session. You signed out in another tab or window. Reload to refresh your session. You switched accounts on another tab or window. Reload to refresh your session. Dismiss alert {{ message }} SirhanMacx / mcp-registry Public Notifications You must be signed in to change notification settings Fork 1 Star 4 Code Issues 0 Pull requests 0 Actions Projects Security 0 Insights Additional navigation options Code Issues Pull requests Actions Projects Security Insights SirhanMacx/mcp-registry main Branches Tags Go to file Code Open more actions menu Folders and files Name Name Last commit message Last commit date Latest commit History 2 Commits 2 Commits .github .github dist dist registry registry schema schema scripts scripts web web CONTRIBUTING.md CONTRIBUTING.md README.md README.md View all files Repository files navigation README Contributing MCP Registry 🔌 The missing discovery layer for Model Context Protocol servers. Problem: MCP is growing fast but finding servers is chaos. There's no canonical registry, no search, no compatibility metadata — just scattered GitHub repos and random awesome-lists. Solution: A community-maintained, searchable registry with structured metadata for every MCP server. What's here registry/ — Structured JSON entries for each MCP server schema/ — JSON schema for registry entries web/ — Static site for browsing/searching (no backend needed) scripts/ — Validation and build tools Entry format { "id" : " sqlite-mcp " , "name" : " SQLite MCP Server " , "description" : " Read/write SQLite databases from any MCP-compatible agent " , "author" : " someone " , "repo" : " https://github.com/someone/sqlite-mcp " , "install" : " npx sqlite-mcp " , "protocol_version" : " 2024-11-05 " , "tools" : [ " query " , " execute " , " list_tables " , " describe_table " ], "prompts" : [], "resources" : [ " sqlite:///{path} " ], "tags" : [ " database " , " sqlite " , " storage " ], "verified" : false , "submitted" : " 2026-03-22 " } Why this matters MCP is becoming the standard way for AI agents to access tools. But right now: Finding servers requires hours of GitHub searching No way to know if a server is maintained or abandoned No compatibility metadata (which clients work with it?) No usage stats or community validation This registry changes that. Contributing Submit a PR adding your server to registry/ . One JSON file per server. The schema validates automatically. Status 🟡 Early — seeding initial entries. PRs welcome. Related Machina Market — Premium MCP server packs (catalog.json for agent-native purchase) MCP Spec MCP SDK About Community registry for Model Context Protocol (MCP) servers — verified install commands, tool listings, structured metadata Topics open-source registry tools mcp ai-agents claude llm model-context-protocol Resources Readme Contributing Contributing Uh oh! There was an error while loading. Please reload this page . Activity Stars 4 stars Watchers 0 watching Forks 1 fork Report repository Releases No releases published Packages 0 &nbsp; &nbsp; &nbsp; Uh oh! There was an error while loading. Please reload this page . Contributors 1 minduploadedcrab Languages HTML 86.8% Python 13.2% Footer &copy; 2026 GitHub,&nbsp;Inc. Footer navigation Terms Privacy Security Status Community Docs Contact Manage cookies Do not share my personal information You can’t perform that action at this time.
```


## 实验分支
`exp/evolution-2026-03-30-mcp-registry-open-source-discovery-l-d215b555`

## 测试命令
`npm run test:unit`

## Agent 钩子

命令："bash scripts/evolution-agent-codex.sh"

```

> my-raw-agent-sdk@0.1.0 ai:codex
> bash scripts/ai-cli/run-codex-fix.sh

repo: /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555
I made a small MCP discovery improvement in the core runtime. [`packages/core/src/runtime.ts`](/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/src/runtime.ts#L32) now reuses `parseMcpUrls()` instead of duplicating env parsing, and [`ensureMcpTools()`](/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/src/runtime.ts#L195) registers a new approval-gated `mcp_list_tools` tool alongside `mcp_invoke`. That gives agents a minimal discovery path for configured MCP servers without changing the existing invoke behavior.

I also added focused tests for the MCP JSON-RPC helpers in [`packages/core/test/mcp-jsonrpc.test.js`](/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/test/mcp-jsonrpc.test.js#L1) and extended the runtime coverage in [`packages/core/test/runtime.test.js`](/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/test/runtime.test.js#L461) to verify MCP discovery tools are registered when `RAW_AGENT_MCP_URLS` is set.

Verification: `npm run build` and `npm run test:unit` both pass.
2026-03-30T17:25:41.513159Z ERROR codex_core_skills::loader: failed to stat skills entry /Users/penglei/.codex/skills/brainstorming (symlink): No such file or directory (os error 2)
2026-03-30T17:25:41.513317Z ERROR codex_core_skills::loader: failed to stat skills entry /Users/penglei/.codex/skills/ai-daily-digest (symlink): No such file or directory (os error 2)
2026-03-30T17:25:41.513324Z ERROR codex_core_skills::loader: failed to stat skills entry /Users/penglei/.codex/skills/vercel-react-best-practices (symlink): No such file or directory (os error 2)
2026-03-30T17:25:41.540264Z ERROR codex_core_skills::loader: failed to stat skills entry /Users/penglei/.agents/skills/ui-ux-pro-max/scripts (symlink): No such file or directory (os error 2)
2026-03-30T17:25:41.540677Z ERROR codex_core_skills::loader: failed to stat skills entry /Users/penglei/.agents/skills/ui-ux-pro-max/data (symlink): No such file or directory (os error 2)
OpenAI Codex v0.117.0 (research preview)
--------
workdir: /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555
model: gpt-5.4
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR, /Users/penglei/.codex/memories]
reasoning effort: high
reasoning summaries: none
session id: 019d3fc7-ada7-7970-9705-75c3e3a9be6a
--------
user
Based on the following constraints and source excerpt, make minimal, safe improvements to this repository. Prefer tests and small refactors; do not add unrelated features.

## Constraints


## Source excerpt
GitHub - SirhanMacx/mcp-registry: Community registry for Model Context Protocol (MCP) servers — verified install commands, tool listings, structured metadata · GitHub Skip to content Navigation Menu Toggle navigation Sign in Appearance settings Platform AI CODE CREATION GitHub Copilot Write better code with AI GitHub Spark Build and deploy intelligent apps GitHub Models Manage and compare prompts MCP Registry New Integrate external tools DEVELOPER WORKFLOWS Actions Automate any workflow Codespaces Instant dev environments Issues Plan and track work Code Review Manage code changes APPLICATION SECURITY GitHub Advanced Security Find and fix vulnerabilities Code security Secure your code as you build Secret protection Stop leaks before they start EXPLORE Why GitHub Documentation Blog Changelog Marketplace View all features Solutions BY COMPANY SIZE Enterprises Small and medium teams Startups Nonprofits BY USE CASE App Modernization DevSecOps DevOps CI/CD View all use cases BY INDUSTRY Healthcare Financial services Manufacturing Government View all industries View all solutions Resources EXPLORE BY TOPIC AI Software Development DevOps Security View all topics EXPLORE BY TYPE Customer stories Events &amp; webinars Ebooks &amp; reports Business insights GitHub Skills SUPPORT &amp; SERVICES Documentation Customer support Community forum Trust center Partners View all resources Open Source COMMUNITY GitHub Sponsors Fund open source developers PROGRAMS Security Lab Maintainer Community Accelerator GitHub Stars Archive Program REPOSITORIES Topics Trending Collections Enterprise ENTERPRISE SOLUTIONS Enterprise platform AI-powered developer platform AVAILABLE ADD-ONS GitHub Advanced Security Enterprise-grade security features Copilot for Business Enterprise-grade AI features Premium Support Enterprise-grade 24/7 support Pricing Search or jump to... Search code, repositories, users, issues, pull requests... --> Search Clear Search syntax tips Provide feedback --> We read every piece of feedback, and take your input very seriously. Include my email address so I can be contacted Cancel Submit feedback Saved searches Use saved searches to filter your results more quickly --> Name Query To see all available qualifiers, see our documentation . Cancel Create saved search Sign in Sign up Appearance settings Resetting focus You signed in with another tab or window. Reload to refresh your session. You signed out in another tab or window. Reload to refresh your session. You switched accounts on another tab or window. Reload to refresh your session. Dismiss alert {{ message }} SirhanMacx / mcp-registry Public Notifications You must be signed in to change notification settings Fork 1 Star 4 Code Issues 0 Pull requests 0 Actions Projects Security 0 Insights Additional navigation options Code Issues Pull requests Actions Projects Security Insights SirhanMacx/mcp-registry main Branches Tags Go to file Code Open more actions menu Folders and files Name Name Last commit message Last commit date Latest commit History 2 Commits 2 Commits .github .github dist dist registry registry schema schema scripts scripts web web CONTRIBUTING.md CONTRIBUTING.md README.md README.md View all files Repository files navigation README Contributing MCP Registry 🔌 The missing discovery layer for Model Context Protocol servers. Problem: MCP is growing fast but finding servers is chaos. There's no canonical registry, no search, no compatibility metadata — just scattered GitHub repos and random awesome-lists. Solution: A community-maintained, searchable registry with structured metadata for every MCP server. What's here registry/ — Structured JSON entries for each MCP server schema/ — JSON schema for registry entries web/ — Static site for browsing/searching (no backend needed) scripts/ — Validation and build tools Entry format { "id" : " sqlite-mcp " , "name" : " SQLite MCP Server " , "description" : " Read/write SQLite databases from any MCP-compatible agent " , "author" : " someone " , "repo" : " https://github.com/someone/sqlite-mcp " , "install" : " npx sqlite-mcp " , "protocol_version" : " 2024-11-05 " , "tools" : [ " query " , " execute " , " list_tables " , " describe_table " ], "prompts" : [], "resources" : [ " sqlite:///{path} " ], "tags" : [ " database " , " sqlite " , " storage " ], "verified" : false , "submitted" : " 2026-03-22 " } Why this matters MCP is becoming the standard way for AI agents to access tools. But right now: Finding servers requires hours of GitHub searching No way to know if a server is maintained or abandoned No compatibility metadata (which clients work with it?) No usage stats or community validation This registry changes that. Contributing Submit a PR adding your server to registry/ . One JSON file per
```

## worktree 变更（git diff --stat / status）

```
packages/core/src/runtime.ts       | 48 +++++++++++++++++++++++++++++++++-----
 packages/core/test/runtime.test.js | 16 +++++++++++++
 2 files changed, 58 insertions(+), 6 deletions(-)

M packages/core/src/runtime.ts
 M packages/core/test/runtime.test.js
?? .evolution/
?? packages/core/test/mcp-jsonrpc.test.js
```

## 输出摘要

```

added 53 packages in 6s

10 packages are looking for funding
  run `npm fund` for details

> my-raw-agent-sdk@0.1.0 ai:codex
> bash scripts/ai-cli/run-codex-fix.sh

repo: /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555
I made a small MCP discovery improvement in the core runtime. [`packages/core/src/runtime.ts`](/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/src/runtime.ts#L32) now reuses `parseMcpUrls()` instead of duplicating env parsing, and [`ensureMcpTools()`](/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/src/runtime.ts#L195) registers a new approval-gated `mcp_list_tools` tool alongside `mcp_invoke`. That gives agents a minimal discovery path for configured MCP servers without changing the existing invoke behavior.

I also added focused tests for the MCP JSON-RPC helpers in [`packages/core/test/mcp-jsonrpc.test.js`](/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/test/mcp-jsonrpc.test.js#L1) and extended the runtime coverage in [`packages/core/test/runtime.test.js`](/Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555/packages/core/test/runtime.test.js#L461) to verify MCP discovery tools are registered when `RAW_AGENT_MCP_URLS` is set.

Verification: `npm run build` and `npm run test:unit` both pass.
2026-03-30T17:25:41.513159Z ERROR codex_core_skills::loader: failed to stat skills entry /Users/penglei/.codex/skills/brainstorming (symlink): No such file or directory (os error 2)
2026-03-30T17:25:41.513317Z ERROR codex_core_skills::loader: failed to stat skills entry /Users/penglei/.codex/skills/ai-daily-digest (symlink): No such file or directory (os error 2)
2026-03-30T17:25:41.513324Z ERROR codex_core_skills::loader: failed to stat skills entry /Users/penglei/.codex/skills/vercel-react-best-practices (symlink): No such file or directory (os error 2)
2026-03-30T17:25:41.540264Z ERROR codex_core_skills::loader: failed to stat skills entry /Users/penglei/.agents/skills/ui-ux-pro-max/scripts (symlink): No such file or directory (os error 2)
2026-03-30T17:25:41.540677Z ERROR codex_core_skills::loader: failed to stat skills entry /Users/penglei/.agents/skills/ui-ux-pro-max/data (symlink): No such file or directory (os error 2)
OpenAI Codex v0.117.0 (research preview)
--------
workdir: /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555
model: gpt-5.4
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR, /Users/penglei/.codex/memories]
reasoning effort: high
reasoning summaries: none
session id: 019d3fc7-ada7-7970-9705-75c3e3a9be6a
--------
user
Based on the following constraints and source excerpt, make minimal, safe improvements to this repository. Prefer tests and small refactors; do not add unrelated features.

## Constraints


## Source excerpt
GitHub - SirhanMacx/mcp-registry: Community registry for Model Context Protocol (MCP) servers — verified install commands, tool listings, structured metadata · GitHub Skip to content Navigation Menu Toggle navigation Sign in Appearance settings Platform AI CODE CREATION GitHub Copilot Write better code with AI GitHub Spark Build and deploy intelligent apps GitHub Models Manage and compare prompts MCP Registry New Integrate external tools DEVELOPER WORKFLOWS Actions Automate any workflow Codespaces Instant dev environments Issues Plan and track work Code Review Manage code changes APPLICATION SECURITY GitHub Advanced Security Find and fix vulnerabilities Code security Secure your code as you build Secret protection Stop leaks before they start EXPLORE Why GitHub Documentation Blog Changelog Marketplace View all features Solutions BY COMPANY SIZE Enterprises Small and medium teams Startups Nonprofits BY USE CASE App Modernization DevSecOps DevOps CI/CD View all use cases BY INDUSTRY Healthcare Financial services Manufacturing Government View all industries View all solutions Resources EXPLORE BY TOPIC AI Software Development DevOps Security View all topics EXPLORE BY TYPE Customer stories Events &amp; webinars Ebooks &amp; reports Business insights GitHub Skills SUPPORT &amp; SERVICES Documentation Customer support Community forum Trust center Partners View all resources Open Source COMMUNITY GitHub Sponsors Fund open source developers PROGRAMS Security Lab Maintainer Community Accelerator GitHub Stars Archive Program REPOSITORIES Topics Trending Collections Enterprise ENTERPRISE SOLUTIONS Enterprise platform AI-powered developer platform AVAILABLE ADD-ONS GitHub Advanced Security Enterprise-grade security features Copilot for Business Enterprise-grade AI features Premium Support Enterprise-grade 24/7 support Pricing Search or jump to... Search code, repositories, users, issues, pull requests... --> Search Clear Search syntax tips Provide feedback --> We read every piece of feedback, and take your input very seriously. Include my email address so I can be contacted Cancel Submit feedback Saved searches Use saved searches to filter your results more quickly --> Name Query To see all available qualifiers, see our documentation . Cancel Create saved search Sign in Sign up Appearance settings Resetting focus You signed in with another tab or window. Reload to refresh your session. You signed out in another tab or window. Reload to refresh your session. You switched accounts on another tab or window. Reload to refresh your session. Dismiss alert {{ message }} SirhanMacx / mcp-registry Public Notifications You must be signed in to change notification settings Fork 1 Star 4 Code Issues 0 Pull requests 0 Actions Projects Security 0 Insights Additional navigation options Code Issues Pull requests Actions Projects Security Insights SirhanMacx/mcp-registry main Branches Tags Go to file Code Open more actions menu Folders and files Name Name Last commit message Last commit date Latest commit History 2 Commits 2 Commits .github .github dist dist registry registry schema schema scripts scripts web web CONTRIBUTING.md CONTRIBUTING.md README.md README.md View all files Repository files navigation README Contributing MCP Registry 🔌 The missing discovery layer for Model Context Protocol servers. Problem: MCP is growing fast but finding servers is chaos. There's no canonical registry, no search, no compatibility metadata — just scattered GitHub repos and random awesome-lists. Solution: A community-maintained, searchable registry with structured metadata for every MCP server. What's here registry/ — Structured JSON entries for each MCP server schema/ — JSON schema for registry entries web/ — Static site for browsing/searching (no backend needed) scripts/ — Validation and build tools Entry format { "id" : " sqlite-mcp " , "name" : " SQLite MCP Server " , "description" : " Read/write SQLite databases from any MCP-compatible agent " , "author" : " someone " , "repo" : " https://github.com/someone/sqlite-mcp " , "install" : " npx sqlite-mcp " , "protocol_version" : " 2024-11-05 " , "tools" : [ " query " , " execute " , " list_tables " , " describe_table " ], "prompts" : [], "resources" : [ " sqlite:///{path} " ], "tags" : [ " database " , " sqlite " , " storage " ], "verified" : false , "submitted" : " 2026-03-22 " } Why this matters MCP is becoming the standard way for AI agents to access tools. But right now: Finding servers requires hours of GitHub searching No way to know if a server is maintained or abandoned No compatibility metadata (which clients work with it?) No usage stats or community validation This registry changes that. Contributing Submit a PR adding your server to registry/ . One JSON file per server. The schema validates automatically. Status 🟡 Early — seeding initial entries. PRs welcome. Related Machina Market — Premium MCP server packs (catalog.json for agent-native purchase) MCP Spec MCP SDK About Community registry for Model Context Protocol (MCP) servers — verified install commands, tool listings, structured metadata Topics open-source registry tools mcp ai-agents claude llm model-context-protocol Resources Readme Contributing Contributing Uh oh! There was an error while loading. Please reload this page . Activity Stars 4 stars Watchers 0 watching Forks 1 fork Report repository Releases No releases published Packages 0 &nbsp; &nbsp; &nbsp; Uh oh! There was an error while loading. Please reload this page . Contributors 1 minduploadedcrab Languages HTML 86.8% Python 13.2% Footer &copy; 2026 GitHub,&nbsp;Inc. Footer navigation Terms Privacy Security Status Community Docs Contact Manage cookies Do not share my personal information You can’t perform that action at this time.
2026-03-30T17:25:46.788159Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: IO error: invalid peer certificate: certificate not valid for name "chatgpt.com"; certificate is only valid for DnsName("*.facebook.com"), DnsName("*.facebook.net"), DnsName("*.fbcdn.net"), DnsName("*.fbsbx.com"), DnsName("*.m.facebook.com"), DnsName("*.messenger.com"), DnsName("*.xx.fbcdn.net"), DnsName("*.xy.fbcdn.net"), DnsName("*.xz.fbcdn.net"), DnsName("facebook.com") or DnsName("messenger.com"), url: wss://chatgpt.com/backend-api/codex/responses
2026-03-30T17:25:47.700971Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: IO error: invalid peer certificate: certificate not valid for name "chatgpt.com"; certificate is only valid for DnsName("*.facebook.com"), DnsName("*.facebook.net"), DnsName("*.fbcdn.net"), DnsName("*.fbsbx.com"), DnsName("*.m.facebook.com"), DnsName("*.messenger.com"), DnsName("*.xx.fbcdn.net"), DnsName("*.xy.fbcdn.net"), DnsName("*.xz.fbcdn.net"), DnsName("facebook.com") or DnsName("messenger.com"), url: wss://chatgpt.com/backend-api/codex/responses
2026-03-30T17:25:48.770439Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: IO error: invalid peer certificate: certificate not valid for name "chatgpt.com"; certificate is only valid for DnsName("*.facebook.com"), DnsName("*.facebook.net"), DnsName("*.fbcdn.net"), DnsName("*.fbsbx.com"), DnsName("*.m.facebook.com"), DnsName("*.messenger.com"), DnsName("*.xx.fbcdn.net"), DnsName("*.xy.fbcdn.net"), DnsName("*.xz.fbcdn.net"), DnsName("facebook.com") or DnsName("messenger.com"), url: wss://chatgpt.com/backend-api/codex/responses
ERROR: Reconnecting... 2/5
2026-03-30T17:25:50.423426Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: IO error: invalid peer certificate: certificate not valid for name "chatgpt.com"; certificate is only valid for DnsName("*.facebook.com"), DnsName("*.facebook.net"), DnsName("*.fbcdn.net"), DnsName("*.fbsbx.com"), DnsName("*.m.facebook.com"), DnsName("*.messenger.com"), DnsName("*.xx.fbcdn.net"), DnsName("*.xy.fbcdn.net"), DnsName("*.xz.fbcdn.net"), DnsName("facebook.com") or DnsName("messenger.com"), url: wss://chatgpt.com/backend-api/codex/responses
ERROR: Reconnecting... 3/5
2026-03-30T17:25:51.989480Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: IO error: invalid peer certificate: certificate not valid for name "chatgpt.com"; certificate is only valid for DnsName("*.facebook.com"), DnsName("*.facebook.net"), DnsName("*.fbcdn.net"), DnsName("*.fbsbx.com"), DnsName("*.m.facebook.com"), DnsName("*.messenger.com"), DnsName("*.xx.fbcdn.net"), DnsName("*.xy.fbcdn.net"), DnsName("*.xz.fbcdn.net"), DnsName("facebook.com") or DnsName("messenger.com"), url: wss://chatgpt.com/backend-api/codex/responses
ERROR: Reconnecting... 4/5
202
```

## 合并

未自动合并（EVOLUTION_AUTO_MERGE=0）；请在主仓手动 `git merge exp/evolution-2026-03-30-mcp-registry-open-source-discovery-l-d215b555`
