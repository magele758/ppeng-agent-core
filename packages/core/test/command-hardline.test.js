import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBuiltinTools } from '../dist/tools/builtin-tools.js';
import { SandboxManager } from '../dist/sandbox/os-sandbox.js';
import { RemoteVmAgentSandbox } from '../dist/sandbox/remote-vm-agent-sandbox.js';
import { MicroserviceAgentSandbox } from '../dist/sandbox/microservice-agent-sandbox.js';
import { startBackgroundJob } from '../dist/runtime/spawn-host.js';
import {
  CommandHardlineDeniedError,
  HARDLINE_ERROR_CODE,
  matchCommandHardline
} from '../dist/sandbox/command-hardline.js';

function stubServices(overrides = {}) {
  return {
    loadSkill: async () => ({ content: '' }),
    updateTodo: async () => [],
    createTask: async () => ({}),
    getTask: async () => undefined,
    listTasks: async () => [],
    updateTask: async () => ({}),
    harnessWriteSpec: async () => '',
    spawnSubagent: async () => '',
    spawnTeammate: async () => '',
    listAgents: async () => [],
    sendMail: async () => ({}),
    readInbox: async () => [],
    startBackgroundJob: async () => {
      throw new Error('background job must not start');
    },
    getBackgroundJob: async () => undefined,
    listBackgroundJobs: async () => [],
    listWorkspaces: async () => [],
    upsertSessionMemory: async () => ({}),
    listSessionMemory: async () => [],
    deleteSessionMemory: async () => true,
    visionAnalyze: async () => '',
    ...overrides
  };
}

function runContext(dir, permissionMode) {
  return {
    repoRoot: dir,
    workspaceRoot: dir,
    stateDir: dir,
    agent: { id: 'general' },
    session: { id: 'sess-hardline', metadata: permissionMode ? { permissionMode } : {} }
  };
}

function assertBlocked(command, ruleId) {
  const match = matchCommandHardline(command);
  assert.ok(match, `expected block: ${command}`);
  assert.equal(match.ruleId, ruleId, command);
}

function assertAllowed(command) {
  assert.equal(matchCommandHardline(command), null, `expected allow: ${command}`);
}

