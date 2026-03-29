export type ChannelType = 'webhook' | 'http_post';

export interface ChannelSpec {
  id: string;
  type: ChannelType;
  /** Full URL for webhook or HTTP POST body delivery */
  url: string;
  /** Extra headers (e.g. Authorization) */
  headers?: Record<string, string>;
  /** For slack-compatible: use { "text": "..." } wrapping */
  payloadMode?: 'json_text' | 'raw_json';
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
