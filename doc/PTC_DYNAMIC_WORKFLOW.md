# PTC Dynamic Workflow

PTC（Programmatic Tool Composition）是 `dynamic_workflow` 的程序化编排引擎。父模型不再逐次输出 JSON worker 列表，而是生成一个短小的 async JavaScript cell，通过 `ptc_exec` 一次性表达并发、条件、循环和结果汇总。

## 模式选择

Lab 对话页切换到 **Task**，在“编排”中选择 **动态 PTC**。选择立即写入会话 metadata：

```json
{
  "taskRunMode": "dynamic_workflow",
  "orchestrationEngine": "ptc"
}
```

HTTP API 同时接受 camelCase 和 snake_case：

```json
{
  "task_run_mode": "dynamic_workflow",
  "orchestration_engine": "ptc"
}
```

解析规则与 ai-agent-node 一致：

- `dynamic_workflow` 未指定引擎时默认使用 `ptc`。
- 显式指定 `orchestrationEngine=legacy` 才回退固定编排。
- 普通会话默认隐藏 `ptc_exec`；PTC 会话隐藏 `spawn_subagent` / `spawn_teammate`，统一改走 cell 内 `agent()`。

## Cell API

```js
const [research, review] = await Promise.all([
  agent({ task: 'Research the relevant implementation', role: 'research' }),
  agent({ task: 'Find failure modes and missing tests', role: 'review' })
]);

await scratchpad.write('research', research);
const tasks = await task_list();
return { research, review, tasks };
```

Cell 可用符号：

- `agent({ task, angle?, agent?, role?, title?, allowed_tools?, model? })`
- 显式标记 `ptc.kind='read'` 的当轮授权工具
- `tools['tool-name']`，用于名称不是合法 JavaScript 标识符的工具
- `scratchpad.write/read/list`
- `verify({ kind: 'files_exist', paths: [...] })` 或允许的 HTTP 验收

每个 `agent()` 都创建 clean-context subagent。独立工作应使用 `Promise.all`；默认并发上限 16，单个 cell 最多 64 次 `agent()` 调用。

## 安全边界

- cell 在冻结的 `node:vm` context 中运行。
- 禁止 `require`、`process`、裸 `fetch`、`eval`、`Function`、WebAssembly 和 dynamic import。
- 同步执行最多 5 秒；cell 总超时默认/上限 120 秒。超时或用户取消会中止 in-flight subagent。
- 宿主函数、thenable、返回值和异常经过跨 realm 包装，阻断通过 `constructor` 链获取宿主进程。
- 未显式标记为 PTC read 的工具不会进入 namespace；写工具和需要确认的工具不会进入。
- cell 不是文件写入面。写文件、shell 和其他 mutation 必须由父 Agent 或具有相应权限的 Worker 通过正常工具链完成。

`node:vm` 是进程内隔离，不应被当作容器级安全边界。PTC 仍依赖当前项目的工具授权、审批、子进程沙箱和审计日志共同收敛风险。

## 可观测性

- Trace 事件：`ptc_cell`、`ptc_hook`
- tool result metadata 记录代码长度、日志行数和执行时间
- 会话 metadata 保存 `ptcLastProgram`、`ptcLastExecutedAt`、`ptcLastRunOk` 和最近错误，便于调试与后续工作流沉淀

实现入口：

- `packages/core/src/ptc/ptc-exec-tool.ts`
- `packages/core/src/ptc/isolate.ts`
- `packages/core/src/ptc/hooks.ts`
- `packages/core/src/ptc/agent-hook.ts`
- `packages/core/src/ptc/mode.ts`
