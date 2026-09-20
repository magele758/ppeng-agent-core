import type { GoalVerifyKind, GoalVerifySpec } from './types.js';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const paths = value
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .map((p) => p.trim());
  return paths;
}

/** 从 JSON 解析。非法形状返回 undefined（调用方视为无 verify）。 */
export function parseGoalVerifySpec(raw: unknown): GoalVerifySpec | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const kindRaw = obj.kind;
  const kind = (typeof kindRaw === 'string' ? kindRaw.trim() : undefined) as GoalVerifyKind | undefined;

  if (kind === 'files_exist' || (!kind && Array.isArray(obj.paths))) {
    const paths = asStringArray(obj.paths);
    if (!paths || paths.length === 0) return undefined;
    return { kind: 'files_exist', paths };
  }

  if (kind === 'http') {
    if (!isNonEmptyString(obj.url)) return undefined;
    const spec: GoalVerifySpec = { kind: 'http', url: obj.url.trim() };
    if (typeof obj.expectStatus === 'number' && Number.isInteger(obj.expectStatus) && obj.expectStatus > 0) {
      spec.expectStatus = obj.expectStatus;
    }
    return spec;
  }

  if (kind === 'command' || (!kind && isNonEmptyString(obj.command))) {
    if (!isNonEmptyString(obj.command)) return undefined;
    return { kind: 'command', command: obj.command.trim() };
  }

  return undefined;
}

const MAX_DERIVED_VERIFY_PATHS = 8;
const MAX_DERIVED_PATH_CHARS = 256;

export function isSafeRelPath(raw: string): boolean {
  const p = raw.trim();
  if (!p || p.length > MAX_DERIVED_PATH_CHARS) return false;
  if (p.startsWith('/') || p.startsWith('\\') || p.startsWith('~')) return false;
  if (/^[a-zA-Z]:/.test(p)) return false;
  const norm = p.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!norm) return false;
  const segs = norm.split('/');
  if (segs.some((seg) => !seg || seg === '..')) return false;
  return true;
}

/**
 * 产品/推导路径：只接受 files_exist / http，丢掉 command。
 * 非法 → undefined（保持闲聊 fail-open）。
 */
export function sanitizeDerivedVerifySpec(raw: unknown): GoalVerifySpec | undefined {
  const parsed = parseGoalVerifySpec(raw);
  if (!parsed) return undefined;
  if (parsed.kind === 'files_exist') {
    const paths = (parsed.paths ?? []).filter(isSafeRelPath).slice(0, MAX_DERIVED_VERIFY_PATHS);
    if (paths.length === 0) return undefined;
    return { kind: 'files_exist', paths };
  }
  if (parsed.kind === 'http' && isExecutableVerifySpec(parsed)) {
    return parsed;
  }
  return undefined;
}

export function describeGoalVerifySpec(spec: GoalVerifySpec): { kind: GoalVerifyKind; label: string } {
  switch (spec.kind) {
    case 'files_exist': {
      const paths = spec.paths ?? [];
      return {
        kind: spec.kind,
        label: paths.length > 0 ? `检查文件存在：${paths.join('、')}` : '检查指定文件是否存在'
      };
    }
    case 'http':
      return {
        kind: spec.kind,
        label: spec.url
          ? `检查接口返回 ${spec.expectStatus ?? 200}：${spec.url}`
          : '检查接口是否可访问'
      };
    case 'command':
      return { kind: spec.kind, label: '主机验收命令（默认不执行）' };
    default: {
      const _never: never = spec.kind;
      void _never;
      return { kind: 'files_exist', label: '验收检查' };
    }
  }
}

export function isExecutableVerifySpec(spec: GoalVerifySpec): boolean {
  switch (spec.kind) {
    case 'files_exist':
      return Array.isArray(spec.paths) && spec.paths.length > 0;
    case 'http':
      return (
        typeof spec.url === 'string' &&
        spec.url.length > 0 &&
        (spec.url.startsWith('http://') || spec.url.startsWith('https://'))
      );
    case 'command':
      return typeof spec.command === 'string' && spec.command.trim().length > 0;
    default: {
      const _never: never = spec.kind;
      void _never;
      return false;
    }
  }
}
