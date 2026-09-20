import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createAssembledLoop, createMiniAssembledLoop } from './create-assembled-loop.js';
import { moduleIdsForPreset, LOOP_MODULES } from './presets.js';
import { createDefaultMemoryStore, DEFAULT_EMBED_AGENT } from './store-adapter.js';
import type { ModelAdapter, ModelTurnResult, ToolContract } from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));

function stubAdapter(impl: () => ModelTurnResult | Promise<ModelTurnResult>): ModelAdapter {
  return {
    name: 'stub',
    async runTurn() {
      return impl();
    },
    async summarizeMessages() {
      return 'summary';
    },
  };
}

function collectStaticImports(entryFile: string, seen = new Set<string>()): Set<string> {
  const abs = entryFile.startsWith('/') ? entryFile : join(here, entryFile);
  if (seen.has(abs)) return seen;
  seen.add(abs);
  let src: string;
  try {
    src = readFileSync(abs, 'utf8');
  } catch {
    return seen;
  }
  const re = /(?:^|\n)import(?:\s+type)?\s+(?:[^'"\n]+from\s+)?['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src))) {
    const spec = match[1]!;
    if (spec.startsWith('.')) {
      const resolved = join(dirname(abs), spec.endsWith('.js') ? spec.replace(/\.js$/, '.ts') : `${spec}.ts`);
      collectStaticImports(resolved, seen);
    } else {
      seen.add(spec);
    }
  }
  return seen;
}

