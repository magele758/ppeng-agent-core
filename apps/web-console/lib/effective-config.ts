import type { MessageKey } from './i18n/messages/types.ts';

/** `GET /api/config/effective` payload + pure helpers for the "运行模式 / 有效配置" card. */

export type ConfigSource = 'explicit-env' | 'lab' | 'auto-detected' | 'local-fallback';
export type ConfigGroup = 'storage' | 'capability' | 'manual';

export interface ConfigNote {
  code: string;
  message: string;
  params?: Record<string, string | number>;
}

export interface EffectiveItem {
  id: string;
  group: ConfigGroup;
  enabled: boolean;
  mode: string;
  source: ConfigSource;
  reasonCode: string;
  reason: string;
  params?: Record<string, string | number>;
  warnings: ConfigNote[];
  hints: ConfigNote[];
}

export interface EffectiveConfigPayload {
  generatedAt: string;
  mode: 'local' | 'hybrid' | 'cloud';
  summary: { externalServices: string[]; autoEnabled: string[]; partial: string[] };
  items: EffectiveItem[];
}

const GROUP_ORDER: ConfigGroup[] = ['storage', 'capability', 'manual'];

function camel(code: string): string {
  return code
    .split(/[_\-.]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** `partial_s3` → `config.notePartialS3` */
export function noteKey(code: string): string {
  return `config.note${camel(code)}`;
}

/** `lab_on_no_key` → `config.reasonLabOnNoKey` */
export function reasonKey(code: string): string {
  return `config.reason${camel(code)}`;
}

/** `storage.eventBuffer` → `config.itemEventBuffer` */
export function itemLabelKey(id: string): string {
  const last = id.split('.').pop() ?? id;
  return `config.item${last.charAt(0).toUpperCase()}${last.slice(1)}`;
}

export function sourceKey(source: ConfigSource): MessageKey {
  switch (source) {
    case 'explicit-env':
      return 'config.sourceExplicitEnv';
    case 'lab':
      return 'config.sourceLab';
    case 'auto-detected':
      return 'config.sourceAutoDetected';
    case 'local-fallback':
      return 'config.sourceLocalFallback';
    default: {
      const unreachable: never = source;
      throw new Error(`unhandled source: ${String(unreachable)}`);
    }
  }
}

export function modeKey(mode: EffectiveConfigPayload['mode']): MessageKey {
  switch (mode) {
    case 'local':
      return 'config.modeLocal';
    case 'hybrid':
      return 'config.modeHybrid';
    case 'cloud':
      return 'config.modeCloud';
    default: {
      const unreachable: never = mode;
      throw new Error(`unhandled mode: ${String(unreachable)}`);
    }
  }
}

export function groupKey(group: ConfigGroup): MessageKey {
  switch (group) {
    case 'storage':
      return 'config.groupStorage';
    case 'capability':
      return 'config.groupCapability';
    case 'manual':
      return 'config.groupManual';
    default: {
      const unreachable: never = group;
      throw new Error(`unhandled group: ${String(unreachable)}`);
    }
  }
}

export function groupItems(items: EffectiveItem[]): Array<{ group: ConfigGroup; items: EffectiveItem[] }> {
  return GROUP_ORDER.map((group) => ({ group, items: items.filter((it) => it.group === group) })).filter(
    (g) => g.items.length > 0
  );
}

/** Items worth surfacing by default: anything carrying a warning. */
export function attentionItems(items: EffectiveItem[]): EffectiveItem[] {
  return items.filter((it) => it.warnings.length > 0);
}
