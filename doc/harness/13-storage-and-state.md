# 13 — Storage 与 State

> **设计选型**：为什么是 SQLite 而不是 PostgreSQL？为什么不是 Redis？为什么不是纯文件系统？——因为 Agent runtime 需要的是"单机可嵌入、零运维、事务安全、可分层上云"的存储，SQLite 恰好是这个交叉点的最优解。

---

## 选型决策

| 方案 | 考虑 | 否决原因 |
|------|------|----------|
| PostgreSQL | 强大、成熟 | 需要独立进程、运维成本高、本地开发需 docker |
| Redis | 快、适合缓存 | 非持久（默认）、不适合结构化查询 |
| 纯文件系统 | 简单 | 无事务、无索引、并发不安全 |
| LevelDB/RocksDB | 嵌入式 | KV 模型，不适合关系查询 |
| **SQLite** | **嵌入式 + SQL + 事务 + 零运维** | ✅ |

### 为什么 SQLite 对 Agent 特别合适？

1. **零部署依赖**：`npm install` 即可用，不需要 docker-compose
2. **单文件备份**：整个状态 = 一个 .db 文件，可随时 cp 备份
3. **同步 API**（better-sqlite3）：Node.js 单线程 + 同步 = 天然无并发问题
4. **足够快**：10k+ sessions、100k+ messages 的规模下响应 < 1ms
5. **事务安全**：WAL 模式下读写并发不阻塞

---

## 表结构全景

| 表 | 核心字段 | 说明 |
|----|----------|------|
| `sessions` | id, status, mode, agentId, taskId, summary, metadata | 会话主表 |
| `session_messages` | sessionId, role, parts(JSON), createdAt | 消息流 |
| `agents` | id, instructions, harnessRole, allowedTools | agent profile |
| `tasks` | id, status, artifacts | 外部驱动的任务 |
| `approvals` | toolCallId, verdict, expiresAt | 审批记录 |
| `agent_memory` | scope, key, value, confidence, importance | 五层记忆 |
| `agent_cases` | context, evaluation, importance, expiresAt | evolving case |
| `swarm_runs/tasks/reviews` | 状态机字段 | 多 agent 协作 |
| `self_heal_runs/events` | status, worktreePath | 自修复 |
| `orchestration_runs/steps/events` | 编排引擎 | 步骤驱动 pipeline |
| `research_tasks/sources/evidence/claims` | 深度研究 | evidence chain |
| `users/tenants/memberships` | 多用户隔离 | SaaS |

---

## 磁盘资产

SQLite 存结构化数据；大块内容走文件系统：

| 目录 | 内容 | 为什么不放 SQLite |
|------|------|------------------|
| `stateDir/images/<session>/` | 图片原文件 | 二进制大、按 hash 去重 |
| `stateDir/transcripts/<session>/` | autoCompact 归档 | JSONL 流式追加 |
| `stateDir/traces/<session>/` | trace events | JSONL 高吞吐追加 |
| `stateDir/working-logs/<session>/` | working log | append-only 文本 |
| `stateDir/llm-debug/<session>/` | LLM 请求快照 | 调试用，体积大 |

**设计原则**：SQLite 存索引和元数据，文件系统存内容本体。这避免了 SQLite 的 blob 性能问题，同时保持了"单目录即全量状态"的可备份性。

---

## 迁移纪律

版本号递增（v1–v10+），启动时自动对齐：

```ts
store.runMigrations() // 检查 schema_version → 逐步 up() 到最新
```

### 约束（硬规则）

1. **新表只能通过新 migration 创建**——禁止在代码里 lazy DDL
2. **字段不可删**（向前兼容）——只可 `ADD COLUMN`（nullable 或有 DEFAULT）
3. **索引按需加**——migration 内用 `CREATE INDEX IF NOT EXISTS`
4. **stateDir 路径稳定**——外部工具（working log、transcripts）靠路径引用

**为什么这么严格？** 因为 SQLite 不支持 `ALTER TABLE DROP COLUMN`（v3.35+ 才有），而且用户的 .db 文件可能从任何旧版本升级——向前兼容是唯一选项。

---

## 云端分层

本地 SQLite 解决单机场景；云端需要分层：

```
hot (本地文件) → warm (S3/OSS) → cold (只保留 hash, 删原文件)
```

| 组件 | 职责 |
|------|------|
| `tiered-asset-storage.ts` | 热→温→冷 生命周期管理 |
| `cloud/redis-event-buffer-repository.ts` | trace event 推 Redis（集中查询） |
| `provider-config.ts` | storage provider 配置 |

### Image Lifecycle

```
ingest (base64/URL) → sha256 dedup → local file (tier=hot)
  → 热图超限 → 生成 contact sheet (tier=warm)
  → 冷化（未访问 N 天） → tier=cold → 原文件可删
```

---

## 多用户隔离

云端按 `(tenant_id, user_id)` 做 row-level 隔离。每个表的查询函数都带 tenant/user 参数——不会出现跨租户数据泄露。

---

## 效果评估

| 指标 | 数值 |
|------|------|
| 启动到可服务 | < 200ms（含 migration check） |
| 10k sessions 查询 | < 5ms |
| 100k messages 全量 session 读取 | < 50ms |
| 备份/恢复 | cp 一个文件 |
| 多实例并发写 | 不支持（单 daemon 设计） |

---

## 长期计划

1. **Read replicas**：WAL 模式下支持只读副本，用于 API 查询不阻塞写入
2. **Cloud-native store**：SaaS 版本迁移到 Turso（SQLite 兼容的分布式方案）
3. **Incremental backup**：基于 WAL 的增量备份，而非全量 cp
4. **Retention policy**：自动清理 N 天前的 traces 和 transcripts

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `storage.ts` | `SqliteStateStore` 全量 CRUD |
| `stores/migrations/index.ts` | 迁移定义 |
| `image-assets.ts` | 图片资产生命周期 |
| `storage/tiered-asset-storage.ts` | S3 分层 |
