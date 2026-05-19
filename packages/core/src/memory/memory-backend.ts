/** Session memory persistence backend (see RAW_AGENT_MEMORY_BACKEND). */
export type MemoryBackend = 'agent' | 'session' | 'dual';

export function memoryBackendFromEnv(env: NodeJS.ProcessEnv = process.env): MemoryBackend {
  const v = String(env.RAW_AGENT_MEMORY_BACKEND ?? 'agent').trim().toLowerCase();
  if (v === 'session') return 'session';
  if (v === 'dual') return 'dual';
  return 'agent';
}

export function sessionScopeToAgent(scope: 'scratch' | 'long'): 'session.scratch' | 'session.long' {
  return scope === 'scratch' ? 'session.scratch' : 'session.long';
}

export function agentScopeToSession(scope: string): 'scratch' | 'long' | undefined {
  if (scope === 'session.scratch') return 'scratch';
  if (scope === 'session.long') return 'long';
  return undefined;
}
