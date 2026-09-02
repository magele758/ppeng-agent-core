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

export function catalogNeedsSetup(data: ModelProvidersResponse | null | undefined): boolean {
  if (!data) return true;
  const hasUiRemote = (data.catalog.providers ?? []).some(
    (p) => p.source === 'ui' && p.kind !== 'heuristic'
  );
  if (hasUiRemote) return false;
  if (data.effective?.source === 'env') return false;
  return true;
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
