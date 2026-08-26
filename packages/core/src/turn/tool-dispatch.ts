/**
 * L3 tool-dispatch façade. Implementation lives in runtime/tool-loop.ts
 * (already extracted); this path is the layer-aligned public name.
 */

export {
  checkToolApprovals,
  executeToolCalls,
  executeSingleTool,
  filterValidToolCalls,
  processToolResults,
  runTurnWithRetries
} from '../runtime/tool-loop.js';
export type { ToolExecResult, ToolLoopDeps, ToolLoopStore } from '../runtime/tool-loop.js';
