// scripts/qa/schema/__tests__/plan-schema.test.ts
//
// Unit tests for the plan front-matter Zod schema. Covers:
//   1. Happy path — a fully populated, valid plan parses and returns the
//      typed object with every field intact.
//   2. Missing required field — a plan without `persona` is rejected and
//      the ZodError names the offending field path.
//   3. Unknown domain — `domain: "totally-bogus"` is rejected and the
//      error names the `domain` field plus the accepted set.
//   4. Reserved domain — `domain: "mobile"` is rejected with the
//      "reserved until mobile Epic lands" message.
//   5. Each currently-accepted domain (excluding `mobile`) parses
//      successfully so future Epics can rely on the open enum.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DOMAINS } from '../domains.ts';
import { parsePlanFrontMatter, safeParsePlanFrontMatter } from '../plan.front-matter.zod.ts';

const validPlanFrontMatter = {
  id: 'tp-identity-signup-happy-path',
  type: 'plan' as const,
  title: 'Sign-up → onboarding happy path',
  domain: 'identity',
  persona: 'athlete',
  surface: 'web',
  route_prefixes: ['/sign-up', '/onboarding'],
  est_minutes: 8,
  prerequisites: ['local stack running (pnpm dev)'],
};

describe('parsePlanFrontMatter — happy path', () => {
  it('returns the typed object when every required field is present and valid', () => {
    const parsed = parsePlanFrontMatter(validPlanFrontMatter);
    expect(parsed).toEqual(validPlanFrontMatter);
    expect(parsed.id).toBe('tp-identity-signup-happy-path');
    expect(parsed.type).toBe('plan');
    expect(parsed.domain).toBe('identity');
    expect(parsed.persona).toBe('athlete');
    expect(parsed.surface).toBe('web');
    expect(parsed.route_prefixes).toEqual(['/sign-up', '/onboarding']);
    expect(parsed.est_minutes).toBe(8);
  });

  it('accepts a plan without optional prerequisites', () => {
    const { prerequisites: _omitted, ...withoutPrereqs } = validPlanFrontMatter;
    const parsed = parsePlanFrontMatter(withoutPrereqs);
    expect(parsed.prerequisites).toBeUndefined();
  });
});

describe('parsePlanFrontMatter — missing required field', () => {
  it('throws ZodError naming the missing field when `persona` is absent', () => {
    const { persona: _omitted, ...withoutPersona } = validPlanFrontMatter;
    let caught: unknown;
    try {
      parsePlanFrontMatter(withoutPersona);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(z.ZodError);
    const error = caught as z.ZodError;
    const personaIssue = error.issues.find((issue) => issue.path[0] === 'persona');
    expect(personaIssue).toBeDefined();
  });

  it('throws ZodError naming the missing field when `id` is absent', () => {
    const { id: _omitted, ...withoutId } = validPlanFrontMatter;
    const result = safeParsePlanFrontMatter(withoutId);
    expect(result.success).toBe(false);
    if (!result.success) {
      const idIssue = result.error.issues.find((issue) => issue.path[0] === 'id');
      expect(idIssue).toBeDefined();
    }
  });
});

describe('parsePlanFrontMatter — unknown domain', () => {
  it('rejects an unknown domain value and the error names the `domain` field', () => {
    const bad = { ...validPlanFrontMatter, domain: 'totally-bogus' };
    const result = safeParsePlanFrontMatter(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const domainIssue = result.error.issues.find((issue) => issue.path[0] === 'domain');
      expect(domainIssue).toBeDefined();
      expect(domainIssue?.message).toMatch(/domain must be one of/);
    }
  });
});

describe('parsePlanFrontMatter — reserved domain (mobile)', () => {
  it('rejects `domain: "mobile"` with the "reserved until mobile Epic lands" message', () => {
    const bad = { ...validPlanFrontMatter, domain: 'mobile' };
    const result = safeParsePlanFrontMatter(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const domainIssue = result.error.issues.find((issue) => issue.path[0] === 'domain');
      expect(domainIssue).toBeDefined();
      expect(domainIssue?.message).toMatch(/reserved until mobile Epic lands/);
    }
  });
});

describe('parsePlanFrontMatter — accepts every currently-live domain', () => {
  // The Tech Spec calls out three live domains; the schema must accept
  // any non-reserved entry so future Epics can land their plans without
  // modifying scripts/qa/*. We exercise every entry in the enum and
  // assert only the reserved ones (mobile) fail.
  const liveDomains = DOMAINS.filter((d) => d !== 'mobile');

  it.each(liveDomains)('accepts domain "%s"', (domain) => {
    const result = safeParsePlanFrontMatter({ ...validPlanFrontMatter, domain });
    expect(result.success).toBe(true);
  });
});

describe('parsePlanFrontMatter — reserved surface (mobile)', () => {
  it('rejects `surface: "mobile"` even when the domain is live', () => {
    const bad = { ...validPlanFrontMatter, surface: 'mobile' };
    const result = safeParsePlanFrontMatter(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const surfaceIssue = result.error.issues.find((issue) => issue.path[0] === 'surface');
      expect(surfaceIssue).toBeDefined();
      expect(surfaceIssue?.message).toMatch(/reserved/);
    }
  });
});
