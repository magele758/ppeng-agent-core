import type { SandboxExecOptions, SandboxExecResult, SandboxProvider } from './os-sandbox.js';
import { CloudflareComputerClient, mapRemoteCwd } from './cloudflare-computer-client.js';
import {
  getBoundSandboxSettingsStore,
  resolveCloudflareComputer,
  resolveCloudflareComputerToken
} from './sandbox-settings.js';
import { getBoundSecretVault } from '../secrets/secret-vault.js';

/**
 * Remote exec via a user-deployed Cloudflare Computer Worker.
 * No local spawn. Host cwd is remapped to `/workspace`.
 */
export class CloudflareComputerProvider implements SandboxProvider {
  readonly name = 'cloudflare-computer';
  readonly tier = 2 as const;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetchImpl?: typeof fetch
  ) {}

  isAvailable(): boolean {
    return resolveCloudflareComputer(getBoundSandboxSettingsStore(), this.env).endpoint.length > 0;
  }

  async execute(command: string, options: SandboxExecOptions): Promise<SandboxExecResult> {
    const resolved = resolveCloudflareComputer(getBoundSandboxSettingsStore(), this.env);
    const tok = resolveCloudflareComputerToken(resolved, getBoundSecretVault(), this.env);
    const client = new CloudflareComputerClient({
      endpoint: resolved.endpoint,
      workspaceName: options.sessionId || resolved.workspaceName,
      token: tok.token,
      timeoutMs: options.timeoutMs ?? resolved.timeoutMs,
      backend: resolved.backend,
      fetchImpl: this.fetchImpl
    });
    const result = await client.exec({
      command,
      cwd: mapRemoteCwd(options.cwd),
      timeoutMs: options.timeoutMs ?? resolved.timeoutMs,
      signal: options.signal,
      workspaceName: options.sessionId || resolved.workspaceName
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
      signal: null,
      tier: 2
    };
  }
}
