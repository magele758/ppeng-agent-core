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

# 按子串过滤（discovery 烟雾）
npm run agent:eval:fast -- --grep discovery
# 等价：
node scripts/agent-eval/runner.mjs --mode fast --grep discovery

# Discovery 完整套（非 fast）
node scripts/agent-eval/runner.mjs --suite discovery
```

## 目录结构

```
scripts/agent-eval/
  runner.mjs          # 主运行器
  cases/
    fast/             # heuristic/HTTP cases；数量以目录内容为准
    discovery/        # Capability Discovery 金标集（--suite discovery）
    nightly/          # 占位（暂不实现）
  fixtures/           # 测试夹具（含 Tailscale mock status.json）
  judges/             # 评判器（预留）
```

## Case 格式

```json
{
  "id": "case-id",
  "capability": "runtime|skills|deployment|evolution|discovery",
  "mode": "fast|nightly|discovery",
  "agentId": "general",
  "description": "...",
  "requiresDiscovery": true,
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

多步 sequence（discovery 用）：

```json
{
  "checks": {
    "type": "sequence",
    "steps": [
      { "action": "seedTailscaleFixture", "fixture": "tailscale/status.json" },
      { "method": "GET", "path": "/api/capabilities?kind=tailscale-node", "minArrayLength": 5, "assert": "tailscaleInventoryShape" }
    ]
  }
}
```

### 特殊路径变量

- `:newSession` — 运行时自动创建一个 session，并将 ID 替换进 path
- sequence `capture` — 如 `{ "capId": "capability.id" }`，后续 path 可用 `:capId`

## Discovery cases

需 `RAW_AGENT_DISCOVERY=1`。Runner 在加载到 `requiresDiscovery` / `capability=discovery` / `id` 以 `discovery-` 开头的 case 时**自动注入**：

| Env | 值 |
|-----|-----|
| `RAW_AGENT_DISCOVERY` | `1` |
| `RAW_AGENT_TAILSCALE_DISCOVERY` | `1` |
| `RAW_AGENT_TAILSCALE_STATUS_JSON` | `scripts/agent-eval/fixtures/tailscale/status.json` |

默认不依赖活网 / 真 Tailscale CLI；inventory case 用 fixture 解析后 `POST /api/capabilities` 入库再断言。

| ID | 描述 |
|---|---|
| `discovery-registry-smoke` | GET `/api/capabilities` → capabilities 数组 |
| `discovery-tailscale-inventory` | mock status → ≥5 `tailscale-node`；offline 不可操作 |
| `discovery-pin-reject` | 创建 bound 被拒；bind 无 approved → 400 |
| `discovery-tool-search-budget` | 大批量入库后 `limit=` 截断 |

完整套：`cases/discovery/`（`--suite discovery`）。

## Fast Cases

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
| `discovery-*` | discovery | 见上节（需 Discovery env） |

## 结果输出

结果写入 `doc/eval-results/YYYY-MM-DD.jsonl`，每行一个 case 结果：

```json
{"case_id":"...","capability":"...","mode":"fast","status":"pass|fail|skip","duration_ms":12,"failure_type":null,"details":"HTTP 200"}
```

## CI 集成

```bash
npm run build && npm run agent:eval:fast
```

默认是 print-only 模式，即使 case 失败也退出 0。CI 必须直接运行 `node scripts/agent-eval/runner.mjs --mode fast --exit-on-fail`；此时 case 失败或 daemon 启动失败才退出 1。
