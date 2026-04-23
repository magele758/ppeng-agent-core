# IM 控制 Agent 能力现状

本文档说明当前仓库内**即时通讯（IM）与 Agent 运行时**的集成范围：哪些平台可收消息驱动会话、哪些仅支持出站通知、哪些尚未内置。

## 已有能力

### 飞书（Lark / Feishu）— 双向（可控制 Agent）

- **入站**：`POST {gatewayPrefix}/providers/feishu/events`，事件订阅校验与挑战应答；消息经 [`packages/capability-gateway/src/im-handlers.ts`](../packages/capability-gateway/src/im-handlers.ts) 调用 `RawAgentRuntime` 执行轮次并回复。
- **出站**：`gateway.config.json` 的 `channels[]` 中 `type: "feishu_bot"`，配合环境变量 `RAW_AGENT_FEISHU_APP_ID` / `RAW_AGENT_FEISHU_APP_SECRET`，见 [`channels.ts`](../packages/capability-gateway/src/channels.ts)、[`feishu-api.ts`](../packages/capability-gateway/src/feishu-api.ts)。
- **配置示例**：[`gateway.config.example.json`](../gateway.config.example.json) 中 `providers.feishu` 与 `replyChannelId`。

### 企业微信（WeCom）— 部分

- **出站群机器人**：`type: "wecom_group_bot"`，[`wecom-send.ts`](../packages/capability-gateway/src/wecom-send.ts) 向企业微信 webhook 发送 markdown。
- **入站**：`POST {gatewayPrefix}/providers/wecom/bridge`（可选 `bridgeSecret`），见 [`http.ts`](../packages/capability-gateway/src/http.ts)。用于**自建桥**将外部系统转发的消息 POST 进来再跑 Agent；**不是**完整的企业微信应用回调协议栈。
- **配置**：`providers.wecom` 见 `gateway.config.example.json`。

### 通用 Webhook（含 Slack Incoming 等）

- `type: "webhook"` + `payloadMode`（如 `json_text`）：主要用于**出站推送**（例如社媒定时发帖经 [`apps/daemon/src/social-schedule-deliver.ts`](../apps/daemon/src/social-schedule-deliver.ts) 投递）。
- **不是**从 Slack 等平台收事件、内置解析并驱动 Agent 的适配器。

## 未内置的平台

| 平台 | 状态 |
|------|------|
| 微信个人号机器人 | 无 |
| 钉钉机器人 | 无（仓库内无钉钉 API / channel 类型） |
| Telegram Bot | 无 |
| Slack Events API 入站 | 无（仅 webhook 出站形态） |

扩展方式：新增 `ChannelType` / `GatewayProvidersConfig` 与对应 handler，或在外部用桥接服务调用 Gateway 的 `POST .../agents/:agentId/invoke`（见 [`types.ts`](../packages/capability-gateway/src/types.ts) 中 `agentRoutes`）。

## 控制 Agent 的其它入口（非 IM）

- **Web 控制台**：Next.js 经 `middleware` 代理到 daemon 的 `/api/sessions/*` 等。
- **Capability Gateway**：`POST .../agents/:agentId/invoke`（需配置 `agentRoutes`）。
- **CLI**：通过 HTTP 调用 daemon。

## 环境变量与索引

- 飞书相关：`RAW_AGENT_FEISHU_*` — 见 [`doc/ENV_REFERENCE.md`](ENV_REFERENCE.md)。
- Gateway：`RAW_AGENT_GATEWAY_*`、`RAW_AGENT_GATEWAY_CONFIG`（`gateway.config.json` 路径）。

## 小结

- **能通过 IM「控制 Agent」**（用户消息 → 创建/续跑 session）：当前主要是**飞书事件订阅**；**企业微信**依赖 **bridge** 入站，群机器人通道主要用于**发回复**。
- **钉钉 / Telegram / 个人微信**：需新增实现，或 **HTTP invoke + 外部桥**。
