import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '../logger.js';
import { envBool } from '../env.js';

const logger = createLogger('llm-debug');

export function llmPromptDebugEnabled(env: NodeJS.ProcessEnv): boolean {
  return envBool(env, 'RAW_AGENT_DEBUG_LLM_PROMPT', false);
}

function maxChars(env: NodeJS.ProcessEnv): number {
  const v = Number(env.RAW_AGENT_DEBUG_LLM_PROMPT_MAX_CHARS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function truncateText(text: string, env: NodeJS.ProcessEnv): string {
  const max = maxChars(env);
  if (text.startsWith('data:') && text.includes(';base64,')) {
    return text.slice(0, 80) + '...[BASE64_TRUNCATED]';
  }
  if (max > 0 && text.length > max) {
    return text.slice(0, max) + `...[TRUNCATED +${text.length - max}]`;
  }
  return text;
}

function sanitizeContentPart(part: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof part === 'string') return truncateText(part, env);
  if (part === null || typeof part !== 'object') return part;
  const p = part as Record<string, unknown>;
  if (p.type === 'text' && typeof p.text === 'string') {
    return { ...p, text: truncateText(p.text, env) };
  }
  if (p.type === 'image_url' && typeof (p as { image_url?: { url?: string } }).image_url?.url === 'string') {
    const iu = (p as { image_url: { url: string } }).image_url;
    return { ...p, image_url: { ...iu, url: truncateText(iu.url, env) } };
  }
  return p;
}

function sanitizeMessage(msg: unknown, env: NodeJS.ProcessEnv): unknown {
  if (msg === null || typeof msg !== 'object') return msg;
  const m = msg as Record<string, unknown>;
  if (typeof m.content === 'string') {
    return { ...m, content: truncateText(m.content, env) };
  }
  if (Array.isArray(m.content)) {
    return { ...m, content: m.content.map((c) => sanitizeContentPart(c, env)) };
  }
  return m;
}

/** Deep-clone-ish sanitization for logging OpenAI-style chat payloads (no secrets in body). */
export function sanitizeLlmRequestBodyForDebug(body: Record<string, unknown>, env: NodeJS.ProcessEnv): Record<string, unknown> {
  const result: Record<string, unknown> = { ...body };
  if (Array.isArray(result.messages)) {
    result.messages = result.messages.map((msg) => sanitizeMessage(msg, env));
  }
  if (Array.isArray(result.system)) {
    result.system = result.system.map((block) => {
      if (block && typeof block === 'object' && typeof (block as { text?: string }).text === 'string') {
        const b = block as { text: string };
        return { ...(block as object), text: truncateText(b.text, env) };
      }
      return block;
    });
  }
  return result;
}

export async function maybeLogLlmRequest(
  env: NodeJS.ProcessEnv,
  ctx: { stateDir: string; sessionId: string } | undefined,
  adapterName: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (!llmPromptDebugEnabled(env) || !ctx) {
    return;
  }
  const sanitized = sanitizeLlmRequestBodyForDebug(payload, env);
  const record = {
    ts: new Date().toISOString(),
    adapter: adapterName,
    sessionId: ctx.sessionId,
    payload: sanitized
  };
  const line = JSON.stringify(record);
  const mode = String(env.RAW_AGENT_DEBUG_LLM_PROMPT_MODE ?? 'file').toLowerCase();
  if (mode === 'logger') {
    logger.info(line);
    return;
  }
  const dir = join(ctx.stateDir, 'llm-debug', ctx.sessionId);
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, 'requests.jsonl'), `${line}\n`, 'utf8');
}
