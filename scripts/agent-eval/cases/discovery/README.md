# Discovery eval suite（非 fast）

完整 Capability Discovery 金标集。默认**不依赖活网 / 真 Tailscale CLI**。

## 运行

```bash
# 需先 build daemon
npm run build

# suite=discovery（runner 会设 RAW_AGENT_DISCOVERY=1 + mock status path）
node scripts/agent-eval/runner.mjs --suite discovery

# 或按 id / grep
node scripts/agent-eval/runner.mjs --suite discovery --case tailscale-gold-inventory
node scripts/agent-eval/runner.mjs --mode fast --grep discovery
```

## Env（runner 自动注入）

| Env | 值 |
|-----|-----|
| `RAW_AGENT_DISCOVERY` | `1` |
| `RAW_AGENT_TAILSCALE_DISCOVERY` | `1` |
| `RAW_AGENT_TAILSCALE_STATUS_JSON` | `scripts/agent-eval/fixtures/tailscale/status.json` |

Fixture 与 `packages/core` Tailscale adapter（`parseTailscaleStatusJson`）字段对齐。
