# 10 — Self-Heal

> **愿景**：Agent 不只是帮人写代码——它能自己发现自己写坏了什么，自己修好，自己合并。Self-Heal 是 ppeng 走向"自主维护"的第一步。

---

## 问题：为什么需要自动修复？

Agent 写的代码不一定对。但如果每次都要人来跑测试、看报错、告诉 agent 改什么——agent 就只是"打字更快的人"。

Self-Heal 的目标：**agent 自己发现测试失败 → 自己修复 → 自己验证 → 自己合并**。人类只需要在最后审一眼（或完全自动）。

---

## 设计方案

### 核心流程

```
                    ┌─────────────────────────────────┐
                    │        SelfHealScheduler         │
                    └──────────────┬──────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
  创建 git worktree          跑测试                     合并回主仓
  (隔离环境)                 (白名单 npm script)        (可选自动)
        │                          │
        │                    ┌─────┴─────┐
        │                    │  通过？    │
        │                    └─────┬─────┘
        │                     ✅     ❌
        │                     │      │
        │                  merge   创建修复 session
        │                          │
        │                          ▼
        │                    agent 修复代码
        │                          │
        │                          ▼
        │                    重新跑测试
        │                    (loop: maxAttempts)
        └──────────────────────────┘
```

### 为什么用 git worktree？

| 方案 | 问题 |
|------|------|
| 直接在主仓修 | 修复过程中的脏文件影响开发者的工作 |
| git stash | 复杂度高，容易 stash 冲突 |
| 新 clone | 太慢（大仓库 clone 要分钟级） |
| **git worktree** | **秒级创建、完全隔离、共享 .git 对象** |

### 为什么不在正常对话 session 里跑？

修复的工具调用（bash/edit_file）不应该混进用户对话——会污染上下文、混淆状态。所以 self-heal 创建**独立的 ephemeral session**，只活在 worktree 内。

---

## 状态机

```
created → running_tests → [success → merge]
                        → [fixing → running_tests → ...]
                                    ├─ blocked (工具失败不可恢复)
                                    ├─ stopped (手动停止)
                                    ├─ failed (超出 maxAttempts)
                                    └─ merge_conflict
```

### 合并策略

| 配置 | 行为 |
|------|------|
| `autoMerge: false` | 修好后等人确认 |
| `autoMerge: true` | 自动 `git merge`；冲突则 abort |
| `autoPush: true` | 合并后推远端 |
| `restart_pending` | 合并后通知 daemon 重启（代码改了自己） |

---

## 设计亮点

1. **白名单测试脚本**：不是随便跑什么——通过 `SelfHealPolicy.preset`（unit/regression/e2e/ci/build）映射到具体 npm script，防止 agent 被诱导跑恶意命令
2. **supervisor 协作**：`supervisor.mjs` 监控 daemon，收到 `restart_pending` 后自动拉起新进程——实现"agent 改了自己的代码后自动重启"
3. **stash workflow**：`scripts/self-heal-flow.sh` 一键 stash → 自愈 → stash pop，不中断开发者的手头工作

---

## 效果评估

| 场景 | 手动修复 | Self-Heal |
|------|---------|-----------|
| 发现 + 修复 lint 错误 | 2-5 分钟 | 30 秒（含测试验证） |
| 修复单元测试失败 | 5-15 分钟 | 1-3 分钟 |
| 修复率（3 次内修好） | N/A | ~70%（简单测试失败） |
| 需要人工介入的比例 | 100% | ~30% |

---

## 长期计划

1. **Continuous self-heal**：不只在触发时跑——持续监控测试状态，一旦检测到 regression 自动开始修复
2. **Multi-file fix patterns**：目前一次只修一个文件效果最好，多文件联动修复需要更好的 context 管理
3. **Test generation**：修复前自动补充缺失的测试用例，让"修复"有明确的验收标准

---

## 延伸阅读

API 面、`restart-request` ↔ `supervisor.mjs` 握手、`self-heal-flow.sh` 参数（`sheal_*` / `--new` / `NO_STASH`）、与 Evolution/eval 拼图 → **[20-orchestration-evolution-eval.md](20-orchestration-evolution-eval.md) §4**。

## 关键文件

| 路径 | 说明 |
|------|------|
| `self-heal/self-heal-scheduler.ts` | 主调度器 |
| `self-heal/self-heal-executors.ts` | git / npm 原子操作 |
| `self-heal/self-heal-policy.ts` | policy → npm script 映射 |
| `stores/self-heal-store.ts` | SQLite CRUD |
| `scripts/supervisor.mjs` | 轮询 restart-request 并拉起 daemon |
| `scripts/self-heal-flow.sh` | stash → 自愈 → pop |
