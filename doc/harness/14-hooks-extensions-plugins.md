# 14 — Hooks、Extensions、Plugins

三层可扩展点——从最外（env script hook）到最内（in-process extension）到最灵活（plugin bundle）。

---

## 分层对比

| 层 | 机制 | 运行环境 | 配置 | 阻塞主流程？ |
|----|------|----------|------|-------------|
| Lifecycle Hook | env var → spawn shell script | 子进程 | `RAW_AGENT_HOOK_<PHASE>=script` | 可（stdout JSON `{"block":true}`) |
| Extension | JS 函数注册到 registry | 同进程 | `RuntimeOptions.extensions` | 可（`result.block=true`） |
| Plugin | 目录下 `manifest.json` → 自动发现 | 同进程 | `RAW_AGENT_PLUGINS_DIR` / `~/.ppeng/plugins` | 注入 tools + extensions |

---

## 1. Lifecycle Hooks (`hooks/lifecycle-hooks.ts`)

### Phase 列表

| Phase | 何时触发 | 可做什么 |
|-------|----------|----------|
| `session_start` | turn 0 开始前 | 注入初始 system message |
| `user_prompt_submit` | user message 追加后 | block 可阻止 run |
| `pre_tool_use` | 工具执行前 | block / force_approval / deny |
| `post_tool_use` | 工具执行后 | 注入 system message |
| `pre_compact` | autoCompact 跑前 | block 可跳过本次压缩 |
| `stop` | 非 tool_use stop | block → 继续循环（验证模式） |
| `subagent_stop` | 子会话 stop | 同 stop，独立于 parent |

### 协议

```
env: RAW_AGENT_HOOK_PRE_TOOL_USE="node /path/to/hook.mjs"
stdin: JSON { phase, sessionId, tool?, input?, ok?, content?, context? }
stdout: JSON { block?, message?, systemMessage?, permissionDecision? }
exit 0 = 正常; 非零 = hook 出错（fail-closed 用于 user_prompt_submit / pre_compact，其余忽略）
```

### `lifecycleForcesApproval`

`pre_tool_use` hook 返回 `{ permissionDecision: 'ask' }` → 该工具本次需审批。

---

## 2. Extensions (`extensions/extension-registry.ts`)

### Phase 列表

| Phase | 何时触发 |
|-------|----------|
| `session_start` | 同 hook，但在 hook 之后 |
| `before_turn` | 每轮模型调用前 |
| `after_tool` | 工具执行 + persist 后 |
| `on_compact` | autoCompact 跑前（hook 之后） |
| `stop` | 正常停止时（hook 之后） |

### 注册

```ts
const ext: ExtensionSpec = {
  name: 'my-ext',
  phases: ['before_turn', 'stop'],
  handler: async (ctx) => ({ block: false, systemMessage: '…' })
};
runtime = new RawAgentRuntime({ extensions: [ext], … });
```

### 行为

- `block: true` → 中止当前动作（before_turn: abort turn; stop: 继续循环）
- `systemMessage` → 注入 system 消息供模型下轮可见
- 多个 extension 同 phase → 按注册顺序执行，任一 block 即短路

---

## 3. Plugins (`plugins/plugin-loader.ts`)

### 发现

```
dirs = pluginDirsFromEnv(env) || ['~/.ppeng/plugins']
for dir in dirs:
  for subdir in dir/*/manifest.json:
    parse manifest → { tools, extensions, skills }
```

### Manifest

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "tools": ["./tools/my-tool.js"],
  "extensions": ["./ext.js"],
  "skills": ["./skills/"]
}
```

### 合并

`mergePlugins(discovered)` → 追加到 runtime 的 tools / extensions / skills。冲突策略：plugin 覆盖内置同名。

---

## 执行顺序汇总

```
[session_start]   hook → extension
[each turn]       extension(before_turn)
[pre tool]        hook(pre_tool_use)
[post tool]       hook(post_tool_use) → extension(after_tool)
[compact]         hook(pre_compact) → extension(on_compact)
[stop]            hook(stop) → extension(stop) → goal gate
```

---

## Env

| 变量 | 说明 |
|------|------|
| `RAW_AGENT_HOOK_SESSION_START` | shell 脚本路径 |
| `RAW_AGENT_HOOK_USER_PROMPT_SUBMIT` | shell 脚本路径 |
| `RAW_AGENT_HOOK_PRE_TOOL_USE` | shell 脚本路径 |
| `RAW_AGENT_HOOK_POST_TOOL_USE` | shell 脚本路径 |
| `RAW_AGENT_HOOK_PRE_COMPACT` | shell 脚本路径 |
| `RAW_AGENT_HOOK_STOP` | shell 脚本路径 |
| `RAW_AGENT_PLUGINS_DIR` | plugin 发现目录（默认 `~/.ppeng/plugins`） |

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `hooks/lifecycle-hooks.ts` | hook 执行器 + phase 类型 |
| `extensions/extension-registry.ts` | in-process extension registry |
| `plugins/plugin-loader.ts` | plugin 发现 + manifest 解析 + merge |
