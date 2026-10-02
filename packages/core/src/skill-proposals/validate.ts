/** Pure validation for skill proposals: name, size limits, secret-looking content. */

export const SKILL_PROPOSAL_NAME_MAX = 64;
export const SKILL_PROPOSAL_DESCRIPTION_MAX = 300;
export const SKILL_PROPOSAL_BODY_MAX = 20_000;
export const SKILL_PROPOSAL_MAX_PENDING = 50;

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class SkillProposalError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'secret' | 'not_found' | 'conflict' | 'limit' = 'invalid'
  ) {
    super(message);
    this.name = 'SkillProposalError';
  }
}

export function isValidSkillProposalName(name: unknown): name is string {
  return typeof name === 'string' && name.length <= SKILL_PROPOSAL_NAME_MAX && NAME_RE.test(name);
}

/** Skips obvious placeholders (`<your-token>`, `${TOKEN}`, `your-…`, `xxxx`, `****`) right where a value starts. */
const PLACEHOLDER_GUARD = '(?!(?:your|my|example|placeholder|changeme|change-me|dummy|redacted|replace|x{3,}|\\*{3,}|\\.{3})(?![a-z]))';

const SECRET_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'OpenAI/Anthropic-style key', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/ },
  { label: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
  { label: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { label: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { label: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { label: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { label: 'bearer token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/i },
  { label: 'Stripe key', re: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/ },
  { label: 'npm token', re: /\bnpm_[A-Za-z0-9]{20,}/ },
  { label: 'Hugging Face token', re: /\bhf_[A-Za-z0-9]{20,}/ },
  {
    label: 'secret env assignment',
    re: new RegExp(`(?:SECRET_KEY|_SECRET|_TOKEN|_PASSWORD)\\b["']?[ \\t]{0,3}=[ \\t]{0,3}["']?${PLACEHOLDER_GUARD}[A-Za-z0-9/+_.=@#%^&!~-]{8,}`)
  },
  {
    label: 'token assignment',
    re: new RegExp(`token["']?[ \\t]{0,3}[:=][ \\t]{0,3}["']${PLACEHOLDER_GUARD}[A-Za-z0-9/+_.=@#%^&!~-]{16,}`, 'i')
  },
  {
    label: 'credential assignment',
    re: /\b(?:api[_-]?key|secret|access[_-]?token|auth[_-]?token|password|passwd|client[_-]?secret)\b["']?\s*[:=]\s*["']?[A-Za-z0-9/+_.=-]{16,}/i
  }
];

/**
 * `scheme://user:PASS@host`. Every quantifier is bounded so a match attempt costs O(1) per start
 * position; the password is judged separately by {@link isPlaceholderConnectionPassword}.
 */
const CONNECTION_STRING_RE = /\b[a-z][a-z0-9+.-]{1,20}:\/\/([^\s:/@<>$]{0,64}):([^\s/@]{3,128})@([^\s/:?#@]{1,100})/gi;

const PLACEHOLDER_PASSWORD_WORDS = new Set([
  'password',
  'pass',
  'passwd',
  'pwd',
  'secret',
  'changeme',
  'example',
  'yourpassword'
]);

const PLACEHOLDER_PASSWORD_SHAPES: RegExp[] = [
  /^your[-_]/,
  /^<[^<>]*>$/,
  /^\{\{.*\}\}$/,
  /^\{[^{}]*\}$/,
  /^\$\{[^}]*\}$/,
  /^\$\([^)]*\)$/,
  /^\$[a-z_][a-z0-9_]*$/,
  /^%s$/,
  /^[x*.\u2026]{3,}$/,
  /^(.)\1{2,}$/
];

const DOC_EXAMPLE_HOSTS = new Set(['localhost', '127.0.0.1', 'example.com', 'db', 'host']);

function isDocExampleHost(host: string): boolean {
  const h = host.toLowerCase();
  if (DOC_EXAMPLE_HOSTS.has(h)) return true;
  const labels = h.split('.');
  return labels.length >= 3 && labels.slice(1, -1).includes('example');
}

/** True when the password segment of a connection string is an obvious documentation placeholder. */
function isPlaceholderConnectionPassword(password: string, host: string): boolean {
  const lower = password.toLowerCase();
  if (PLACEHOLDER_PASSWORD_WORDS.has(lower)) return true;
  if (PLACEHOLDER_PASSWORD_SHAPES.some((re) => re.test(lower))) return true;
  return password.length <= 8 && /^[a-z]+$/.test(password) && isDocExampleHost(host);
}

function hasRealConnectionCredentials(text: string): boolean {
  for (const m of text.matchAll(CONNECTION_STRING_RE)) {
    if (!isPlaceholderConnectionPassword(m[2] ?? '', m[3] ?? '')) return true;
  }
  return false;
}

/** Returns the label of the first secret-looking pattern found, or undefined. */
export function findSecretLikeContent(text: string): string | undefined {
  for (const { label, re } of SECRET_PATTERNS) {
    if (re.test(text)) return label;
  }
  if (hasRealConnectionCredentials(text)) return 'credentials in connection string';
  return undefined;
}

export interface SkillProposalDraft {
  name: string;
  description: string;
  body: string;
}

function collapseLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Validate + normalize model-supplied fields. Throws SkillProposalError. */
export function validateSkillProposalDraft(raw: {
  name?: unknown;
  description?: unknown;
  body?: unknown;
}): SkillProposalDraft {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!isValidSkillProposalName(name)) {
    throw new SkillProposalError(
      `name must be lowercase letters/digits separated by single hyphens, at most ${SKILL_PROPOSAL_NAME_MAX} chars (e.g. "deploy-staging")`
    );
  }
  const description = typeof raw.description === 'string' ? collapseLine(raw.description) : '';
  if (!description) throw new SkillProposalError('description is required');
  if (description.length > SKILL_PROPOSAL_DESCRIPTION_MAX) {
    throw new SkillProposalError(`description exceeds ${SKILL_PROPOSAL_DESCRIPTION_MAX} chars`);
  }
  const body = typeof raw.body === 'string' ? raw.body.replace(/\r\n/g, '\n').trim() : '';
  if (!body) throw new SkillProposalError('body is required');
  if (body.length > SKILL_PROPOSAL_BODY_MAX) {
    throw new SkillProposalError(`body exceeds ${SKILL_PROPOSAL_BODY_MAX} chars`);
  }
  if (/^---\s*\n/.test(body)) {
    throw new SkillProposalError('body must be plain markdown without YAML frontmatter; name/description are set separately');
  }
  for (const [field, text] of [
    ['name', name],
    ['description', description],
    ['body', body]
  ] as const) {
    const hit = findSecretLikeContent(text);
    if (hit) {
      throw new SkillProposalError(
        `${field} looks like it contains a secret (${hit}); remove credentials and use placeholders instead`,
        'secret'
      );
    }
  }
  return { name, description, body };
}
