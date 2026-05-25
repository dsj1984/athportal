// scripts/qa/__tests__/coverage.test.ts
//
// Unit tests for the QA-corpus coverage reporter
// (`scripts/qa/coverage.mjs`). The tests drive `runCoverage` against
// in-memory index fixtures so the grid renderer, the gap computation,
// and the `--report` mode are all exercised without touching the live
// catalog.

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildReport,
  computeGaps,
  countByDomain,
  loadIndex,
  renderGrid,
  runCoverage,
  serializeReport,
} from '../coverage.mjs';
import { COVERAGE_FLOORS } from '../schema/coverage-floors.ts';

type IndexEntry = {
  id: string;
  path: string;
  type: 'plan' | 'charter';
  domain: string;
};

const ZERO_FLOORS = {
  marketing: { plans: 0, charters: 0 },
  'public-discovery': { plans: 0, charters: 0 },
  identity: { plans: 0, charters: 0 },
  'athlete-dashboard': { plans: 0, charters: 0 },
  'coach-dashboard': { plans: 0, charters: 0 },
  'org-admin': { plans: 0, charters: 0 },
  settings: { plans: 0, charters: 0 },
  'design-system': { plans: 0, charters: 0 },
  mobile: { plans: 0, charters: 0 },
};

let tmpDir: string;
let indexPath: string;
let reportPath: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'coverage-qa-'));
  indexPath = path.join(tmpDir, 'tests', 'qa-index.json');
  reportPath = path.join(tmpDir, 'coverage', 'qa-coverage.json');
  await mkdir(path.dirname(indexPath), { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeIndex(entries: IndexEntry[]) {
  await writeFile(indexPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

describe('countByDomain', () => {
  it('returns zeroed totals when the index is empty', () => {
    const totals = countByDomain([]);
    expect(totals.identity).toEqual({ plans: 0, charters: 0 });
    expect(totals['org-admin']).toEqual({ plans: 0, charters: 0 });
  });

  it('aggregates plans and charters by domain', () => {
    const totals = countByDomain([
      { id: 'tp-a', path: 'p1', type: 'plan', domain: 'identity' } as IndexEntry,
      { id: 'tp-b', path: 'p2', type: 'plan', domain: 'identity' } as IndexEntry,
      { id: 'ec-a', path: 'c1', type: 'charter', domain: 'org-admin' } as IndexEntry,
      { id: 'tp-c', path: 'p3', type: 'plan', domain: 'design-system' } as IndexEntry,
    ]);
    expect(totals.identity).toEqual({ plans: 2, charters: 0 });
    expect(totals['org-admin']).toEqual({ plans: 0, charters: 1 });
    expect(totals['design-system']).toEqual({ plans: 1, charters: 0 });
  });
});

describe('computeGaps', () => {
  it('returns no gaps when actual >= floor', () => {
    const actual = {
      ...ZERO_FLOORS,
      identity: { plans: 10, charters: 1 },
      'org-admin': { plans: 6, charters: 2 },
      'design-system': { plans: 1, charters: 0 },
    };
    const gaps = computeGaps(actual, COVERAGE_FLOORS);
    expect(gaps).toEqual([]);
  });

  it('returns gap rows for each unmet floor', () => {
    const actual = {
      ...ZERO_FLOORS,
      identity: { plans: 1, charters: 1 },
      'org-admin': { plans: 0, charters: 1 },
    };
    const gaps = computeGaps(actual, COVERAGE_FLOORS);
    expect(gaps).toContainEqual({ domain: 'identity', kind: 'plan', need: 10, have: 1 });
    expect(gaps).toContainEqual({ domain: 'org-admin', kind: 'plan', need: 6, have: 0 });
    expect(gaps).toContainEqual({ domain: 'org-admin', kind: 'charter', need: 2, have: 1 });
    expect(gaps).toContainEqual({ domain: 'design-system', kind: 'plan', need: 1, have: 0 });
  });
});

describe('buildReport', () => {
  it('clones the floors so callers cannot mutate the SSOT', () => {
    const report = buildReport([], { floors: COVERAGE_FLOORS });
    report.floors.identity.plans = 999;
    expect(COVERAGE_FLOORS.identity.plans).toBe(10);
  });
});

describe('runCoverage (default mode)', () => {
  it('exits 0 even when gaps exist', async () => {
    await writeIndex([]);
    const code = await runCoverage({ indexPath, reportPath });
    expect(code).toBe(0);
  });

  it('throws a clear error when the index file is missing', async () => {
    await expect(runCoverage({ indexPath, reportPath })).rejects.toThrow(/not found/);
  });
});

describe('runCoverage --report', () => {
  it('writes coverage/qa-coverage.json and exits 1 on gaps', async () => {
    // Index with only the existing identity plan; the floor needs 10 → gap.
    await writeIndex([{ id: 'tp-a', path: 'p1', type: 'plan', domain: 'identity' }]);
    const code = await runCoverage({ indexPath, reportPath, report: true });
    expect(code).toBe(1);
    const raw = await readFile(reportPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.gaps.length).toBeGreaterThan(0);
    expect(parsed.floors.identity).toEqual({ plans: 10, charters: 1 });
    expect(parsed.actual.identity).toEqual({ plans: 1, charters: 0 });
  });

  it('exits 0 in report mode when every floor is met', async () => {
    // Inject a zero-floor table so an empty corpus passes.
    await writeIndex([]);
    const code = await runCoverage({
      indexPath,
      reportPath,
      report: true,
      floors: ZERO_FLOORS,
    });
    expect(code).toBe(0);
    const raw = await readFile(reportPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.gaps).toEqual([]);
  });
});

describe('renderGrid', () => {
  it('renders one row per declared domain', () => {
    const report = buildReport([], { floors: COVERAGE_FLOORS });
    const grid = renderGrid(report);
    expect(grid).toMatch(/identity/);
    expect(grid).toMatch(/org-admin/);
    expect(grid).toMatch(/design-system/);
    // The header row is present.
    expect(grid).toMatch(/^domain/);
  });

  it('marks domains with gaps using "GAP" in the status column', () => {
    const report = buildReport([], { floors: COVERAGE_FLOORS });
    const grid = renderGrid(report);
    expect(grid).toMatch(/GAP/);
  });
});

describe('loadIndex', () => {
  it('returns the parsed array on a valid file', async () => {
    await writeIndex([{ id: 'tp-x', path: 'p', type: 'plan', domain: 'identity' }]);
    const entries = await loadIndex(indexPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('tp-x');
  });

  it('throws when the index file is missing', async () => {
    await expect(loadIndex(indexPath)).rejects.toThrow(/not found/);
  });

  it('throws when the file is not a JSON array', async () => {
    await writeFile(indexPath, '{"oops": true}\n', 'utf8');
    await expect(loadIndex(indexPath)).rejects.toThrow(/expected an array/);
  });
});

describe('serializeReport', () => {
  it('emits a stable, newline-terminated JSON string', () => {
    const report = buildReport([], { floors: ZERO_FLOORS });
    const serialized = serializeReport(report);
    expect(serialized.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(serialized)).not.toThrow();
  });
});
