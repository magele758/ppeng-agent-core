import type { ToolContract } from '../types.js';
import { McpStdioSession, parseMcpStdioConfigs, sanitizeMcpToolSuffix } from './mcp-stdio.js';
import { appendTraceEvent } from '../stores/trace.js';
import { envBool } from '../env.js';

export interface McpManagerDeps {
  stateDir: string;
  tools: ToolContract<any>[];
  env: Record<string, string | undefined>;
  log: { warn: (msg: string) => void };
}

export class McpManager {
  private mcpUrls: string[];
  private mcpToolsPromise?: Promise<void>;
  private mcpExpansionDone = false;
  private readonly mcpStdioSessions: McpStdioSession[] = [];

  constructor(private readonly deps: McpManagerDeps) {
    this.mcpUrls = (deps.env['RAW_AGENT_MCP_URLS'] ?? deps.env['RAW_AGENT_MCP_URL'] ?? '')
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  get stdioSessions(): McpStdioSession[] {
    return this.mcpStdioSessions;
  }

  async ensureLoaded(sessionId: string): Promise<void> {
    if (this.mcpExpansionDone) return;

    if (!this.mcpToolsPromise) {
      this.mcpToolsPromise = this.performMcpExpansion(sessionId);
    }
    await this.mcpToolsPromise;
  }

  /** One-shot MCP expansion: connects servers, registers tools, then marks done. */
  private async performMcpExpansion(sessionId: string): Promise<void> {
    const urls = [...this.mcpUrls];
    const stdioConfigs = parseMcpStdioConfigs(this.deps.env as NodeJS.ProcessEnv);
    const expandStdio = envBool(this.deps.env as NodeJS.ProcessEnv, 'RAW_AGENT_MCP_EXPAND_STDIO', true);
    const expandHttp = envBool(this.deps.env as NodeJS.ProcessEnv, 'RAW_AGENT_MCP_EXPAND_HTTP', false);

    if (urls.length === 0 && stdioConfigs.length === 0) {
      this.mcpExpansionDone = true;
      return;
    }

    try {
      const mod = await import('./mcp-jsonrpc.js');
      const { mcpCallTool, mcpListResources, mcpReadResource } = mod;

      this.expandHttpMcpTools(urls, expandHttp, mod.mcpListTools, mcpCallTool);
      await this.connectStdioMcpServers(stdioConfigs, expandStdio, sessionId);
      this.registerResourceTools(urls, mcpListResources, mcpReadResource);
    } finally {
      this.mcpExpansionDone = true;
    }
  }

  /** Register generic mcp_invoke + optionally expand individual HTTP server tools. */
  private async expandHttpMcpTools(
    urls: string[],
    expandHttp: boolean,
    mcpListTools: (url: string) => Promise<{ name: string; description?: string; inputSchema?: Record<string, unknown> }[]>,
    mcpCallTool: (url: string, tool: string, args: Record<string, unknown>) => Promise<{ isError?: boolean; content: string }>
  ): Promise<void> {
    if (urls.length === 0 || this.deps.tools.some((t) => t.name === 'mcp_invoke')) return;

    const httpUrls = [...urls];
    this.deps.tools.push({
      name: 'mcp_invoke',
      description: 'Invoke a tool on an HTTP JSON-RPC MCP server. server is 0-based index into RAW_AGENT_MCP_URLS list.',
      inputSchema: {
        type: 'object',
        properties: {
          server: { type: 'number', description: 'MCP server index (from env URL list)' },
          tool: { type: 'string' },
          arguments: { type: 'object' }
        },
        required: ['server', 'tool']
      },
      approvalMode: 'auto',
      sideEffectLevel: 'system',
      needsApproval: () => true,
      async execute(_ctx, args: { server: number; tool: string; arguments?: Record<string, unknown> }) {
        const url = httpUrls[Math.floor(args.server)];
        if (!url) return { ok: false, content: `Invalid MCP server index ${args.server}` };
        const out = await mcpCallTool(url, args.tool, args.arguments ?? {});
        return { ok: !out.isError, content: out.content };
      }
    } as ToolContract<{ server: number; tool: string; arguments?: Record<string, unknown> }>);

    if (!expandHttp) return;

    for (let hi = 0; hi < httpUrls.length; hi++) {
      const baseUrl = httpUrls[hi];
      if (!baseUrl) continue;
      let listed: { name: string; description?: string; inputSchema?: Record<string, unknown> }[] = [];
      try {
        listed = await mcpListTools(baseUrl);
      } catch (err) {
        this.deps.log.warn(`Failed to list tools from ${baseUrl}: ${err instanceof Error ? err.message : err}`);
      }
      for (const t of listed) {
        const name = `mcp_h${hi}_${sanitizeMcpToolSuffix(t.name)}`;
        if (this.deps.tools.some((x) => x.name === name)) continue;
        const toolName = t.name;
        const bu = baseUrl;
        this.deps.tools.push({
          name,
          description: t.description ?? `MCP HTTP server ${hi} tool ${toolName}`,
          inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object' },
          approvalMode: 'auto',
          sideEffectLevel: 'system',
          needsApproval: () => true,
          async execute(_ctx, args) {
            const out = await mcpCallTool(bu, toolName, args as Record<string, unknown>);
            return { ok: !out.isError, content: out.content };
          }
        });
      }
    }
  }

  /** Connect stdio MCP servers and optionally expand their tools. */
  private async connectStdioMcpServers(
    stdioConfigs: ReturnType<typeof parseMcpStdioConfigs>,
    expandStdio: boolean,
    sessionId: string
  ): Promise<void> {
    for (let si = 0; si < stdioConfigs.length; si++) {
      const cfg = stdioConfigs[si];
      if (!cfg) continue;
      const session = new McpStdioSession(si, cfg);
      try {
        await session.connect();
        this.mcpStdioSessions.push(session);
        if (!expandStdio) continue;
        const listed = await session.listTools();
        for (const t of listed) {
          const name = `mcp_s${si}_${sanitizeMcpToolSuffix(t.name)}`;
          if (this.deps.tools.some((x) => x.name === name)) continue;
          const toolName = t.name;
          this.deps.tools.push({
            name,
            description: t.description ?? `MCP stdio server ${si} tool ${toolName}`,
            inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object' },
            approvalMode: 'auto',
            sideEffectLevel: 'system',
            needsApproval: () => true,
            async execute(_ctx, args) {
              const out = await session.callTool(toolName, args as Record<string, unknown>);
              return { ok: !out.isError, content: out.content };
            }
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        void appendTraceEvent(this.deps.stateDir, sessionId, {
          kind: 'model_error',
          payload: { mcpStdio: si, message: msg }
        });
      }
    }
  }

  /** Register mcp_list_resources and mcp_read_resource tools for all connected servers. */
  private registerResourceTools(
    urls: string[],
    mcpListResources: (url: string) => Promise<unknown>,
    mcpReadResource: (url: string, uri: string) => Promise<{ mimeType?: string; text: string }>
  ): void {
    const totalServers = urls.length + this.mcpStdioSessions.length;
    if (totalServers === 0) return;
    const mgr = this;

    if (!this.deps.tools.some((t) => t.name === 'mcp_list_resources')) {
      this.deps.tools.push({
        name: 'mcp_list_resources',
        description: 'List MCP resources. server index: 0..N-1 where HTTP URLs (RAW_AGENT_MCP_URLS) come first, then stdio servers (RAW_AGENT_MCP_STDIO order).',
        inputSchema: {
          type: 'object',
          properties: { server: { type: 'number' } },
          required: ['server']
        },
        approvalMode: 'auto',
        sideEffectLevel: 'system',
        needsApproval: () => false,
        async execute(_ctx, args: { server: number }) {
          const idx = Math.floor(args.server);
          if (idx < 0 || idx >= totalServers) return { ok: false, content: `Invalid server ${args.server}` };
          if (idx < urls.length) {
            const u = urls[idx];
            if (!u) return { ok: false, content: 'Invalid URL index' };
            try {
              const r = await mcpListResources(u);
              return { ok: true, content: JSON.stringify(r, null, 2) };
            } catch (e) {
              return { ok: false, content: e instanceof Error ? e.message : String(e) };
            }
          }
          const s = mgr.mcpStdioSessions[idx - urls.length];
          if (!s) return { ok: false, content: 'Stdio server not connected' };
          const r = await s.listResources();
          return { ok: true, content: JSON.stringify(r, null, 2) };
        }
      } as ToolContract<{ server: number }>);
    }

    if (!this.deps.tools.some((t) => t.name === 'mcp_read_resource')) {
      this.deps.tools.push({
        name: 'mcp_read_resource',
        description: 'Read one MCP resource by URI (same server indexing as mcp_list_resources).',
        inputSchema: {
          type: 'object',
          properties: { server: { type: 'number' }, uri: { type: 'string' } },
          required: ['server', 'uri']
        },
        approvalMode: 'auto',
        sideEffectLevel: 'system',
        needsApproval: () => true,
        async execute(_ctx, args: { server: number; uri: string }) {
          const idx = Math.floor(args.server);
          if (idx < 0 || idx >= totalServers) return { ok: false, content: `Invalid server ${args.server}` };
          if (idx < urls.length) {
            const u = urls[idx];
            if (!u) return { ok: false, content: 'Invalid URL index' };
            try {
              const r = await mcpReadResource(u, args.uri);
              return { ok: true, content: r.mimeType ? `${r.mimeType}\n\n${r.text}` : r.text };
            } catch (e) {
              return { ok: false, content: e instanceof Error ? e.message : String(e) };
            }
          }
          const s = mgr.mcpStdioSessions[idx - urls.length];
          if (!s) return { ok: false, content: 'Stdio server not connected' };
          const r = await s.readResource(args.uri);
          return { ok: true, content: r.mimeType ? `${r.mimeType}\n\n${r.text}` : r.text };
        }
      } as ToolContract<{ server: number; uri: string }>);
    }
  }

  async destroy(): Promise<void> {
    for (const session of this.mcpStdioSessions) {
      try { await session.close(); } catch { /* best effort */ }
    }
    this.mcpStdioSessions.length = 0;
  }
}
