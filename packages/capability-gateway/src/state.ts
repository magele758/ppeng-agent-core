import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface StoredFeedItem {
  title: string;
  link: string;
  fetchedAt: string;
}

export interface ChannelSessionBinding {
  sessionId: string;
  updatedAt: string;
}

export interface GatewayPersistedState {
  version: 1;
  rollingItems: StoredFeedItem[];
  seenLinks: string[];
  lastLearnRunDateUtc?: string;
  lastDigestMarkdown?: string;
  /** e.g. feishu:open_id:xxx → sessionId for multi-turn */
  channelSessions?: Record<string, ChannelSessionBinding>;
}

const EMPTY: GatewayPersistedState = {
  version: 1,
  rollingItems: [],
  seenLinks: []
};

export async function readGatewayState(dir: string): Promise<GatewayPersistedState> {
  const path = join(dir, 'gateway-state.json');
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<GatewayPersistedState>;
    if (parsed.version !== 1) {
      return { ...EMPTY, seenLinks: Array.isArray(parsed.seenLinks) ? parsed.seenLinks : [] };
    }
    return {
      version: 1,
      rollingItems: Array.isArray(parsed.rollingItems) ? parsed.rollingItems : [],
      seenLinks: Array.isArray(parsed.seenLinks) ? parsed.seenLinks : [],
      lastLearnRunDateUtc: typeof parsed.lastLearnRunDateUtc === 'string' ? parsed.lastLearnRunDateUtc : undefined,
      lastDigestMarkdown: typeof parsed.lastDigestMarkdown === 'string' ? parsed.lastDigestMarkdown : undefined,
      channelSessions:
        parsed.channelSessions && typeof parsed.channelSessions === 'object' && !Array.isArray(parsed.channelSessions)
          ? (parsed.channelSessions as Record<string, ChannelSessionBinding>)
          : undefined
    };
  } catch {
    return { ...EMPTY };
  }
}

export async function writeGatewayState(dir: string, state: GatewayPersistedState): Promise<void> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'gateway-state.json');
  await writeFile(path, JSON.stringify(state, null, 2), 'utf8');
}
