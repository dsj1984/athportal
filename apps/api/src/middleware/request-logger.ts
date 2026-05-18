// apps/api/src/middleware/request-logger.ts
//
// Request-completion middleware for the Workers API (Story #257).
//
// Mounted at the root of the Hono app as the first middleware. For every
// request — success, 4xx, or 5xx — it constructs a `LogEvent` and hands
// it to env.ANALYTICS.writeDataPoint exactly once. Metadata copied off
// the request is gated by the shared `RedactionAllowlist` (Story #256);
// this module does NOT maintain its own field list. See
// packages/shared/src/observability/redaction.ts for the trust boundary.
//
// Latency posture: the call to writeDataPoint is fire-and-forget. The
// middleware never awaits the sink — the response returns as soon as the
// handler resolves, and the LogEvent dispatch happens on the resolved
// path before the framework drains. This matches Tech Spec #246 §
// Performance budget: "response latency unaffected by sink throughput".

import type { LogEvent } from '@repo/shared';
import { redactHeaders, redactQueryAndBody } from '@repo/shared';
import type { Context, MiddlewareHandler } from 'hono';

/**
 * Subset of the Workers Analytics Engine binding surface the middleware
 * uses. Declared structurally so consumers can supply a stub in tests
 * without pulling the full `@cloudflare/workers-types` definition. The
 * real binding's signature is wider; we only call writeDataPoint with
 * the LogEvent envelope.
 */
export interface AnalyticsEngineBinding {
  writeDataPoint: (event: LogEvent) => void;
}

/**
 * Environment bindings the middleware reads. The Workers runtime exposes
 * these as `c.env`; the contract test injects them via the third
 * argument of `app.request(path, init, env)`.
 *
 *   - `ANALYTICS` — the Analytics Engine dataset binding.
 *   - `RUNTIME_ENV` — deploy environment label; defaults to development
 *     when unset so local runs are still log-shaped correctly.
 *   - `RELEASE_SHA` — deploy SHA; defaults to "unknown" when unset.
 */
export interface RequestLoggerEnv {
  ANALYTICS: AnalyticsEngineBinding;
  RUNTIME_ENV?: 'development' | 'staging' | 'production';
  RELEASE_SHA?: string;
}

type LoggerContext = Context<{ Bindings: RequestLoggerEnv }>;

// LogEvent.method is a closed enum; narrow the request method onto it so
// non-standard verbs (e.g. PROPFIND) do not poison the envelope. Anything
// outside the enum collapses to GET, which keeps the sink schema clean
// while preserving the rest of the event for triage.
const ALLOWED_METHODS = new Set<LogEvent['method']>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

function normalizeMethod(method: string): LogEvent['method'] {
  const upper = method.toUpperCase() as LogEvent['method'];
  return ALLOWED_METHODS.has(upper) ? upper : 'GET';
}

function routePattern(c: LoggerContext): string {
  // `c.req.routePath` is set by Hono when the request matched a
  // registered route; for 404s and middleware-only paths it is empty,
  // in which case the URL pathname is the most honest fallback.
  const matched = c.req.routePath;
  if (typeof matched === 'string' && matched.length > 0) {
    return matched;
  }
  return new URL(c.req.url).pathname;
}

/**
 * Hono middleware factory for the request-completion logger. Returns a
 * handler that wraps `next()`, captures the timing/outcome, and emits
 * exactly one LogEvent per request.
 *
 * Errors thrown by downstream handlers are re-thrown after the event is
 * recorded so Hono's error pipeline can still respond with the 5xx —
 * the logger does not swallow failures.
 */
export function requestLogger(): MiddlewareHandler<{ Bindings: RequestLoggerEnv }> {
  return async (c, next) => {
    const startedAt = Date.now();
    let thrown: unknown;
    try {
      await next();
    } catch (err) {
      // Hono normally surfaces handler throws via `c.error` and converts
      // the response to a 500; the catch here is defensive in case a
      // future onError changes that contract.
      thrown = err;
    }
    const durationMs = Math.max(0, Date.now() - startedAt);

    // When the handler threw, Hono assigns the error to `c.error` before
    // dispatching its onError pipeline. We read it (alongside the
    // defensive try/catch above) so the LogEvent reflects the true
    // outcome class even when the framework swallows the throw.
    const error = thrown ?? c.error;

    // Resolve status: a thrown handler is a 500. Otherwise read the
    // status off the response Hono assembled.
    const status = error !== undefined ? 500 : c.res.status;

    // Headers come from the Request object; query + body come from the
    // same Request via the redactor (it clones internally so the body
    // is not consumed for the handler).
    const headerMetadata = redactHeaders(c.req.raw.headers);
    const queryAndBodyMetadata = await redactQueryAndBody(c.req.raw);
    const metadata: Record<string, string> = {
      ...headerMetadata,
      ...queryAndBodyMetadata,
    };

    const event: LogEvent = {
      ts: new Date().toISOString(),
      runtime: 'workers',
      env: c.env.RUNTIME_ENV ?? 'development',
      release: c.env.RELEASE_SHA ?? 'unknown',
      method: normalizeMethod(c.req.method),
      route_pattern: routePattern(c),
      status,
      duration_ms: durationMs,
      metadata,
      ...(error !== undefined ? { error_class: errorClassName(error) } : {}),
    };

    // Fire-and-forget — never await the sink so response latency is
    // unaffected by Analytics Engine throughput. Swallow sink errors
    // here for the same reason: a logging-layer fault must not turn
    // into a user-visible 5xx.
    try {
      c.env.ANALYTICS.writeDataPoint(event);
    } catch {
      // intentional swallow — see comment above
    }

    if (thrown !== undefined) {
      // Re-throw the original handler error so Hono's onError pipeline
      // can still respond with the appropriate 5xx. The narrowing keeps
      // @typescript-eslint/only-throw-error happy without disguising
      // non-Error throws — those become a synthetic Error wrapper.
      throw thrown instanceof Error ? thrown : new Error(safeStringify(thrown));
    }
  };
}

function errorClassName(err: unknown): string {
  if (err instanceof Error) {
    return err.constructor.name;
  }
  return 'NonError';
}

/**
 * Stringify an unknown thrown value without risking a `[object Object]`
 * leak through `String(...)`. JSON-encodes plain objects; falls back to
 * `typeof` for unserializable inputs (circular refs, BigInts).
 */
function safeStringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value) ?? typeof value;
  } catch {
    return typeof value;
  }
}
