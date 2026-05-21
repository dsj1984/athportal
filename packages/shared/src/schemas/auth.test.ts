/**
 * Unit tests for the onboarding Zod schemas.
 *
 * The schemas are the load-bearing contract between the web form and the
 * API handler, so each test exercises a specific contractual constraint
 * named in Task #568's acceptance criteria.
 */

import { describe, expect, it } from 'vitest';
import { OnboardInputSchema, OnboardOutputSchema } from './auth';

const validBody = {
  profile: {
    displayName: 'Ada Lovelace',
    firstName: 'Ada',
    lastName: 'Lovelace',
  },
  ageAttestation: { isAtLeast13: true as const },
  legalAcceptances: {
    termsOfServiceVersion: '2026-04-15',
    privacyPolicyVersion: '2026-04-15',
  },
};

describe('OnboardInputSchema', () => {
  it('accepts a well-formed body without optional fields', () => {
    const parsed = OnboardInputSchema.parse(validBody);
    expect(parsed.profile.displayName).toBe('Ada Lovelace');
    expect(parsed.ageAttestation.isAtLeast13).toBe(true);
    expect(parsed.inviteToken).toBeUndefined();
  });

  it('accepts a well-formed body with optional inviteToken and profilePhotoUploadId', () => {
    const parsed = OnboardInputSchema.parse({
      ...validBody,
      inviteToken: 'tok_abc123',
      profilePhotoUploadId: 'upl_xyz789',
    });
    expect(parsed.inviteToken).toBe('tok_abc123');
    expect(parsed.profilePhotoUploadId).toBe('upl_xyz789');
  });

  it('rejects payloads where ageAttestation.isAtLeast13 is not literally true', () => {
    const result = OnboardInputSchema.safeParse({
      ...validBody,
      ageAttestation: { isAtLeast13: false },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flagged = result.error.issues.some(
        (issue) => issue.path[0] === 'ageAttestation' && issue.path[1] === 'isAtLeast13',
      );
      expect(flagged).toBe(true);
    }
  });

  it('rejects payloads missing termsOfServiceVersion', () => {
    const result = OnboardInputSchema.safeParse({
      ...validBody,
      legalAcceptances: { privacyPolicyVersion: '2026-04-15' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flagged = result.error.issues.some(
        (issue) =>
          issue.path[0] === 'legalAcceptances' && issue.path[1] === 'termsOfServiceVersion',
      );
      expect(flagged).toBe(true);
    }
  });

  it('rejects payloads missing privacyPolicyVersion', () => {
    const result = OnboardInputSchema.safeParse({
      ...validBody,
      legalAcceptances: { termsOfServiceVersion: '2026-04-15' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flagged = result.error.issues.some(
        (issue) => issue.path[0] === 'legalAcceptances' && issue.path[1] === 'privacyPolicyVersion',
      );
      expect(flagged).toBe(true);
    }
  });

  it('rejects unknown top-level keys (strict mode)', () => {
    const result = OnboardInputSchema.safeParse({
      ...validBody,
      acceptedTerms: true,
    });
    expect(result.success).toBe(false);
  });
});

describe('OnboardOutputSchema', () => {
  it('parses a canonical handler return shape', () => {
    const onboardedAt = new Date('2026-05-01T00:00:00.000Z');
    const parsed = OnboardOutputSchema.parse({
      user: {
        userId: 'u_1',
        role: 'member',
        orgId: null,
        teamId: null,
        email: 'ada@example.invalid',
        onboardedAt,
      },
      onboardedAt,
    });
    expect(parsed.user.userId).toBe('u_1');
    expect(parsed.user.onboardedAt.getTime()).toBe(onboardedAt.getTime());
  });

  it('strips internal user fields (createdAt, updatedAt, clerkSubjectId)', () => {
    const onboardedAt = new Date('2026-05-01T00:00:00.000Z');
    const result = OnboardOutputSchema.safeParse({
      user: {
        userId: 'u_1',
        role: 'member',
        orgId: null,
        teamId: null,
        email: 'ada@example.invalid',
        onboardedAt,
        createdAt: new Date(),
        updatedAt: new Date(),
        clerkSubjectId: 'clerk_sub_1',
      },
      onboardedAt,
    });
    // `.strict()` makes unknown keys a hard failure so the schema *refuses*
    // to round-trip internal fields — that is the public-surface contract.
    expect(result.success).toBe(false);
    if (!result.success) {
      const flaggedFields = result.error.issues
        .filter(
          (issue): issue is typeof issue & { readonly keys: ReadonlyArray<string> } =>
            issue.code === 'unrecognized_keys' && Array.isArray((issue as { keys?: unknown }).keys),
        )
        .flatMap((issue) => issue.keys);
      expect(flaggedFields).toEqual(
        expect.arrayContaining(['createdAt', 'updatedAt', 'clerkSubjectId']),
      );
    }
  });
});
