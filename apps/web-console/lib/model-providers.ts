export type ModelProviderKind = 'openai-compatible' | 'anthropic-compatible' | 'heuristic';

export type ModelRef = { providerId: string; modelId: string };

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

export function parseSessionModelRef(metadata: Record<string, unknown> | undefined): ModelRef | undefined {
  const raw = metadata?.modelRef;
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const providerId = typeof o.providerId === 'string' ? o.providerId.trim() : '';
  const modelId = typeof o.modelId === 'string' ? o.modelId.trim() : '';
  if (!providerId || !modelId) return undefined;
  return { providerId, modelId };
}
