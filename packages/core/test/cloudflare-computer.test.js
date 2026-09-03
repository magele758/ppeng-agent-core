import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SandboxManager } from '../dist/sandbox/os-sandbox.js';
import {
  CloudflareComputerClient,
  encodeWorkspaceFilePath,
  mapRemoteCwd,
  probeCloudflareComputerHealth
} from '../dist/sandbox/cloudflare-computer-client.js';
import { CloudflareComputerProvider } from '../dist/sandbox/cloudflare-computer-provider.js';
import {
  defaultSandboxSettings,
  normalizeSandboxSettings,
  parseSandboxMode,
  readSandboxSettings,
  resolveCloudflareComputer,
  resolveCloudflareComputerToken,
  resolveSandboxMode,
  writeSandboxSettings
} from '../dist/sandbox/sandbox-settings.js';
import { createMemorySecretVault } from '../dist/secrets/secret-vault.js';
import { runDoctor } from '../dist/doctor/doctor.js';

function memStore(init) {
  const kv = new Map();
  if (init) kv.set('sandbox_settings', init);
  return {
    getDaemonControl(key) {
      return kv.get(key);
    },
    setDaemonControl(key, value) {
      kv.set(key, value);
    }
  };
}

function jsonResponse(status, body, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

describe('sandbox settings', () => {
  it('parses mode aliases', () => {
    assert.equal(parseSandboxMode('cloudflare-computer'), 'cloudflare-computer');
    assert.equal(parseSandboxMode('cf_computer'), 'cloudflare-computer');
    assert.equal(parseSandboxMode('cf-computer'), 'cloudflare-computer');
    assert.equal(parseSandboxMode('auto'), 'auto');
    assert.equal(parseSandboxMode('nope'), undefined);
  });

  it('normalizes workspace names and timeout', () => {
    const s = normalizeSandboxSettings({
      cfWorkspaceName: '../evil',
      cfTimeoutMs: 12,
      cfBackend: 'container-shell',
      cfEndpoint: 'https://x.workers.dev/'
    });
    assert.equal(s.cfWorkspaceName, 'default');
    assert.equal(s.cfTimeoutMs, 1000);
    assert.equal(s.cfBackend, 'container-shell');
    assert.equal(s.cfEndpoint, 'https://x.workers.dev');
  });

  it('persisted Lab mode wins over env', () => {
    const store = memStore();
    writeSandboxSettings(store, { mode: 'cloudflare-computer', cfEndpoint: 'https://cf.example' });
    assert.equal(
      resolveSandboxMode(store, { RAW_AGENT_SANDBOX_MODE: 'direct' }),
      'cloudflare-computer'
    );
  });

  it('env fallback when never saved; default is auto', () => {
    const store = memStore();
    assert.equal(resolveSandboxMode(store, { RAW_AGENT_SANDBOX_MODE: 'direct' }), 'direct');
    assert.equal(resolveSandboxMode(undefined, {}), 'auto');
  });

  it('read/write roundtrip does not store a token', () => {
    const store = memStore();
    const next = writeSandboxSettings(store, {
      cfTokenSecretName: 'CLOUDFLARE_COMPUTER_TOKEN',
      cfEndpoint: 'https://cf.example'
    });
    assert.equal(next.cfTokenSecretName, 'CLOUDFLARE_COMPUTER_TOKEN');
    const raw = store.getDaemonControl('sandbox_settings');
    assert.equal(raw.token, undefined);
    assert.equal(JSON.stringify(raw).includes('sk-'), false);
    assert.equal(readSandboxSettings(store).cfEndpoint, 'https://cf.example');
  });

  it('resolves token from vault name, then env', () => {
    const vault = createMemorySecretVault();
    vault.set('CF_LAB_TOKEN', 'vault-secret');
    const fromVault = resolveCloudflareComputerToken(
      { tokenSecretName: 'CF_LAB_TOKEN' },
      vault,
      {}
    );
    assert.equal(fromVault.source, 'vault');
    assert.equal(fromVault.token, 'vault-secret');

    const fromEnv = resolveCloudflareComputerToken(
      { tokenSecretName: '' },
      createMemorySecretVault(),
      { CLOUDFLARE_COMPUTER_TOKEN: 'env-secret' }
    );
    assert.equal(fromEnv.source, 'env');
    assert.equal(fromEnv.token, 'env-secret');
  });
});

describe('SandboxManager routing', () => {
  it('auto never selects cloudflare-computer', () => {
    const mgr = new SandboxManager('auto');
    assert.notEqual(mgr.activeProvider.name, 'cloudflare-computer');
  });

  it('explicit cloudflare-computer does not fall back to local', () => {
    const mgr = new SandboxManager('cloudflare-computer');
    assert.equal(mgr.activeProvider.name, 'cloudflare-computer');
    assert.equal(mgr.activeTier, 2);
  });
});

describe('cloudflare-computer client', () => {
  it('maps host cwd to /workspace', () => {
    assert.equal(mapRemoteCwd('/Users/me/repo'), '/workspace');
    assert.equal(mapRemoteCwd('/workspace/app'), '/workspace/app');
    assert.equal(mapRemoteCwd(undefined), '/workspace');
  });

  it('rejects path traversal', () => {
    assert.equal(encodeWorkspaceFilePath('../etc/passwd'), undefined);
    assert.equal(encodeWorkspaceFilePath('ok/file.txt'), 'ok/file.txt');
  });

  it('exec posts official HTTP body and parses exitCode', async () => {
    const calls = [];
    const client = new CloudflareComputerClient({
      endpoint: 'https://cf.example',
      workspaceName: 'demo',
      token: 'tok-1',
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse(200, { exitCode: 0, stdout: 'ok\n', stderr: '' });
      }
    });
    const r = await client.exec({ command: 'uname -a' });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, 'ok\n');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://cf.example/c/demo/exec');
    assert.equal(calls[0].init.method, 'POST');
    assert.match(calls[0].init.headers.Authorization, /Bearer tok-1/);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.command, 'uname -a');
    assert.equal(body.encoding, 'utf8');
    assert.equal(body.cwd, '/workspace');
  });

  it('unconfigured exec is fail-soft 127', async () => {
    const client = new CloudflareComputerClient({
      endpoint: '',
      fetchImpl: async () => {
        throw new Error('should not fetch');
      }
    });
    const r = await client.exec({ command: 'true' });
    assert.equal(r.code, 127);
    assert.match(r.stderr, /not configured/);
  });

  it('HTTP error is fail-soft, not fake success', async () => {
    const client = new CloudflareComputerClient({
      endpoint: 'https://cf.example',
      fetchImpl: async () => jsonResponse(503, { error: 'container cold' })
    });
    const r = await client.exec({ command: 'true' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /container cold/);
  });

  it('write/read use official file paths', async () => {
    const calls = [];
    const client = new CloudflareComputerClient({
      endpoint: 'https://cf.example',
      workspaceName: 'demo',
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), method: init.method, body: init.body });
        if (init.method === 'PUT') return new Response('', { status: 200 });
        return new Response('hello', { status: 200 });
      }
    });
    const w = await client.writeFile('notes/a.txt', 'hello');
    const r = await client.readFile('notes/a.txt');
    assert.equal(w.ok, true);
    assert.equal(r.ok, true);
    assert.equal(r.body, 'hello');
    assert.equal(calls[0].url, 'https://cf.example/c/demo/file/workspace/notes/a.txt');
    assert.equal(calls[0].method, 'PUT');
    assert.equal(calls[1].method, 'GET');
  });

  it('dispose does not pretend success', () => {
    const client = new CloudflareComputerClient({ endpoint: 'https://cf.example' });
    const d = client.dispose();
    assert.equal(d.ok, false);
    assert.match(d.reason, /no destroy API/);
  });

  it('health probes GET /health and never POST /exec', async () => {
    const methods = [];
    const probe = await probeCloudflareComputerHealth({
      endpoint: 'https://cf.example',
      fetchImpl: async (url, init) => {
        methods.push(`${init.method} ${url}`);
        return new Response('ok', { status: 200 });
      }
    });
    assert.equal(probe.reachable, true);
    assert.equal(probe.path, '/health');
    assert.ok(methods.every((m) => m.startsWith('GET ')));
    assert.ok(!methods.some((m) => m.includes('/exec')));
  });
});

