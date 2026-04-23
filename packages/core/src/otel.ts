import { createHash } from 'node:crypto';
import { appendTraceEvent } from './stores/trace.js';

function sessionScopedTraceEnabled(env: NodeJS.ProcessEnv): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(env.RAW_AGENT_OTEL_SESSION_SCOPED_TRACE ?? '').toLowerCase());
}

function traceIdHex(
  env: NodeJS.ProcessEnv,
  stateDir: string,
  sessionId: string,
  name: string
): string {
  if (sessionScopedTraceEnabled(env)) {
    return createHash('sha256').update(`otel-trace:${stateDir}:${sessionId}`).digest('hex').slice(0, 32);
  }
  return Buffer.from(`${sessionId}:${name}:${Date.now()}`.slice(0, 32).padEnd(32, '0'))
    .toString('hex')
    .slice(0, 32);
}

function spanIdHex(name: string): string {
  return createHash('sha256')
    .update(`span:${name}:${Date.now()}:${Math.random()}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Optional OTLP HTTP JSON export (minimal, no heavy SDK).
 * Set RAW_AGENT_OTEL_HTTP_ENDPOINT to a collector URL (e.g. http://localhost:4318/v1/traces).
 *
 * When RAW_AGENT_OTEL_SESSION_SCOPED_TRACE=1, all spans for a session share one traceId (better UI correlation).
 */
export async function maybeExportOtelSpan(
  env: NodeJS.ProcessEnv,
  stateDir: string,
  sessionId: string,
  name: string,
  attrs: Record<string, string>
): Promise<void> {
  const endpoint = env.RAW_AGENT_OTEL_HTTP_ENDPOINT?.trim();
  if (!endpoint) {
    return;
  }
  const serviceName = env.RAW_AGENT_OTEL_SERVICE_NAME?.trim() || 'raw-agent';
  const traceId = traceIdHex(env, stateDir, sessionId, name);
  const spanId = spanIdHex(name);
  const mergedAttrs: Record<string, string> = { sessionId, ...attrs };
  const body = {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] },
        scopeSpans: [
          {
            spans: [
              {
                traceId,
                spanId,
                name,
                kind: 1,
                startTimeUnixNano: String(Date.now() * 1e6),
                endTimeUnixNano: String(Date.now() * 1e6),
                attributes: Object.entries(mergedAttrs).map(([k, v]) => ({
                  key: k,
                  value: { stringValue: v }
                }))
              }
            ]
          }
        ]
      }
    ]
  };
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch {
    /* ignore export failures */
  }
  void appendTraceEvent(stateDir, sessionId, { kind: 'otel_proxy', payload: { name, endpoint } });
}
