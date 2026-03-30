import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

function daemonBase(): string {
  return (process.env.DAEMON_PROXY_TARGET ?? 'http://127.0.0.1:7070').replace(/\/$/, '');
}

export const config = {
  matcher: '/api/:path*'
};

/** 构建时 next.config rewrites 会固化目标；e2e 随机 daemon 端口必须在运行时解析 DAEMON_PROXY_TARGET */
export async function middleware(request: NextRequest) {
  const targetUrl = `${daemonBase()}${request.nextUrl.pathname}${request.nextUrl.search}`;
  const headers = new Headers(request.headers);
  headers.delete('host');

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual'
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  const res = await fetch(targetUrl, init);
  const outHeaders = new Headers(res.headers);
  return new NextResponse(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: outHeaders
  });
}
