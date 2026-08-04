# 05：会话、可见历史与压缩

长会话有两份不同视图：SQLite 中的完整 transcript，以及每轮送给模型的消息数组。理解这点才能读懂压缩代码。

## 每轮的实际顺序

```text
完整 transcript
  → visibleMessages（短历史直接返回；长历史可做 episodic selection）
  → prepareMessagesForModel
       ├─ 冷图片换成文本标记
       ├─ 需要时插入 warm contact sheet
       ├─ refusal preservation guard
       └─ microCompactMessages
  → token 估算 / model input
```

`autoCompact` 在阈值命中后调用模型总结更老的消息、额外写一份原文归档，并更新 session summary。当前实现不删除 SQLite 旧 message；后续由 `visibleMessages()` 选择送模范围。micro-compact 每轮运行，只折叠模型已经处理过的旧工具结果，也不修改数据库。

## 三个机制不要混用

| 机制 | 选择什么 | 是否改变 SQLite transcript |
|---|---|---|
| Episodic selection | 从长历史中选择本轮可见消息 | 否 |
| Micro-compact | 缩短旧 tool result 的送模表示 | 否 |
| Auto-compact | 总结更老的消息并写额外归档 | 不删旧 message；会写 summary、archive 和 system marker |

## 预算

`session/session-budget.ts` 用模型窗口、system prompt 大小、工具 schema 和输出预留推导历史预算。显式的 `RAW_AGENT_EPISODIC_TOKEN_BUDGET` 或 `RAW_AGENT_COMPACT_TOKEN_THRESHOLD` 优先。

Working log 位于 `stateDir/working-logs/<sessionId>/working-memory.md`。它记录压缩锚点和步骤结果，尾部以 user-side appendix 注入；读取失败会降级为空。

## 验证

```bash
node --test packages/core/test/micro-compact.test.js packages/core/test/session-budget.test.js
```

若文件名随测试重构变化，先用 `rg --files packages/core/test | rg 'compact|budget'` 查当前用例。继续 [06 Skills 路由](06-skills-routing.md)。
