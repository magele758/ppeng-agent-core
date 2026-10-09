export const ADVANCED_STORAGE_KEY = 'lab.settings.advanced';

export function parseAdvancedFlag(raw: string | null | undefined): boolean {
  return raw === '1' || raw === 'true';
}

export function serializeAdvancedFlag(on: boolean): string {
  return on ? '1' : '0';
}

export function readStoredAdvanced(storage: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return parseAdvancedFlag(storage?.getItem(ADVANCED_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function writeStoredAdvanced(storage: Pick<Storage, 'setItem'> | undefined, on: boolean): void {
  try {
    storage?.setItem(ADVANCED_STORAGE_KEY, serializeAdvancedFlag(on));
  } catch {
    /* 隐私模式 / 配额：忽略，仅本次会话生效 */
  }
}
