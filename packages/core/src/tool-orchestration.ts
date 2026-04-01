import type { ToolContract } from './types.js';

export function truncateToolContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  return `${content.slice(0, maxChars)}\n… [truncated ${content.length - maxChars} chars]`;
}

export function envToolResultMaxChars(env: NodeJS.ProcessEnv): number {
  const v = Number(env.RAW_AGENT_TOOL_RESULT_MAX_CHARS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 120_000;
}

export function partitionForParallel<T>(items: T[], maxParallel: number): T[][] {
  const chunks: T[][] = [];
  const n = Math.max(1, maxParallel);
  for (let i = 0; i < items.length; i += n) {
    chunks.push(items.slice(i, i + n));
  }
  return chunks;
}

export function findToolByName<T extends ToolContract<any>>(tools: T[], name: string): T | undefined {
  return tools.find((c) => c.name === name);
}
