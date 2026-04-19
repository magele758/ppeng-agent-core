/**
 * Tiny route table for the daemon HTTP layer.
 *
 * Goals (vs. the previous big if-else chain in `server.ts`):
 *   - Self-documenting: each route knows its method, path pattern, and handler.
 *   - One place for cross-cutting concerns (CORS, body parsing, error → status).
 *   - Path params via `:id` style, no regex needed at call sites.
 *   - No framework dependency — built directly on `node:http`.
 *
 * Pattern syntax:
 *   '/api/sessions'                exact
 *   '/api/sessions/:id'            single segment param → ctx.params.id
 *   '/api/sessions/:id/messages'   nested
 *
 * A route may also use `match` for cases that don't fit the simple grammar
 * (e.g. trailing-suffix paths like `/api/social-post-schedules/:taskId/action`).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RouteContext {
  request: IncomingMessage;
  response: ServerResponse<IncomingMessage>;
  url: URL;
  /** Path segments after splitting on `/` (no empty entries). */
  parts: string[];
  /**
   * Named params extracted from the pattern (e.g. `:id` → params.id).
   *
   * Indexed access returns `string | undefined` under `noUncheckedIndexedAccess`,
   * so handlers should use {@link requireParam} for declared params.
   */
  params: Record<string, string>;
  /** Pulls a required param defined by the matcher; throws if missing (defensive). */
  requireParam(name: string): string;
  /** JSON body parser (memoised per request). Throws if request has invalid JSON. */
  readBody(): Promise<unknown>;
}

export type RouteHandler = (ctx: RouteContext) => Promise<void> | void;

export interface RouteSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** `/api/sessions/:id/messages`-style pattern; ignored if `match` is given. */
  pattern?: string;
  /** Custom matcher overriding `pattern`. Returns params or `null` for no match. */
  match?: (url: URL, parts: string[]) => Record<string, string> | null;
  handler: RouteHandler;
}

export interface RouterOptions {
  /** CORS application — invoked for every request before routing (returns false to short-circuit OPTIONS). */
  applyCors?: (request: IncomingMessage, response: ServerResponse<IncomingMessage>) => boolean;
  /** Body reader factory (allows server.ts to enforce body-size limits). */
  readBody: (request: IncomingMessage) => Promise<unknown>;
}

/** Compile a `/foo/:id/bar`-style pattern into a matcher. */
function compilePattern(pattern: string): (url: URL, parts: string[]) => Record<string, string> | null {
  const tokens = pattern.split('/').filter(Boolean);
  return (_url, parts) => {
    if (parts.length !== tokens.length) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]!;
      const seg = parts[i]!;
      if (tok.startsWith(':')) {
        params[tok.slice(1)] = decodeURIComponent(seg);
      } else if (tok !== seg) {
        return null;
      }
    }
    return params;
  };
}

interface CompiledRoute {
  method: RouteSpec['method'];
  match: (url: URL, parts: string[]) => Record<string, string> | null;
  handler: RouteHandler;
}

export class Router {
  private readonly routes: CompiledRoute[] = [];
  constructor(private readonly opts: RouterOptions) {}

  add(spec: RouteSpec): this {
    const match = spec.match ?? (spec.pattern ? compilePattern(spec.pattern) : () => null);
    this.routes.push({ method: spec.method, match, handler: spec.handler });
    return this;
  }

  addAll(specs: RouteSpec[]): this {
    for (const s of specs) this.add(s);
    return this;
  }

  /**
   * Try to handle the request. Returns `true` if a route matched (and the
   * handler ran), `false` if the caller should fall through to other handlers
   * (gateway, static files, etc.).
   *
   * Errors thrown by handlers propagate — server.ts wraps them in the standard
   * AppError → http status mapping.
   */
  async dispatch(request: IncomingMessage, response: ServerResponse<IncomingMessage>, url: URL): Promise<boolean> {
    const parts = url.pathname.split('/').filter(Boolean);

    // CORS preflight (always handled here so individual routes don't need to).
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      const allowed = this.opts.applyCors?.(request, response) ?? true;
      response.statusCode = allowed ? 204 : 403;
      response.end();
      return true;
    }

    this.opts.applyCors?.(request, response);

    let cachedBody: unknown | undefined;
    const readBody = async () => {
      if (cachedBody === undefined) cachedBody = await this.opts.readBody(request);
      return cachedBody;
    };

    for (const route of this.routes) {
      if (route.method !== request.method) continue;
      const params = route.match(url, parts);
      if (!params) continue;
      const ctx: RouteContext = {
        request,
        response,
        url,
        parts,
        params,
        readBody,
        requireParam(name) {
          const v = params[name];
          if (typeof v !== 'string' || v === '') {
            throw new Error(`Route param missing: ${name}`);
          }
          return v;
        }
      };
      await route.handler(ctx);
      return true;
    }
    return false;
  }
}
