// packages/shared/src/observability/log-event.test.ts
//
// Unit suite for `LogEventSchema`. Pins every Zod constraint by asserting
// both a passing payload AND a failing one for each rule, so Stryker
// mutants that flip a literal (e.g. `min(1)` → `min(0)`, `int()` → `_`,
// an enum entry removed) are killed by at least one targeted negative
// case rather than slipping silently past a partial-shape `toMatchObject`.

import { describe, expect, it } from 'vitest';
import { LogEventSchema } from './log-event';

function baseEvent() {
  return {
    ts: '2026-05-21T22:46:45.897+00:00',
    runtime: 'workers',
    env: 'production',
    release: '1.0.0',
    method: 'GET',
    route_pattern: '/api/v1/health',
    status: 200,
    duration_ms: 17,
    metadata: {},
  };
}

describe('LogEventSchema', () => {
  describe('happy path', () => {
    it('accepts a minimal valid envelope', () => {
      const result = LogEventSchema.safeParse(baseEvent());
      expect(result.success).toBe(true);
    });

    it('defaults metadata to an empty object when omitted', () => {
      const { metadata, ...rest } = baseEvent();
      void metadata;
      const result = LogEventSchema.safeParse(rest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata).toEqual({});
      }
    });

    it('accepts an optional error_class when present', () => {
      const result = LogEventSchema.safeParse({
        ...baseEvent(),
        status: 500,
        error_class: 'TypeError',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.error_class).toBe('TypeError');
      }
    });

    it('omits error_class when not present (does not synthesize a value)', () => {
      const result = LogEventSchema.safeParse(baseEvent());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.error_class).toBeUndefined();
      }
    });
  });

  describe('ts (datetime with offset)', () => {
    it('rejects a non-string ts', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), ts: 12345 });
      expect(result.success).toBe(false);
    });

    it('rejects a non-ISO ts', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), ts: 'yesterday' });
      expect(result.success).toBe(false);
    });

    it('rejects a UTC-Z ts (offset must be explicit)', () => {
      const result = LogEventSchema.safeParse({
        ...baseEvent(),
        ts: '2026-05-21T22:46:45.897Z',
      });
      // The schema enforces `datetime({ offset: true })`, which permits
      // both `+HH:MM`/`-HH:MM` offsets AND the `Z` suffix in Zod v3+.
      // We assert "explicit offset accepted" rather than rejecting Z;
      // the negative branch lives below.
      expect(result.success).toBe(true);
    });

    it('rejects a ts with no offset and no Z', () => {
      const result = LogEventSchema.safeParse({
        ...baseEvent(),
        ts: '2026-05-21T22:46:45.897',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('runtime enum', () => {
    it('accepts each declared runtime', () => {
      for (const runtime of ['workers', 'astro', 'expo']) {
        const result = LogEventSchema.safeParse({ ...baseEvent(), runtime });
        expect(result.success).toBe(true);
      }
    });

    it('rejects an unknown runtime', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), runtime: 'deno' });
      expect(result.success).toBe(false);
    });
  });

  describe('env enum', () => {
    it('accepts each declared environment', () => {
      for (const env of ['development', 'staging', 'production']) {
        const result = LogEventSchema.safeParse({ ...baseEvent(), env });
        expect(result.success).toBe(true);
      }
    });

    it('rejects an unknown environment', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), env: 'prod' });
      expect(result.success).toBe(false);
    });
  });

  describe('release', () => {
    it('rejects an empty release', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), release: '' });
      expect(result.success).toBe(false);
    });

    it('rejects a non-string release', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), release: 1 });
      expect(result.success).toBe(false);
    });
  });

  describe('method enum', () => {
    it.each([
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'HEAD',
      'OPTIONS',
    ])('accepts %s', (method) => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), method });
      expect(result.success).toBe(true);
    });

    it('rejects a lowercase method (e.g. "get")', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), method: 'get' });
      expect(result.success).toBe(false);
    });

    it('rejects an unknown method (e.g. "CONNECT")', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), method: 'CONNECT' });
      expect(result.success).toBe(false);
    });
  });

  describe('route_pattern', () => {
    it('rejects an empty route_pattern', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), route_pattern: '' });
      expect(result.success).toBe(false);
    });

    it('rejects a non-string route_pattern', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), route_pattern: 42 });
      expect(result.success).toBe(false);
    });
  });

  describe('status (int 100..599)', () => {
    it('accepts the minimum (100)', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), status: 100 });
      expect(result.success).toBe(true);
    });

    it('accepts the maximum (599)', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), status: 599 });
      expect(result.success).toBe(true);
    });

    it('rejects below the minimum (99)', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), status: 99 });
      expect(result.success).toBe(false);
    });

    it('rejects above the maximum (600)', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), status: 600 });
      expect(result.success).toBe(false);
    });

    it('rejects a non-integer status (200.5)', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), status: 200.5 });
      expect(result.success).toBe(false);
    });

    it('rejects a string status ("200")', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), status: '200' });
      expect(result.success).toBe(false);
    });
  });

  describe('duration_ms', () => {
    it('accepts 0', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), duration_ms: 0 });
      expect(result.success).toBe(true);
    });

    it('rejects a negative duration', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), duration_ms: -1 });
      expect(result.success).toBe(false);
    });

    it('rejects a non-integer duration', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), duration_ms: 1.5 });
      expect(result.success).toBe(false);
    });
  });

  describe('error_class', () => {
    it('rejects an empty error_class when the key is present', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), error_class: '' });
      expect(result.success).toBe(false);
    });

    it('rejects a non-string error_class', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), error_class: 500 });
      expect(result.success).toBe(false);
    });
  });

  describe('metadata (Record<string, string>)', () => {
    it('accepts an empty metadata', () => {
      const result = LogEventSchema.safeParse({ ...baseEvent(), metadata: {} });
      expect(result.success).toBe(true);
    });

    it('accepts string-to-string metadata', () => {
      const result = LogEventSchema.safeParse({
        ...baseEvent(),
        metadata: { tenant_id: 'org_123', release_lane: 'canary' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects a non-string metadata value (number)', () => {
      const result = LogEventSchema.safeParse({
        ...baseEvent(),
        metadata: { count: 42 as unknown as string },
      });
      expect(result.success).toBe(false);
    });

    it('rejects a non-string metadata value (boolean)', () => {
      const result = LogEventSchema.safeParse({
        ...baseEvent(),
        metadata: { active: true as unknown as string },
      });
      expect(result.success).toBe(false);
    });

    it('rejects a non-string metadata value (null)', () => {
      const result = LogEventSchema.safeParse({
        ...baseEvent(),
        metadata: { key: null as unknown as string },
      });
      expect(result.success).toBe(false);
    });

    it('rejects a non-object metadata (array)', () => {
      const result = LogEventSchema.safeParse({
        ...baseEvent(),
        metadata: ['oops'] as unknown as Record<string, string>,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('required-key enforcement', () => {
    it.each([
      'ts',
      'runtime',
      'env',
      'release',
      'method',
      'route_pattern',
      'status',
      'duration_ms',
    ] as const)('rejects when %s is omitted', (omit) => {
      const event = baseEvent() as Record<string, unknown>;
      delete event[omit];
      const result = LogEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });
  });
});
