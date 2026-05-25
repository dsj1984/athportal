// scripts/qa/__tests__/index.test.ts
//
// Unit tests for the QA-corpus indexer (`scripts/qa/index.mjs`). We
// drive `runIndex` against on-disk fixture trees so the lexical sort,
// the deterministic serialization, and the `--check` drift detection
// are all exercised without depending on the live corpus.

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildIndex,
  projectCharterEntry,
  projectPlanEntry,
  runIndex,
  serializeIndex,
  toRepoRelative,
} from '../index.mjs';

const PLAN_FRONT_MATTER = (id: string, domain = 'identity') => `---
id: ${id}
type: plan
title: ${id}
domain: ${domain}
persona: athlete
surface: web
route_prefixes:
  - /sign-up
est_minutes: 5
---

## Setup
- noop

## Steps
1. step one.
   **Expected:** ok.

## Cleanup
- noop
`;

const CHARTER_FRONT_MATTER = (id: string, domain = 'org-admin') => `---
id: ${id}
type: charter
title: ${id}
domain: ${domain}
persona: org-admin
route_prefixes:
  - /admin
mission: Find ways the surface accepts bad data.
heuristics:
  - boundary-values
time_box_minutes: 15
safety_constraints:
  environment: local
  mutation_surface:
    - "noop_table"
  required_reset: "pnpm reset"
---

## Mission
test

## Heuristics
- boundary-values

## Findings
| id | title | severity | repro | suggested-promotion |
| --- | --- | --- | --- | --- |
`;

