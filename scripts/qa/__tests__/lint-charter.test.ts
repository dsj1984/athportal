// scripts/qa/__tests__/lint-charter.test.ts
//
// Unit tests for the charter branch of `scripts/qa/lint.mjs`. We exercise
// the exported `validateCharterFile`, `validateCharterBody`,
// `validateCharterHeuristics`, and the top-level `runLint`
// orchestrator against in-memory fixtures so the tests stay independent
// of the pilot charter that lands later in the Story.
//
// Citation: Task #797 Acceptance criteria.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  runLint,
  validateCharterBody,
  validateCharterFile,
  validateCharterHeuristics,
} from '../lint.mjs';

const VALID_CHARTER_FRONT_MATTER = `---
id: ec-org-admin-csv-import
type: charter
title: CSV import — silently-accepted bad data
domain: org-admin
persona: org-admin
route_prefixes:
  - /admin/import
mission: >-
  Find ways the CSV import surface accepts malformed, ambiguous, or
  out-of-range data without surfacing a visible error.
heuristics:
  - boundary-values
  - encoding-fuzz
  - form-fuzz
time_box_minutes: 30
safety_constraints:
  environment: local
  mutation_surface:
    - "csv_import_batches table"
    - "athlete_memberships table"
  required_reset: "pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed"
---
`;

const VALID_CHARTER_BODY = `## Mission

Probe the CSV import surface for silent acceptance of bad data.

## Heuristics

- boundary-values: push every numeric column to its declared bounds.
- encoding-fuzz: upload CSVs with BOM, smart quotes, RTL overrides.
- form-fuzz: substitute wrong-type values into each column.

## Notes

Scratchpad for the session.

## Findings

| id | title | severity | repro | suggested-promotion |
| --- | --- | --- | --- | --- |
`;

const VALID_CHARTER = VALID_CHARTER_FRONT_MATTER + '\n' + VALID_CHARTER_BODY;

const ALL_HEURISTICS = [
  'boundary-values',
  'encoding-fuzz',
  'email-collision',
  'form-fuzz',
  'landmark-tour',
  'money-tour',
  'auth-fuzz',
  'cross-tenant-probe',
];

let tmpDir: string;
let plansRoot: string;
let chartersRoot: string;
let heuristicsDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'lint-qa-charter-'));
  plansRoot = path.join(tmpDir, 'plans');
  chartersRoot = path.join(tmpDir, 'charters');
  heuristicsDir = path.join(chartersRoot, '_heuristics');
  await mkdir(plansRoot, { recursive: true });
  await mkdir(heuristicsDir, { recursive: true });
  // Seed the heuristic library so charter heuristic-name resolution
  // succeeds for any of the canonical eight names.
  for (const name of ALL_HEURISTICS) {
    await writeFile(
      path.join(heuristicsDir, `${name}.md`),
      `# ${name}\n\n## When to apply\n\n- ok\n\n## How to apply\n\n- ok\n\n## Signals of a finding\n\n- ok\n`,
      'utf8',
    );
  }
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeCharter(name: string, contents: string): Promise<string> {
  const sub = path.join(chartersRoot, 'org-admin');
  await mkdir(sub, { recursive: true });
  const abs = path.join(sub, name);
  await writeFile(abs, contents, 'utf8');
  return abs;
}

function knownHeuristicSet(): Set<string> {
  return new Set(ALL_HEURISTICS);
}

describe('validateCharterFile — happy path', () => {
  it('returns no errors for a valid charter', async () => {
    const abs = await writeCharter('valid.charter.md', VALID_CHARTER);
    const errors = await validateCharterFile(abs, knownHeuristicSet());
    expect(errors).toEqual([]);
  });
});

describe('validateCharterFile — missing safety_constraints', () => {
  it('rejects a charter missing safety_constraints and the error names the field', async () => {
    const withoutSafety = VALID_CHARTER.replace(
      /safety_constraints:[\s\S]*?required_reset: ".+"\n/,
      '',
    );
    const abs = await writeCharter('no-safety.charter.md', withoutSafety);
    const errors = await validateCharterFile(abs, knownHeuristicSet());
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const issue = errors.find((e) => e.field === 'safety_constraints');
    expect(issue).toBeDefined();
  });
});

