/**
 * Unit tier — locks the redaction-allowlist trust boundary.
 *
 * Per Epic #5 PRD AC-7 (Story #256), this module carries a ≥95% branch
 * coverage floor configured in `packages/shared/vitest.config.ts`. The
 * suite below enumerates:
 *
 *   - every member of `RedactionAllowlist.headers` (positive copy)
 *   - every member of `RedactionAllowlist.queryKeys` (positive copy)
 *   - the empty `bodyKeys` posture (rejection of every body field)
 *   - case-insensitive header walking + lower-casing on output
 *   - case-sensitive query-key comparison
 *   - JSON body short-circuits (non-JSON content type, missing body,
 *     unparseable body, non-object body, array body)
 *   - `URLSearchParams` multi-value collapse to the last value
 *   - the frozen `RedactionAllowlist` reference cannot be reassigned
 *
 * Removing any of these acceptances WILL drop branch coverage below the
 * configured threshold and fail CI — that is the gate Story #256 lands.
 */
import { describe, expect, it } from 'vitest';
import {
  RedactionAllowlist,
  redactHeaders,
  redactQueryAndBody,
} from './redaction';

const REQ_URL = 'https://api.example.invalid/api/v1/things';

function jsonRequest(body: unknown): Request {
  return new Request(REQ_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('RedactionAllowlist', () => {
  it('exposes the expected Day 1 header allowlist', () => {
    expect([...RedactionAllowlist.headers].sort()).toEqual(
      [
        'accept-language',
        'cf-ipcountry',
        'cf-ray',
        'user-agent',
        'x-request-id',
      ].sort(),
    );
  });

  it('exposes the expected Day 1 query-key allowlist', () => {
    expect([...RedactionAllowlist.queryKeys].sort()).toEqual(
      ['cursor', 'limit', 'order', 'sort'].sort(),
    );
  });

  it('has bodyKeys as an empty Set on Day 1', () => {
    expect(RedactionAllowlist.bodyKeys.size).toBe(0);
  });

  it('is frozen — the outer object cannot be reassigned', () => {
    expect(Object.isFrozen(RedactionAllowlist)).toBe(true);
  });
});

describe('redactHeaders', () => {
  it('copies every allowlisted header into the output map', () => {
    const headers = new Headers({
      'user-agent': 'curl/8.0',
      'cf-ray': 'abc123-DFW',
      'cf-ipcountry': 'US',
      'x-request-id': 'req-42',
      'accept-language': 'en-US,en;q=0.9',
    });
    expect(redactHeaders(headers)).toEqual({
      'user-agent': 'curl/8.0',
      'cf-ray': 'abc123-DFW',
      'cf-ipcountry': 'US',
      'x-request-id': 'req-42',
      'accept-language': 'en-US,en;q=0.9',
    });
  });

  it('drops headers not in the allowlist (e.g. authorization, cookie)', () => {
    const headers = new Headers({
      authorization: 'Bearer secret',
      cookie: 'session=secret',
      'x-api-key': 'secret',
      'user-agent': 'ok',
    });
    const out = redactHeaders(headers);
    expect(out).toEqual({ 'user-agent': 'ok' });
    expect(out).not.toHaveProperty('authorization');
    expect(out).not.toHaveProperty('cookie');
    expect(out).not.toHaveProperty('x-api-key');
  });

  it('matches header names case-insensitively and lower-cases the output', () => {
    const headers = new Headers();
    headers.append('USER-AGENT', 'mixed');
    headers.append('Cf-Ray', 'mixedRay');
    const out = redactHeaders(headers);
    expect(out['user-agent']).toBe('mixed');
    expect(out['cf-ray']).toBe('mixedRay');
  });

  it('returns an empty object when no headers match', () => {
    const headers = new Headers({ 'x-custom': 'nope' });
    expect(redactHeaders(headers)).toEqual({});
  });

  it('returns an empty object for an empty Headers instance', () => {
    expect(redactHeaders(new Headers())).toEqual({});
  });
});

describe('redactQueryAndBody — query strings', () => {
  it('copies every allowlisted query key (case-sensitive)', async () => {
    const req = new Request(
      `${REQ_URL}?cursor=abc&limit=20&order=asc&sort=name`,
    );
    expect(await redactQueryAndBody(req)).toEqual({
      cursor: 'abc',
      limit: '20',
      order: 'asc',
      sort: 'name',
    });
  });

  it('drops query keys not in the allowlist', async () => {
    const req = new Request(`${REQ_URL}?email=user@example.invalid&limit=5`);
    const out = await redactQueryAndBody(req);
    expect(out).toEqual({ limit: '5' });
    expect(out).not.toHaveProperty('email');
  });

  it('ignores capitalization mismatches on query keys (case-sensitive)', async () => {
    const req = new Request(`${REQ_URL}?Cursor=abc&LIMIT=20`);
    const out = await redactQueryAndBody(req);
    expect(out).not.toHaveProperty('Cursor');
    expect(out).not.toHaveProperty('cursor');
    expect(out).not.toHaveProperty('LIMIT');
    expect(out).not.toHaveProperty('limit');
  });

  it('collapses multi-valued query params to the last value', async () => {
    const req = new Request(`${REQ_URL}?sort=name&sort=date`);
    expect(await redactQueryAndBody(req)).toEqual({ sort: 'date' });
  });

  it('returns an empty object for a URL with no query string', async () => {
    const req = new Request(REQ_URL);
    expect(await redactQueryAndBody(req)).toEqual({});
  });
});

describe('redactQueryAndBody — JSON body short-circuits', () => {
  it('does not parse the body when bodyKeys is empty (Day 1 posture)', async () => {
    // A body that WOULD parse and WOULD match a key, but the allowlist is
    // empty so the function must short-circuit before parsing.
    const req = jsonRequest({ email: 'user@example.invalid', limit: 5 });
    const out = await redactQueryAndBody(req);
    expect(out).not.toHaveProperty('email');
    expect(out).not.toHaveProperty('limit');
    // The body must still be readable by downstream consumers — we clone.
    await expect(req.text()).resolves.toContain('"email"');
  });

  it('does not consume the request body (clone() preserves it)', async () => {
    const req = jsonRequest({ anything: 'value' });
    await redactQueryAndBody(req);
    const text = await req.text();
    expect(text).toContain('"anything"');
  });

  it('returns query-only output even when the body would otherwise be parsed', async () => {
    // Even with bodyKeys empty we want to assert the query still flows.
    const req = new Request(`${REQ_URL}?limit=3`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ field: 'value' }),
    });
    expect(await redactQueryAndBody(req)).toEqual({ limit: '3' });
  });
});

