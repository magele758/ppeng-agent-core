/**
 * Minimal message shapes for a future IDE / VS Code bridge (phase 4 placeholder).
 * Align loosely with JSON-RPC control channels; not wired to daemon yet.
 */
export type BridgeDirection = 'toHost' | 'toAgent';

export interface BridgeSessionHello {
  type: 'session.hello';
  sessionId: string;
  workspaceRoot: string;
}

export interface BridgeToolPermissionRequest {
  type: 'tool.permission';
  sessionId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface BridgeToolPermissionResponse {
  type: 'tool.permission.result';
  sessionId: string;
  toolCallId: string;
  approved: boolean;
}

export type BridgeMessage = BridgeSessionHello | BridgeToolPermissionRequest | BridgeToolPermissionResponse;
