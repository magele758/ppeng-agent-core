import { spawn } from 'node:child_process';
import { sanitizeSpawnEnv, type ToolContract } from '@ppeng/agent-core';
import { truncate } from '../util.js';

type K8sArgs = {
  /** kubectl verb — restricted to read-only verbs. */
  verb?: 'get' | 'describe' | 'logs' | 'top';
  /** Resource name e.g. pods, deploy, svc. */
  resource: string;
  namespace?: string;
  /** Optional resource name (e.g. deploy/api). */
  name?: string;
  /** Output format for `get`/`describe`. Default: yaml for describe, json for get. */
  output?: 'json' | 'yaml' | 'wide';
  /** Extra flags as plain tokens (validated against an allow-list below). */
  flags?: string[];
  /** Override env (test only). */
  kubeconfig?: string;
};

const ALLOWED_VERBS = new Set(['get', 'describe', 'logs', 'top']);
// Conservative allow-list: read-only flags only.
const ALLOWED_FLAGS = new Set([
  '--all-namespaces', '-A',
  '--show-labels',
  '--no-headers',
  '--selector', '-l',
  '--field-selector',
  '--container', '-c',
  '--tail',
  '--since',
  '--previous',
  '--sort-by',
  '--output-watch-events',
]);

function validateFlags(flags: string[] | undefined): string | undefined {
  for (const f of flags ?? []) {
    if (typeof f !== 'string' || !f.startsWith('-')) {
      // values for the previous flag (e.g. "--selector", "app=foo") — accept
      continue;
    }
    // Strip a "=value" suffix for the allow-list check.
    const bare = f.split('=')[0]!;
    if (!ALLOWED_FLAGS.has(bare)) {
      return `flag ${bare} is not on the read-only allow-list`;
    }
  }
  return undefined;
}

export const k8sGetTool: ToolContract<K8sArgs> = {
  name: 'k8s_get',
  description:
    'Read-only kubectl wrapper (verbs: get / describe / logs / top). Requires kubectl on PATH and SRE_KUBECONFIG (or the standard KUBECONFIG) pointing at the right cluster.',
  inputSchema: {
    type: 'object',
    properties: {
      verb: { type: 'string', enum: ['get', 'describe', 'logs', 'top'] },
      resource: { type: 'string', description: 'pods | deploy | svc | nodes | events | …' },
      namespace: { type: 'string' },
      name: { type: 'string' },
      output: { type: 'string', enum: ['json', 'yaml', 'wide'] },
      flags: { type: 'array', items: { type: 'string' } },
      kubeconfig: { type: 'string' },
    },
    required: ['resource'],
  },
  approvalMode: 'never',
  sideEffectLevel: 'system',
  async execute(_context, args) {
    const verb = args.verb ?? 'get';
    if (!ALLOWED_VERBS.has(verb)) {
      return { ok: false, content: `verb ${verb} is not allowed (read-only verbs only)` };
    }
    const flagError = validateFlags(args.flags);
    if (flagError) return { ok: false, content: flagError };

    const cmd = ['kubectl', verb, args.resource];
    if (args.name) cmd.push(args.name);
    if (args.namespace) cmd.push('-n', args.namespace);
    const defaultOut = verb === 'get' ? 'json' : undefined;
    const output = args.output ?? defaultOut;
    if (output && (verb === 'get' || verb === 'describe')) {
      cmd.push('-o', output);
    }
    if (args.flags && args.flags.length > 0) cmd.push(...args.flags);

    const env = sanitizeSpawnEnv();
    const kubeconfig = args.kubeconfig ?? process.env.SRE_KUBECONFIG ?? process.env.KUBECONFIG;
    if (kubeconfig) env.KUBECONFIG = kubeconfig;

    return await new Promise((resolve) => {
      const child = spawn(cmd[0]!, cmd.slice(1), { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (c) => { stdout += c.toString(); });
      child.stderr?.on('data', (c) => { stderr += c.toString(); });
      child.on('error', (err) => {
        resolve({
          ok: false,
          content:
            err.message.includes('ENOENT')
              ? 'kubectl not found on PATH. Install kubectl and ensure it is on the daemon PATH.'
              : err.message,
        });
      });
      child.on('close', (code) => {
        if (code !== 0) {
          resolve({
            ok: false,
            content: `kubectl exited ${code}\n${truncate([stderr, stdout].filter(Boolean).join('\n'), 8_000)}`,
          });
          return;
        }
        resolve({ ok: true, content: truncate(stdout || '(no output)') });
      });
    });
  },
};
