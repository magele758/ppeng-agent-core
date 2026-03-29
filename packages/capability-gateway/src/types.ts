export type ChannelType = 'webhook' | 'http_post' | 'feishu_bot' | 'wecom_group_bot';

export interface ChannelSpec {
  id: string;
  type: ChannelType;
  /** Full URL for webhook or HTTP POST body delivery */
  url: string;
  /** Extra headers (e.g. Authorization) */
  headers?: Record<string, string>;
  /** For slack-compatible: use { "text": "..." } wrapping */
  payloadMode?: 'json_text' | 'raw_json';
  /** Lark / Feishu group bot: use chat_id from receive_id_v2 when sending */
  feishuReceiveIdType?: 'open_id' | 'user_id' | 'union_id' | 'chat_id';
  /** WeCom group bot key (path segment) if url is base only */
  wecomKey?: string;
}

/** Feishu / Lark event subscription (inbound). */
export interface FeishuProviderSpec {
  enabled?: boolean;
  /** Must match app "Verification Token" in Feishu developer console */
  verificationToken?: string;
  /** Optional Encrypt Key (base64) — enables decrypt of `encrypt` payloads */
  encryptKey?: string;
  /** Default internal agent id for chat turns */
  defaultAgentId?: string;
  /** Outbound channel id from `channels[]` to reply in thread (must be type feishu_bot) */
  replyChannelId?: string;
}

/** WeCom: outbound group bot + optional simple bridge inbound. */
export interface WeComProviderSpec {
  enabled?: boolean;
  /** Shared secret for POST /wecom/bridge (optional) */
  bridgeSecret?: string;
  defaultAgentId?: string;
  /** channels[].id with type wecom_group_bot */
  replyChannelId?: string;
}

export interface GatewayAgentRoute {
  /** Stable id used in URL: POST .../agents/:agentId/invoke */
  agentId: string;
  /** Optional API key for this route (header X-Agent-Route-Key) */
  routeKey?: string;
  /** Persist chat across invokes when true (default true) */
  stickySession?: boolean;
}

export interface GatewayProvidersConfig {
  feishu?: FeishuProviderSpec;
  wecom?: WeComProviderSpec;
}

export interface LearnConfig {
  /** RSS or Atom feed URLs */
  feeds: string[];
  /** Relative to repo root; digest SKILL.md is written here */
  skillsSubdir: string;
  /** Max items to keep per run per feed */
  maxItemsPerFeed?: number;
}

export interface GatewayFileConfig {
  channels?: ChannelSpec[];
  learn?: LearnConfig;
  /** Inbound IM + internal agent routing (OpenClaw-style) */
  providers?: GatewayProvidersConfig;
  /** Internal HTTP routes per agent */
  agentRoutes?: GatewayAgentRoute[];
}

export interface GatewayEnvOptions {
  enabled: boolean;
  /** URL path prefix, e.g. /gateway/v1 */
  pathPrefix: string;
  configPath?: string;
  learnEnabled: boolean;
  /** UTC hour 0–23 to run daily learn (once per calendar day) */
  learnDailyHourUtc: number;
  /** Optional shared secret for X-Gateway-Token header */
  authToken?: string;
}

export interface ParsedFeedItem {
  title: string;
  link: string;
}
