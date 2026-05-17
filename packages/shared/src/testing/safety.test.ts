import { describe, expect, it } from 'vitest';
import { SyntheticPiiError, assertSyntheticPii, syntheticEmailSchema } from './safety';

describe('syntheticEmailSchema', () => {
  it('accepts a synthetic email ending in @example.invalid', () => {
    const result = syntheticEmailSchema.safeParse('test-user-1@example.invalid');
    expect(result.success).toBe(true);
  });

  it('rejects an @example.com address', () => {
    const result = syntheticEmailSchema.safeParse('user@example.com');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('@example.invalid');
    }
  });

  it('rejects an empty local part', () => {
    const result = syntheticEmailSchema.safeParse('@example.invalid');
    expect(result.success).toBe(false);
  });

  it('rejects non-string values', () => {
    const result = syntheticEmailSchema.safeParse(42);
    expect(result.success).toBe(false);
  });
});

describe('assertSyntheticPii', () => {
  it('accepts an empty overrides object', () => {
    expect(() => assertSyntheticPii({})).not.toThrow();
  });

  it('accepts a flat overrides object with a synthetic email', () => {
    expect(() =>
      assertSyntheticPii({ email: 'test-coach-7@example.invalid', role: 'org_admin' }),
    ).not.toThrow();
  });

  it('throws SyntheticPiiError when a top-level email uses @example.com', () => {
    expect(() => assertSyntheticPii({ email: 'real@example.com' })).toThrowError(SyntheticPiiError);
  });

  it('reports the offending field path on a nested violation', () => {
    let captured: SyntheticPiiError | undefined;
    try {
      assertSyntheticPii({
        team: {
          owner: { email: 'leak@gmail.com' },
        },
      });
    } catch (error) {
      captured = error as SyntheticPiiError;
    }
    expect(captured).toBeInstanceOf(SyntheticPiiError);
    expect(captured?.path).toBe('team.owner.email');
    expect(captured?.value).toBe('leak@gmail.com');
    expect(captured?.message).toContain('team.owner.email');
  });

  it('reports the offending index inside an array', () => {
    let captured: SyntheticPiiError | undefined;
    try {
      assertSyntheticPii({
        members: [{ email: 'ok@example.invalid' }, { email: 'oops@example.com' }],
      });
    } catch (error) {
      captured = error as SyntheticPiiError;
    }
    expect(captured).toBeInstanceOf(SyntheticPiiError);
    expect(captured?.path).toBe('members[1].email');
  });

  it('throws when email is present but is not a string', () => {
    expect(() => assertSyntheticPii({ email: 42 })).toThrowError(SyntheticPiiError);
  });

  it('ignores non-email string fields', () => {
    expect(() =>
      assertSyntheticPii({
        name: 'Ada Lovelace',
        notes: 'real@example.com appears in free text, not as an email field',
      }),
    ).not.toThrow();
  });
});
