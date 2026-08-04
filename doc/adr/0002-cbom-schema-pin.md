# ADR 0002 — CBOM & Schema Pin

| 字段 | 值 |
|------|----|
| 状态 | Accepted |
| 日期 | 2026-08-04 |

## 决策

绑定（`trust=bound`）时固化：

- `schemaHash`（工具 schema / OpenAPI 指纹）
- 可选 `serverFingerprint`、`toolNames[]`
- Tailscale：`nodeId` / `DNSName` / Tailscale IPs

调用前（tool-loop 钩子 / MCP 挂载前）比对 pin；漂移 → 阻断并将 binding 标 `needs-reverify` 或 capability `revoked`。

导出：`GET /api/capabilities/cbom`。

## 非目标

完整 OPA/PDP；工业 Twin SBOM。
