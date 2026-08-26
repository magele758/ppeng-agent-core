import * as net from 'net';

/** 探测端口是否空闲：分别在 IPv4 与 IPv6（有的话）loopback 上尝试监听 */
function tryListen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (err: NodeJS.ErrnoException) => {
      // EADDRINUSE 视为占用；其余错误（如系统禁用 IPv6）视为不阻塞
      if (err && err.code === 'EADDRINUSE') {
        resolve(false);
        return;
      }
      resolve(true);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    try {
      server.listen({ port, host, ipv6Only: host === '::' });
    } catch {
      resolve(true);
    }
  });
}

export async function isPortFree(port: number): Promise<boolean> {
  const v4 = await tryListen(port, '127.0.0.1');
  if (!v4) return false;
  return tryListen(port, '::');
}

/** 优先使用 preferred，被占用则依次探测 preferred+1 … preferred+span-1 */
export async function pickPort(preferred: number, span = 20): Promise<number> {
  const base = Math.floor(preferred);
  if (!Number.isFinite(base) || base <= 0) {
    throw new Error(`Invalid preferred port: ${preferred}`);
  }
  for (let i = 0; i < span; i += 1) {
    const port = base + i;
    if (port > 65535) break;
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port in range ${base}..${Math.min(65535, base + span - 1)}`);
}
