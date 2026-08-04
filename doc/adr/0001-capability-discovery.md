# ADR 0001 — Capability Discovery & Registry

| 字段 | 值 |
|------|----|
| 状态 | Accepted |
| 日期 | 2026-08-04 |
| 相关 | `doc/CAPABILITY_DISCOVERY_PLAN.md` |

## 上下文

需要端到端「发现 → 识别 → 绑定 → 治理」能力目录，且不重写 `runtime.ts` 主循环。现有 `packages/capability-gateway` 是 IM/渠道网关，**不是**本 Registry。

## 决策

1. **四层模型**：Probe（候选）→ Registry `untrusted` → Verify `verified` → HITL Bind `bound`（可 `revoked`）。
2. **模块命名**：`packages/core/src/discovery/*`；HTTP `/api/capabilities*`；env `RAW_AGENT_DISCOVERY`（默认关）。
3. **扩展点**：DomainBundle / extraTools / 审批钩子 / Tool Search；不改 tool-loop 控制流。
4. **凭证**：仅 `credRef`；禁止 secret 进 prompt/memory。
5. **Tailscale**：`kind=tailscale-node` + `pool=tailnet:<id>`；官方 CLI/API inventory，禁止默认扫公网。

## 威胁模型（摘要）

- 工具投毒 / rug-pull（schema 漂移）→ CBOM pin（ADR 0002）
- confused deputy → 绑定凭证只用引用 + 审批
- 借道 tailnet 扫公网 → probe-policy + tailnet-only

## 非目标

全网裸扫、直连射频、自动升 `bound`、重写 MCP SDK / ToolContract。

## 后果

手工登记即可用；Probe/Tool Search/Domain 适配器分阶段挂载。