describe('command hardline matcher', () => {
  it('allows quoted explanation, relative rm, and /tmp paths', () => {
    assertAllowed('git commit -m "rm -rf /"');
    assertAllowed("git commit -m 'rm -rf /'");
    assertAllowed('rm -rf ./build');
    assertAllowed('rm -rf /tmp/foo');
    assertAllowed('rm -rf /tmp/foo && echo ok');
    assertAllowed('echo ok # rm -rf /');
    assertAllowed("echo '$(rm -rf /)'");
    assertAllowed('echo mkfs.ext4 /dev/sda');
    assertAllowed('dd if=/dev/sda of=./disk.img');
    assertAllowed('dd if=/dev/zero of=/dev/null');
    assertAllowed('rm -rf ~/projects/app/dist');
    assertAllowed('rm -rf "$HOME/projects/app/dist"');
    assertAllowed("rm -rf '$HOME'");
    assertAllowed('systemctl status nginx');
    assertAllowed('kill -15 1234');
    assertAllowed('init');
  });

  it('blocks recursive deletes of root, system dirs, and home', () => {
    assertBlocked('rm -rf /', 'rm-root');
    assertBlocked('rm -fr /', 'rm-root');
    assertBlocked('rm -r /', 'rm-root');
    assertBlocked('rm --recursive --force /', 'rm-root');
    assertBlocked('rm -rf -- /', 'rm-root');
    assertBlocked('/bin/rm -rf /', 'rm-root');
    assertBlocked('rm -rf /*', 'rm-root');
    assertBlocked('rm -rf /tmp/foo/../../', 'rm-root');
    assertBlocked('sudo rm -rf /', 'rm-root');
    assertBlocked('sudo -n rm -rf /', 'rm-root');
    assertBlocked('echo hi && rm -rf /', 'rm-root');
    assertBlocked('echo hi; rm -rf /', 'rm-root');
    assertBlocked("bash -c 'rm -rf /'", 'rm-root');
    assertBlocked('bash -lc "rm -rf /"', 'rm-root');
    assertBlocked('echo "$(rm -rf /)"', 'rm-root');
    assertBlocked('rm -rf /home', 'rm-system-dir');
    assertBlocked('rm -rf /home/', 'rm-system-dir');
    assertBlocked('rm -rf /root', 'rm-system-dir');
    assertBlocked('rm -rf /etc', 'rm-system-dir');
    assertBlocked('rm -rf /usr', 'rm-system-dir');
    assertBlocked('rm -rf /usr/*', 'rm-system-dir');
    assertBlocked('rm -rf /tmp/foo/../../../etc', 'rm-system-dir');
    assertBlocked('rm -rf ~', 'rm-home');
    assertBlocked('rm -rf ~/', 'rm-home');
    assertBlocked('rm -rf ~/*', 'rm-home');
    assertBlocked('rm -rf $HOME', 'rm-home');
    assertBlocked('rm -rf "$HOME"', 'rm-home');
    assertBlocked('rm -rf ${HOME}', 'rm-home');
    assertBlocked('rm -rf "${HOME}"', 'rm-home');
    assertBlocked('rm -rf ${HOME}/', 'rm-home');
  });

  it('blocks mkfs, raw dd, fork bombs, and power commands', () => {
    assertBlocked('mkfs.ext4', 'mkfs');
    assertBlocked('mkfs.ext4 /dev/sdb1', 'mkfs');
    assertBlocked('/sbin/mkfs.vfat /dev/sdb', 'mkfs');
    assertBlocked('mkfs', 'mkfs');
    assertBlocked('dd if=/dev/zero of=/dev/sda bs=1M', 'dd-raw-device');
    assertBlocked('dd of=/dev/nvme0n1', 'dd-raw-device');
    assertBlocked('dd of=/dev/nvme0n1p1', 'dd-raw-device');
    assertBlocked('dd of=/dev/mmcblk0', 'dd-raw-device');
    assertBlocked('dd of=/dev/vda', 'dd-raw-device');
    assertBlocked('dd of=/dev/xvda', 'dd-raw-device');
    assertBlocked('dd of=/dev/hda', 'dd-raw-device');
    assertBlocked(':(){ :|:& };:', 'fork-bomb');
    assertBlocked(':() { : | : & }; :', 'fork-bomb');
    assertBlocked('shutdown -h now', 'power');
    assertBlocked('reboot', 'power');
    assertBlocked('halt', 'power');
    assertBlocked('poweroff', 'power');
    assertBlocked('init 0', 'init-runlevel');
    assertBlocked('init 6', 'init-runlevel');
    assertBlocked('telinit 0', 'init-runlevel');
    assertBlocked('telinit 6', 'init-runlevel');
    assertBlocked('systemctl poweroff', 'systemctl-power');
    assertBlocked('systemctl reboot', 'systemctl-power');
    assertBlocked('systemctl halt', 'systemctl-power');
    assertBlocked('systemctl --no-block poweroff', 'systemctl-power');
    assertBlocked('kill -1', 'kill-minus-one');
    assertBlocked('kill -9 -1', 'kill-minus-one');
  });

  it('does not treat a quoted fork bomb as a command', () => {
    assertAllowed('echo ":(){ :|:& };:"');
    assertAllowed("bash -c 'git commit -m \"rm -rf /\"'");
  });
});

