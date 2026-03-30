# evolution-run-day 最近一次

[2026-03-30T17:13:36.595Z] 启动
[2026-03-30T17:13:36.596Z] inbox: /Users/penglei/developer/self-test-grounding/ppeng-agent-core/doc/evolution/inbox/2026-03-30.md
[2026-03-30T17:13:36.596Z] 解析: inbox 内共 148 条链接，本跑取前 3 条（EVOLUTION_MAX_ITEMS=3）
[2026-03-30T17:13:36.596Z] 策略: 目标分支=main, 测试=npm run test:unit, npm ci=执行, 构建=npx tsc -b packages/core packages/capability-gateway, 自动合并=否
[2026-03-30T17:13:36.596Z] 说明：每条会先抓取来源 URL 的正文摘录（供对照）；验证阶段在本仓库独立 worktree 跑白名单测试，不克隆外链仓库。
[2026-03-30T17:13:36.596Z] 并发: 3（EVOLUTION_CONCURRENCY，上限 3）
[2026-03-30T17:13:36.597Z] [1/3] ━━ 开始 ━━
[2026-03-30T17:13:36.597Z] [1/3] 标题: Show HN: ClamBot – AI agent that runs all LLM-generated code in a WASM sandbox
[2026-03-30T17:13:36.597Z] [1/3] 链接: https://github.com/clamguy/clambot
[2026-03-30T17:13:36.615Z] [2/3] ━━ 开始 ━━
[2026-03-30T17:13:36.615Z] [2/3] 标题: MCP Registry – Open-source discovery layer for 20 Model Context Protocol servers
[2026-03-30T17:13:36.615Z] [2/3] 链接: https://github.com/SirhanMacx/mcp-registry
[2026-03-30T17:13:36.615Z] [3/3] ━━ 开始 ━━
[2026-03-30T17:13:36.615Z] [3/3] 标题: The MCP Ecosystem: How Model Context Protocol Is Becoming the HTTP of AI Agents
[2026-03-30T17:13:36.615Z] [3/3] 链接: https://primitivesai.substack.com/p/the-mcp-ecosystem-how-a-protocol
[2026-03-30T17:13:37.058Z] [3/3] 来源正文抓取失败或为空: fetch failed（443ms）
[2026-03-30T17:13:37.058Z] [3/3] slug=the-mcp-ecosystem-how-model-context--ced87e27 → 分支 exp/evolution-2026-03-30-the-mcp-ecosystem-how-model-context--ced87e27，worktree /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-the-mcp-ecosystem-how-model-context--ced87e27
[2026-03-30T17:13:37.125Z] [3/3] 清理旧 worktree/分支 (67ms)
[2026-03-30T17:13:37.192Z] [3/3] git worktree add → exit=0 (67ms)
[2026-03-30T17:13:37.192Z] [3/3] 已拷贝主仓 .env → worktree
[2026-03-30T17:13:37.192Z] [3/3] 已拷贝 gateway.config.json → worktree/gateway.config.json
[2026-03-30T17:13:38.132Z] [1/3] 来源正文已抓取 14000 字（1535ms）
[2026-03-30T17:13:38.132Z] [1/3] slug=show-hn-clambot-ai-agent-that-runs-a-85987e11 → 分支 exp/evolution-2026-03-30-show-hn-clambot-ai-agent-that-runs-a-85987e11，worktree /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-show-hn-clambot-ai-agent-that-runs-a-85987e11
[2026-03-30T17:13:38.214Z] [1/3] 清理旧 worktree/分支 (82ms)
[2026-03-30T17:13:38.300Z] [1/3] git worktree add → exit=0 (85ms)
[2026-03-30T17:13:38.300Z] [1/3] 已拷贝主仓 .env → worktree
[2026-03-30T17:13:38.301Z] [1/3] 已拷贝 gateway.config.json → worktree/gateway.config.json
[2026-03-30T17:13:38.395Z] [2/3] 来源正文已抓取 5826 字（1780ms）
[2026-03-30T17:13:38.395Z] [2/3] slug=mcp-registry-open-source-discovery-l-d215b555 → 分支 exp/evolution-2026-03-30-mcp-registry-open-source-discovery-l-d215b555，worktree /Users/penglei/developer/self-test-grounding/ppeng-agent-core/.evolution-worktrees/2026-03-30-mcp-registry-open-source-discovery-l-d215b555
[2026-03-30T17:13:38.460Z] [2/3] 清理旧 worktree/分支 (65ms)
[2026-03-30T17:13:38.530Z] [2/3] git worktree add → exit=0 (70ms)
[2026-03-30T17:13:38.530Z] [2/3] 已拷贝主仓 .env → worktree
[2026-03-30T17:13:38.530Z] [2/3] 已拷贝 gateway.config.json → worktree/gateway.config.json
[2026-03-30T17:13:43.483Z] [3/3] npm ci → exit=0 (6291ms)
[2026-03-30T17:13:44.093Z] [2/3] npm ci → exit=0 (5563ms)
[2026-03-30T17:13:44.097Z] [1/3] npm ci → exit=0 (5796ms)
[2026-03-30T17:13:45.167Z] [3/3] 构建「npx tsc -b packages/core packages/capability-gateway」→ exit=0 (1684ms)
[2026-03-30T17:13:45.687Z] [2/3] 构建「npx tsc -b packages/core packages/capability-gateway」→ exit=0 (1594ms)
[2026-03-30T17:13:45.796Z] [1/3] 构建「npx tsc -b packages/core packages/capability-gateway」→ exit=0 (1699ms)
[2026-03-30T17:13:45.903Z] [3/3] 测试命令「npm run test:unit」→ exit=0 (736ms)
[2026-03-30T17:13:46.698Z] [2/3] 测试命令「npm run test:unit」→ exit=0 (1011ms)
[2026-03-30T17:13:46.698Z] [1/3] 测试命令「npm run test:unit」→ exit=0 (902ms)
[2026-03-30T17:13:46.824Z] [3/3] worktree 已移除
[2026-03-30T17:13:46.824Z] [3/3] 未自动合并：分支 exp/evolution-2026-03-30-the-mcp-ecosystem-how-model-context--ced87e27 保留，可手动 git merge
[2026-03-30T17:13:46.824Z] [3/3] 结果: 成功 → 已写 doc/evolution/success/
[2026-03-30T17:13:48.019Z] [2/3] worktree 已移除
[2026-03-30T17:13:48.019Z] [2/3] 未自动合并：分支 exp/evolution-2026-03-30-mcp-registry-open-source-discovery-l-d215b555 保留，可手动 git merge
[2026-03-30T17:13:48.019Z] [2/3] 结果: 成功 → 已写 doc/evolution/success/
[2026-03-30T17:13:48.019Z] [1/3] worktree 已移除
[2026-03-30T17:13:48.019Z] [1/3] 未自动合并：分支 exp/evolution-2026-03-30-show-hn-clambot-ai-agent-that-runs-a-85987e11 保留，可手动 git merge
[2026-03-30T17:13:48.019Z] [1/3] 结果: 成功 → 已写 doc/evolution/success/
[2026-03-30T17:13:48.020Z] 全部条目处理完毕
[2026-03-30T17:13:48.020Z] 可读摘要 → doc/evolution/runs/latest-run-day.md

（终端亦有相同时间戳行；设 `EVOLUTION_NO_RUN_LOG=1` 可禁用本文件）
