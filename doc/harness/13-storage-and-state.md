# 13 — Storage 与 State

SQLite 主存 + 磁盘资产 + 可选云端分层 + 迁移纪律。

---

## SQLite 主表 (`storage.ts`, 725 行)

`SqliteStateStore` 是 runtime 唯一数据入口（同步 API，better-sqlite3）。

| 表名 | 说明 |
|------|------|
| `agents` | agent profile（instructions, harnessRole, allowedTools） |
| `sessions` | 会话（status, mode, agentId, taskId, summary, metadata JSON） |
| `session_messages` | 消息流（role, parts JSON, createdAt） |
| `tasks` | 外部可驱动的任务（status, artifacts） |
| `task_events` | 任务事件日志 |
| `approvals` | 工具审批记录 |
| `workspaces` | workspace 根目录注册 |
| `mailbox` | agent 间信箱（send_message 写、read_inbox 读） |
| `background_jobs` | bg_run 后台命令 |
| `image_assets` | 图片资产元数据（sha256, mimeType, retentionTier） |
| `session_memory` | 旧版 KV 记忆（向 agent_memory 迁移中） |
| `scheduler_wake` | autonomousScheduler 唤醒标记 |
| `self_heal_runs` / `self_heal_events` | self-heal 数据 |
| `daemon_control` | daemon restart request 握手 |
| `agent_cases` | evolving case store |
| `orchestration_runs` / `_steps` / `_events` | 编排引擎 |
| `research_tasks` / `_sources` / `_evidence` / `_claims` | deep research |
| `users` / `tenants` / `memberships` | 多用户隔离 |
| `agent_memory` | 五层记忆 |
| `swarm_runs` / `swarm_tasks` / `swarm_reviews` | swarm 协作 |
| `schema_version` | 迁移版本号 |

---

## 迁移 (`stores/migrations/index.ts`)

- 版本号递增（v1–v10+）。
- 启动时 `store.runMigrations()` 对齐到最新版本。
- 每个 migration 包含 `up()` 函数（CREATE TABLE / ALTER TABLE / CREATE INDEX）。
- **新增表只能通过新 migration**——禁止在 `storage.ts` 内 lazy DDL。

---

## 磁盘资产

| 目录 | 内容 |
|------|------|
| `stateDir/images/<session>/<id>.ext` | 图片原文件（hot/warm/cold 三档） |
| `stateDir/transcripts/<session>/<ts>.jsonl` | autoCompact 归档 |
| `stateDir/traces/<session>/<ts>.jsonl` | trace events |
| `stateDir/working-logs/<session>/working-memory.md` | working log |
| `stateDir/llm-debug/<session>/` | LLM prompt debug 快照（可选） |

---

## 云端分层 (`storage/`)

| 模块 | 说明 |
|------|------|
| `tiered-asset-storage.ts` | hot (本地) → warm (S3) → cold (删原文只留 hash) |
| `cloud/redis-event-buffer-repository.ts` | trace event 推 Redis（可选 cloud） |
| `provider-config.ts` | `RAW_AGENT_ASSET_STORAGE_PROVIDER` / tenant / user 默认值 |
| `interfaces.ts` | `AssetStorage` / `EventBufferRepository` 接口 |

---

## Image Lifecycle (`image-assets.ts`)

```
ingest (base64 / fetch-url)
  → sha256 dedup → 写 local file → 插 image_assets 行（tier=hot）
  → 热图超限 → 生成 contact sheet (tier=warm) → metadata.imageWarmContactAssetId
  → 冷化（未访问 N 天）→ tier=cold → 原文件可删、仅保留 hash
```

Warm contact sheet 通过 `prepareMessagesForModel` 自动注入为 ImagePart。

---

## 纪律（改动 checklist）

1. 新表 → 新 migration（版本号 = 当前最大 + 1）
2. 字段不可删（向前兼容），只可 ADD COLUMN（nullable 或有 DEFAULT）
3. 索引按查询需求加——migration 内用 `CREATE INDEX IF NOT EXISTS`
4. `stateDir` 路径保持稳定（working log / transcripts 靠路径被外部工具引用）
5. 多用户隔离：云端按 `(tenant_id, user_id)` 做 row-level 隔离

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `storage.ts` | `SqliteStateStore` 全量 CRUD |
| `stores/migrations/index.ts` | 迁移定义 |
| `stores/session-store.ts` | session 特化查询 |
| `stores/task-store.ts` | task 特化查询 |
| `stores/agent-case-store.ts` | case CRUD |
| `image-assets.ts` | 图片资产生命周期 |
| `storage/tiered-asset-storage.ts` | S3 分层 |
