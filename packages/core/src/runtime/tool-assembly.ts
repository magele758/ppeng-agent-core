/**
 * Optional extra tools (browser / cron / discovery / tailscale) assembled at runtime start.
 */

import { CronJobStore, createCronTools, cronToolsFeatureEnabled } from '../cron/cron-store.js';
import { CapabilityRegistry } from '../discovery/registry.js';
import type { SqliteStateStore } from '../storage.js';
import { createTailscaleTools } from '../tools/tailscale-tools.js';
import { createToolSearchTools } from '../tools/tool-search.js';
import {
  browserToolsFeatureEnabled,
  createBrowserTools,
  defaultBrowserAction
} from '../tools/browser-tools.js';
import type { ToolContract } from '../types.js';

export function assembleOptionalTools(input: {
  env: NodeJS.ProcessEnv;
  store: SqliteStateStore;
  stateDir: string;
  getCronStore: () => CronJobStore;
}): ToolContract<any>[] {
  const optionalExtras: ToolContract<any>[] = [];
  if (browserToolsFeatureEnabled(input.env)) {
    optionalExtras.push(
      ...createBrowserTools({
        runBrowserAction: (ctx, action) => defaultBrowserAction(ctx, action)
      })
    );
  }
  if (cronToolsFeatureEnabled(input.env)) {
    optionalExtras.push(...createCronTools(() => input.getCronStore()));
  }
  {
    const getRegistry = () => new CapabilityRegistry(input.store.capabilities());
    optionalExtras.push(
      ...createToolSearchTools({
        getRegistry,
        getShortlist: (sessionId) => {
          const session = input.store.getSession(sessionId);
          const raw = (session?.metadata as Record<string, unknown> | undefined)
            ?.capabilityShortlist;
          return Array.isArray(raw) ? raw.map(String) : [];
        },
        env: input.env,
        settingsStore: input.store
      }),
      ...createTailscaleTools({
        getRegistry,
        env: input.env,
        settingsStore: input.store
      })
    );
  }
  return optionalExtras;
}
