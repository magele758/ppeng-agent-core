import type { AgentSandbox, AgentSandboxExecRequest, AgentSandboxExecResult } from './agent-sandbox-types.js';
import { SandboxManager, type SandboxMode } from './os-sandbox.js';

/**
 * Wraps existing {@link SandboxManager} (Tier 0 + Tier 1 on capable hosts).
 */
export class NativeAgentSandbox implements AgentSandbox {
  readonly kind = 'native' as const;
  private readonly manager: SandboxManager;

  constructor(mode: SandboxMode = 'auto') {
    this.manager = new SandboxManager(mode);
  }

  get backendName(): string {
    return this.manager.activeProvider.name;
  }

  async execute(req: AgentSandboxExecRequest): Promise<AgentSandboxExecResult> {
    const r = await this.manager.execute(req.command, req.cwd, {
      workspace: req.workspace,
      timeoutMs: req.timeoutMs,
      signal: req.signal,
      allowNetwork: req.allowNetwork
    });
    return {
      stdout: r.stdout,
      stderr: r.stderr,
      code: r.code,
      signal: r.signal,
      kind: 'native',
      backend: this.manager.activeProvider.name
    };
  }
}
