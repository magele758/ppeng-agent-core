# 自主探针 / Capability Discovery Agent — 开发计划

| 字段 | 值 |
|------|----|
| **状态** | MVP landed（M0–M3 + Tailscale 只读 + Domain 试点 + fast eval） |
| **日期** | 2026-08-04 |
| **相关** | [`ROADMAP.md`](ROADMAP.md) P1（领域 Harness）/ P3（节点发现前导）；harness Skills / MCP / 审批 / optional-tool-groups / Domain；[`DOMAIN_AGENTS.md`](DOMAIN_AGENTS.md)；[`HARNESS_EVAL.md`](HARNESS_EVAL.md)；[`CAPABILITY_ABSORPTION_PLAN.md`](CAPABILITY_ABSORPTION_PLAN.md)（能力吸收，命名勿混） |

对齐现有命名：主循环仍在 `packages/core/src/runtime.ts` + `runtime/tool-loop.ts`；扩展走 `DomainBundle` / `RuntimeOptions.extra*`；工具面预算对齐 `optional-tool-groups` + Skills progressive disclosure；审批走 `approval/*`；子探针走 `spawn_subagent` + `session/subagent-contract.ts`；评测走 `scripts/agent-eval`。**不重写主循环**；不把「全网裸扫」做成默认路径。

> 注意：`packages/capability-gateway` 是 IM/渠道网关，**≠** 本计划的 Capability Registry。新模块建议用 `capability-registry` / `discovery` 命名，避免混淆。

---

## 0. 目标与非目标

### 目标（做）

| 目标 | 说明 |
|------|------|
| 发现→识别→绑定→治理→记忆沉淀 | 端到端闭环；候选能力先入 Registry，再经 Verify/HITL 绑定为可调用工具 |
| Capability Registry（P0 ROI） | 手工/探针写入的权威目录：endpoint、schema hash、信任态、作用域、凭证引用 |
| Tool Search 元工具 | 懒加载披露，对标 `load_skill` / optional groups，控制工具面 token |
| 只读 Probe Subagent | 沙箱 + CIDR/allowlist；产出候选卡，不直接升生产工具 |
| CBOM + schema pin | 绑定后 pin 工具 schema/指纹；防 rug-pull / 工具投毒 |
| Domain 试点 | HA/MQTT/Matter **网关北向**；企业 OpenAPI/CMDB/well-known；ERP Adapter→Canonical Tools；**Tailscale 虚拟组网 → 可操作设备池** |
| 能力进化门禁 | Spec→MCP 合成仅草稿；经 `agent-eval` 晋升；度量 Discovery precision/recall |
| 复用底座 | Skills/MCP/Plugin/Memory/审批/Domain/optional-tool-groups/Evolution/eval |

### 非目标（不做 / 远期）

- 全网裸扫、默认主动端口扫描、直连射频（Zigbee/Z-Wave/Thread 等）
- **借道 Tailscale / 子网路由扫公网**；offline 节点上的写操作
- 联邦拓扑 / CRDT / 多节点协调平面（ROADMAP P3 全量）——仅做「节点/端点发现」前导数据模型
- 在 core 主循环内嵌「自动绑定写操作」或绕过审批的 PDP 旁路
- 重写 MCP SDK 会话循环、替换现有 ToolContract 体系
- 工业 Twin / OPA 全量 PDP / A2A Card 生产联邦（属 M5+）

**MVP 边界**：Registry + 只读 Probe + HITL 绑定 + Tool Search 预算 + HA/OpenAPI 两条适配器 + **Tailscale 只读 inventory / 可操作池绑定** + schema pin。  
**远期**：ERP draft/submit/post、A2A/WoT Domain、Spec→MCP 合成晋升、执行层 PDP、Tailscale SSH/服务写路径增强。

---

## 1. 总体架构落点