let tmpDir: string;
let plansRoot: string;
let chartersRoot: string;
let indexPath: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'index-qa-'));
  plansRoot = path.join(tmpDir, 'tests', 'plans');
  chartersRoot = path.join(tmpDir, 'tests', 'charters');
  indexPath = path.join(tmpDir, 'tests', 'qa-index.json');
  await mkdir(plansRoot, { recursive: true });
  await mkdir(chartersRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('runIndex (write mode)', () => {
  it('emits an empty array when the corpus is empty', async () => {
    const code = await runIndex({
      plansRoot,
      chartersRoot,
      indexPath,
      repoRoot: tmpDir,
    });
    expect(code).toBe(0);
    const written = await readFile(indexPath, 'utf8');
    expect(written).toBe('[]\n');
  });

  it('writes a deterministic catalog sorted by id', async () => {
    // Arrange — drop two plans and one charter on disk, deliberately in
    // non-alphabetical insert order so the sort can be observed.
    const identityDir = path.join(plansRoot, 'identity');
    const orgAdminDir = path.join(chartersRoot, 'org-admin');
    await mkdir(identityDir, { recursive: true });
    await mkdir(orgAdminDir, { recursive: true });
    await writeFile(
      path.join(identityDir, 'tp-zebra.plan.md'),
      PLAN_FRONT_MATTER('tp-zebra'),
      'utf8',
    );
    await writeFile(
      path.join(identityDir, 'tp-alpha.plan.md'),
      PLAN_FRONT_MATTER('tp-alpha'),
      'utf8',
    );
    await writeFile(
      path.join(orgAdminDir, 'ec-omega.charter.md'),
      CHARTER_FRONT_MATTER('ec-omega'),
      'utf8',
    );

    // Act
    const code = await runIndex({
      plansRoot,
      chartersRoot,
      indexPath,
      repoRoot: tmpDir,
    });

    // Assert — exit code, file present, lexical id order.
    expect(code).toBe(0);
    const raw = await readFile(indexPath, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(raw) as Array<{ id: string; type: string; path: string }>;
    expect(parsed.map((entry) => entry.id)).toEqual(['ec-omega', 'tp-alpha', 'tp-zebra']);
    expect(parsed.find((entry) => entry.id === 'tp-alpha')?.type).toBe('plan');
    expect(parsed.find((entry) => entry.id === 'ec-omega')?.type).toBe('charter');
    // Paths are repo-relative POSIX.
    expect(parsed[0]?.path.includes('\\')).toBe(false);
  });

  it('skips the _heuristics directory under charters', async () => {
    const orgAdminDir = path.join(chartersRoot, 'org-admin');
    const heuristicsDir = path.join(chartersRoot, '_heuristics');
    await mkdir(orgAdminDir, { recursive: true });
    await mkdir(heuristicsDir, { recursive: true });
    await writeFile(
      path.join(orgAdminDir, 'ec-real.charter.md'),
      CHARTER_FRONT_MATTER('ec-real'),
      'utf8',
    );
    // A `.md` reference card that, if traversed, would lack the
    // `.charter.md` suffix and be ignored — but the directory guard
    // ensures we never recurse here in the first place.
    await writeFile(
      path.join(heuristicsDir, 'boundary-values.md'),
      '# Boundary values heuristic\n',
      'utf8',
    );

    const { entries } = await buildIndex({ plansRoot, chartersRoot, repoRoot: tmpDir });
    expect(entries.map((entry) => entry.id)).toEqual(['ec-real']);
  });
});

describe('runIndex --check', () => {
  it('passes when the on-disk index matches the corpus', async () => {
    const identityDir = path.join(plansRoot, 'identity');
    await mkdir(identityDir, { recursive: true });
    await writeFile(
      path.join(identityDir, 'tp-alpha.plan.md'),
      PLAN_FRONT_MATTER('tp-alpha'),
      'utf8',
    );

    // Generate the index first.
    await runIndex({ plansRoot, chartersRoot, indexPath, repoRoot: tmpDir });

    // Then --check should succeed.
    const code = await runIndex({
      plansRoot,
      chartersRoot,
      indexPath,
      repoRoot: tmpDir,
      check: true,
    });
    expect(code).toBe(0);
  });

  it('fails when the on-disk index is missing', async () => {
    const code = await runIndex({
      plansRoot,
      chartersRoot,
      indexPath,
      repoRoot: tmpDir,
      check: true,
    });
    expect(code).toBe(1);
  });

  it('fails when the on-disk index drifts from the corpus', async () => {
    const identityDir = path.join(plansRoot, 'identity');
    await mkdir(identityDir, { recursive: true });
    await writeFile(
      path.join(identityDir, 'tp-alpha.plan.md'),
      PLAN_FRONT_MATTER('tp-alpha'),
      'utf8',
    );
    await runIndex({ plansRoot, chartersRoot, indexPath, repoRoot: tmpDir });

    // Mutate the on-disk index so a drift is guaranteed.
    await writeFile(indexPath, '[]\n', 'utf8');

    const code = await runIndex({
      plansRoot,
      chartersRoot,
      indexPath,
      repoRoot: tmpDir,
      check: true,
    });
    expect(code).toBe(1);
  });
});

describe('parseArtifact projection helpers', () => {
  it('projects a valid plan into the canonical shape', () => {
    const result = projectPlanEntry(
      {
        id: 'tp-foo',
        type: 'plan',
        title: 'Foo',
        domain: 'identity',
        persona: 'athlete',
        surface: 'web',
        route_prefixes: ['/sign-up'],
        est_minutes: 6,
      },
      '/repo/tests/plans/identity/tp-foo.plan.md',
      '/repo',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry).toEqual({
      id: 'tp-foo',
      path: 'tests/plans/identity/tp-foo.plan.md',
      type: 'plan',
      domain: 'identity',
      persona: 'athlete',
      surface: 'web',
      route_prefixes: ['/sign-up'],
      est_minutes: 6,
    });
  });

  it('returns errors when required plan fields are missing', () => {
    const result = projectPlanEntry({ type: 'plan' }, '/repo/x.plan.md', '/repo');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain('missing id');
    expect(result.errors).toContain('missing domain');
  });

  it('projects a valid charter into the canonical shape', () => {
    const result = projectCharterEntry(
      {
        id: 'ec-bar',
        type: 'charter',
        title: 'Bar',
        domain: 'org-admin',
        persona: 'org-admin',
        route_prefixes: ['/admin'],
        mission: 'mission text',
        time_box_minutes: 20,
      },
      '/repo/tests/charters/org-admin/ec-bar.charter.md',
      '/repo',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry).toEqual({
      id: 'ec-bar',
      path: 'tests/charters/org-admin/ec-bar.charter.md',
      type: 'charter',
      domain: 'org-admin',
      persona: 'org-admin',
      route_prefixes: ['/admin'],
      mission: 'mission text',
      time_box_minutes: 20,
    });
  });
});

describe('serializeIndex', () => {
  it('writes a trailing newline so the file is POSIX-friendly', () => {
    const out = serializeIndex([]);
    expect(out).toBe('[]\n');
  });
});

describe('toRepoRelative', () => {
  it('normalizes backslashes to forward slashes', () => {
    const result = toRepoRelative('/repo/tests/plans/identity/tp-foo.plan.md', '/repo');
    expect(result).toBe('tests/plans/identity/tp-foo.plan.md');
  });
});
