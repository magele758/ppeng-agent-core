/**
 * OpenAPI → draft capability / tool candidates (never auto-bound).
 */

import { computeSchemaHash } from '../cbom.js';
import type { CreateCapabilityInput } from '../types.js';

export interface OpenApiToolDraft {
  toolName: string;
  method: string;
  path: string;
  summary: string;
  schemaHash: string;
  operationId?: string;
}

export interface OpenApiParseResult {
  capability: CreateCapabilityInput;
  tools: OpenApiToolDraft[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v != null && !Array.isArray(v);
}

export function parseOpenApiSpec(
  spec: unknown,
  opts?: { endpoint?: string; name?: string }
): OpenApiParseResult {
  if (!isObject(spec)) {
    throw new Error('OpenAPI spec must be an object');
  }
  const info = isObject(spec.info) ? spec.info : {};
  const title = String(info.title ?? opts?.name ?? 'openapi');
  const paths = isObject(spec.paths) ? spec.paths : {};
  const tools: OpenApiToolDraft[] = [];

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isObject(pathItem)) continue;
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const op = pathItem[method];
      if (!isObject(op)) continue;
      const operationId =
        typeof op.operationId === 'string' ? op.operationId : undefined;
      const summary =
        typeof op.summary === 'string'
          ? op.summary
          : typeof op.description === 'string'
            ? op.description
            : `${method.toUpperCase()} ${path}`;
      const toolName =
        operationId ||
        `${method}_${path.replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]+/g, '_')}`.replace(
          /^_+|_+$/g,
          ''
        );
      const schemaSlice = { method, path, operationId, parameters: op.parameters, requestBody: op.requestBody };
      tools.push({
        toolName,
        method: method.toUpperCase(),
        path,
        summary,
        schemaHash: computeSchemaHash(schemaSlice),
        operationId
      });
    }
  }

  const capability: CreateCapabilityInput = {
    kind: 'openapi',
    name: title,
    description: typeof info.description === 'string' ? info.description : undefined,
    endpoint:
      opts?.endpoint ??
      (() => {
        const servers = Array.isArray(spec.servers) ? spec.servers : [];
        const first = servers[0];
        if (isObject(first) && typeof first.url === 'string') return first.url;
        return 'https://example.invalid';
      })(),
    transport: 'https',
    trust: 'untrusted',
    scope: ['read'],
    source: 'openapi-adapter',
    schemaHash: computeSchemaHash({ title, toolNames: tools.map((t) => t.toolName).sort() }),
    metadata: {
      toolCount: tools.length,
      draftTools: tools
    }
  };

  return { capability, tools };
}
