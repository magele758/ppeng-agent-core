/**
 * Dynamic tool factory records — JSON in AgentMemory namespace `dyn-tools`.
 * Not a ptcLastProgram blob. P0/P1 kind is ptc_cell only.
 */

import type { MemoryScope } from '../memory/types.js';

export const DYN_TOOLS_NAMESPACE = 'dyn-tools';
export const DYN_TOOL_SOURCE = 'dyn-tool';
export const DYN_TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,47}$/;
export const MAX_ACTIVE_DRAFT_PER_SESSION = 20;
export const MAX_SOURCE_CODE_CHARS = 16_000;
export const DYN_TOOL_HYDRATE_TOP_K = 8;
export const DYN_TOOL_UNUSED_SUGGEST_TURNS = 20;
export const DYN_TOOLS_USED_META_KEY = 'dynToolsUsed';

export const SAVE_AS_TOOL_NAME = 'save_as_tool';
export const PROPOSE_TOOL_NAME = 'propose_tool';
export const SEARCH_DYN_TOOLS_NAME = 'search_dyn_tools';
export const DYN_META_TOOL_NAMES = [SAVE_AS_TOOL_NAME, PROPOSE_TOOL_NAME, SEARCH_DYN_TOOLS_NAME] as const;
export const DYN_TOOL_PROMOTE_APPROVAL = 'dyn_tool_promote';

export type DynToolKind = 'ptc_cell';
export type DynToolStatus = 'draft' | 'active' | 'retired';
export type DynToolScope = Extract<MemoryScope, 'session.scratch' | 'session.long' | 'project.memory'>;

export interface DynToolStats {
  uses: number;
  lastUsedTurn?: number;
  lastUsedAt?: string;
}

export interface DynToolFixtureExpectContains {
  contains: string;
}

export interface DynToolFixture {
  args: Record<string, unknown>;
  /** Deep-equal on cell return value, or `{ contains }` against JSON result. */
  expect?: unknown;
}

export interface DynToolCreatedFrom {
  sessionId?: string;
  ptcLastProgram?: boolean;
}

export interface DynToolRecord {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  kind: DynToolKind;
  source: { code: string };
  scope: DynToolScope;
  status: DynToolStatus;
  stats: DynToolStats;
  createdFrom?: DynToolCreatedFrom;
  tests?: DynToolFixture[];
  /** When true, name may appear in memory appendix (R17). Default false. */
  pin?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DynToolErrorCode =
  | 'invalid_name'
  | 'reserved_name'
  | 'quota'
  | 'code_too_large'
  | 'empty_code'
  | 'not_found'
  | 'invalid_record'
  | 'disabled';

export class DynToolError extends Error {
  readonly code: DynToolErrorCode;

  constructor(code: DynToolErrorCode, message: string) {
    super(message);
    this.name = 'DynToolError';
    this.code = code;
  }
}

export interface DynToolOwner {
  sessionId?: string;
}

export const DEFAULT_DYN_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: true
};
