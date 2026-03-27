export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

async function rpc(url: string, method: string, params: Record<string, unknown>): Promise<unknown> {
  const body = {
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`MCP HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(text) as { result?: unknown; error?: { message?: string } };
  if (parsed.error) {
    throw new Error(parsed.error.message ?? 'MCP error');
  }
  return parsed.result;
}

/** Best-effort tools/list for HTTP JSON-RPC MCP servers. */
export async function mcpListTools(baseUrl: string): Promise<McpToolInfo[]> {
  const result = (await rpc(baseUrl.replace(/\/$/, ''), 'tools/list', {})) as {
    tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
  };
  return (result.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema
  }));
}

export async function mcpCallTool(
  baseUrl: string,
  name: string,
  args: Record<string, unknown>
): Promise<{ content: string; isError?: boolean }> {
  const result = (await rpc(baseUrl.replace(/\/$/, ''), 'tools/call', {
    name,
    arguments: args
  })) as {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  const parts = result.content ?? [];
  const text = parts
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text as string)
    .join('\n');
  return { content: text || JSON.stringify(result), isError: result.isError };
}

export function parseMcpUrls(env: NodeJS.ProcessEnv): string[] {
  const raw = env.RAW_AGENT_MCP_URLS ?? env.RAW_AGENT_MCP_URL ?? '';
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
