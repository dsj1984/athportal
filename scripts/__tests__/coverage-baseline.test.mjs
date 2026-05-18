// scripts/__tests__/coverage-baseline.test.mjs
//
// AC-pinning tests for the coverage-baseline ratchet (Task #215).
//
// These tests run under the repo's Vitest `scripts` project (declared
// in vitest.workspace.ts) so `pnpm run test` exercises them on every
// PR. They pin the script's parsing, rollup, tolerance, and envelope-
// build helpers without depending on the @repo/baselines harness
// (Story #210 lands the harness in a parallel wave). Once the harness
// merges and the script's dynamic import resolves, the same helpers
// continue to pass — the fallback path is byte-compatible with the
// harness contract.
//
// Three acceptance criteria from #215 are pinned here:
//   1. `--check` against the unprimed baseline exits 0 (operator must
//      prime via :update before the gate enforces).
//   2. `--update` writes a refreshed baselines/coverage.json with
//      current lines/branches/functions per workspace, byte-stable
//      across runs.
//   3. A synthetic -3pp drop in a workspace produces a violation
//      naming that workspace and the pp delta.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KERNEL_VERSION,
  SCHEMA_POINTER,
  TOLERANCE_PP,
  aggregateCoverageFinal,
  buildEnvelope,
  collectMeasurements,
  compareTolerance,
  discoverWorkspaces,
  formatRejectionMessage,
  parseArgs,
  rollupRows,
  serialise,
  workspaceForPath,
} from '../coverage-baseline.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCoverageFinal({
  statementsHit,
  statementsTotal,
  branchesHit,
  branchesTotal,
  functionsHit,
  functionsTotal,
}) {
  const entry = { s: {}, b: {}, f: {} };
  for (let i = 0; i < statementsTotal; i++) {
    entry.s[String(i)] = i < statementsHit ? 1 : 0;
  }
  // Branches are an object of arrays; pack the hit/total into a single group.
  entry.b['0'] = Array.from({ length: branchesTotal }, (_, i) => (i < branchesHit ? 1 : 0));
  for (let i = 0; i < functionsTotal; i++) {
    entry.f[String(i)] = i < functionsHit ? 1 : 0;
  }
  return entry;
}

function fixedDate() {
  return new Date('2026-05-17T00:00:00.000Z');
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('defaults to check mode', () => {
    expect(parseArgs(['node', 'script.mjs']).mode).toBe('check');
  });

  it('parses --check', () => {
    expect(parseArgs(['node', 'script.mjs', '--check']).mode).toBe('check');
  });

  it('parses --update', () => {
    expect(parseArgs(['node', 'script.mjs', '--update']).mode).toBe('update');
  });

  it('parses --help', () => {
    expect(parseArgs(['node', 'script.mjs', '--help']).mode).toBe('help');
  });

  it('parses --coverage-root=<dir>', () => {
    const { coverageRoot } = parseArgs(['node', 'script.mjs', '--coverage-root=/tmp/cov']);
    expect(coverageRoot).toBe('/tmp/cov');
  });
});

// ---------------------------------------------------------------------------
// aggregateCoverageFinal / computeFilePercentages
// ---------------------------------------------------------------------------

