// apps/api/src/lib/r2.test.ts
//
// Unit tests for the pure helpers in `./r2`. The contract tier covers
// the route surface; these tests pin the validator decisions and the
// key-shape construction in isolation.

import { describe, expect, it } from 'vitest';
import { ALLOWED_LOGO_CONTENT_TYPES, MAX_LOGO_BYTES, buildLogoKey, validateLogoUpload } from './r2';

describe('validateLogoUpload', () => {
  it.each(ALLOWED_LOGO_CONTENT_TYPES)('accepts %s under the size cap', (ct) => {
    const result = validateLogoUpload({ contentType: ct, contentLength: 1024 });
    expect(result.ok).toBe(true);
  });

  it('rejects an unsupported mime', () => {
    const result = validateLogoUpload({ contentType: 'image/gif', contentLength: 1024 });
    expect(result).toEqual({ ok: false, reason: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('rejects an oversize payload', () => {
    const result = validateLogoUpload({
      contentType: 'image/png',
      contentLength: MAX_LOGO_BYTES + 1,
    });
    expect(result).toEqual({ ok: false, reason: 'PAYLOAD_TOO_LARGE' });
  });

  it('rejects a zero / negative / non-finite length as PAYLOAD_TOO_LARGE', () => {
    for (const len of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = validateLogoUpload({ contentType: 'image/png', contentLength: len });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('PAYLOAD_TOO_LARGE');
    }
  });
});

describe('buildLogoKey', () => {
  it('places the key under the per-org namespace with the right extension', () => {
    expect(buildLogoKey('org-a', 'image/png')).toMatch(/^logos\/org-a\/[0-9a-f-]+\.png$/);
    expect(buildLogoKey('org-a', 'image/jpeg')).toMatch(/^logos\/org-a\/[0-9a-f-]+\.jpg$/);
    expect(buildLogoKey('org-a', 'image/webp')).toMatch(/^logos\/org-a\/[0-9a-f-]+\.webp$/);
  });

  it('returns a distinct key per call (uuid suffix)', () => {
    const a = buildLogoKey('org-a', 'image/png');
    const b = buildLogoKey('org-a', 'image/png');
    expect(a).not.toBe(b);
  });
});
