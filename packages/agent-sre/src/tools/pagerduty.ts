import type { ToolContract } from '@ppeng/agent-core';
import { httpJson, notConfigured } from '../util.js';

type PdArgs = {
  status?: 'triggered' | 'acknowledged' | 'resolved';
  service_ids?: string[];
  team_ids?: string[];
  urgencies?: ('high' | 'low')[];
  limit?: number;
  /** Override env (test only). */
  base_url?: string;
};

export const pagerDutyListTool: ToolContract<PdArgs> = {
  name: 'pagerduty_list',
  description:
    'List PagerDuty incidents (env SRE_PAGERDUTY_TOKEN). Read-only. Defaults to triggered + acknowledged so you see open work.',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['triggered', 'acknowledged', 'resolved'] },
      service_ids: { type: 'array', items: { type: 'string' } },
      team_ids: { type: 'array', items: { type: 'string' } },
      urgencies: { type: 'array', items: { type: 'string', enum: ['high', 'low'] } },
      limit: { type: 'number', description: 'Default 25, max 100' },
      base_url: { type: 'string', description: 'Override PagerDuty base (default https://api.pagerduty.com)' },
    },
  },
  approvalMode: 'never',
  sideEffectLevel: 'system',
  async execute(_context, args) {
    const token = process.env.SRE_PAGERDUTY_TOKEN?.trim();
    if (!token) return notConfigured('SRE_PAGERDUTY_TOKEN', 'Create a REST API key at PagerDuty → Integrations → API Access Keys.');
    const base = (args.base_url ?? 'https://api.pagerduty.com').replace(/\/+$/, '');
    const url = new URL(`${base}/incidents`);
    const statuses = args.status ? [args.status] : ['triggered', 'acknowledged'];
    for (const s of statuses) url.searchParams.append('statuses[]', s);
    for (const id of args.service_ids ?? []) url.searchParams.append('service_ids[]', id);
    for (const id of args.team_ids ?? []) url.searchParams.append('team_ids[]', id);
    for (const u of args.urgencies ?? []) url.searchParams.append('urgencies[]', u);
    url.searchParams.set('limit', String(Math.min(Math.max(args.limit ?? 25, 1), 100)));
    return httpJson({
      url: url.toString(),
      headers: {
        // PagerDuty uses Token-style auth, not Bearer.
        authorization: `Token token=${token}`,
        accept: 'application/vnd.pagerduty+json;version=2',
      },
    });
  },
};
