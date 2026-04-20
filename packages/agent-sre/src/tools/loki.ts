import type { ToolContract } from '@ppeng/agent-core';
import { httpJson, normalizeBase, notConfigured } from '../util.js';

type LokiArgs = {
  query: string;
  start?: string;
  end?: string;
  limit?: number;
  direction?: 'forward' | 'backward';
  base_url?: string;
};

export const lokiQueryTool: ToolContract<LokiArgs> = {
  name: 'loki_query',
  description:
    'Run a LogQL query against the configured Loki (env SRE_LOKI_URL). When start/end are omitted, queries the last 15 minutes. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'LogQL expression, e.g. {job="api"} |= "error"' },
      start: { type: 'string', description: 'RFC3339 or nanosecond unix' },
      end: { type: 'string', description: 'RFC3339 or nanosecond unix' },
      limit: { type: 'number', description: 'Default 100, max 5000' },
      direction: { type: 'string', enum: ['forward', 'backward'] },
      base_url: { type: 'string', description: 'Override SRE_LOKI_URL' },
    },
    required: ['query'],
  },
  approvalMode: 'never',
  sideEffectLevel: 'system',
  async execute(_context, args) {
    const base = (args.base_url ?? process.env.SRE_LOKI_URL ?? '').trim();
    if (!base) return notConfigured('SRE_LOKI_URL', 'Set it to your Loki base URL, e.g. http://loki:3100');
    const url = new URL(`${normalizeBase(base)}/loki/api/v1/query_range`);
    url.searchParams.set('query', args.query);
    if (args.start) url.searchParams.set('start', args.start);
    if (args.end) url.searchParams.set('end', args.end);
    url.searchParams.set('limit', String(Math.min(Math.max(args.limit ?? 100, 1), 5000)));
    url.searchParams.set('direction', args.direction ?? 'backward');
    const auth = process.env.SRE_LOKI_TOKEN ? `Bearer ${process.env.SRE_LOKI_TOKEN}` : undefined;
    return httpJson({ url: url.toString(), auth });
  },
};