describe('redactQueryAndBody — exhaustive branch coverage of body parsing', () => {
  // To exercise every branch in the body-parse path we temporarily widen
  // bodyKeys for a single test. This is the only place in the codebase
  // that may add to the Set; it tears the addition back down in a
  // try/finally so other tests see the Day 1 posture.

  async function withWidenedBody(
    keys: string[],
    fn: () => Promise<void>,
  ): Promise<void> {
    for (const k of keys) RedactionAllowlist.bodyKeys.add(k);
    try {
      await fn();
    } finally {
      for (const k of keys) RedactionAllowlist.bodyKeys.delete(k);
    }
  }

  it('copies allowlisted body fields when bodyKeys contains them', async () => {
    await withWidenedBody(['team_id'], async () => {
      const req = jsonRequest({ team_id: 'team-42', secret: 'nope' });
      const out = await redactQueryAndBody(req);
      expect(out).toEqual({ team_id: 'team-42' });
      expect(out).not.toHaveProperty('secret');
    });
  });

  it('stringifies non-string body values via String(value)', async () => {
    await withWidenedBody(['n', 'b', 'nested', 'nullv'], async () => {
      const req = jsonRequest({
        n: 42,
        b: true,
        nested: { hidden: 'x' },
        nullv: null,
      });
      const out = await redactQueryAndBody(req);
      expect(out.n).toBe('42');
      expect(out.b).toBe('true');
      // Nested objects collapse to '[object Object]' — that's a tell
      // the allowlist needs revisiting, not a feature.
      expect(out.nested).toBe('[object Object]');
      // `null` stringifies to 'null'; documented behaviour.
      expect(out.nullv).toBe('null');
    });
  });

  it('returns query-only output when content-type header is null (absent)', async () => {
    await withWidenedBody(['team_id'], async () => {
      // Construct a request whose Headers genuinely lacks content-type.
      // Passing a string body via `new Request` causes Node to auto-set
      // `text/plain;charset=UTF-8`, so we hand-build the Headers map.
      const req = new Request(`${REQ_URL}?limit=4`, {
        method: 'POST',
        headers: new Headers(),
      });
      expect(req.headers.get('content-type')).toBeNull();
      expect(await redactQueryAndBody(req)).toEqual({ limit: '4' });
    });
  });

  it('returns query-only output when content-type is not JSON', async () => {
    await withWidenedBody(['team_id'], async () => {
      const req = new Request(`${REQ_URL}?limit=2`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ team_id: 'team-42' }),
      });
      const out = await redactQueryAndBody(req);
      expect(out).toEqual({ limit: '2' });
    });
  });

  it('returns query-only output when content-type header is absent', async () => {
    await withWidenedBody(['team_id'], async () => {
      const req = new Request(`${REQ_URL}?limit=2`, {
        method: 'POST',
        body: JSON.stringify({ team_id: 'team-42' }),
      });
      const out = await redactQueryAndBody(req);
      expect(out).toEqual({ limit: '2' });
    });
  });

  it('handles JSON content-type with parameters (e.g. charset)', async () => {
    await withWidenedBody(['team_id'], async () => {
      const req = new Request(REQ_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ team_id: 'team-42' }),
      });
      expect(await redactQueryAndBody(req)).toEqual({ team_id: 'team-42' });
    });
  });

  it('returns empty body output for an empty body string', async () => {
    await withWidenedBody(['team_id'], async () => {
      const req = new Request(REQ_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '',
      });
      expect(await redactQueryAndBody(req)).toEqual({});
    });
  });

  it('returns empty body output for unparseable JSON', async () => {
    await withWidenedBody(['team_id'], async () => {
      const req = jsonRequest('{this is not json');
      expect(await redactQueryAndBody(req)).toEqual({});
    });
  });

  it('returns empty body output when the body parses to null', async () => {
    await withWidenedBody(['team_id'], async () => {
      const req = jsonRequest(null);
      expect(await redactQueryAndBody(req)).toEqual({});
    });
  });

  it('returns empty body output when the body parses to an array', async () => {
    await withWidenedBody(['team_id'], async () => {
      const req = jsonRequest([{ team_id: 'team-42' }]);
      expect(await redactQueryAndBody(req)).toEqual({});
    });
  });

  it('returns empty body output when the body parses to a scalar string', async () => {
    await withWidenedBody(['team_id'], async () => {
      const req = jsonRequest('"just-a-string"');
      expect(await redactQueryAndBody(req)).toEqual({});
    });
  });

  it('falls back gracefully when clone().text() rejects', async () => {
    await withWidenedBody(['team_id'], async () => {
      // Simulate a clone whose text() rejects by passing an object that
      // looks like a Request but whose clone returns a thenable that
      // throws when text() is called.
      const url = REQ_URL;
      const fakeReq = {
        url,
        headers: new Headers({ 'content-type': 'application/json' }),
        clone() {
          return {
            text() {
              return Promise.reject(new Error('stream consumed'));
            },
          };
        },
      } as unknown as Request;
      // The query path still runs (none here), the body path must
      // return empty on the catch branch.
      expect(await redactQueryAndBody(fakeReq)).toEqual({});
    });
  });
});
