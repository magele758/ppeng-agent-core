# Agent Eval Harness

可重复的 Agent 能力评测框架，作为 CI 质量底座。

## 快速开始

```bash
# 运行所有 fast cases（需先 build daemon）
npm run agent:eval:fast

# 运行所有 cases（默认 fast 模式）
npm run agent:eval

# 过滤指定 case
node scripts/agent-eval/runner.mjs --case session-create
```

## 目录结构

```
scripts/agent-eval/
  runner.mjs          # 主运行器
  cases/
    fast/             # 10 个 fast cases（heuristic/HTTP，无需真实模型）
    nightly/          # 占位（暂不实现）
  fixtures/           # 测试夹具（预留）
  judges/             # 评判器（预留）
```

## Case 格式

```json
{
  "id": "case-id",
  "capability": "runtime|skills|deployment|evolution",
  "mode": "fast|nightly",
  "agentId": "general",
  "description": "...",
  "checks": {
    "type": "http",
    "method": "GET|POST",
    "path": "/api/...",
    "expectedStatus": 200,
    "bodyContainsField": "fieldName",
    "fieldIsArray": "fieldName",
    "createSession": true,
    "body": {}
  }
}
```

### 特殊路径变量

- `:newSession` — 运行时自动创建一个 session，并将 ID 替换进 path

## Fast Cases（10 个）

| ID | Capability | 描述 |
|---|---|---|
| `release-health-smoke` | deployment | GET /api/health 返回 200 |
| `session-create` | runtime | POST /api/sessions 创建 session |
| `session-list` | runtime | GET /api/sessions 返回数组 |
| `session-message-append` | runtime | POST /api/sessions/:id/messages |
| `version-endpoint` | runtime | GET /api/version 含 version 字段 |
| `evolution-overview` | evolution | GET /api/evolution/overview |
| `traces-endpoint` | runtime | GET /api/traces?sessionId= 返回数组 |
| `approvals-endpoint` | runtime | GET /api/approvals 返回数组 |
| `workspaces-endpoint` | runtime | GET /api/workspaces |
| `background-jobs-endpoint` | runtime | GET /api/background-jobs |

## 结果输出

结果写入 `doc/eval-results/YYYY-MM-DD.jsonl`，每行一个 case 结果：

```json
{"case_id":"...","capability":"...","mode":"fast","status":"pass|fail|skip","duration_ms":12,"failure_type":null,"details":"HTTP 200"}
```

## CI 集成

```bash
npm run build && npm run agent:eval:fast
```

失败时 exit code 为 1。
