/** Lab-side shape of GET/PATCH /api/gateway/settings (secrets are never returned, only `*Set` flags). */
export interface GatewaySettingsView {
  feishu: { verificationTokenSet: boolean; encryptKeySet: boolean; allowedSenders: string[]; botId?: string };
  wecom: { bridgeSecretSet: boolean; allowedSenders: string[]; botId?: string };
  webhook: { allowedSenders: string[] };
  updatedAt?: string;
}

export interface GatewaySettingsPatch {
  feishu?: {
    verificationToken?: string | null;
    encryptKey?: string | null;
    allowedSenders?: string[];
    botId?: string | null;
  };
  wecom?: { bridgeSecret?: string | null; allowedSenders?: string[]; botId?: string | null };
  webhook?: { allowedSenders?: string[] };
}

export interface GatewayDraft {
  feishu: {
    verificationToken: string;
    clearVerificationToken: boolean;
    encryptKey: string;
    clearEncryptKey: boolean;
    allowedSenders: string;
    botId: string;
  };
  wecom: { bridgeSecret: string; clearBridgeSecret: boolean; allowedSenders: string; botId: string };
  webhook: { allowedSenders: string };
}

export function parseSenderList(text: string): string[] {
  return [...new Set(text.split(/[\s,;，；]+/).map((s) => s.trim()).filter(Boolean))];
}

export function draftFromView(view: GatewaySettingsView): GatewayDraft {
  return {
    feishu: {
      verificationToken: '',
      clearVerificationToken: false,
      encryptKey: '',
      clearEncryptKey: false,
      allowedSenders: view.feishu.allowedSenders.join('\n'),
      botId: view.feishu.botId ?? ''
    },
    wecom: {
      bridgeSecret: '',
      clearBridgeSecret: false,
      allowedSenders: view.wecom.allowedSenders.join('\n'),
      botId: view.wecom.botId ?? ''
    },
    webhook: { allowedSenders: view.webhook.allowedSenders.join('\n') }
  };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function secretPatch(typed: string, clear: boolean): string | null | undefined {
  if (clear) return null;
  const v = typed.trim();
  return v ? v : undefined;
}

function botPatch(draft: string, current: string | undefined): string | null | undefined {
  const next = draft.trim();
  if (next === (current ?? '')) return undefined;
  return next ? next : null;
}

function compact<T extends object>(o: T): T | undefined {
  const entries = Object.entries(o).filter(([, v]) => v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}

/** Only fields the user actually changed; empty secret inputs mean "keep as is". */
export function buildGatewayPatch(view: GatewaySettingsView, draft: GatewayDraft): GatewaySettingsPatch {
  const feishuSenders = parseSenderList(draft.feishu.allowedSenders);
  const wecomSenders = parseSenderList(draft.wecom.allowedSenders);
  const webhookSenders = parseSenderList(draft.webhook.allowedSenders);
  const feishu = compact({
    verificationToken: secretPatch(draft.feishu.verificationToken, draft.feishu.clearVerificationToken),
    encryptKey: secretPatch(draft.feishu.encryptKey, draft.feishu.clearEncryptKey),
    allowedSenders: sameList(feishuSenders, view.feishu.allowedSenders) ? undefined : feishuSenders,
    botId: botPatch(draft.feishu.botId, view.feishu.botId)
  });
  const wecom = compact({
    bridgeSecret: secretPatch(draft.wecom.bridgeSecret, draft.wecom.clearBridgeSecret),
    allowedSenders: sameList(wecomSenders, view.wecom.allowedSenders) ? undefined : wecomSenders,
    botId: botPatch(draft.wecom.botId, view.wecom.botId)
  });
  const webhook = sameList(webhookSenders, view.webhook.allowedSenders)
    ? undefined
    : { allowedSenders: webhookSenders };
  const patch: GatewaySettingsPatch = {};
  if (feishu) patch.feishu = feishu;
  if (wecom) patch.wecom = wecom;
  if (webhook) patch.webhook = webhook;
  return patch;
}

export function isGatewayDirty(view: GatewaySettingsView, draft: GatewayDraft): boolean {
  return Object.keys(buildGatewayPatch(view, draft)).length > 0;
}
