import type { AgentSandbox, AgentSandboxKind } from './agent-sandbox-types.js';
import { NativeAgentSandbox } from './native-agent-sandbox.js';
import { RemoteVmAgentSandbox } from './remote-vm-agent-sandbox.js';
import { MicroserviceAgentSandbox } from './microservice-agent-sandbox.js';
import type { SandboxMode } from './os-sandbox.js';

/**
 * High-level kind for *agent* execution (orthogonal to `RAW_AGENT_SANDBOX_MODE`
 * which only applies to {@link NativeAgentSandbox}).
 *
 * Env: `RAW_AGENT_AGENT_SANDBOX_KIND=native|remote_vm|microservice` (default: native)
 */
export function agentSandboxKindFromEnv(env?: NodeJS.ProcessEnv): AgentSandboxKind {
  const e = env ?? process.env;
  const raw = (e.RAW_AGENT_AGENT_SANDBOX_KIND ?? 'native').trim().toLowerCase();
  if (raw === 'remote_vm' || raw === 'remote-vm' || raw === 'e2b') return 'remote_vm';
  if (raw === 'microservice' || raw === 'runner' || raw === 'service') return 'microservice';
  return 'native';
}

export function createAgentSandboxFromEnv(env?: NodeJS.ProcessEnv): AgentSandbox {
  const e = env ?? process.env;
  const kind = agentSandboxKindFromEnv(e);
  if (kind === 'remote_vm') {
    return new RemoteVmAgentSandbox(e);
  }
  if (kind === 'microservice') {
    return new MicroserviceAgentSandbox(e);
  }
  const mode = (e.RAW_AGENT_SANDBOX_MODE ?? 'auto') as SandboxMode;
  return new NativeAgentSandbox(mode);
}
