export type ModelProviderKind = 'openai-compatible' | 'anthropic-compatible' | 'heuristic';

export type ModelRef = { providerId: string; modelId: string };

export type RemoteModelHint = { id: string; ownedBy?: string };

export type PreviewScanResponse = {
  ok: boolean;
  models: RemoteModelHint[];
  endpoint?: string;
  error?: string;
  suggestedName?: string;
};

export type ModelProviderPreset = {
  id: string;
  label: string;
  kind: ModelProviderKind;
  baseUrl: string;
  apiKeyHint?: string;
};

export const MODEL_PROVIDER_PRESETS: ModelProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'siliconflow', label: '硅基流动', kind: 'openai-compatible', baseUrl: 'https://api.siliconflow.cn/v1' },
  { id: 'moonshot', label: 'Moonshot', kind: 'openai-compatible', baseUrl: 'https://api.moonshot.cn/v1' },
  {
    id: 'ollama',
    label: 'Ollama',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKeyHint: 'ollama'
  },
  { id: 'anthropic', label: 'Anthropic', kind: 'anthropic-compatible', baseUrl: 'https://api.anthropic.com' },
  { id: 'custom', label: '自定义', kind: 'openai-compatible', baseUrl: '' }
];

export type PublicCatalogModel = { id: string; ownedBy?: string; enabled: boolean };

export type PublicModelProvider = {
  id: string;
  name: string;
  kind: ModelProviderKind;
  baseUrl: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  useJsonMode: boolean;
  httpKind?: 'chat_completions' | 'responses';
  models: PublicCatalogModel[];
  scannedAt?: string;
  scanError?: string;
  createdAt: string;
  updatedAt: string;
  source: 'ui' | 'env' | 'builtin';
};

export type ModelPickerOption = {
  providerId: string;
  providerName: string;
  modelId: string;
  kind: ModelProviderKind;
  source: 'ui' | 'env' | 'builtin';
};

export type ModelProvidersResponse = {
  catalog: {
    providers: PublicModelProvider[];
    defaultRef: ModelRef | null;
    updatedAt: string;
  };
  options: ModelPickerOption[];
  persisted: boolean;
  effective: { source: 'ui' | 'env' | 'heuristic'; defaultRef: ModelRef };
};

export type GroupedPickerOptions = {
  providerId: string;
  providerName: string;
  options: ModelPickerOption[];
};

export function parseManualModelIds(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\s,;，；]+/)) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Configured remote provider that passed scan or has enabled models (not heuristic). */
export function isVerifiedConfiguredProvider(p: PublicModelProvider): boolean {
  if (p.kind === 'heuristic' || p.source === 'builtin') return false;
  if (!p.baseUrl.trim()) return false;
  if (p.source === 'ui' && !p.hasApiKey) return false;
  if (p.scanError) return false;
  const enabled = p.models.some((m) => m.enabled);
  if (p.source === 'env') return enabled;
  return Boolean(p.scannedAt) || enabled;
}

export function isEnvFallbackOption(o: { source?: string; providerId?: string; id?: string }): boolean {
  return o.source === 'env' || o.providerId === '__env__' || o.id === '__env__';
}

function isComposerPickerProvider(p: PublicModelProvider): boolean {
  if (isEnvFallbackOption(p)) return false;
  if (p.kind === 'heuristic' || p.source === 'builtin') return true;
  if (!p.baseUrl.trim()) return false;
  if (p.source === 'ui' && !p.hasApiKey) return false;
  return p.models.some((m) => m.enabled);
}

export function catalogToPickerOptions(
  data: ModelProvidersResponse | null | undefined
): ModelPickerOption[] {
  const out: ModelPickerOption[] = [];
  const seen = new Set<string>();
  for (const p of data?.catalog.providers ?? []) {
    if (!isComposerPickerProvider(p)) continue;
    for (const m of p.models) {
      if (!m.enabled) continue;
      const key = `${p.id}::${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        providerId: p.id,
        providerName: p.name,
        modelId: m.id,
        kind: p.kind,
        source: p.source
      });
    }
  }
  return out;
}

/** Current picker selection: session/UI ref if it is a catalog option, else persisted default, else none (never env). */
export function resolvePickerModelRef(
  options: readonly ModelPickerOption[],
  current: ModelRef | null | undefined,
  catalogDefault?: ModelRef | null
): ModelRef | null {
  const ui = options.filter((o) => !isEnvFallbackOption(o));
  const match = (ref: ModelRef | null | undefined): ModelRef | null => {
    if (!ref || isEnvFallbackOption(ref)) return null;
    const hit = ui.find((o) => o.providerId === ref.providerId && o.modelId === ref.modelId);
    return hit ? { providerId: hit.providerId, modelId: hit.modelId } : null;
  };
  return match(current) ?? match(catalogDefault);
}

export function groupPickerOptionsByProvider(
  options: readonly ModelPickerOption[]
): GroupedPickerOptions[] {
  const order: string[] = [];
  const byProvider = new Map<string, GroupedPickerOptions>();
  for (const o of options) {
    let group = byProvider.get(o.providerId);
    if (!group) {
      group = { providerId: o.providerId, providerName: o.providerName, options: [] };
      byProvider.set(o.providerId, group);
      order.push(o.providerId);
    }
    group.options.push(o);
  }
  return order.map((id) => byProvider.get(id)!);
}

export function encodeModelValue(ref: ModelRef): string {
  return `${ref.providerId}::${ref.modelId}`;
}

export function decodeModelValue(value: string): ModelRef | undefined {
  const i = value.indexOf('::');
  if (i <= 0) return undefined;
  const providerId = value.slice(0, i).trim();
  const modelId = value.slice(i + 2).trim();
  if (!providerId || !modelId) return undefined;
  return { providerId, modelId };
}

function normalizeProviderUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

/** Chips in the setup row: saved custom (UI) providers only. */
export function providersForPresetRow(providers: readonly PublicModelProvider[]): PublicModelProvider[] {
  return providers.filter((p) => p.source === 'ui' && p.kind !== 'heuristic');
}

export function baseUrlFromModelsEndpoint(endpoint: string): string | undefined {
  const raw = endpoint.trim().replace(/\/+$/, '');
  if (!raw) return undefined;
  if (raw.endsWith('/models')) {
    const next = raw.slice(0, -'/models'.length).replace(/\/+$/, '');
    return next || undefined;
  }
  return undefined;
}

export function matchProviderPresetId(provider: Pick<PublicModelProvider, 'baseUrl' | 'kind'>): string {
  const url = normalizeProviderUrl(provider.baseUrl);
  const hit = MODEL_PROVIDER_PRESETS.find(
    (pre) => pre.id !== 'custom' && pre.kind === provider.kind && normalizeProviderUrl(pre.baseUrl) === url
  );
  return hit?.id ?? 'custom';
}

export function catalogNeedsSetup(data: ModelProvidersResponse | null | undefined): boolean {
  if (!data) return true;
  return catalogToPickerOptions(data).length === 0;
}

export function parseSessionModelRef(metadata: Record<string, unknown> | undefined): ModelRef | undefined {
  const raw = metadata?.modelRef;
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const providerId = typeof o.providerId === 'string' ? o.providerId.trim() : '';
  const modelId = typeof o.modelId === 'string' ? o.modelId.trim() : '';
  if (!providerId || !modelId) return undefined;
  return { providerId, modelId };
}
