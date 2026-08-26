# 14 — Hooks、Extensions、Plugins

> **设计目标**：让 Harness 可以在不修改源码的情况下被扩展——从"跑一个脚本"到"注入一个 JS 函数"到"加载一个完整的 plugin 包"，三种粒度满足不同集成深度。

---

## 为什么需要三层？

| 需求 | 最佳方案 |
|------|----------|
| "CI 里跑个检查脚本就行" | Hook（env 指定脚本路径） |
| "我的 Node.js 项目需要深度集成" | Extension（同进程 JS 函数） |
| "我要发布一个可分享的能力包" | Plugin（自发现、带 manifest） |

一层搞不定所有场景——shell hook 不够灵活（跨进程通信成本高）、in-process extension 不够隔离（bug 可能 crash runtime）、plugin 太重（简单需求不需要 manifest.json）。三层各有其最佳适用区间。

---

## 层 1: Lifecycle Hooks

**机制**：env var → spawn shell 脚本 → stdin/stdout JSON 通信

```bash
# 配置
RAW_AGENT_HOOK_PRE_TOOL_USE="node /path/to/hook.mjs"
```

```
stdin:  { phase, sessionId, tool, input, context }
stdout: { block?, message?, systemMessage?, permissionDecision? }
exit 0 = 正常; 非零 = hook 出错
```

### Phase 列表

| Phase | 时机 | 典型用途 |
|-------|------|----------|
| `session_start` | turn 0 前 | 注入初始化指令 |
| `user_prompt_submit` | user message 追加后 | 内容审查/拦截 |
| `pre_tool_use` | 工具执行前 | 强制审批 / deny |
| `post_tool_use` | 工具执行后 | 注入 system message |
| `pre_compact` | 压缩前 | 阻止特定时机的压缩 |
| `stop` | 非 tool_use stop | 验证模式（"真的完了吗？"） |
| `subagent_stop` | 子会话 stop | 独立于 parent |

**设计亮点**：hook 可以返回 `{ block: true }` 中断当前操作——比如 `stop` hook 返回 block → 继续循环（实现"agent 必须通过验证才能结束"）。

---

## 层 2: Extensions

**机制**：同进程 JS 函数，通过 `RuntimeOptions.extensions` 注册

```ts
const ext: ExtensionSpec = {
  name: 'my-ext',
  phases: ['before_turn', 'stop'],
  handler: async (ctx) => ({
    block: false,
    systemMessage: '记得检查 TypeScript 类型'
  })
};
```

### Phase 列表

| Phase | 时机 | 与 Hook 的关系 |
|-------|------|---------------|
| `session_start` | 同 hook | hook 之后 |
| `before_turn` | 每轮模型调用前 | hook 无对应 |
| `after_tool` | 工具执行后 | hook(post_tool_use) 之后 |
| `on_compact` | 压缩前 | hook(pre_compact) 之后 |
| `stop` | 正常停止时 | hook(stop) 之后 |

**执行顺序**：hook → extension → 内置逻辑。任一 block 即短路后续。

### vs Hooks

| | Hooks | Extensions |
|---|-------|-----------|
| 隔离 | 进程隔离（安全） | 同进程（快） |
| 延迟 | ~10-50ms（spawn） | ~0ms |
| 能力 | 只能通过 JSON 通信 | 可访问 runtime context |
| 部署 | 放个脚本文件就行 | 需要代码集成 |

---

## 层 3: Plugins

**机制**：目录下 `manifest.json` → 自动发现 → 合并 tools + extensions + skills

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "tools": ["./tools/my-tool.js"],
  "extensions": ["./ext.js"],
  "skills": ["./skills/"]
}
```

### 发现路径

```
RAW_AGENT_PLUGINS_DIR || ~/.ppeng/plugins
  └─ my-plugin/manifest.json
  └─ another-plugin/manifest.json
```

**冲突策略**：plugin 覆盖内置同名。这意味着你可以通过 plugin "替换"内置工具的行为。

### 适用场景

- 发布企业内部的工具包（含自定义工具 + 配套 skill）
- 开源社区共享 plugin（类似 VS Code extension 生态）
- 按项目启用不同 plugin set

---

## 执行顺序全景

```
[session_start]    hook → extension
[each turn]        extension(before_turn)
[pre tool]         hook(pre_tool_use)
[post tool]        hook(post_tool_use) → extension(after_tool)
[compact]          hook(pre_compact) → extension(on_compact)
[stop]             hook(stop) → extension(stop) → goal gate
```

---

## 验证扩展点

分别测试 phase 触发顺序、block 语义、超时 / 非零退出、非法 JSON、extension 异常隔离和 plugin 合并优先级。Plugin 在进程内加载的能力应视为受信代码，不要把它与工具沙箱等同。

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `hooks/lifecycle-hooks.ts` | hook 执行器 + phase 类型 |
| `extensions/extension-registry.ts` | in-process extension registry |
| `plugins/plugin-loader.ts` | plugin 发现 + manifest 解析 |
