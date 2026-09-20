import { attachFileCompensation as attachFromLoop } from '@ppeng/agent-loop/full';
import type { ToolContract } from '../types.js';
import { resolveWorkspacePath } from '../workspace/index.js';

export function attachFileCompensation(tools: ToolContract<any>[]): ToolContract<any>[] {
  return attachFromLoop(tools, resolveWorkspacePath);
}
