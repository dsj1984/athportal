// apps/api/src/sentry.test.ts
import { describe, expect, it } from 'vitest';

import { SENTRY_SCRUB_FIELDS, initSentry, scrubPii } from './sentry';

describe('scrubPii', () => {
  it('removes every documented PII field from request headers', () => {
    const event = {
      request: {
        headers: {
          Authorization: 'Bearer secret',
          Cookie: 'session=abc',
          'X-Trace': 'safe',
        },
      },
    };

    scrubPii(event);

    expect(event.request.headers).toEqual({ 'X-Trace': 'safe' });
  });

  it('removes every documented PII field from request data', () => {
    const event = {
      request: {
        data: {
          email: 'a@example.invalid',
          phone: '+1-555-0100',
          password: 'p',
          token: 't',
          authorization: 'Bearer x',
          cookie: 'k=v',
          orderId: 'kept',
        },
      },
    };

    scrubPii(event);

    expect(event.request.data).toEqual({ orderId: 'kept' });
  });

  it('matches scrub keys case-insensitively', () => {
    const event = {
      request: {
        headers: { AUTHORIZATION: 'Bearer secret', cookie: 'k=v' },
      },
    };

    scrubPii(event);

    expect(event.request.headers).toEqual({});
  });

  it('is a no-op when there is no request payload', () => {
    const event = {};
    expect(scrubPii(event)).toBe(event);
  });

  it('covers every name in the canonical scrub list', () => {
    const headers = Object.fromEntries(SENTRY_SCRUB_FIELDS.map((f) => [f, 'redact-me']));
    const event = { request: { headers } };

    scrubPii(event);

    expect(event.request.headers).toEqual({});
  });
});

describe('initSentry', () => {
  it('returns null when the DSN is unset', () => {
    expect(initSentry({})).toBeNull();
  });

  it('returns null when the DSN is an empty string', () => {
    expect(initSentry({ SENTRY_DSN_WORKERS: '' })).toBeNull();
  });

  it('wires the configured DSN and release SHA into the options', () => {
    const options = initSentry({
      SENTRY_DSN_WORKERS: 'https://public@sentry.example.invalid/1',
      RELEASE_SHA: 'abc1234',
    });

    expect(options).not.toBeNull();
    expect(options?.dsn).toBe('https://public@sentry.example.invalid/1');
    expect(options?.release).toBe('abc1234');
    expect(typeof options?.beforeSend).toBe('function');
  });

  it('registers a beforeSend hook that scrubs PII headers and data', () => {
    const options = initSentry({ SENTRY_DSN_WORKERS: 'https://public@sentry.example.invalid/1' });
    const event = {
      request: {
        headers: { Authorization: 'Bearer secret', 'X-Trace': 'safe' },
        data: { email: 'a@example.invalid', orderId: 'kept' },
      },
    };

    // beforeSend signature is (event, hint) → event | null
    const beforeSend = options?.beforeSend as unknown as (
      e: typeof event,
      hint: unknown,
    ) => typeof event;
    const result = beforeSend(event, {});

    expect(result.request.headers).toEqual({ 'X-Trace': 'safe' });
    expect(result.request.data).toEqual({ orderId: 'kept' });
  });

  it('omits the release tag when RELEASE_SHA is not provided', () => {
    const options = initSentry({ SENTRY_DSN_WORKERS: 'https://public@sentry.example.invalid/1' });

    expect(options?.release).toBeUndefined();
  });
});