describe('command hardline execution gate', () => {
  it('bash and bg_run return a structured error before spawn, even in bypass mode', async () => {
    let started = 0;
    const tools = createBuiltinTools(
      stubServices({
        startBackgroundJob: async () => {
          started += 1;
          return { id: 'should-not-run' };
        }
      })
    );
    const bash = tools.find((tool) => tool.name === 'bash');
    const bg = tools.find((tool) => tool.name === 'bg_run');
    const dir = mkdtempSync(join(tmpdir(), 'hardline-bash-'));
    const ctx = runContext(dir, 'bypass');
    const commands = ['rm -rf /', 'rm -rf ~', 'mkfs.ext4', ':(){ :|:& };:'];

    for (const command of commands) {
      assert.ok(matchCommandHardline(command), command);
      const result = await bash.execute(ctx, { command });
      assert.equal(result.ok, false, command);
      const payload = JSON.parse(result.content);
      assert.equal(payload.error_code, HARDLINE_ERROR_CODE);
      assert.equal(result.metadata.hardline, true);
      assert.equal(result.metadata.ruleId, payload.rule_id);
    }

    const autoCtx = runContext(dir, 'auto');
    assert.ok(matchCommandHardline('rm -rf /'));
    const bgResult = await bg.execute(autoCtx, { command: 'rm -rf /' });
    assert.equal(bgResult.ok, false);
    assert.equal(JSON.parse(bgResult.content).error_code, HARDLINE_ERROR_CODE);
    assert.equal(started, 0);
  });

  it('still runs ordinary rm and echo', async () => {
    const tools = createBuiltinTools(stubServices());
    const bash = tools.find((tool) => tool.name === 'bash');
    const dir = mkdtempSync(join(tmpdir(), 'hardline-allow-'));
    mkdirSync(join(dir, 'build'));
    writeFileSync(join(dir, 'build', 'out.txt'), 'x');
    const nested = join(dir, 'nested');
    mkdirSync(nested);
    writeFileSync(join(nested, 'leaf'), 'y');
    const ctx = runContext(dir, 'bypass');

    assertAllowed('echo hardline-ok');
    const echoed = await bash.execute(ctx, { command: 'echo hardline-ok' });
    assert.equal(echoed.ok, true, echoed.content);
    assert.match(echoed.content, /hardline-ok/);

    assertAllowed('rm -rf ./build');
    const removed = await bash.execute(ctx, { command: 'rm -rf ./build' });
    assert.equal(removed.ok, true, removed.content);
    assert.equal(existsSync(join(dir, 'build')), false);

    const rmTmp = `rm -rf ${nested}`;
    assertAllowed(rmTmp);
    const removedTmp = await bash.execute(ctx, { command: rmTmp });
    assert.equal(removedTmp.ok, true, removedTmp.content);
    assert.equal(existsSync(nested), false);
  });

  it('startBackgroundJob throws before touching the store', async () => {
    assert.ok(matchCommandHardline('shutdown -h now'));
    await assert.rejects(
      () => startBackgroundJob({}, 'sid', 'shutdown -h now'),
      (err) => err instanceof CommandHardlineDeniedError && err.ruleId === 'power'
    );
  });

  it('SandboxManager refuses mkfs before provider spawn', async () => {
    assert.ok(matchCommandHardline('mkfs.ext4'));
    const mgr = new SandboxManager('direct');
    const result = await mgr.execute('mkfs.ext4', tmpdir());
    assert.equal(result.code, 126);
    assert.equal(result.tier, 0);
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.error_code, HARDLINE_ERROR_CODE);
    assert.equal(payload.rule_id, 'mkfs');
  });

  it('remote VM and microservice backends cannot skip the hardline', async () => {
    const hits = [];
    const server = createServer((req, res) => {
      hits.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ stdout: 'ran', stderr: '', code: 0 }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const remote = new RemoteVmAgentSandbox({ RAW_AGENT_SANDBOX_REMOTE_URL: base });
      const micro = new MicroserviceAgentSandbox({ RAW_AGENT_SANDBOX_RUNNER_URL: base });
      assert.ok(matchCommandHardline('rm -rf /'));
      const remoteDenied = await remote.execute({
        command: 'rm -rf /',
        cwd: '/tmp',
        workspace: '/tmp',
        timeoutMs: 2000
      });
      const microDenied = await micro.execute({
        command: 'mkfs.ext4',
        cwd: '/tmp',
        workspace: '/tmp',
        timeoutMs: 2000
      });
      assert.equal(remoteDenied.code, 126);
      assert.equal(remoteDenied.backend, 'command-hardline');
      assert.equal(microDenied.backend, 'command-hardline');
      assert.equal(hits.length, 0);

      const remoteOk = await remote.execute({
        command: 'echo hi',
        cwd: '/tmp',
        workspace: '/tmp',
        timeoutMs: 2000
      });
      assert.equal(remoteOk.stdout, 'ran');
      assert.deepEqual(hits, ['/exec']);
    } finally {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
