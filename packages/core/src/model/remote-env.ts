/**
 * Normalize third-party API secrets coming from GitHub Actions / .env paste.
 * Trailing newlines, wrapping quotes, and a duplicated `Bearer ` prefix are
 * the usual reasons a configured key still 401s.
 */

export function normalizeRemoteSecret(raw: string | undefined): string {
  let value = String(raw ?? '').trim();
  if (value.length >= 2) {
    const start = value[0];
    const end = value[value.length - 1];
    if ((start === '"' && end === '"') || (start === "'" && end === "'")) {
      value = value.slice(1, -1).trim();
    }
  }
  if (/^bearer\s+/i.test(value)) {
    value = value.replace(/^bearer\s+/i, '').trim();
  }
  return value;
}

export interface RemoteEnvInspection {
  keyLen: number;
  keyHadWhitespace: boolean;
  keyHadQuotes: boolean;
  keyHadBearerPrefix: boolean;
  baseUrlLen: number;
  baseUrlHadWhitespace: boolean;
  baseUrlHasV1: boolean;
  modelLen: number;
  modelHadWhitespace: boolean;
}

function hadOuterWhitespace(raw: string | undefined): boolean {
  if (raw == null) return false;
  return raw !== raw.trim();
}

function hadQuotes(raw: string | undefined): boolean {
  const trimmed = String(raw ?? '').trim();
  return (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  );
}

function unwrapQuotes(raw: string | undefined): string {
  let value = String(raw ?? '').trim();
  if (hadQuotes(value)) value = value.slice(1, -1).trim();
  return value;
}

export function inspectRemoteEnv(env: NodeJS.ProcessEnv = process.env): RemoteEnvInspection {
  const key = env.RAW_AGENT_API_KEY;
  const base = env.RAW_AGENT_BASE_URL ?? env.RAW_AGENT_ANTHROPIC_URL;
  const model = env.RAW_AGENT_MODEL_NAME;
  const normalizedBase = normalizeRemoteSecret(base);
  return {
    keyLen: normalizeRemoteSecret(key).length,
    keyHadWhitespace: hadOuterWhitespace(key),
    keyHadQuotes: hadQuotes(key),
    keyHadBearerPrefix: /^bearer\s+/i.test(unwrapQuotes(key)),
    baseUrlLen: normalizedBase.length,
    baseUrlHadWhitespace: hadOuterWhitespace(base),
    baseUrlHasV1: /\/v1(?:\/|$)/i.test(normalizedBase),
    modelLen: normalizeRemoteSecret(model).length,
    modelHadWhitespace: hadOuterWhitespace(model)
  };
}

export function formatRemoteEnvInspection(info: RemoteEnvInspection): string {
  return [
    `key_len=${info.keyLen}`,
    `key_ws=${info.keyHadWhitespace}`,
    `key_quoted=${info.keyHadQuotes}`,
    `key_bearer=${info.keyHadBearerPrefix}`,
    `base_len=${info.baseUrlLen}`,
    `base_ws=${info.baseUrlHadWhitespace}`,
    `base_has_v1=${info.baseUrlHasV1}`,
    `model_len=${info.modelLen}`,
    `model_ws=${info.modelHadWhitespace}`
  ].join(' ');
}
