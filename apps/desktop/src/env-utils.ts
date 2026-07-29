import * as fs from 'fs';

/** 解析简单 KEY=VALUE 形式的 .env 内容，忽略空行与注释行 */
export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      result[key.trim()] = value.trim();
    }
  });
  return result;
}

/**
 * 若 .env 中指定 key 不存在或为空，则追加一行并写回文件。
 * 返回写入后的最终值（已有非空值则原样返回，不覆盖）。
 */
export function ensureEnvKey(envPath: string, key: string, generateValue: () => string): string {
  const content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  const existing = parseEnvContent(content)[key];
  if (existing) return existing;

  const value = generateValue();
  const needsNewline = content.length > 0 && !content.endsWith('\n');
  fs.writeFileSync(envPath, `${content}${needsNewline ? '\n' : ''}${key}=${value}\n`);
  return value;
}