| 组件 | 落点 | 路径风格（建议） |
|------|------|------------------|
| ADR：四层模型、安全威胁、schema pin | ADR 文档 | `doc/adr/00XX-capability-discovery.md`、`doc/adr/00XY-cbom-schema-pin.md` |
| Capability 类型 + Registry store | **core** | `packages/core/src/discovery/types.ts`、`registry.ts`、`stores/capability-store.ts`（SQLite migration） |
| Probe 策略（CIDR/allowlist/只读） | **core** | `packages/core/src/discovery/probe-policy.ts` |
| Probe Subagent persona + 工具白名单 | **core** builtin / 或 discovery domain | `builtin-agents` 增 `capability-prober`；`allowedTools` 极窄 |
| Verify / Bind / Trust state machine | **core** | `packages/core/src/discovery/bind.ts`、`verify.ts` |
| Tool Search 元工具 | **core tools** | `packages/core/src/tools/tool-search.ts`；接入 `optional-tool-groups` / prompt 披露 |
| CBOM / schema pin | **core + ADR** | `packages/core/src/discovery/cbom.ts`；执行前在 `tool-loop` 钩子校验 pin |
| HTTP API | **daemon** | `apps/daemon/src/routes/capabilities.ts`：`/api/capabilities` CRUD、bind、probe jobs |
| HA / MQTT / Matter 北向适配 | **domain** | `packages/agent-homeiot/`（`DomainBundle`） |
| 企业 OpenAPI / CMDB / well-known | **domain** | `packages/agent-enterprise-discovery/` 或先放 `discovery/adapters/openapi.ts`（MVP 可先 core adapter + domain 挂载） |
| **Tailscale → 可操作设备池** | **core adapter 和/或 domain** | `packages/core/src/discovery/adapters/tailscale.ts` 或 `packages/agent-tailscale/`（`DomainBundle`）；见 [§2.1](#21-tailscale-设备池) |
| ERP Canonical Tools | **domain** | `packages/agent-erp/`：draft/submit/post + `approvalMode: 'always'` |
| A2A / WoT 试点 | **domain + plugin** | `packages/agent-a2a/`、`packages/agent-wot/`；Plugin 仅做协议客户端 |
| Spec→MCP 合成 | **scripts + core draft** | `scripts/discovery/spec-to-mcp.mjs`；产物进 Registry `status=draft` |
| Discovery eval | **scripts/eval** | `scripts/agent-eval/cases/fast/discovery-*.json` + `scripts/agent-eval/cases/discovery/`（含 Tailscale mock `status.json`） |
| 记忆沉淀 | **core memory** | `AgentMemoryStore` scope：`project.memory` / `team.memory` 写「已绑定能力摘要」，不把密钥写进 prompt |
| 观测 | **core trace** | `stores/trace.ts` 增 `capability_*` kinds（含 `capability_tailscale_*`） |
| PDP/OPA（远期） | **plugin / 旁路** | 勿先塞进 runtime；先扩展 `approval-policy.ts` 钩子 |

数据流（不改主循环控制权）：

```text
Probe(subagent, sandbox) → Candidate Card → Registry(untrusted)
  → Verify(schema/fingerprint/allowlist) → HITL Approve
  → Bound Tool / MCP mount / Domain tool → Tool Search 披露
  → 调用时 CBOM pin 校验 → 审批/PDP → 执行 → Memory 摘要

# Tailscale 特化路径（官方 inventory，默认不扫端口）
tailscale status --json | Tailscale API
  → Candidate Cards (kind=tailscale-node) → Registry
  → 只读 inventory 可 verified → HITL bind → OperablePool
  → tool_search / list·get·(可选 ping) → 可选 optional group（ssh/HTTP）+ 审批
```

---

## 2. 分阶段里程碑

### M0 — ADR + 数据模型 + Registry 骨架（可手工登记）

**目标**：有权威能力目录与信任态，无需自动发现即可人工登记并被 API 查询。

**交付物**
- `doc/adr/00XX-capability-discovery.md`（四层、威胁模型、与 Domain/MCP/optional-groups 边界；**含 Tailscale 设备池数据模型前导**）
- `packages/core/src/discovery/{types,registry,index}.ts`
- SQLite：`capabilities` / `capability_bindings`（schema version bump，跟现有 `stores/migrations`）；类型预留 `kind=tailscale-node`、pool 标签字段
- `apps/daemon/src/routes/capabilities.ts`：list/get/create/update（手工）
- 单元测试：`packages/core/test/discovery-registry.test.ts`

**关键任务**
- [ ] 定义 `CapabilityCard`：`id, kind, endpoint, transport, schemaRef, schemaHash, trust(untrusted|verified|bound|revoked), scope, credRef, source, cbom`（`kind` 含 `tailscale-node` 等）
- [ ] 信任态机：仅 `bound` 可进入可调用面；默认 `untrusted`
- [ ] CLI/HTTP 手工 upsert；禁止无审批自动升 `bound`
- [ ] Trace：`capability_register` / `capability_state_change`
- [ ] `.env.example`：`RAW_AGENT_DISCOVERY=0|1`（默认关）；文档注明后续 `RAW_AGENT_TAILSCALE_DISCOVERY` 独立开关

**验收标准**
- 手工登记 3 条假 OpenAPI/MCP 卡 → `GET /api/capabilities` 可筛 trust/kind
- 默认 `RAW_AGENT_DISCOVERY=0` 时路由 404 或空实现，不影响现有会话
- unit：状态非法迁移抛错

**工期**：1.0～1.5 人周  
**风险/依赖**：与现有 `capability-gateway` 命名冲突（文档与模块名必须区分）；SQLite 迁移需兼容本机 stateDir

---

### M1 — 只读 Probe + Verify + HITL 绑定

**目标**：在沙箱/CIDR 内只读探测，产出候选卡，经人工批准后绑定；**含 Tailscale 只读 inventory → Registry 候选卡 + 列表工具**。

**交付物**
- `packages/core/src/discovery/probe-policy.ts`（CIDR、host allowlist、禁止扫描端口范围、超时/并发；**tailnet IP 段可作为 allowlist 来源**）
- builtin agent：`capability-prober`（`allowedTools` 仅 `web_fetch`/受限 HTTP probe 工具，**无 bash 写**；Tailscale 路径走专用 adapter，非通用 bash 扫网）
- `spawn_subagent` 合同扩展：`role=capability-probe`，`summaryMaxChars` + 结构化 JSON 摘要
- `discovery/verify.ts`：schema 拉取、hash、基础连通性（HEAD/GET well-known）
- 绑定 API：`POST /api/capabilities/:id/bind` → 走现有 `approvals`（`approvalMode: always`）
- Web Console 最小：能力列表 + Approve/Reject（可先 Ops 页简表）
- **Tailscale（M1 切片）**：
  - `packages/core/src/discovery/adapters/tailscale.ts`（或 Domain 内等价模块）：解析 `tailscale status --json` / 可选 API
  - 只读工具：`tailscale_list_devices`、`tailscale_get_device`（默认）；`tailscale_ping` 可选且受策略
  - env：`RAW_AGENT_TAILSCALE_DISCOVERY=0|1`（默认关）、`RAW_AGENT_TAILSCALE_API_CRED_REF=...`
  - eval fixture：mock `status.json`

**关键任务**
- [ ] 主动扫描默认关：`RAW_AGENT_DISCOVERY_ACTIVE_SCAN=0`
- [ ] Probe 仅允许：已知 base URL、well-known、OpenAPI URL、用户粘贴的 spec、**Tailscale 官方 inventory（CLI/API）**
- [ ] 沙箱：复用 `SandboxManager` / `sanitizeSpawnEnv`；网络出站受 CIDR 策略
- [ ] Verify 失败保持 `untrusted`；成功 → `verified`，仍需 HITL → `bound`
- [ ] confused deputy：绑定凭证用 `credRef`（secret store/env 名），永不回灌模型原文
- [ ] **Tailscale**：区分 self / peer / tagged / offline / exit node / subnet router；记录 hostname、DNSName、Tailscale IPs、OS、tags、online、capabilities（ssh/funnel 等若可得）
- [ ] **Tailscale**：探查结果默认 `untrusted`；只读 inventory 校验通过可至 `verified`；**不可**自动进可操作池
- [ ] agent-eval：`discovery-probe-readonly`、`discovery-bind-requires-approval`、`discovery-tailscale-inventory`（mock status.json）

**验收标准**
- 对 allowlist 内 mock OpenAPI：Probe 生成候选 → Verify pass → 无审批不能 `bound`
- 对 CIDR 外主机：Probe 工具返回结构化拒绝，不发起请求
- 审批拒绝后状态不变；批准后出现可搜索绑定
- **Tailscale mock**：`status.json` → N 条 `kind=tailscale-node` 候选入 Registry；`tailscale_list_devices` 可列出；offline 节点标记且不可操作；默认开关关闭时无副作用

**工期**：2.0～2.5 人周  
**风险/依赖**：企业网络 ACL；`web_fetch` 与探针策略需统一出口，避免旁路；本机未安装 `tailscale` CLI / 无 API token 时需优雅降级

---

### M2 — Tool Search + optional groups 统一披露预算

**目标**：模型默认只见元工具 + shortlist，按需加载完整工具 schema，控制工具面爆炸。

**交付物**
- `packages/core/src/tools/tool-search.ts`（`tool_search` / `load_capability_tool`）
- 与 `skills/skill-disclosure.ts`、`optional-tool-groups.ts` 对齐的预算配置
- PromptBuilder：Discovery 开启时注入「先 search 再 load」片段（bump `STABLE_SYSTEM_VERSION` 规则见 `model/AGENTS.md`）
- `RAW_AGENT_TOOL_DISCLOSURE_BUDGET`（条数/字符）与 session `enabledOptionalToolGroups` 联合
- **Tailscale 池很大时**：节点不逐条塞首轮 tools schema；经 `tool_search` / list 工具披露

**关键任务**
- [ ] Registry `bound` 工具默认不进全量 tools 列表，只进索引
- [ ] `tool_search(query)` → top-k 卡（name/desc/risk）；`load_capability_tool(id)` → 当轮暴露完整 schema
- [ ] 与 MCP 工具合流：MCP 大集合走同一索引（复用 `mcp-schema-minify`）
- [ ] 严格模式：`RAW_AGENT_TOOL_LOAD_STRICT=1` 时仅 shortlist 可 load（对标 skill strict）
- [ ] OperablePool / `tailscale-node` 批量节点走同一预算哲学
- [ ] eval：工具面 token 上限 case；未知工具仍保持配对（现有 unknown-tool 自愈）

**验收标准**
- 绑定 ≥30 个假工具时，首轮 system+tools 增量低于预算阈值（写入 eval 断言）
- search→load→调用路径可观测（trace）
- 关闭 Discovery 时行为与现网一致
- Tailscale 假池 ≥50 节点时，首轮不注入全部节点级 schema

**工期**：1.5～2.0 人周  
**风险/依赖**：模型是否遵守元工具协议；需与 skill routing 披露策略避免双重混乱（文档写清优先级：Skills 管 playbook，Tool Search 管可调用面）

---

### M3 — HA/OpenAPI 两条适配器 + CBOM/schema pin（含 Tailscale 可操作池）

**目标**：家庭与企业各打通一条「北向只读→绑定→pin」真实路径；**Tailscale 完成可操作池 HITL 绑定 + optional group（SSH/服务）+ schema pin**。

**交付物**
- Domain：`packages/agent-homeiot/`（HA REST / MQTT 北向；Matter 经现有网关，不直连射频）
- Adapter：`discovery/adapters/openapi.ts` + CMDB/well-known/DNS-AID（AID 可先 stub + 单测）
- `discovery/cbom.ts` + ADR schema pin：bound 时固化 `schemaHash`、server fingerprint、工具名集合
- `tool-loop` / MCP 调用前 pin 校验；漂移 → 阻断并降级 `revoked|needs-reverify`
- CBOM 导出：`GET /api/capabilities/cbom`（JSON）
- **Tailscale 可操作池（本里程碑或紧随其后的独立小切片，不阻塞 HA/OpenAPI）**：
  - HITL bind 后进入 OperablePool；optional tool group 默认关：`tailscale_ssh`、经节点的 HTTP/服务探测
  - allowlist = tailnet 地址族；禁止借道扫公网；offline 不可操作
  - pin：节点身份（node id / DNSName / Tailscale IPs）+ 暴露工具集合

**关键任务**
- [ ] Home Assistant：实体列表/状态只读工具；写操作一律 `approvalMode: 'always'` 且默认 optional group 关闭
- [ ] OpenAPI：从 spec 生成 Candidate Tools（draft），不自动 MCP 上线
- [ ] 企业优先源顺序：CMDB → 用户提供 OpenAPI → `/.well-known` → DNS-AID；扫描默认关
- [ ] 威胁：工具投毒（描述诱导）、rug-pull（绑定后改 schema）、scoped token（最小 scope + TTL）
- [ ] Domain 按 `doc/DOMAIN_AGENTS.md` 五步挂进 `domain-loader.ts`
- [ ] **Tailscale**：bind → OperablePool；写路径（SSH、HTTP 控制、脚本）`approvalMode: 'always'`
- [ ] **Tailscale**：`credRef`（API key / SSH 密钥引用）不进 prompt；出站仅 tailnet
- [ ] eval + domain unit（mock HA / mock OpenAPI / mock Tailscale status + bind）

**验收标准**
- HA mock：发现灯/传感器实体 → 绑定 → `tool_search` 可召回 → 读状态成功
- OpenAPI mock：生成 N 个 draft tools；pin 后篡改 schema → 调用被拒并 trace
- `RAW_AGENT_DOMAINS=homeiot` 可装载，不影响 sre/stock
- **Tailscale**：verified inventory → HITL bind → optional group 开启后可 `tool_search` 召回节点；未审批不能 SSH；公网目标被策略拒绝；pin 漂移拦截

**工期**：3.0～3.5 人周（Tailscale 可操作池若拆独立小里程碑，另计约 0.5～1.0 人周，可与 HA/OpenAPI 并行）  
**风险/依赖**：HA/MQTT 凭证与本机网络；Matter 网关可用性；OpenAPI 质量参差（需容错）；Tailscale SSH 能力因 peer/ACL 而异

---

### M4 — ERP Canonical + 写操作生命周期；Discovery eval

**目标**：企业写路径有统一生命周期；Discovery 质量可测可门禁。

**交付物**
- `packages/agent-erp/`：Adapter→Canonical Tools（`erp_draft` / `erp_submit` / `erp_post`）
- 状态机：draft → submit(待批) → post(执行) / void；全程审批 + 审计
- `scripts/agent-eval/cases/discovery/`：precision/recall 金标集（固定 fixture，非活网；**含 Tailscale status.json 金标**）
- `scripts/discovery/score-discovery.mjs`：对比 Registry 预测 vs 金标
- Evolution 衔接（可选）：高分合成草案进 `doc/evolution/backlog/`，不自动 merge

**关键任务**
- [ ] Canonical 参数模型与具体 ERP（Odoo/SAP mock）adapter 分离
- [ ] post 必须二次确认（approval + 幂等键）
- [ ] Discovery eval 指标：endpoint 召回、工具分类精度、误绑率、pin 拦截率、**Tailscale 节点召回/误操作拦截率**
- [ ] `npm run agent:eval:fast` 纳入 discovery 烟雾；完整集可选 `--suite discovery`
- [ ] Memory：成功绑定写 `project.memory` 摘要（无密钥；Tailscale 写「已绑定 tailnet 节点摘要」）

**验收标准**
- ERP mock：draft→reject 不落账；approve→post 可查审计
- 金标集 precision/recall 有基线数字并写入 `doc/eval-results/`
- 故意 rug-pull fixture：100% 调用前拦截
- Tailscale 金标：offline / 公网目标 100% 操作前拦截

**工期**：3.0～4.0 人周  
**风险/依赖**：ERP 语义差异大；金标集需人工维护；写操作合规审查

---

### M5+（可选 / 远期）

| 项 | 目标 | 落点 | 粗估 |
|----|------|------|------|
| A2A Agent Card | 拉取远程 Card 为 Candidate，不改主循环 | `packages/agent-a2a` Domain | 1.5～2 人周 |
| WoT Thing Description | TD→Candidate Tools Domain 试点 | `packages/agent-wot` | 1.5～2 人周 |
| Spec→MCP 合成 | OpenAPI/TD→MCP server 草稿 + eval 晋升 | `scripts/discovery/spec-to-mcp.mjs` | 2～3 人周 |
| 执行层 PDP/OPA | 绑定 scope + 会话身份 → allow/deny | `approval` 钩子 / 旁路 plugin | 2～3 人周 |
| Tailscale 深度 | ACL 感知、Funnel/Serve 发现、subnet router 受控转发策略增强 | adapter / Domain | 1～2 人周 |
| 工业 Twin | 只读数字孪生适配（OPC-UA 网关北向） | 新 Domain，P1 工业矩阵 | 单独立项 |

晋升规则（远期统一）：`draft` → eval suite pass → HITL → `bound` → CBOM pin；失败进 backlog，不进默认工具面。

---

## 2.1 Tailscale 设备池

> 专节：将 **Tailscale 虚拟组网探查 → 可操作设备池（Operable Pool）** 纳入 Capability Discovery，与 Registry / Tool Search / 审批对齐。

### 目标

- 自动探查当前 Tailscale 网络（tailnet）中的设备/节点
- 将发现的节点沉淀为 Capability Registry 中的「可操作池」
- 通过工具（`tool_search` / 绑定后的工具）让 Agent 能查询与（在审批下）操作这些设备

### 发现源（优先官方 API / CLI，勿默认扫端口）

| 源 | 说明 | 优先级 |
|----|------|--------|
| `tailscale status --json` | 本机 CLI，零配置起步 | **P0** |
| Tailscale API / MagicDNS / 设备列表 | 有 token（`credRef`）时补全/对账 | P1 |
| 主动端口扫描 | **默认关闭**；不作为 Tailscale 发现路径 | 禁止默认 |

节点区分与记录字段：

- **角色/状态**：self / peer / tagged devices / offline / exit node / subnet router
- **身份与网络**：hostname、DNSName、Tailscale IPs、OS、tags、online
- **能力提示**（若可得）：ssh / funnel / serve 等——仅作候选元数据，不自动授权

### 信任与绑定

| 阶段 | 信任态 | 说明 |
|------|--------|------|
| 探查入库 | `untrusted`（默认） | 仅 inventory |
| 只读 inventory 校验通过 | 可至 `verified` | 仍不可写操作 |
| HITL bind | `bound` | 进入「可操作池」 |
| 写操作（SSH、HTTP 控制、脚本） | `bound` + 审批 | `approvalMode: 'always'` |

凭证：`credRef`（如 Tailscale API key、SSH 密钥引用），**不进 prompt**；走现有脱敏与 secret 引用约定。

### 可操作池模型

建议概念（实现二选一或并存，ADR 定稿）：

1. 显式 `DevicePool` / `OperablePool` 实体，成员指向 CapabilityCards；或
2. `CapabilityCard.kind = 'tailscale-node'` + pool 标签（如 `pool=tailnet:<id>`）

**工具面（只读优先，默认可用或随 Discovery 开关）**

| 工具 | 用途 | 默认 |
|------|------|------|
| `tailscale_list_devices` | 列池内/ inventory 节点 | 开（Discovery+Tailscale 开启时） |
| `tailscale_get_device` | 单节点详情 | 开 |
| `tailscale_ping` | 可选连通性探测 | 受策略，默认可关 |

**绑定后可选工具组（optional tool group，默认关）**

| 工具/组 | 用途 | 约束 |
|---------|------|------|
| `tailscale_ssh` | peer 支持 Tailscale SSH 时 | 审批；offline 拒绝 |
| 经节点访问的 HTTP/服务探测 | 服务级发现/调用 | allowlist = **tailnet IP 段**；禁止借道扫公网 |

与 Tool Search 对齐：池很大时不把全部节点工具 schema 塞进首轮；list/search → load → 调用。

### 安全边界

- 仅允许 tailnet 地址族出站（含 MagicDNS 解析结果校验）
- 禁止借道 subnet router / exit node **默认扫公网**
- offline 节点：可展示，**不可操作**
- Probe 不用通用 `bash` 扫网；CLI 调用经 `sanitizeSpawnEnv`（及既有沙箱策略）

### 落点路径与 env

| 项 | 建议 |
|----|------|
| 代码 | `packages/core/src/discovery/adapters/tailscale.ts` **或** `packages/agent-tailscale/` DomainBundle |
| 开关 | `RAW_AGENT_TAILSCALE_DISCOVERY=0\|1`（默认 `0`） |
| 凭证 | `RAW_AGENT_TAILSCALE_API_CRED_REF=...`（引用，非明文塞进会话） |
| 评测 | `scripts/agent-eval/...` + mock `status.json` fixture |

### 里程碑映射（摘要）

| 阶段 | Tailscale 交付 |
|------|----------------|
| M0 | 类型/`kind`/pool 字段预留；ADR 威胁与边界 |
| M1 | 只读 `status --json`（+可选 API）→ 候选卡 + list/get 工具 + eval fixture |
| M2 | 大池走 Tool Search 预算，不炸首轮 tools |
| M3 | HITL → OperablePool；optional group（SSH/HTTP）；schema pin；tailnet-only |
| M4 | 金标集召回/误操作拦截基线 |
| M5+ | ACL/Funnel/Serve/subnet 策略增强 |

---

## 3. 跨阶段工程原则

1. **安全默认**：Discovery/主动扫描/写工具/Tailscale Discovery 默认关；绑定与写操作默认审批；Probe 无通用 `bash`。
2. **凭证**：只存 `credRef`；结果回流走现有 `result-redaction`；Memory/CBOM 禁止明文 secret。
3. **工具面预算**：全量 schema 禁止默认注入；Skill disclosure / Tool Search / optional groups 三层同一预算哲学（含 OperablePool）。
4. **信任分离**：发现 ≠ 识别 ≠ 绑定；`verified` 仍不可调用写路径，直至 HITL `bound` + pin。
5. **执行层强制**：pin 漂移、scope 越权、CIDR/tailnet 违规、offline 写操作在 **执行前** 硬失败（非仅靠提示词）。
6. **评测门禁**：合并 Discovery 相关 PR 至少跑 `agent:eval:fast`；M4 起 precision/recall 基线不可静默倒退。
7. **扩展契约**：Domain/适配器只经 `DomainBundle` / `extraTools` / Plugin；禁止依赖 core 内部私有路径（对齐 ROADMAP P1）。
8. **观测**：每次 register/probe/verify/bind/pin-fail/load/search（及 `capability_tailscale_*`）打 trace，供 Evolution/排障复用。
9. **不重写主循环**：只加工具、agent、store、审批钩子、domain；控制流仍在 `tool-loop`。

---

## 4. 人员 / 优先级排序

| 优先级 | 项 | 可并行？ |
|--------|----|----------|
| **P0** | M0 Registry + ADR；M1 Probe/Verify/HITL + **Tailscale 只读 inventory**；CBOM pin 最小集（可在 M1 末尾做 hash 字段，M3 补齐执行钩子） | M0 ADR 与类型可先于实现；store 与 API 可一人串行；Tailscale adapter ∥ OpenAPI mock 策略草案 |
| **P1** | M2 Tool Search；M3 HA + OpenAPI 适配器；**Tailscale OperablePool + optional group + pin**；pin 执行钩子 | Tool Search ∥ HA adapter（接口冻结后）；OpenAPI ∥ HA；Tailscale 可操作池 ∥ HA（契约冻结后） |
| **P2** | M4 ERP canonical；Discovery eval 金标；DNS-AID/CMDB 增强 | ERP ∥ eval 金标建设 |
| **P2/远期** | M5+ A2A/WoT/合成/PDP/Tailscale 深度 | 均依赖 M0–M2 稳定契约，勿并行进主线 |

**建议人力**：1 名熟仓工程师串行 M0→M2；M3 起若有第二人，拆 Domain 适配 vs core 披露/pin（Tailscale 可划给 Domain 侧）。

**总工期（MVP=M0–M3，含 Tailscale 只读 + 可操作池）**：约 **8.0～10.5 人周**；含 M4：**11.0～14.5 人周**。  
（相对原 MVP 7.5～9.5：Tailscale M1 切片已计入 M1 工期；M3 可操作池并行时取区间上沿或 +0.5～1.0。）

---

## 5. 与现有 ROADMAP 对齐

| ROADMAP | 本计划关系 |
|---------|------------|
| **P0 底座硬化** | Discovery 必须复用沙箱、审批、可观测、Domain 扩展点；默认关闭，不破坏退出标准 |
| **P1 Domain Harness** | `homeiot` / `erp` /（可选）`tailscale` /（远期）`a2a`·`wot` 按 Harness 包落地；办公/工业自动化矩阵的具体切片 |
| **P2 炼油与知识库** | 绑定摘要进 `AgentMemoryStore`；CBOM/trace 作为炼油采集面输入，不做完整图谱 |
| **P3 联邦与节点发现** | **本计划是前导**：Registry 的 endpoint/节点身份/策略标签可复用为未来节点发现目录；**Tailscale inventory 是「虚拟组网节点发现」的第一落地源**；**不必等** CRDT/mTLS/协调平面 |
| **P4 工业运营** | scoped token、配额、多租户在 M5 PDP/配额前只做字段预留 |

与「能力进化飞轮」：Spec→MCP 合成走 Evolution backlog + `agent-eval` 晋升，对齐现有 merge-gate/harness-gate 思路，不另造发布管道。

完整分阶段计划见本文；路线图阶段定义仍以 [`ROADMAP.md`](ROADMAP.md) 为准。

---

## 6. 第一周立刻可做的 5 件事

1. **写 ADR 草稿** `doc/adr/00XX-capability-discovery.md`：四层状态机、与 `capability-gateway` 边界、威胁（投毒/rug-pull/confused deputy）、非目标（裸扫/直射频/**借道 tailnet 扫公网**）；附录含 Probe 政策与 **Tailscale 设备池** 字段草图。
2. **落地 `CapabilityCard` 类型 + 内存/SQLite Registry 骨架**（`packages/core/src/discovery/*` + migration），仅支持手工 `create/list`；feature flag 默认关；预留 `kind=tailscale-node` / pool 标签。
3. **Daemon 路由薄封装** `GET/POST /api/capabilities`，并用现有测试风格加 1 个 unit + 1 个 fast eval HTTP case。
4. **冻结 Probe 政策草案**（env 名 + CIDR/allowlist + 禁止项清单）写进 ADR 附录，并开空模块 `probe-policy.ts` 导出纯函数（先单测、不接网络）；**另开** `adapters/tailscale.ts` 空壳：只解析一份检入的 mock `status.json` → Candidate 列表（不调真实 CLI）。
5. **盘点工具披露插入点**：在 `optional-tool-groups.ts`、`prompt-builder.ts`、`mcp-manager.ts`、`runtime` 的 turnTools 过滤处加注释/设计笔记（不改行为），明确 M2 `tool_search` 与 Tailscale list 工具挂载点——保证第二周不踩主循环。

---

**决策摘要**：先 Registry 与信任态，再只读探针与 HITL（含 **Tailscale 官方 inventory → 候选卡**），再用 Tool Search 控预算，然后 HA/OpenAPI + **Tailscale 可操作池** + schema pin 打穿真实域；ERP 与 eval 度量收官 MVP+；A2A/WoT/合成/PDP 全部 Domain/脚本化试点，主循环不动。发现源优先官方 API/CLI，默认不扫端口；可操作池必须 HITL，写操作必须审批，出站仅限 tailnet。

---

## 实现状态（2026-08-04）

| 里程碑 | 状态 | 说明 |
|--------|------|------|
| **M0** Registry + ADR + HTTP | ✅ | `packages/core/src/discovery/*`、migration v11、`/api/capabilities*`；ADR `doc/adr/0001`/`0002` |
| **M1** Probe/Verify/Bind + Tailscale 只读 | ✅ | `probe-policy`/`verify`/`adapters/tailscale`；工具 `tailscale_list_devices`/`get`；`POST .../probe/tailscale`；builtin `capability-prober` |
| **M2** Tool Search 预算 | ✅ | `tools/tool-search.ts`；披露预算；prompt 片段 + `STABLE_SYSTEM_VERSION=v3` |
| **M3** OpenAPI + CBOM pin + HA | ✅（MVP） | `adapters/openapi`、`cbom.ts`、tool-loop pin 钩子；Domain `homeiot`；Tailscale OperablePool 写路径（SSH）仅 optional group 占位，**未做真 SSH** |
| **M4** ERP + eval | ✅（部分） | Domain `erp` draft/submit/post；fast eval `discovery-*` 4 case PASS；完整 precision/recall 金标脚本 **未做** |
| **UI 设置** | ✅ | `discovery/settings.ts` + `GET/PATCH /api/capabilities/settings` + Lab「更多 → 能力发现」；**界面持久化优先**，env 仅 CI/未配置回退 |
| **M5+** A2A/WoT/合成/PDP | ❌ 未做 | 按计划远期 |

### 关键路径

- Core：`packages/core/src/discovery/`（含 `settings.ts`）、`tools/tool-search.ts`、`tools/tailscale-tools.ts`
- Daemon：`apps/daemon/src/routes/capabilities.ts`
- Console：`apps/web-console/components/DiscoverySettingsCard.tsx`（More 面板）
- Domains：`packages/agent-homeiot/`、`packages/agent-erp/`（`RAW_AGENT_DOMAINS=homeiot,erp`）
- Eval：`scripts/agent-eval/cases/fast/discovery-*.json`、`fixtures/tailscale/status.json`
- ADR：`doc/adr/0001-capability-discovery.md`、`0002-cbom-schema-pin.md`

### 如何跑测试

```bash
npx tsc -b packages/core packages/agent-homeiot packages/agent-erp apps/daemon
node --test packages/core/test/discovery-*.test.js packages/core/test/tool-search.test.js
node --test packages/agent-homeiot/test/*.test.js packages/agent-erp/test/*.test.js
npm run agent:eval:fast -- --grep discovery
```

开启 Discovery（本机）：Lab → **更多 → 能力发现** 打开开关（立即生效，无需改 `.env`）。评测仍可用 env 注入作为回退。