describe('createAssembledLoop presets', () => {
  it('mini runs a text turn on the memory store', async () => {
    const { store, surface } = createDefaultMemoryStore({ agent: DEFAULT_EMBED_AGENT });
    const session = surface.createSession({
      title: 't',
      mode: 'chat',
      agentId: DEFAULT_EMBED_AGENT.id,
    });
    surface.appendMessage(session.id, 'user', [{ type: 'text', text: 'hi' }]);
    const assembled = await createAssembledLoop({
      preset: 'mini',
      io: {
        store,
        model: stubAdapter(() => ({
          stopReason: 'end',
          assistantParts: [{ type: 'text', text: 'ok' }],
        })),
      },
    });
    expect(assembled.preset).toBe('mini');
    expect(assembled.loadedModules).toEqual(moduleIdsForPreset('mini'));
    expect(assembled.loadedModules).not.toContain('ptc');
    expect(assembled.loadedModules).not.toContain('event-log-sqlite');
    const ended = await assembled.run(session.id);
    expect(ended.status).toBe('idle');
  });

  it('normal loads tool-loop and gates dirty input', async () => {
    const { store, surface } = createDefaultMemoryStore({ agent: DEFAULT_EMBED_AGENT });
    const session = surface.createSession({
      title: 't',
      mode: 'chat',
      agentId: DEFAULT_EMBED_AGENT.id,
    });
    surface.appendMessage(session.id, 'user', [{ type: 'text', text: 'hi' }]);
    const echo: ToolContract<Record<string, unknown>> = {
      name: 'echo',
      description: 'echo',
      inputSchema: {},
      approvalMode: 'never',
      sideEffectLevel: 'none',
      execute: async (_ctx, args) => ({ ok: true, content: String(args.x ?? '') }),
    };
    let calls = 0;
    const assembled = await createAssembledLoop({
      preset: 'normal',
      io: {
        store,
        tools: [echo],
        model: stubAdapter(() => {
          calls += 1;
          if (calls === 1) {
            return {
              stopReason: 'tool_use',
              assistantParts: [
                { type: 'tool_call', toolCallId: 'c1', name: 'echo', input: { raw: '{not json' } },
              ],
            };
          }
          return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'done' }] };
        }),
      },
    });
    expect(assembled.loadedModules).toContain('tool-loop');
    expect(assembled.loadedModules).toContain('dirty-input-gate');
    await assembled.run(session.id);
    const fold = store.foldMessages(session.id);
    const dirty = fold.some((m) =>
      m.parts.some(
        (p) => p.type === 'tool_result' && p.content.includes('unparsed tool arguments')
      )
    );
    expect(dirty).toBe(true);
  });

  it('full exposes EventLog stepTx and L4 handle', async () => {
    const { store, surface } = createDefaultMemoryStore({ agent: DEFAULT_EMBED_AGENT });
    const session = surface.createSession({
      title: 't',
      mode: 'chat',
      agentId: DEFAULT_EMBED_AGENT.id,
    });
    surface.appendMessage(session.id, 'user', [{ type: 'text', text: 'hi' }]);
    const assembled = await createAssembledLoop({
      preset: 'full',
      io: {
        store,
        model: stubAdapter(() => ({
          stopReason: 'end',
          assistantParts: [{ type: 'text', text: 'ok' }],
        })),
      },
    });
    expect(assembled.loadedModules).toContain('event-log');
    expect(assembled.loadedModules).toContain('l4-agent-loop');
    expect(typeof assembled.createHandle).toBe('function');
    expect(assembled.host.stepTx).toBeDefined();
    await assembled.run(session.id);
  });

  it('max lists shell-policy without claiming ptc/vault when io omits them', async () => {
    const { store, surface } = createDefaultMemoryStore({ agent: DEFAULT_EMBED_AGENT });
    const session = surface.createSession({
      title: 't',
      mode: 'chat',
      agentId: DEFAULT_EMBED_AGENT.id,
    });
    surface.appendMessage(session.id, 'user', [{ type: 'text', text: 'hi' }]);
    const assembled = await createAssembledLoop({
      preset: 'max',
      io: {
        store,
        model: stubAdapter(() => ({
          stopReason: 'end',
          assistantParts: [{ type: 'text', text: 'ok' }],
        })),
      },
    });
    expect(assembled.loadedModules).toContain('shell-policy');
    expect(assembled.loadedModules).not.toContain('ptc');
    expect(assembled.loadedModules).not.toContain('vault');
    expect(assembled.loadedModules).not.toContain('otel');
    await assembled.run(session.id);
  });

  it('max lists ptc/vault when io actually provides them', async () => {
    const { store, surface } = createDefaultMemoryStore({ agent: DEFAULT_EMBED_AGENT });
    surface.createSession({
      title: 't',
      mode: 'chat',
      agentId: DEFAULT_EMBED_AGENT.id,
    });
    const ptc: ToolContract<Record<string, unknown>> = {
      name: 'ptc_exec',
      description: 'ptc',
      inputSchema: {},
      approvalMode: 'never',
      sideEffectLevel: 'none',
      execute: async () => ({ ok: true, content: 'ptc' }),
    };
    const assembled = await createAssembledLoop({
      preset: 'max',
      io: {
        store,
        model: stubAdapter(() => ({
          stopReason: 'end',
          assistantParts: [{ type: 'text', text: 'ok' }],
        })),
        createPtcExecTool: async () => ptc,
        vault: { resolveNamed: () => ({}) },
        otel: { exportSpan: () => undefined },
      },
    });
    expect(assembled.loadedModules).toContain('ptc');
    expect(assembled.loadedModules).toContain('vault');
    expect(assembled.loadedModules).toContain('otel');
  });

  it('createMiniAssembledLoop is sync and matches mini modules', () => {
    const { store } = createDefaultMemoryStore({ agent: DEFAULT_EMBED_AGENT });
    const assembled = createMiniAssembledLoop({
      io: {
        store,
        model: stubAdapter(() => ({
          stopReason: 'end',
          assistantParts: [{ type: 'text', text: 'ok' }],
        })),
      },
    });
    expect(assembled.preset).toBe('mini');
    expect(assembled.loadedModules).toEqual(moduleIdsForPreset('mini'));
  });
});

describe('mini static import graph', () => {
  it('does not statically import node:sqlite, node:vm, isolate, or event-log-sqlite', () => {
    const graph = collectStaticImports(join(here, '../mini.ts'));
    const joined = [...graph].join('\n');
    expect(joined).not.toContain('node:sqlite');
    expect(joined).not.toContain('node:crypto');
    expect(joined).not.toContain('node:vm');
    expect(joined).not.toContain('node:fs');
    expect(joined).not.toContain('node:async_hooks');
    expect(joined).not.toMatch(/isolate\.ts/);
    expect(joined).not.toMatch(/event-log-sqlite\.ts/);
    expect(joined).not.toMatch(/file-compensation\.ts/);
    expect(joined).not.toMatch(/create-assembled-loop\.ts/);
    expect(LOOP_MODULES.find((m) => m.id === 'ptc')?.load).toBe('dynamic');
  });
});
