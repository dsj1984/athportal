// scripts/qa/__tests__/index.test.ts
//
// Unit tests for the QA-corpus indexer (`scripts/qa/index.mjs`). We
// drive `runIndex` against on-disk fixture trees so the lexical sort,
// the deterministic serialization, and the `--check` drift detection
// are all exercised without depending on the live corpus.
//
// Scripted Test Plans (`tests/plans/**`) were retired from the corpus,
// so the indexer catalogs `.charter.md` artifacts only and these tests
// exercise the charter projection exclusively.

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildIndex,
  projectCharterEntry,
  runIndex,
  serializeIndex,
  toRepoRelative,
} from '../index.mjs';

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
let chartersRoot: string;
let indexPath: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'index-qa-'));
  chartersRoot = path.join(tmpDir, 'tests', 'charters');
  indexPath = path.join(tmpDir, 'tests', 'qa-index.json');
  await mkdir(chartersRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('runIndex (write mode)', () => {
  it('emits an empty array when the corpus is empty', async () => {
    const code = await runIndex({
      chartersRoot,
      indexPath,
      repoRoot: tmpDir,
    });
    expect(code).toBe(0);
    const written = await readFile(indexPath, 'utf8');
    expect(written).toBe('[]\n');
  });

  it('writes a deterministic catalog sorted by id', async () => {
    // Arrange — drop two charters on disk, deliberately in
    // non-alphabetical insert order so the sort can be observed.
    const orgAdminDir = path.join(chartersRoot, 'org-admin');
    await mkdir(orgAdminDir, { recursive: true });
    await writeFile(
      path.join(orgAdminDir, 'ec-zebra.charter.md'),
      CHARTER_FRONT_MATTER('ec-zebra'),
      'utf8',
    );
    await writeFile(
      path.join(orgAdminDir, 'ec-alpha.charter.md'),
      CHARTER_FRONT_MATTER('ec-alpha'),
      'utf8',
    );

    // Act
    const code = await runIndex({
      chartersRoot,
      indexPath,
      repoRoot: tmpDir,
    });

    // Assert — exit code, file present, lexical id order.
    expect(code).toBe(0);
    const raw = await readFile(indexPath, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(raw) as Array<{ id: string; type: string; path: string }>;
    expect(parsed.map((entry) => entry.id)).toEqual(['ec-alpha', 'ec-zebra']);
    expect(parsed.find((entry) => entry.id === 'ec-alpha')?.type).toBe('charter');
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

    const { entries } = await buildIndex({ chartersRoot, repoRoot: tmpDir });
    expect(entries.map((entry) => entry.id)).toEqual(['ec-real']);
  });
});

describe('runIndex --check', () => {
  it('passes when the on-disk index matches the corpus', async () => {
    const orgAdminDir = path.join(chartersRoot, 'org-admin');
    await mkdir(orgAdminDir, { recursive: true });
    await writeFile(
      path.join(orgAdminDir, 'ec-alpha.charter.md'),
      CHARTER_FRONT_MATTER('ec-alpha'),
      'utf8',
    );

    // Generate the index first.
    await runIndex({ chartersRoot, indexPath, repoRoot: tmpDir });

    // Then --check should succeed.
    const code = await runIndex({
      chartersRoot,
      indexPath,
      repoRoot: tmpDir,
      check: true,
    });
    expect(code).toBe(0);
  });

  it('fails when the on-disk index is missing', async () => {
    const code = await runIndex({
      chartersRoot,
      indexPath,
      repoRoot: tmpDir,
      check: true,
    });
    expect(code).toBe(1);
  });

  it('fails when the on-disk index drifts from the corpus', async () => {
    const orgAdminDir = path.join(chartersRoot, 'org-admin');
    await mkdir(orgAdminDir, { recursive: true });
    await writeFile(
      path.join(orgAdminDir, 'ec-alpha.charter.md'),
      CHARTER_FRONT_MATTER('ec-alpha'),
      'utf8',
    );
    await runIndex({ chartersRoot, indexPath, repoRoot: tmpDir });

    // Mutate the on-disk index so a drift is guaranteed.
    await writeFile(indexPath, '[]\n', 'utf8');

    const code = await runIndex({
      chartersRoot,
      indexPath,
      repoRoot: tmpDir,
      check: true,
    });
    expect(code).toBe(1);
  });
});

describe('parseArtifact projection helpers', () => {
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

  it('returns errors when required charter fields are missing', () => {
    const result = projectCharterEntry({ type: 'charter' }, '/repo/x.charter.md', '/repo');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain('missing id');
    expect(result.errors).toContain('missing domain');
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
    const result = toRepoRelative('/repo/tests/charters/org-admin/ec-bar.charter.md', '/repo');
    expect(result).toBe('tests/charters/org-admin/ec-bar.charter.md');
  });
});
