// apps/api/src/middleware/request-logger.contract.test.ts
//
// Contract test for the request-completion middleware (Story #257, AC-2).
//
// Locks the privacy posture at the wire boundary: PII carried in headers,
// query strings, and JSON bodies MUST NOT reach the LogEvent that the
// middleware hands to env.ANALYTICS.writeDataPoint. The middleware
// delegates the decision to the shared `RedactionAllowlist`; this test
// asserts the boundary, not the allowlist's internals (those have their
// own unit tests in packages/shared).
//
// Tier: contract. The assertions here are wire shape and call counts —
// HTTP status, exactly-once invocation, and the absence of disallowed
// keys in the recorded payload. User-visible journeys belong in
// acceptance scenarios; pure logic belongs in unit tests.

import type { LogEvent } from '@repo/shared';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { type RequestLoggerEnv, requestLogger } from './request-logger';

interface AnalyticsStub {
  writeDataPoint: (event: LogEvent) => void;
  events: LogEvent[];
}

function createAnalyticsStub(): AnalyticsStub {
  const events: LogEvent[] = [];
  return {
    events,
    writeDataPoint(event: LogEvent): void {
      events.push(event);
    },
  };
}

function createAppWithStub(analytics: AnalyticsStub): {
  app: Hono<{ Bindings: RequestLoggerEnv }>;
} {
  const app = new Hono<{ Bindings: RequestLoggerEnv }>();
  app.use('*', requestLogger());
  app.get('/ping', (c) => c.json({ ok: true }));
  app.post('/echo', async (c) => {
    // Drain the body so the handler path is realistic — proves the
    // middleware's body redaction does not consume the buffer that
    // downstream handlers need.
    await c.req.text();
    return c.json({ ok: true });
  });
  app.get('/boom', () => {
    throw new Error('boom');
  });
  app.get('/notfound-handler', (c) => c.json({ ok: false }, 404));
  return { app };
}

function bindings(analytics: AnalyticsStub): RequestLoggerEnv {
  return {
    ANALYTICS: { writeDataPoint: analytics.writeDataPoint },
    RUNTIME_ENV: 'development',
    RELEASE_SHA: 'test-release',
  };
}

describe('requestLogger() — redaction contract', () => {
  it('drops disallowed PII headers from LogEvent.metadata', async () => {
    // Arrange
    const analytics = createAnalyticsStub();
    const { app } = createAppWithStub(analytics);

    // Act
    const res = await app.request(
      '/ping',
      {
        method: 'GET',
        headers: {
          authorization: 'Bearer secret-token',
          'x-user-email': 'leak@example.invalid',
          'user-agent': 'contract-test/1.0',
        },
      },
      bindings(analytics),
    );

    // Assert — handler still responded
    expect(res.status).toBe(200);

    // Assert — exactly one event recorded
    expect(analytics.events).toHaveLength(1);
    const event = analytics.events[0];
    if (!event) {
      throw new Error('expected exactly one event');
    }

    // Assert — PII headers absent, allowlisted header preserved
    const metadataKeys = Object.keys(event.metadata);
    expect(metadataKeys).not.toContain('authorization');
    expect(metadataKeys).not.toContain('x-user-email');
    expect(event.metadata['user-agent']).toBe('contract-test/1.0');
  });

  it('drops disallowed PII body fields from LogEvent.metadata', async () => {
    // Arrange
    const analytics = createAnalyticsStub();
    const { app } = createAppWithStub(analytics);

    // Act — body carries PII the allowlist must not surface
    const res = await app.request(
      '/echo',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'leak@example.invalid',
          password: 'super-secret',
          // benign field, also not on the allowlist on Day 1
          note: 'hello',
        }),
      },
      bindings(analytics),
    );

    // Assert — handler still responded
    expect(res.status).toBe(200);

    // Assert — exactly one event recorded
    expect(analytics.events).toHaveLength(1);
    const event = analytics.events[0];
    if (!event) {
      throw new Error('expected exactly one event');
    }

    // Assert — body PII absent from metadata. The Day 1 allowlist is
    // empty for body keys, so no body fields appear at all.
    const metadataKeys = Object.keys(event.metadata);
    expect(metadataKeys).not.toContain('email');
    expect(metadataKeys).not.toContain('password');
    expect(metadataKeys).not.toContain('note');
  });

  it('writes exactly one event per request including 5xx failure paths', async () => {
    // Arrange
    const analytics = createAnalyticsStub();
    const { app } = createAppWithStub(analytics);

    // Act — handler throws; Hono converts to 500
    const res = await app.request('/boom', { method: 'GET' }, bindings(analytics));

    // Assert — failure response surfaced as 5xx
    expect(res.status).toBe(500);

    // Assert — exactly one event recorded for the failing request
    expect(analytics.events).toHaveLength(1);
    const event = analytics.events[0];
    if (!event) {
      throw new Error('expected exactly one event');
    }
    expect(event.status).toBeGreaterThanOrEqual(500);
    expect(event.error_class).toBe('Error');
  });

  it('writes exactly one event per request for 4xx handler responses', async () => {
    // Arrange
    const analytics = createAnalyticsStub();
    const { app } = createAppWithStub(analytics);

    // Act — handler returns 404 explicitly
    const res = await app.request('/notfound-handler', { method: 'GET' }, bindings(analytics));

    // Assert
    expect(res.status).toBe(404);
    expect(analytics.events).toHaveLength(1);
    const event = analytics.events[0];
    if (!event) {
      throw new Error('expected exactly one event');
    }
    expect(event.status).toBe(404);
    expect(event.error_class).toBeUndefined();
  });
});
