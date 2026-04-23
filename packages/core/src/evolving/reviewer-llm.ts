import { jsonrepair } from 'jsonrepair';
import { envBool } from '../env.js';

const SYSTEM = `You distill agent runs into ONE reusable case for a local library.
Reply with ONLY a JSON object (no markdown), either:
{"skip":true,"reason":"short"}
or
{"skip":false,"outcome":"success"|"failure"|"partial","task_fingerprint":"short task label (<=80 chars)","what_worked":"","what_failed":"","pivot_hint":"","applicable_when":"","not_applicable_when":""}
Rules:
- what_worked / what_failed / pivot_hint must be concrete (tools, parameters, order), not "task completed".
- If there is nothing transferable, return skip:true.`;

export async function runReviewerLlm(
  env: NodeJS.ProcessEnv,
  userPayload: string,
  signal?: AbortSignal
): Promise<Record<string, unknown> | null> {
  const apiKey = env.RAW_AGENT_API_KEY?.trim();
  const baseUrl = env.RAW_AGENT_BASE_URL?.trim().replace(/\/$/, '');
  const model = env.RAW_AGENT_MODEL_NAME?.trim();
  if (!apiKey || !baseUrl || !model) return null;

  const useJsonMode = envBool(env, 'RAW_AGENT_USE_JSON_MODE', true);
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userPayload.slice(0, 24_000) }
    ],
    temperature: 0
  };
  if (useJsonMode) {
    body.response_format = { type: 'json_object' };
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal
    });
    const text = await res.text();
    if (!res.ok) return null;
    const parsed = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
    const content = parsed.choices?.[0]?.message?.content?.trim();
    if (!content) return null;
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      try {
        return JSON.parse(jsonrepair(content)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  }
}
