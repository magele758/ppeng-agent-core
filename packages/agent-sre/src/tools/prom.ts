import type { ToolContract } from '@ppeng/agent-core';
import { httpJson, normalizeBase, notConfigured } from '../util.js';

type PromArgs = {
  query: string;
  /** When set, runs query_range; otherwise instant query. */
  start?: string;
  end?: string;
  step?: string;
  /** Override env (mostly for tests). */
  base_url?: string;
};

export const promQueryTool: ToolContract<PromArgs> = {
  name: 'prom_query',
  description:
    'Run a PromQL query against the configured Prometheus (env SRE_PROM_URL). Pass `start`+`end`+`step` for query_range; omit them for an instant query at "now". Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'PromQL expression, e.g. sum(rate(http_requests_total[5m])) by (status)' },
      start: { type: 'string', description: 'RFC3339 or unix timestamp (range query only)' },
      end: { type: 'string', description: 'RFC3339 or unix timestamp (range query only)' },
      step: { type: 'string', description: 'Step (e.g. "30s", "1m"); range query only' },
      base_url: { type: 'string', description: 'Override SRE_PROM_URL for ad-hoc / test calls' },
    },
    required: ['query'],
  },
  approvalMode: 'never',
  sideEffectLevel: 'system',
  async execute(_context, args) {
    const base = (args.base_url ?? process.env.SRE_PROM_URL ?? '').trim();
    if (!base) return notConfigured('SRE_PROM_URL', 'Set it to your Prometheus base URL, e.g. http://prometheus:9090');
    const isRange = Boolean(args.start && args.end && args.step);
    const path = isRange ? '/api/v1/query_range' : '/api/v1/query';
    const url = new URL(`${normalizeBase(base)}${path}`);
    url.searchParams.set('query', args.query);
    if (isRange) {
      url.searchParams.set('start', String(args.start));
      url.searchParams.set('end', String(args.end));
      url.searchParams.set('step', String(args.step));
    }
    const auth = process.env.SRE_PROM_TOKEN ? `Bearer ${process.env.SRE_PROM_TOKEN}` : undefined;
    return httpJson({ url: url.toString(), auth });
  },
};