describe('CloudflareComputerProvider', () => {
  it('execute uses sessionId as workspace name', async () => {
    let seen = '';
    const prev = process.env.CLOUDFLARE_COMPUTER_ENDPOINT;
    process.env.CLOUDFLARE_COMPUTER_ENDPOINT = 'https://cf.example';
    try {
      const p = new CloudflareComputerProvider(process.env, async (url) => {
        seen = String(url);
        return jsonResponse(200, { exitCode: 0, stdout: 'x', stderr: '' });
      });
      const r = await p.execute('echo x', {
        cwd: '/Users/me/repo',
        workspace: '/Users/me/repo',
        env: {},
        sessionId: 'sess-1',
        timeoutMs: 5000
      });
      assert.equal(r.code, 0);
      assert.equal(r.tier, 2);
      assert.equal(seen, 'https://cf.example/c/sess-1/exec');
    } finally {
      if (prev === undefined) delete process.env.CLOUDFLARE_COMPUTER_ENDPOINT;
      else process.env.CLOUDFLARE_COMPUTER_ENDPOINT = prev;
    }
  });
});

describe('doctor cloudflare-computer', () => {
  it('idle when auto and no endpoint', () => {
    const report = runDoctor({
      repoRoot: '/tmp',
      env: { ...process.env, RAW_AGENT_SANDBOX_MODE: 'auto', CLOUDFLARE_COMPUTER_ENDPOINT: '' }
    });
    const c = report.checks.find((x) => x.id === 'cloudflare_computer');
    assert.ok(c);
    assert.equal(c.severity, 'ok');
    assert.match(c.detail, /idle/);
    assert.ok(!JSON.stringify(report).includes('vault-secret'));
  });

  it('warns when mode selected but endpoint missing', () => {
    const store = memStore();
    writeSandboxSettings(store, { mode: 'cloudflare-computer' });
    const report = runDoctor({
      repoRoot: '/tmp',
      env: { RAW_AGENT_SANDBOX_MODE: 'auto' },
      store
    });
    const c = report.checks.find((x) => x.id === 'cloudflare_computer');
    assert.equal(c.severity, 'warn');
    assert.match(c.detail, /endpoint missing/);
  });

  it('reports injected health probe without token value', () => {
    const store = memStore();
    writeSandboxSettings(store, {
      mode: 'cloudflare-computer',
      cfEndpoint: 'https://cf.example',
      cfTokenSecretName: 'CLOUDFLARE_COMPUTER_TOKEN'
    });
    const vault = createMemorySecretVault();
    vault.set('CLOUDFLARE_COMPUTER_TOKEN', 'super-secret-token-value');
    const report = runDoctor({
      repoRoot: '/tmp',
      env: {},
      store,
      secretVault: vault,
      cloudflareProbe: { probed: true, reachable: true, status: 200, path: '/health', detail: 'ok' }
    });
    const c = report.checks.find((x) => x.id === 'cloudflare_computer');
    assert.equal(c.severity, 'ok');
    assert.match(c.detail, /reachable \/health/);
    assert.match(c.detail, /token=present/);
    assert.ok(!JSON.stringify(report).includes('super-secret-token-value'));
    const resolved = resolveCloudflareComputer(store, {}, vault);
    assert.equal(resolved.tokenPresent, true);
    assert.equal(defaultSandboxSettings().mode, 'auto');
  });
});
