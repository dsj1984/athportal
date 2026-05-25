// scripts/qa/schema/__tests__/charter-schema.test.ts
//
// Unit tests for the charter front-matter Zod schema. Covers:
//   1. Happy path — a fully populated, valid charter parses and returns
//      the typed object with every field intact (heuristics is string[]).
//   2. Missing safety_constraints — a charter without the block is
//      rejected with a ZodError naming the offending field path.
//   3. safety_constraints.environment === 'prod' is rejected with the
//      schema's denylist message.
//   4. Missing individual safety_constraints sub-fields (environment,
//      mutation_surface, required_reset) are each rejected.
//   5. Reserved domain (mobile) is rejected with the standard message.
//
// Citation: Task #795 Acceptance criteria, Tech Spec #782 § Front-matter
// contracts and § Security & Privacy Considerations §1-§4.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  parseCharterFrontMatter,
  safeParseCharterFrontMatter,
} from '../charter.front-matter.zod.ts';

const validCharterFrontMatter = {
  id: 'ec-org-admin-csv-import',
  type: 'charter' as const,
  title: 'CSV import — silently-accepted bad data',
  domain: 'org-admin',
  persona: 'org-admin',
  route_prefixes: ['/admin/import'],
  mission:
    'Find ways the CSV import surface accepts malformed, ambiguous, or out-of-range data without surfacing a visible error.',
  heuristics: ['boundary-values', 'encoding-fuzz', 'form-fuzz'],
  time_box_minutes: 30,
  safety_constraints: {
    environment: 'local',
    mutation_surface: ['csv_import_batches table', 'athlete_memberships table'],
    required_reset:
      'pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed',
  },
};

describe('parseCharterFrontMatter — happy path', () => {
  it('returns the typed object when every required field is present and valid', () => {
    const parsed = parseCharterFrontMatter(validCharterFrontMatter);
    expect(parsed).toEqual(validCharterFrontMatter);
    expect(parsed.id).toBe('ec-org-admin-csv-import');
    expect(parsed.type).toBe('charter');
    expect(parsed.domain).toBe('org-admin');
    expect(parsed.persona).toBe('org-admin');
    expect(parsed.time_box_minutes).toBe(30);
  });

  it('returns heuristics as a string[]', () => {
    const parsed = parseCharterFrontMatter(validCharterFrontMatter);
    expect(Array.isArray(parsed.heuristics)).toBe(true);
    expect(parsed.heuristics).toEqual(['boundary-values', 'encoding-fuzz', 'form-fuzz']);
    for (const name of parsed.heuristics) {
      expect(typeof name).toBe('string');
    }
  });
});

describe('parseCharterFrontMatter — missing safety_constraints', () => {
  it('rejects a charter missing safety_constraints with a ZodError naming the field', () => {
    const { safety_constraints: _omitted, ...withoutSafety } = validCharterFrontMatter;
    let caught: unknown;
    try {
      parseCharterFrontMatter(withoutSafety);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(z.ZodError);
    const error = caught as z.ZodError;
    const issue = error.issues.find((i) => i.path[0] === 'safety_constraints');
    expect(issue).toBeDefined();
  });
});

describe('parseCharterFrontMatter — environment === "prod"', () => {
  it('rejects safety_constraints.environment === "prod" with a ZodError', () => {
    const bad = {
      ...validCharterFrontMatter,
      safety_constraints: {
        ...validCharterFrontMatter.safety_constraints,
        environment: 'prod',
      },
    };
    const result = safeParseCharterFrontMatter(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const envIssue = result.error.issues.find(
        (i) => i.path[0] === 'safety_constraints' && i.path[1] === 'environment',
      );
      expect(envIssue).toBeDefined();
      expect(envIssue?.message).toMatch(/must not be "prod"/);
    }
  });
});

describe('parseCharterFrontMatter — missing safety sub-fields', () => {
  it('rejects safety_constraints missing `environment`', () => {
    const bad = {
      ...validCharterFrontMatter,
      safety_constraints: {
        mutation_surface: validCharterFrontMatter.safety_constraints.mutation_surface,
        required_reset: validCharterFrontMatter.safety_constraints.required_reset,
      },
    };
    const result = safeParseCharterFrontMatter(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path[0] === 'safety_constraints' && i.path[1] === 'environment',
      );
      expect(issue).toBeDefined();
    }
  });

  it('rejects safety_constraints missing `mutation_surface`', () => {
    const bad = {
      ...validCharterFrontMatter,
      safety_constraints: {
        environment: validCharterFrontMatter.safety_constraints.environment,
        required_reset: validCharterFrontMatter.safety_constraints.required_reset,
      },
    };
    const result = safeParseCharterFrontMatter(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path[0] === 'safety_constraints' && i.path[1] === 'mutation_surface',
      );
      expect(issue).toBeDefined();
    }
  });

  it('rejects safety_constraints missing `required_reset`', () => {
    const bad = {
      ...validCharterFrontMatter,
      safety_constraints: {
        environment: validCharterFrontMatter.safety_constraints.environment,
        mutation_surface: validCharterFrontMatter.safety_constraints.mutation_surface,
      },
    };
    const result = safeParseCharterFrontMatter(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path[0] === 'safety_constraints' && i.path[1] === 'required_reset',
      );
      expect(issue).toBeDefined();
    }
  });

  it('rejects safety_constraints with an empty mutation_surface array', () => {
    const bad = {
      ...validCharterFrontMatter,
      safety_constraints: {
        ...validCharterFrontMatter.safety_constraints,
        mutation_surface: [],
      },
    };
    const result = safeParseCharterFrontMatter(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path[0] === 'safety_constraints' && i.path[1] === 'mutation_surface',
      );
      expect(issue).toBeDefined();
    }
  });
});

describe('parseCharterFrontMatter — reserved domain (mobile)', () => {
  it('rejects `domain: "mobile"` with the standard reserved message', () => {
    const bad = { ...validCharterFrontMatter, domain: 'mobile' };
    const result = safeParseCharterFrontMatter(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === 'domain');
      expect(issue).toBeDefined();
      expect(issue?.message).toMatch(/reserved until mobile Epic lands/);
    }
  });
});

describe('parseCharterFrontMatter — empty heuristics array', () => {
  it('rejects a charter whose heuristics array is empty', () => {
    const bad = { ...validCharterFrontMatter, heuristics: [] };
    const result = safeParseCharterFrontMatter(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === 'heuristics');
      expect(issue).toBeDefined();
    }
  });
});
