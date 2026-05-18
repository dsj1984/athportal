// apps/api/src/sentry.ts
//
// Workers Sentry init wrapper. The Workers runtime mounts this via the
// `s-sentry-baseline` initializer (Story #255). The wrapper:
//   - Produces the @sentry/cloudflare options object keyed off
//     env.SENTRY_DSN_WORKERS, ready for `withSentry(optionsFn, handler)`.
//   - Tags every event with the deploy SHA (env.RELEASE_SHA).
//   - Registers a beforeSend hook that strips a fixed allowlist of PII
//     fields from request headers and request data before the event
//     leaves the runtime.
//   - Is a no-op when env.SENTRY_DSN_WORKERS is unset (returns null), so
//     the request handler continues uninstrumented in local / preview
//     environments where DSN secrets are not provisioned.
//
// Usage from the Workers entry (mounted by `s-sentry-baseline`):
//
//   import { withSentry } from '@sentry/cloudflare';
//   import { initSentry } from './sentry';
//
//   export default withSentry((env) => initSentry(env) ?? undefined, {
//     fetch(request, env, ctx) { return handle(request, env, ctx); },
//   });

import type { CloudflareOptions } from '@sentry/cloudflare';

/**
 * Runtime env contract this wrapper reads.
 *
 * Extra fields on the binding are tolerated — the wrapper only consults
 * the two keys below.
 */
export interface SentryEnv {
  SENTRY_DSN_WORKERS?: string;
  RELEASE_SHA?: string;
}

/**
 * Fields scrubbed from `event.request.headers` and `event.request.data`
 * before the event is dispatched. Matched case-insensitively.
 *
 * Source: the security baseline forbids logging PII / credentials; this
 * list is the canonical set Story #255 ratifies for the Workers tier.
 */
export const SENTRY_SCRUB_FIELDS = [
  'email',
  'phone',
  'password',
  'token',
  'authorization',
  'cookie',
] as const;

const SCRUB_SET = new Set<string>(SENTRY_SCRUB_FIELDS.map((f) => f.toLowerCase()));

function scrubRecord(record: Record<string, unknown> | undefined): void {
  if (!record) return;
  for (const key of Object.keys(record)) {
    if (SCRUB_SET.has(key.toLowerCase())) {
      delete record[key];
    }
  }
}

/**
 * Strip the canonical PII fields from a Sentry event's request payload.
 * Exported for unit-test coverage; the production path calls it from the
 * `beforeSend` hook configured by {@link initSentry}.
 */
export function scrubPii<TEvent extends { request?: { headers?: unknown; data?: unknown } }>(
  event: TEvent,
): TEvent {
  const request = event.request;
  if (!request) return event;

  if (request.headers && typeof request.headers === 'object') {
    scrubRecord(request.headers as Record<string, unknown>);
  }

  if (request.data && typeof request.data === 'object') {
    scrubRecord(request.data as Record<string, unknown>);
  }

  return event;
}

/**
 * Build the @sentry/cloudflare options object that the Workers entry
 * hands to `withSentry`. The returned object is the configured Sentry
 * client wiring — DSN, release tag, and the PII scrubber — exactly what
 * the `s-sentry-baseline` mount consumes.
 *
 * @returns The Sentry-client options, or `null` when the DSN is unset.
 *   Callers MUST tolerate the null branch — that is the local-dev /
 *   preview-without-secrets path; the request handler stays
 *   uninstrumented.
 */
export function initSentry(env: SentryEnv): CloudflareOptions | null {
  const dsn = env.SENTRY_DSN_WORKERS;
  if (!dsn) {
    return null;
  }

  return {
    dsn,
    release: env.RELEASE_SHA,
    beforeSend(event) {
      return scrubPii(event);
    },
  };
}
