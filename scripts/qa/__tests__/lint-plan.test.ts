// scripts/qa/__tests__/lint-plan.test.ts
//
// Unit tests for the plan branch of `scripts/qa/lint.mjs`. We exercise
// the exported `validatePlanFile` and `validatePlanBody` helpers
// against in-memory fixtures so the tests stay independent of any
// pilot artifact that lands later in the Story.
//
// Citation: Task #788 Acceptance criteria.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runLint, validatePlanBody, validatePlanFile } from '../lint.mjs';

const VALID_FRONT_MATTER = `---
id: tp-identity-signup-happy-path
type: plan
title: Sign-up → onboarding happy path
domain: identity
persona: athlete
surface: web
route_prefixes:
  - /sign-up
  - /onboarding
est_minutes: 8
prerequisites:
  - "local stack running (pnpm dev)"
---
`;

const VALID_BODY = `## Setup
- Local stack is running.

## Steps
1. Visit the sign-up page.
   **Expected:** the sign-up form renders.
2. Submit valid credentials.
   **Expected:** the user lands on the onboarding gate.

## Cleanup
- Sign out and reset the seed.
`;

const VALID_PLAN = VALID_FRONT_MATTER + '\n' + VALID_BODY;

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'lint-qa-plan-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writePlan(name: string, contents: string): Promise<string> {
  const abs = path.join(tmpDir, name);
  await writeFile(abs, contents, 'utf8');
  return abs;
}

describe('validatePlanFile — happy path', () => {
  it('returns no errors for a valid plan', async () => {
    const abs = await writePlan('valid.plan.md', VALID_PLAN);
    const errors = await validatePlanFile(abs);
    expect(errors).toEqual([]);
  });
});

describe('validatePlanFile — missing front-matter field', () => {
  it('rejects a plan missing `persona:` and the error names the field', async () => {
    const withoutPersona = VALID_PLAN.replace(/persona: athlete\n/, '');
    const abs = await writePlan('no-persona.plan.md', withoutPersona);
    const errors = await validatePlanFile(abs);

    expect(errors.length).toBeGreaterThanOrEqual(1);
    const personaError = errors.find((e) => e.field === 'persona');
    expect(personaError).toBeDefined();
    expect(personaError?.file).toBe(abs);
  });

  it('rejects a plan with an unknown domain and the error names the domain field', async () => {
    const withBadDomain = VALID_PLAN.replace(/domain: identity/, 'domain: totally-not-a-domain');
    const abs = await writePlan('bad-domain.plan.md', withBadDomain);
    const errors = await validatePlanFile(abs);

    const domainError = errors.find((e) => e.field === 'domain');
    expect(domainError).toBeDefined();
  });
});

describe('validatePlanFile — missing body section', () => {
  it('rejects a plan missing `## Steps` and the error names the section', async () => {
    const withoutSteps =
      VALID_FRONT_MATTER + '\n## Setup\n- Local stack running.\n\n## Cleanup\n- Sign out.\n';
    const abs = await writePlan('no-steps.plan.md', withoutSteps);
    const errors = await validatePlanFile(abs);

    const stepsError = errors.find((e) => e.field === 'Steps');
    expect(stepsError).toBeDefined();
    expect(stepsError?.message).toMatch(/missing required section/);
  });

  it('rejects a plan missing `## Setup` and the error names the section', async () => {
    const withoutSetup =
      VALID_FRONT_MATTER +
      '\n## Steps\n1. Do a thing.\n   **Expected:** something happens.\n\n## Cleanup\n- Reset.\n';
    const abs = await writePlan('no-setup.plan.md', withoutSetup);
    const errors = await validatePlanFile(abs);

    const setupError = errors.find((e) => e.field === 'Setup');
    expect(setupError).toBeDefined();
  });
});

describe('validatePlanBody — steps without **Expected:**', () => {
  it('flags every numbered step that lacks an Expected line', () => {
    const body = `## Setup
- foo

## Steps
1. Step one.
2. Step two.
   **Expected:** ok.
3. Step three.

## Cleanup
- bar
`;
    const errors = validatePlanBody(body);
    const expectedErrors = errors.filter((e) => /Expected/.test(e.message));
    // Steps 1 and 3 lack the Expected marker; Step 2 has one.
    expect(expectedErrors.length).toBe(2);
  });
});

describe('runLint — directory-level orchestration', () => {
  it('exits 0 when no plans are present', async () => {
    const code = await runLint({ plansRoot: tmpDir });
    expect(code).toBe(0);
  });

  it('exits 0 when every plan in the corpus is valid', async () => {
    const sub = path.join(tmpDir, 'identity');
    await mkdir(sub, { recursive: true });
    await writeFile(path.join(sub, 'valid.plan.md'), VALID_PLAN, 'utf8');
    const code = await runLint({ plansRoot: tmpDir });
    expect(code).toBe(0);
  });

  it('exits 1 when at least one plan is invalid', async () => {
    const sub = path.join(tmpDir, 'identity');
    await mkdir(sub, { recursive: true });
    await writeFile(path.join(sub, 'valid.plan.md'), VALID_PLAN, 'utf8');
    await writeFile(
      path.join(sub, 'bad.plan.md'),
      VALID_PLAN.replace(/persona: athlete\n/, ''),
      'utf8',
    );
    const code = await runLint({ plansRoot: tmpDir });
    expect(code).toBe(1);
  });
});
