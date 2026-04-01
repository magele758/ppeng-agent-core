import { spawn } from 'node:child_process';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/lib/node/main.js';

export interface LspServerConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export function parseLspConfigFromEnv(env: NodeJS.ProcessEnv): LspServerConfig | undefined {
  if (!['1', 'true', 'yes'].includes(String(env.RAW_AGENT_LSP_ENABLED ?? '').toLowerCase())) {
    return undefined;
  }
  const raw = env.RAW_AGENT_LSP_COMMAND?.trim();
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as LspServerConfig;
    if (typeof parsed.command !== 'string' || !parsed.command) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Spawn LSP server, initialize, send one request, tear down.
 * For methods that need an open document, include appropriate params (e.g. textDocument/definition).
 */
export async function lspSendRequest(
  config: LspServerConfig,
  method: string,
  params: unknown
): Promise<string> {
  const child = spawn(config.command, config.args ?? [], {
    cwd: config.cwd,
    env: { ...process.env, ...config.env },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const reader = new StreamMessageReader(child.stdout);
  const writer = new StreamMessageWriter(child.stdin);
  const connection = createMessageConnection(reader, writer);
  connection.listen();

  try {
    await connection.sendRequest('initialize', {
      processId: null,
      rootUri: null,
      capabilities: {},
      clientInfo: { name: 'raw-agent', version: '0.1.0' },
      workspaceFolders: null
    });
    await connection.sendNotification('initialized', {});
    const result = await connection.sendRequest(method, params);
    return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  } finally {
    connection.dispose();
    child.kill('SIGTERM');
  }
}
