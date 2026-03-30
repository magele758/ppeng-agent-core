---
status: failure
source_url: "https://github.com/SirhanMacx/mcp-registry"
source_title: "MCP Registry – Open-source discovery layer for 20 Model Context Protocol servers"
experiment_branch: "exp/evolution-2026-03-30-mcp-registry-open-source-discovery-l-d215b555"
test_command: "bash scripts/evolution-agent-codex.sh"
date_utc: "2026-03-30T17:23:57.512Z"
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
`bash scripts/evolution-agent-codex.sh`

## Agent 钩子（失败）

命令："bash scripts/evolution-agent-codex.sh"


## 失败输出（摘录）

```
bash: scripts/evolution-agent-codex.sh: No such file or directory

```

## 原因分析

EVOLUTION_AGENT_CMD 非零退出；未执行构建与 EVOLUTION_TEST_CMD。请检查钩子脚本或 CLI/agent。
