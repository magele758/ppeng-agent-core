---
name: A2UI surface
description: 用 A2UI v0.9 协议在对话气泡里渲染交互式 UI（卡片、表单、按钮、任务列表、审批等）。当用户请求 "渲染界面 / 显示卡片 / 给我一个表单 / 任务面板 / 仪表板 / 让我点按钮" 等含交互意图的需求时调用 a2ui_render。
triggerWords:
  - 渲染
  - 表单
  - 卡片
  - 仪表板
  - 面板
  - dashboard
  - surface
  - a2ui
  - 按钮
  - 交互
aliases:
  - a2ui-surface
  - render-ui
---

# A2UI 渲染速查

启用：daemon 进程需 `RAW_AGENT_A2UI_ENABLED=1`，否则 `a2ui_render` 工具不会出现在工具列表里。

## 工具

| 工具 | 入参 | 用途 |
|------|------|------|
| `a2ui_render` | `surfaceId`, `catalogId?`, `messages: A2uiMessage[]` | 创建或更新一个 surface（同一 surfaceId 复用即增量更新） |
| `a2ui_delete_surface` | `surfaceId` | 关闭已渲染的 surface |

`messages` 是 A2UI v0.9 envelope 序列，可以包含：

- `{ "createSurface": { "surfaceId", "catalogId" } }`
- `{ "updateComponents": { "surfaceId", "components": [...] } }`
- `{ "updateDataModel": { "surfaceId", "path?": "/...", "value?": <any> } }`
- `{ "deleteSurface": { "surfaceId" } }`

`version` / `surfaceId` / `catalogId` 缺省时由工具自动补齐。

## Catalog

### basic（catalogId `https://a2ui.org/specification/v0_9/basic_catalog.json`）
通用 UI 组件。容器 `Card`(child)、`Column`/`Row`/`List`(children)，叶子 `Text`/`Icon`/`Image`/`Divider`，交互 `Button`/`TextField`/`CheckBox`/`ChoicePicker`。

### agent-native（catalogId `https://ppeng.dev/agent-core/a2ui/v1`）
绑定本仓库领域对象，前端会自动从 `/api/...` 拉数据：

- `TaskCard` `{ taskId }` / `TaskList` `{ filter?, limit? }`
- `AgentBadge` `{ agentId }`
- `MailboxThread` `{ agentId, limit? }`
- `ApprovalRequest` `{ approvalId }`
- `SessionLink` `{ sessionId, label? }`
- `TodoEditable` —— 绑定 `/todos`
- `DiffView` `{ diff }`
- `TraceMini` `{ sessionId, limit? }`
- `KnowledgeGraph` / `ChartCard` —— 后续接入 Cytoscape / Recharts，当前为占位降级渲染

未知组件名不会让渲染崩溃：前端会展示一个可展开的占位 + 原始 JSON，方便后续补齐。

## 三个最小示例

### 1）按钮 → 后端事件（basic catalog）

```json
{
  "surfaceId": "demo_btn",
  "catalogId": "https://a2ui.org/specification/v0_9/basic_catalog.json",
  "messages": [
    { "createSurface": { "surfaceId": "demo_btn", "catalogId": "https://a2ui.org/specification/v0_9/basic_catalog.json" } },
    { "updateComponents": { "surfaceId": "demo_btn", "components": [
      { "id": "root", "component": "Card", "child": "col" },
      { "id": "col", "component": "Column", "children": ["title", "go"] },
      { "id": "title", "component": "Text", "text": "Confirm action?" },
      { "id": "go", "component": "Button", "child": "go_label",
        "action": { "event": { "name": "demo.confirm", "context": { "ts": "now" } } } },
      { "id": "go_label", "component": "Text", "text": "Confirm" }
    ] } }
  ]
}
```

按钮被点 → 前端 POST `/api/sessions/<sid>/a2ui/action`，agent 下一轮会收到一条形如 `[a2ui:action demo.confirm] {...}` 的用户消息。

### 2）双向绑定表单（basic catalog）

```json
{
  "messages": [
    { "createSurface": { "surfaceId": "form1", "catalogId": "https://a2ui.org/specification/v0_9/basic_catalog.json", "sendDataModel": true } },
    { "updateDataModel": { "surfaceId": "form1", "value": { "user": { "name": "" } } } },
    { "updateComponents": { "surfaceId": "form1", "components": [
      { "id": "root", "component": "Column", "children": ["lbl", "tf", "submit"] },
      { "id": "lbl", "component": "Text", "text": "Your name:" },
      { "id": "tf", "component": "TextField", "label": "name", "value": { "path": "/user/name" } },
      { "id": "submit", "component": "Button", "child": "submitLbl",
        "action": { "event": { "name": "form.submit", "context": { "name": { "path": "/user/name" } } } } },
      { "id": "submitLbl", "component": "Text", "text": "Submit" }
    ] } }
  ]
}
```

### 3）TaskList 仪表板（agent-native catalog）

```json
{
  "messages": [
    { "createSurface": { "surfaceId": "task_dash", "catalogId": "https://ppeng.dev/agent-core/a2ui/v1" } },
    { "updateComponents": { "surfaceId": "task_dash", "components": [
      { "id": "root", "component": "Column", "children": ["h", "list"] },
      { "id": "h", "component": "Text", "text": "Pending tasks", "variant": "h3" },
      { "id": "list", "component": "TaskList", "filter": { "status": "pending" }, "limit": 10 }
    ] } }
  ]
}
```

## 用法准则

- 每个新 surfaceId 第一条消息**必须**是 `createSurface`；后续更新复用同一 `surfaceId`。
- 必须有一个 `id: "root"` 的组件，否则前端只显示 placeholder。
- 子节点用 `children`（多个）或 `child`（一个）的 ComponentId 引用，不要把子组件直接嵌进 `components` 之外的位置。
- 数据绑定写 `{ "path": "/foo/bar" }`；模板列表写 `"children": { "path": "/items", "componentId": "row_tpl" }`，模板内字段用相对路径（不以 `/` 开头）。
- Button 触发服务端动作：`"action": { "event": { "name": "...", "context": { ... } } }`，`context` 里的字段可以是字面量或 `{path}`，前端会替你解析后再 POST。
- 不要在 `a2ui_render` 之外再用普通文字描述 UI，会和实际渲染重复——直接渲染即可。
