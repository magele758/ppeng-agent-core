export interface MemoryToolServices {
  upsertSessionMemory(
    sessionId: string,
    scope: 'scratch' | 'long',
    key: string,
    value: string
  ): Promise<void>;
  listSessionMemory(sessionId: string, scope?: 'scratch' | 'long'): Promise<unknown[]>;
  deleteSessionMemory(sessionId: string, scope: 'scratch' | 'long', key: string): Promise<boolean>;
}
