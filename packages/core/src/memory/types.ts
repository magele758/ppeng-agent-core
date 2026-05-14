export type MemoryScope =
  | 'session.scratch'
  | 'session.long'
  | 'user.memory'
  | 'team.memory'
  | 'project.memory';

export type MemoryConfidence = 'low' | 'medium' | 'high';

export interface AgentMemory {
  id: string;
  scope: MemoryScope;
  namespace: string;
  key: string;
  value: string;
  userId?: string;
  tenantId?: string;
  sessionId?: string;
  importance: number;
  source?: string;
  confidence: MemoryConfidence;
  expiresAt?: string;
  accessCount: number;
  lastAccessAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryFilter {
  scope?: MemoryScope;
  namespace?: string;
  userId?: string;
  tenantId?: string;
  sessionId?: string;
  /** FTS full-text search query */
  query?: string;
  limit?: number;
  orderBy?: 'importance' | 'recency' | 'access_count';
}

export interface User {
  id: string;
  email?: string;
  displayName?: string;
  status: string;
  createdAt: string;
}

export interface Tenant {
  id: string;
  name: string;
  createdAt: string;
}

export interface Membership {
  userId: string;
  tenantId: string;
  role: string;
}
