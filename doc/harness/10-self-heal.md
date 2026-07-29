# 10 — Self-Heal

自动化修复：在隔离 worktree 里跑测试、失败则让 agent 修、修好合并回主仓。

---

## 状态机

```
created → running_tests → [success | fixing → running_tests…]
                            ├─ blocked (工具失败)
                            ├─ stopped (手动停止)
                            ├─ failed (超出 maxAttempts)
                            ├─ merging → [completed | merge_conflict]
                            └─ restart_pending → completed (daemon 握手重启)
```

---

## 调度器 (`self-heal/self-heal-scheduler.ts`)

`SelfHealScheduler` 单例（runtime 构造时创建），持有一个 `SelfHealContext`：

```ts
interface SelfHealContext {
  store: SelfHealStore;
  runtime: RawAgentRuntime;
  stateDir: string;
  repoRoot: string;
}
```

### 启动 (`start`)

1. 读 env → `normalizeSelfHealPolicy`（`SelfHealPolicy { preset, maxAttempts, autoMerge, autoPush }`)
2. 创建 git worktree（`gitWorktreeClean`）
3. 在 worktree 内执行白名单 npm script（`npmScriptForSelfHealPolicy`）
4. 结果写 `self_heal_runs` + `self_heal_events` 表

### 修复循环

```
loop:
  runTest (in worktree)
    ├─ pass → break → merge phase
    └─ fail → 用 agent session 修复（在同一 worktree context）
              → 再 runTest（maxAttempts 兜底）
```

### 合并 (`merging`)

- `gitMergeBranch` → 冲突则 `gitMergeAbort` → status `merge_conflict`
- 成功 → 可选 `gitPushBranch`（`RAW_AGENT_SELF_HEAL_GIT_PUSH`）
- 可选 daemon restart request（`restart_pending`）

---

## 与 runtime 的协作

- `runtime.runSession` 里跑的是一个 ephemeral session（专为修复创建）。
- Self-heal 可由 CLI / HTTP API / cron 触发。
- **不在正常对话 session 里跑**——避免把修复的工具调用混进用户对话。

---

## Env

| 变量 | 默认 | 说明 |
|------|------|------|
| `RAW_AGENT_SELF_HEAL_POLICY` | unit | test preset: unit/regression/e2e/ci/build |
| `RAW_AGENT_SELF_HEAL_MAX_ATTEMPTS` | 3 | 修复尝试上限 |
| `RAW_AGENT_SELF_HEAL_AUTO_MERGE` | 0 | 是否自动合并回主分支 |
| `RAW_AGENT_SELF_HEAL_AUTO_START` | 0 | 启动时自动开始 |
| `RAW_AGENT_SELF_HEAL_GIT_PUSH` | 0 | 合并后推远端 |
| `RAW_AGENT_NPM_BIN` / `RAW_AGENT_GIT_BIN` | (PATH) | spawn 用的可执行路径覆盖 |

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `self-heal/self-heal-scheduler.ts` | 主调度器 |
| `self-heal/self-heal-executors.ts` | git / npm 原子操作 |
| `self-heal/self-heal-policy.ts` | policy 解析 + npm script 映射 |
| `stores/self-heal-store.ts` | SQLite CRUD (runs + events) |