describe('aggregateCoverageFinal', () => {
  it('reports 100% on empty counter maps (no statements is treated as fully covered)', () => {
    const json = { '/abs/src/a.ts': { s: {}, b: {}, f: {} } };
    const rows = aggregateCoverageFinal(json);
    expect(rows).toEqual([{ path: '/abs/src/a.ts', lines: 100, branches: 100, functions: 100 }]);
  });

  it('computes percentages from hit / total counters', () => {
    const json = {
      '/abs/src/a.ts': makeCoverageFinal({
        statementsHit: 8,
        statementsTotal: 10,
        branchesHit: 1,
        branchesTotal: 4,
        functionsHit: 2,
        functionsTotal: 2,
      }),
    };
    const [row] = aggregateCoverageFinal(json);
    expect(row.path).toBe('/abs/src/a.ts');
    expect(row.lines).toBe(80);
    expect(row.branches).toBe(25);
    expect(row.functions).toBe(100);
  });

  it('skips non-object entries silently', () => {
    const json = { '/abs/a.ts': null, '/abs/b.ts': 'oops' };
    expect(aggregateCoverageFinal(json)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// rollupRows
// ---------------------------------------------------------------------------

describe('rollupRows', () => {
  it('returns zeros for an empty list', () => {
    expect(rollupRows([])).toEqual({ lines: 0, branches: 0, functions: 0 });
  });

  it('averages per-file percentages equally', () => {
    const rows = [
      { path: 'a.ts', lines: 100, branches: 50, functions: 100 },
      { path: 'b.ts', lines: 50, branches: 50, functions: 0 },
    ];
    expect(rollupRows(rows)).toEqual({ lines: 75, branches: 50, functions: 50 });
  });
});

// ---------------------------------------------------------------------------
// buildEnvelope (shape contract)
// ---------------------------------------------------------------------------

describe('buildEnvelope', () => {
  it('emits the $schema, kernelVersion, generatedAt, rollup, rows envelope', () => {
    const env = buildEnvelope(
      {
        workspaceRollups: { 'apps/api': { lines: 80, branches: 50, functions: 90 } },
        rows: [{ path: 'apps/api/src/a.ts', lines: 80, branches: 50, functions: 90 }],
      },
      fixedDate(),
    );
    expect(env.$schema).toBe(SCHEMA_POINTER);
    expect(env.kernelVersion).toBe(KERNEL_VERSION);
    expect(env.generatedAt).toBe('2026-05-17T00:00:00.000Z');
    expect(env.rollup['*']).toBeDefined();
    expect(env.rollup['apps/api']).toBeDefined();
    expect(env.rows).toHaveLength(1);
  });

  it('sorts rollup keys lexicographically (with * first)', () => {
    const env = buildEnvelope(
      {
        workspaceRollups: {
          'packages/shared': { lines: 50, branches: 50, functions: 50 },
          'apps/api': { lines: 80, branches: 80, functions: 80 },
        },
        rows: [],
      },
      fixedDate(),
    );
    // '*' < 'a' < 'p' lexicographically
    expect(Object.keys(env.rollup)).toEqual(['*', 'apps/api', 'packages/shared']);
  });

  it('sorts rows by path ascending', () => {
    const env = buildEnvelope(
      {
        workspaceRollups: {},
        rows: [
          { path: 'z.ts', lines: 0, branches: 0, functions: 0 },
          { path: 'a.ts', lines: 0, branches: 0, functions: 0 },
        ],
      },
      fixedDate(),
    );
    expect(env.rows.map((r) => r.path)).toEqual(['a.ts', 'z.ts']);
  });
});

// ---------------------------------------------------------------------------
// serialise (byte-stable)
// ---------------------------------------------------------------------------

describe('serialise', () => {
  it('produces byte-identical output for the same envelope on repeated calls', () => {
    const env = buildEnvelope(
      {
        workspaceRollups: { 'apps/api': { lines: 80, branches: 50, functions: 90 } },
        rows: [{ path: 'apps/api/src/a.ts', lines: 80, branches: 50, functions: 90 }],
      },
      fixedDate(),
    );
    expect(serialise(env)).toBe(serialise(env));
  });

  it('emits sorted keys at every depth', () => {
    const env = {
      $schema: 'x',
      kernelVersion: '1.0.0',
      generatedAt: '2026-05-17T00:00:00.000Z',
      rollup: {
        '*': { lines: 0, branches: 0, functions: 0 },
        'apps/api': { lines: 80, branches: 50, functions: 90 },
      },
      rows: [],
    };
    const out = serialise(env);
    // Top-level: $schema before generatedAt before kernelVersion before rollup before rows
    const topOrder = ['"$schema"', '"generatedAt"', '"kernelVersion"', '"rollup"', '"rows"'];
    let cursor = 0;
    for (const needle of topOrder) {
      const pos = out.indexOf(needle, cursor);
      expect(pos).toBeGreaterThan(cursor);
      cursor = pos;
    }
    // Inside each rollup value: branches before functions before lines
    expect(out.indexOf('"branches"')).toBeLessThan(out.indexOf('"functions"'));
    expect(out.indexOf('"functions"')).toBeLessThan(out.indexOf('"lines"'));
  });

  it('ends with a trailing newline', () => {
    const env = buildEnvelope({ workspaceRollups: {}, rows: [] }, fixedDate());
    expect(serialise(env).endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// compareTolerance (ADR-015 -2pp floor)
// ---------------------------------------------------------------------------

describe('compareTolerance', () => {
  function envelopeWith(rollup) {
    return {
      $schema: SCHEMA_POINTER,
      kernelVersion: KERNEL_VERSION,
      generatedAt: '2026-05-17T00:00:00.000Z',
      rollup: { '*': { lines: 0, branches: 0, functions: 0 }, ...rollup },
      rows: [],
    };
  }

  it('returns no violations when current matches baseline', () => {
    const baseline = envelopeWith({ 'apps/api': { lines: 80, branches: 60, functions: 90 } });
    const current = envelopeWith({ 'apps/api': { lines: 80, branches: 60, functions: 90 } });
    expect(compareTolerance(baseline, current)).toEqual([]);
  });

  it('allows a 1pp drop (within tolerance)', () => {
    const baseline = envelopeWith({ 'apps/api': { lines: 80, branches: 60, functions: 90 } });
    const current = envelopeWith({ 'apps/api': { lines: 79, branches: 60, functions: 90 } });
    expect(compareTolerance(baseline, current)).toEqual([]);
  });

  it('allows a 2pp drop (exactly at tolerance)', () => {
    const baseline = envelopeWith({ 'apps/api': { lines: 80, branches: 60, functions: 90 } });
    const current = envelopeWith({ 'apps/api': { lines: 78, branches: 60, functions: 90 } });
    expect(compareTolerance(baseline, current)).toEqual([]);
  });

  it('flags a 3pp drop on the lines axis (the synthetic AC case)', () => {
    const baseline = envelopeWith({ 'apps/api': { lines: 80, branches: 60, functions: 90 } });
    const current = envelopeWith({ 'apps/api': { lines: 77, branches: 60, functions: 90 } });
    const violations = compareTolerance(baseline, current);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      workspace: 'apps/api',
      axis: 'lines',
      prev: 80,
      current: 77,
      deltaPp: -3,
    });
  });

  it('reports violations per (workspace, axis) — every axis is independent', () => {
    const baseline = envelopeWith({
      'apps/api': { lines: 80, branches: 60, functions: 90 },
      'packages/shared': { lines: 70, branches: 70, functions: 70 },
    });
    const current = envelopeWith({
      'apps/api': { lines: 77, branches: 50, functions: 90 }, // lines -3, branches -10
      'packages/shared': { lines: 70, branches: 70, functions: 70 }, // unchanged
    });
    const violations = compareTolerance(baseline, current);
    const keys = violations.map((v) => `${v.workspace}/${v.axis}`).sort();
    expect(keys).toEqual(['apps/api/branches', 'apps/api/lines']);
  });

  it('ignores the * (whole-repo) rollup — gate is per-workspace per ADR-015', () => {
    const baseline = envelopeWith({});
    // Mutate the * rollup to a -50pp drop; gate should still pass.
    baseline.rollup['*'] = { lines: 100, branches: 100, functions: 100 };
    const current = envelopeWith({});
    current.rollup['*'] = { lines: 50, branches: 50, functions: 50 };
    expect(compareTolerance(baseline, current)).toEqual([]);
  });

  it('treats a newly-registered workspace as a pass (no prior to compare against)', () => {
    const baseline = envelopeWith({ 'apps/api': { lines: 80, branches: 60, functions: 90 } });
    const current = envelopeWith({
      'apps/api': { lines: 80, branches: 60, functions: 90 },
      'apps/web': { lines: 0, branches: 0, functions: 0 },
    });
    expect(compareTolerance(baseline, current)).toEqual([]);
  });

  it('honours TOLERANCE_PP from the script', () => {
    // The exported constant pins the ADR-015 -2pp policy. If someone
    // edits it, every consuming test breaks until docs and ADR move
    // together.
    expect(TOLERANCE_PP).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// formatRejectionMessage
// ---------------------------------------------------------------------------

describe('formatRejectionMessage', () => {
  it('names the workspace, the axis, and the pp delta', () => {
    const msg = formatRejectionMessage([
      { workspace: 'apps/api', axis: 'lines', prev: 80, current: 77, deltaPp: -3 },
    ]);
    expect(msg).toMatch(/apps\/api/);
    expect(msg).toMatch(/lines/);
    expect(msg).toMatch(/80\.00/);
    expect(msg).toMatch(/77\.00/);
    expect(msg).toMatch(/-3\.00pp/);
  });

  it('mentions ADR-015 and the operator remediation', () => {
    const msg = formatRejectionMessage([
      { workspace: 'apps/api', axis: 'lines', prev: 80, current: 77, deltaPp: -3 },
    ]);
    expect(msg).toMatch(/ADR-015/);
    expect(msg).toMatch(/coverage:update/);
  });
});

// ---------------------------------------------------------------------------
// Shipped baselines/coverage.json (primed under Story #384)
// ---------------------------------------------------------------------------

describe('shipped baselines/coverage.json', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..');
  const baselinePath = path.join(repoRoot, 'baselines', 'coverage.json');

  it('exists and parses as JSON', () => {
    const raw = fs.readFileSync(baselinePath, 'utf8');
    const doc = JSON.parse(raw);
    expect(doc.$schema).toBe(SCHEMA_POINTER);
    expect(doc.kernelVersion).toBe(KERNEL_VERSION);
  });

  it('carries the envelope shape (rollup."*" with three required axes, rows array)', () => {
    const doc = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    expect(doc.rollup).toBeDefined();
    expect(doc.rollup['*']).toBeDefined();
    for (const axis of ['lines', 'branches', 'functions']) {
      expect(doc.rollup['*']).toHaveProperty(axis);
      expect(typeof doc.rollup['*'][axis]).toBe('number');
    }
    expect(Array.isArray(doc.rows)).toBe(true);
  });

  it('is primed (rollup."*" has non-zero coverage on every axis)', () => {
    const doc = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    expect(doc.rollup['*'].lines).toBeGreaterThan(0);
    expect(doc.rollup['*'].branches).toBeGreaterThan(0);
    expect(doc.rollup['*'].functions).toBeGreaterThan(0);
  });

  it('carries per-workspace rollups for every workspace under apps/* and packages/*', () => {
    const doc = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    for (const ws of discoverWorkspaces(repoRoot)) {
      expect(doc.rollup, `missing rollup for ${ws}`).toHaveProperty(ws);
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end: discoverWorkspaces against a synthetic tree
// ---------------------------------------------------------------------------

describe('discoverWorkspaces', () => {
  it('finds workspaces under apps/* and packages/*', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-baseline-'));
    try {
      // apps/<x> needs package.json so discoverWorkspaces() finds it.
      const wsDir = path.join(root, 'apps', 'fake');
      fs.mkdirSync(path.join(wsDir, 'coverage'), { recursive: true });
      fs.writeFileSync(path.join(wsDir, 'package.json'), '{"name":"@repo/fake"}');

      const pkgDir = path.join(root, 'packages', 'fake-pkg');
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"@repo/fake-pkg"}');

      // A directory without package.json is skipped.
      fs.mkdirSync(path.join(root, 'apps', 'bare'), { recursive: true });

      expect(discoverWorkspaces(root)).toEqual(['apps/fake', 'packages/fake-pkg']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns empty when apps/ and packages/ are absent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-baseline-empty-'));
    try {
      expect(discoverWorkspaces(root)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// workspaceForPath (path → workspace partition — Story #384)
// ---------------------------------------------------------------------------

describe('workspaceForPath', () => {
  const repoRoot = '/r';
  const workspaces = ['apps/api', 'apps/web', 'packages/shared'];

  it('matches an absolute path inside a workspace', () => {
    expect(workspaceForPath('/r/apps/api/src/x.ts', workspaces, repoRoot)).toBe('apps/api');
    expect(workspaceForPath('/r/packages/shared/src/y.ts', workspaces, repoRoot)).toBe(
      'packages/shared',
    );
  });

  it('returns null for paths outside any declared workspace', () => {
    expect(workspaceForPath('/r/scripts/foo.mjs', workspaces, repoRoot)).toBe(null);
    expect(workspaceForPath('/r/tests/features/a.feature', workspaces, repoRoot)).toBe(null);
  });

  it('does not match a sibling whose name is a prefix-only substring of the path', () => {
    // "apps/apifoo" must not match the "apps/api" workspace.
    expect(workspaceForPath('/r/apps/apifoo/src/x.ts', workspaces, repoRoot)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// collectMeasurements (producer/consumer alignment — Story #384)
// ---------------------------------------------------------------------------

describe('collectMeasurements — merged root coverage (Option B)', () => {
  // Build a synthetic repo with apps/api and packages/shared workspaces
  // plus a root-level coverage/coverage-final.json that carries rows for
  // both workspaces and one path outside any workspace.
  function buildSyntheticRepo() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-merged-'));
    for (const ws of ['apps/api', 'packages/shared']) {
      fs.mkdirSync(path.join(root, ws), { recursive: true });
      fs.writeFileSync(path.join(root, ws, 'package.json'), `{"name":"@repo/${ws}"}`);
    }
    fs.mkdirSync(path.join(root, 'coverage'), { recursive: true });
    // 80% lines in apps/api, 50% lines in packages/shared, plus an
    // out-of-workspace path that must be dropped.
    const merged = {
      [path.join(root, 'apps/api/src/a.ts')]: makeCoverageFinal({
        statementsHit: 8,
        statementsTotal: 10,
        branchesHit: 2,
        branchesTotal: 4,
        functionsHit: 1,
        functionsTotal: 1,
      }),
      [path.join(root, 'packages/shared/src/b.ts')]: makeCoverageFinal({
        statementsHit: 5,
        statementsTotal: 10,
        branchesHit: 2,
        branchesTotal: 4,
        functionsHit: 1,
        functionsTotal: 2,
      }),
      [path.join(root, 'scripts/orphan.mjs')]: makeCoverageFinal({
        statementsHit: 0,
        statementsTotal: 10,
        branchesHit: 0,
        branchesTotal: 0,
        functionsHit: 0,
        functionsTotal: 1,
      }),
    };
    fs.writeFileSync(path.join(root, 'coverage', 'coverage-final.json'), JSON.stringify(merged));
    return root;
  }

  it('partitions a single root coverage-final.json by workspace prefix', () => {
    const root = buildSyntheticRepo();
    try {
      const { workspaceRollups, rows } = collectMeasurements({ repoRoot: root });
      expect(workspaceRollups['apps/api']).toEqual({ lines: 80, branches: 50, functions: 100 });
      expect(workspaceRollups['packages/shared']).toEqual({
        lines: 50,
        branches: 50,
        functions: 50,
      });
      // Rows include only paths inside a declared workspace, normalised
      // to repo-relative POSIX. The scripts/ orphan is dropped.
      const paths = rows.map((r) => r.path).sort();
      expect(paths).toEqual(['apps/api/src/a.ts', 'packages/shared/src/b.ts']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to per-workspace files when the root coverage is absent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-fallback-'));
    try {
      const ws = 'apps/api';
      const wsDir = path.join(root, ws);
      fs.mkdirSync(path.join(wsDir, 'coverage'), { recursive: true });
      fs.writeFileSync(path.join(wsDir, 'package.json'), `{"name":"@repo/${ws}"}`);
      const perWs = {
        [path.join(wsDir, 'src/a.ts')]: makeCoverageFinal({
          statementsHit: 7,
          statementsTotal: 10,
          branchesHit: 0,
          branchesTotal: 0,
          functionsHit: 1,
          functionsTotal: 1,
        }),
      };
      fs.writeFileSync(path.join(wsDir, 'coverage', 'coverage-final.json'), JSON.stringify(perWs));

      const { workspaceRollups } = collectMeasurements({ repoRoot: root });
      expect(workspaceRollups[ws]).toEqual({ lines: 70, branches: 100, functions: 100 });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports zero rollups for workspaces absent from the merged coverage', () => {
    // packages/shared exists in the synthetic repo but has no rows in
    // the merged coverage — it should rollup as zero (still primed,
    // separate from the unprimed-baseline guard).
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-partial-'));
    try {
      for (const ws of ['apps/api', 'packages/shared']) {
        fs.mkdirSync(path.join(root, ws), { recursive: true });
        fs.writeFileSync(path.join(root, ws, 'package.json'), `{"name":"@repo/${ws}"}`);
      }
      fs.mkdirSync(path.join(root, 'coverage'), { recursive: true });
      const merged = {
        [path.join(root, 'apps/api/src/a.ts')]: makeCoverageFinal({
          statementsHit: 10,
          statementsTotal: 10,
          branchesHit: 0,
          branchesTotal: 0,
          functionsHit: 1,
          functionsTotal: 1,
        }),
      };
      fs.writeFileSync(path.join(root, 'coverage', 'coverage-final.json'), JSON.stringify(merged));
      const { workspaceRollups } = collectMeasurements({ repoRoot: root });
      expect(workspaceRollups['apps/api']).toEqual({ lines: 100, branches: 100, functions: 100 });
      expect(workspaceRollups['packages/shared']).toEqual({
        lines: 0,
        branches: 0,
        functions: 0,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