describe('validateCharterFile — environment === "prod"', () => {
  it('rejects safety_constraints.environment === "prod" and stderr names the field', async () => {
    const bad = VALID_CHARTER.replace('environment: local', 'environment: prod');
    const abs = await writeCharter('prod-env.charter.md', bad);
    const errors = await validateCharterFile(abs, knownHeuristicSet());
    const issue = errors.find((e) => e.field === 'safety_constraints.environment');
    expect(issue).toBeDefined();
    expect(issue?.message).toMatch(/must not be "prod"/);
  });
});

describe('validateCharterFile — unknown heuristic reference', () => {
  it('rejects a charter referencing a heuristic name without a _heuristics/<name>.md', async () => {
    const bad = VALID_CHARTER.replace('  - form-fuzz\n', '  - form-fuzz\n  - made-up-heuristic\n');
    const abs = await writeCharter('unknown-heuristic.charter.md', bad);
    const errors = await validateCharterFile(abs, knownHeuristicSet());
    const issue = errors.find(
      (e) => e.field === 'heuristics' && e.message.includes('made-up-heuristic'),
    );
    expect(issue).toBeDefined();
  });
});

describe('validateCharterFile — missing body section', () => {
  it('rejects a charter missing `## Mission`', async () => {
    const withoutMission =
      VALID_CHARTER_FRONT_MATTER + '\n## Heuristics\n\n- foo\n\n## Findings\n\n| id |\n';
    const abs = await writeCharter('no-mission.charter.md', withoutMission);
    const errors = await validateCharterFile(abs, knownHeuristicSet());
    const issue = errors.find((e) => e.field === 'Mission');
    expect(issue).toBeDefined();
  });

  it('rejects a charter missing `## Findings`', async () => {
    const withoutFindings =
      VALID_CHARTER_FRONT_MATTER +
      '\n## Mission\n\nMission.\n\n## Heuristics\n\n- boundary-values\n';
    const abs = await writeCharter('no-findings.charter.md', withoutFindings);
    const errors = await validateCharterFile(abs, knownHeuristicSet());
    const issue = errors.find((e) => e.field === 'Findings');
    expect(issue).toBeDefined();
  });
});

describe('validateCharterBody', () => {
  it('flags every missing required section', () => {
    const errs = validateCharterBody('## Notes\n\nonly notes here\n');
    const sections = new Set(errs.map((e) => e.section));
    expect(sections.has('Mission')).toBe(true);
    expect(sections.has('Heuristics')).toBe(true);
    expect(sections.has('Findings')).toBe(true);
  });
});

describe('validateCharterHeuristics', () => {
  it('returns an empty array when every name resolves', () => {
    const errs = validateCharterHeuristics(
      ['boundary-values', 'encoding-fuzz'],
      knownHeuristicSet(),
    );
    expect(errs).toEqual([]);
  });

  it('returns an error for each unknown name', () => {
    const errs = validateCharterHeuristics(
      ['boundary-values', 'unknown-one', 'unknown-two'],
      knownHeuristicSet(),
    );
    expect(errs.length).toBe(2);
    expect(errs.some((e) => e.name === 'unknown-one')).toBe(true);
    expect(errs.some((e) => e.name === 'unknown-two')).toBe(true);
  });
});

describe('runLint — dispatch and orchestration', () => {
  it('exits 0 when no plans and no charters are present (only heuristic library)', async () => {
    const code = await runLint({ plansRoot, chartersRoot });
    expect(code).toBe(0);
  });

  it('exits 0 when every plan and charter in the corpus is valid', async () => {
    await writeCharter('valid.charter.md', VALID_CHARTER);
    const code = await runLint({ plansRoot, chartersRoot });
    expect(code).toBe(0);
  });

  it('exits 1 when a charter omits safety_constraints', async () => {
    const withoutSafety = VALID_CHARTER.replace(
      /safety_constraints:[\s\S]*?required_reset: ".+"\n/,
      '',
    );
    await writeCharter('no-safety.charter.md', withoutSafety);
    const code = await runLint({ plansRoot, chartersRoot });
    expect(code).toBe(1);
  });

  it('exits 1 when a charter targets environment: prod', async () => {
    const bad = VALID_CHARTER.replace('environment: local', 'environment: prod');
    await writeCharter('prod-env.charter.md', bad);
    const code = await runLint({ plansRoot, chartersRoot });
    expect(code).toBe(1);
  });

  it('exits 1 when a charter references an unknown heuristic name', async () => {
    const bad = VALID_CHARTER.replace('  - form-fuzz\n', '  - form-fuzz\n  - made-up-heuristic\n');
    await writeCharter('unknown-heuristic.charter.md', bad);
    const code = await runLint({ plansRoot, chartersRoot });
    expect(code).toBe(1);
  });
});
