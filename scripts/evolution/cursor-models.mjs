import { spawn } from 'node:child_process';

const ANSI_RE = /\u001B\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(text) {
  return String(text || '').replace(ANSI_RE, '');
}

export function parseCursorModelListOutput(raw) {
  return stripAnsi(raw)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[a-z0-9][a-z0-9.-]*\s+-\s+/.test(line))
    .map((line) => line.split(/\s+-\s+/, 1)[0]);
}

export async function listCursorModels(cwd) {
  return await new Promise((resolve, reject) => {
    const child = spawn('agent', ['--list-models'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (chunk) => { out += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { err += chunk.toString(); });
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        out,
        err,
        models: parseCursorModelListOutput(out + '\n' + err)
      });
    });
    child.on('error', reject);
  });
}
