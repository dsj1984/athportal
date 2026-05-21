// scripts/__tests__/mutation-baseline.test.mjs
//
// AC-pinning tests for the mutation-baseline ratchet (Task #219).
//
// Story #208 acceptance:
//   1. Script reads Stryker's report path (configurable via
//      --report-path) and refuses to run if the report is missing.
//   2. Per-workspace tolerance check fails on a synthetic -6% score
//      drop in one workspace.
//
// These tests pin the script's parsing, aggregation, rollup, envelope,
// and tolerance helpers. They do NOT exercise modeCheck/modeUpdate end-
// to-end — those require the `@repo/baselines` harness which is unit-
// tested in its own package. The shipped baselines/mutation.json
// envelope contract is pinned at the bottom of this file via the
// shared scripts/__tests__/baseline-stubs.test.mjs harness import.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BASELINE_PATH,
  DEFAULT_REPORT_PATH,
  KERNEL_VERSION,
  REPO_ROOT,
  SCHEMA_POINTER,
  TOLERANCE_PCT,
  aggregateReport,
  buildEnvelope,
  compareWorkspaceRollups,
  computeScore,
  discoverWorkspaces,
  formatWorkspaceViolations,
  loadReport,
  parseArgs,
  rollupAll,
  rollupRowsByWorkspace,
} from '../mutation-baseline.mjs';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function fixedDate() {
  return new Date('2026-05-17T00:00:00.000Z');
}

function strykerReport(files) {
  return {
    schemaVersion: '3',
    thresholds: { high: 80, low: 60 },
    projectRoot: '/repo',
    files,
  };
}

function mutant(status) {
  return { status, id: '0', mutatorName: 'BlockStatement', replacement: '{}', location: {} };
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

  it('parses --report-path=<path> (equals form)', () => {
    const { reportPath } = parseArgs(['node', 'script.mjs', '--report-path=/tmp/m.json']);
    expect(reportPath).toBe('/tmp/m.json');
  });

  it('parses --report-path <path> (spaced form)', () => {
    const { reportPath } = parseArgs(['node', 'script.mjs', '--report-path', '/tmp/m.json']);
    expect(reportPath).toBe('/tmp/m.json');
  });

  it('throws on an unknown flag', () => {
    expect(() => parseArgs(['node', 'script.mjs', '--bogus'])).toThrow(/Unknown argument/);
  });
});

// ---------------------------------------------------------------------------
// loadReport — Story #208 AC #1: refuses to run when the report is missing
// ---------------------------------------------------------------------------

describe('loadReport', () => {
  it('throws a descriptive error when the Stryker report file is absent', () => {
    const missing = path.join(os.tmpdir(), `mutation-baseline-missing-${Date.now()}.json`);
    expect(() => loadReport(missing)).toThrow(
      /Stryker JSON report not found.*Run `pnpm run mutation` first/,
    );
  });

  it('rejects malformed JSON with a parse-error message', () => {
    const f = path.join(os.tmpdir(), `mutation-baseline-bad-${Date.now()}.json`);
    fs.writeFileSync(f, '{not-json');
    try {
      expect(() => loadReport(f)).toThrow(/failed to parse/);
    } finally {
      fs.unlinkSync(f);
    }
  });

  it('returns the parsed object when the report is valid JSON', () => {
    const f = path.join(os.tmpdir(), `mutation-baseline-ok-${Date.now()}.json`);
    const report = strykerReport({ 'a.ts': { mutants: [mutant('Killed')] } });
    fs.writeFileSync(f, JSON.stringify(report));
    try {
      const parsed = loadReport(f);
      expect(parsed.files['a.ts'].mutants).toHaveLength(1);
    } finally {
      fs.unlinkSync(f);
    }
  });
});

// ---------------------------------------------------------------------------
// computeScore
// ---------------------------------------------------------------------------

describe('computeScore', () => {
  it('returns 100 when there are no mutants to score', () => {
    expect(computeScore({ killed: 0, survived: 0, noCoverage: 0 })).toBe(100);
  });

  it('returns killed / (killed + survived + noCoverage) * 100', () => {
    expect(computeScore({ killed: 8, survived: 2, noCoverage: 0 })).toBe(80);
    expect(computeScore({ killed: 4, survived: 4, noCoverage: 2 })).toBe(40);
  });

  it('rounds to two decimal places', () => {
    expect(computeScore({ killed: 1, survived: 2, noCoverage: 0 })).toBe(33.33);
  });
});

// ---------------------------------------------------------------------------
// aggregateReport — Stryker report -> per-file rows
// ---------------------------------------------------------------------------

describe('aggregateReport', () => {
  it('returns an empty rows array when given an empty report', () => {
    expect(aggregateReport(strykerReport({}))).toEqual({ rows: [] });
  });

  it('returns an empty rows array when given null/garbage input', () => {
    expect(aggregateReport(null)).toEqual({ rows: [] });
    expect(aggregateReport({ files: null })).toEqual({ rows: [] });
  });

  it('counts Killed / Timeout / RuntimeError as killed', () => {
    const report = strykerReport({
      'apps/api/src/a.ts': {
        mutants: [mutant('Killed'), mutant('Timeout'), mutant('RuntimeError'), mutant('Survived')],
      },
    });
    const [row] = aggregateReport(report).rows;
    expect(row.killed).toBe(3);
    expect(row.survived).toBe(1);
    expect(row.score).toBe(75);
  });

  it('rolls NoCoverage into the score denominator but not the rows.killed/survived fields', () => {
    const report = strykerReport({
      'apps/api/src/a.ts': {
        mutants: [mutant('Killed'), mutant('NoCoverage'), mutant('NoCoverage')],
      },
    });
    const [row] = aggregateReport(report).rows;
    expect(row.killed).toBe(1);
    expect(row.survived).toBe(0);
    expect(row.score).toBe(33.33);
    // The internal _noCoverage tag rolls into the workspace/total
    // rollups but the per-row envelope shape excludes it per the schema.
    expect(row._noCoverage).toBe(2);
  });

  it('ignores Ignored and CompileError statuses (excluded from numerator + denominator)', () => {
    const report = strykerReport({
      'apps/api/src/a.ts': {
        mutants: [mutant('Killed'), mutant('Ignored'), mutant('CompileError')],
      },
    });
    const [row] = aggregateReport(report).rows;
    expect(row.killed).toBe(1);
    expect(row.survived).toBe(0);
    expect(row.score).toBe(100);
  });

  it('normalises path separators to POSIX', () => {
    const report = strykerReport({
      'apps\\api\\src\\a.ts': { mutants: [mutant('Killed')] },
    });
    const [row] = aggregateReport(report).rows;
    expect(row.path).not.toMatch(/\\/);
  });

  it('skips files whose entry is missing the mutants array', () => {
    const report = strykerReport({
      'apps/api/src/a.ts': { mutants: [mutant('Killed')] },
      'apps/api/src/b.ts': null,
      'apps/api/src/c.ts': { notMutants: [] },
    });
    expect(aggregateReport(report).rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// rollupAll / rollupRowsByWorkspace
// ---------------------------------------------------------------------------

describe('rollupAll', () => {
  it('returns zero counts and score=100 for an empty rows list', () => {
    expect(rollupAll([])).toEqual({ score: 100, killed: 0, survived: 0, noCoverage: 0 });
  });

  it('derives the score from rolled-up counts, not from averaging rows', () => {
    // Two rows: tiny file at 100% (1/1) and bigger file at 50% (5/10).
    // Averaged row score = 75; rolled-up score = 6/11 ~= 54.55.
    const rows = [
      { path: 'a.ts', killed: 1, survived: 0, _noCoverage: 0 },
      { path: 'b.ts', killed: 5, survived: 5, _noCoverage: 0 },
    ];
    expect(rollupAll(rows).score).toBe(54.55);
  });
});

describe('rollupRowsByWorkspace', () => {
  it('groups rows by the apps/<name> or packages/<name> prefix', () => {
    const rows = [
      { path: 'apps/api/src/a.ts', killed: 4, survived: 1, _noCoverage: 0 },
      { path: 'apps/api/src/b.ts', killed: 4, survived: 1, _noCoverage: 0 },
      { path: 'packages/shared/src/a.ts', killed: 9, survived: 1, _noCoverage: 0 },
    ];
    const rollup = rollupRowsByWorkspace(rows);
    expect(rollup['apps/api']).toEqual({ score: 80, killed: 8, survived: 2, noCoverage: 0 });
    expect(rollup['packages/shared']).toEqual({
      score: 90,
      killed: 9,
      survived: 1,
      noCoverage: 0,
    });
  });

  it('includes workspaces with zero rows (so missing workspaces stay visible)', () => {
    const rollup = rollupRowsByWorkspace([], ['apps/api', 'packages/shared']);
    expect(rollup['apps/api']).toEqual({ score: 100, killed: 0, survived: 0, noCoverage: 0 });
    expect(rollup['packages/shared']).toEqual({
      score: 100,
      killed: 0,
      survived: 0,
      noCoverage: 0,
    });
  });

  it('ignores rows that fall outside apps/* and packages/*', () => {
    const rows = [{ path: 'tools/x.ts', killed: 1, survived: 0, _noCoverage: 0 }];
    expect(rollupRowsByWorkspace(rows)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// buildEnvelope (shape contract)
// ---------------------------------------------------------------------------

describe('buildEnvelope', () => {
  it('emits the envelope with $schema, kernelVersion, generatedAt, rollup, rows', () => {
    const env = buildEnvelope(
      {
        rows: [{ path: 'apps/api/src/a.ts', score: 80, killed: 8, survived: 2, _noCoverage: 0 }],
        workspaces: ['apps/api'],
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

  it('rows carry only the schema-allowed shape (path, score, killed, survived)', () => {
    const env = buildEnvelope(
      {
        rows: [{ path: 'apps/api/src/a.ts', score: 80, killed: 8, survived: 2, _noCoverage: 3 }],
        workspaces: ['apps/api'],
      },
      fixedDate(),
    );
    expect(Object.keys(env.rows[0]).sort()).toEqual(['killed', 'path', 'score', 'survived']);
  });

  it('rollup entries carry score/killed/survived/noCoverage', () => {
    const env = buildEnvelope(
      {
        rows: [{ path: 'apps/api/src/a.ts', score: 80, killed: 8, survived: 2, _noCoverage: 3 }],
        workspaces: ['apps/api'],
      },
      fixedDate(),
    );
    for (const key of ['*', 'apps/api']) {
      expect(env.rollup[key]).toHaveProperty('score');
      expect(env.rollup[key]).toHaveProperty('killed');
      expect(env.rollup[key]).toHaveProperty('survived');
      expect(env.rollup[key]).toHaveProperty('noCoverage');
    }
  });

  it('sorts rollup keys with * first then lex order', () => {
    const env = buildEnvelope(
      {
        rows: [
          { path: 'packages/shared/x.ts', score: 50, killed: 5, survived: 5, _noCoverage: 0 },
          { path: 'apps/api/x.ts', score: 80, killed: 8, survived: 2, _noCoverage: 0 },
        ],
        workspaces: ['apps/api', 'packages/shared'],
      },
      fixedDate(),
    );
    expect(Object.keys(env.rollup)).toEqual(['*', 'apps/api', 'packages/shared']);
  });

  it('sorts rows by path ascending', () => {
    const env = buildEnvelope(
      {
        rows: [
          { path: 'z.ts', score: 0, killed: 0, survived: 1, _noCoverage: 0 },
          { path: 'a.ts', score: 0, killed: 0, survived: 1, _noCoverage: 0 },
        ],
        workspaces: [],
      },
      fixedDate(),
    );
    expect(env.rows.map((r) => r.path)).toEqual(['a.ts', 'z.ts']);
  });
});

// ---------------------------------------------------------------------------
// compareWorkspaceRollups — Story #208 AC #2: -6% drop triggers a violation
// ---------------------------------------------------------------------------

function envelopeWith(rollupEntries) {
  const rollup = { '*': { score: 0, killed: 0, survived: 0, noCoverage: 0 } };
  for (const [ws, v] of Object.entries(rollupEntries)) {
    rollup[ws] = v;
  }
  return {
    $schema: SCHEMA_POINTER,
    kernelVersion: KERNEL_VERSION,
    generatedAt: '2026-05-17T00:00:00.000Z',
    rollup,
    rows: [],
  };
}

// `relative-pct` evaluator from the @repo/baselines harness — replicate
// the math here so the suite stays independent of the harness install
// state (the harness is itself unit-tested in packages/baselines).
const fakeHarness = {
  evaluate(tolerance, prev, next, polarity) {
    if (tolerance.kind !== 'relative-pct') return null;
    const pol = polarity ?? 'higher-is-better';
    if (prev === 0) {
      return pol === 'higher-is-better' ? null : next > 0 ? 'fail' : null;
    }
    const allowed = (tolerance.pct / 100) * Math.abs(prev);
    if (pol === 'higher-is-better') return next < prev - allowed ? 'fail' : null;
    return next > prev + allowed ? 'fail' : null;
  },
};

describe('compareWorkspaceRollups (5% relative-pct, higher-is-better)', () => {
  it('returns no violations when current matches baseline exactly', () => {
    const prev = envelopeWith({
      'apps/api': { score: 80, killed: 8, survived: 2, noCoverage: 0 },
    });
    const curr = envelopeWith({
      'apps/api': { score: 80, killed: 8, survived: 2, noCoverage: 0 },
    });
    expect(compareWorkspaceRollups(prev, curr, fakeHarness)).toEqual([]);
  });

  it('allows a drop within 5% relative tolerance', () => {
    const prev = envelopeWith({
      'apps/api': { score: 80, killed: 8, survived: 2, noCoverage: 0 },
    });
    // 5% of 80 is 4.0 -> score >= 76 is conforming.
    const curr = envelopeWith({
      'apps/api': { score: 76.5, killed: 7, survived: 2, noCoverage: 0 },
    });
    expect(compareWorkspaceRollups(prev, curr, fakeHarness)).toEqual([]);
  });

  it('flags a -6% drop on one workspaces score (the synthetic AC case)', () => {
    const prev = envelopeWith({
      'apps/api': { score: 80, killed: 8, survived: 2, noCoverage: 0 },
      'packages/shared': { score: 90, killed: 9, survived: 1, noCoverage: 0 },
    });
    // 6% of 80 is 4.8 -> a score of 75.2 (a 4.8-point drop, ~6% relative)
    // falls below the 5% band.
    const curr = envelopeWith({
      'apps/api': { score: 75.2, killed: 7, survived: 3, noCoverage: 0 },
      'packages/shared': { score: 90, killed: 9, survived: 1, noCoverage: 0 },
    });
    const violations = compareWorkspaceRollups(prev, curr, fakeHarness);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      workspace: 'apps/api',
      axis: 'score',
      prev: 80,
      current: 75.2,
      severity: 'fail',
    });
  });

  it('ignores the * (whole-repo) rollup - gate is per-workspace', () => {
    const prev = envelopeWith({});
    prev.rollup['*'] = { score: 100, killed: 10, survived: 0, noCoverage: 0 };
    const curr = envelopeWith({});
    curr.rollup['*'] = { score: 50, killed: 5, survived: 5, noCoverage: 0 };
    expect(compareWorkspaceRollups(prev, curr, fakeHarness)).toEqual([]);
  });

  it('treats a newly-registered workspace as a pass (no prior to compare against)', () => {
    const prev = envelopeWith({
      'apps/api': { score: 80, killed: 8, survived: 2, noCoverage: 0 },
    });
    const curr = envelopeWith({
      'apps/api': { score: 80, killed: 8, survived: 2, noCoverage: 0 },
      'apps/web': { score: 0, killed: 0, survived: 0, noCoverage: 0 },
    });
    expect(compareWorkspaceRollups(prev, curr, fakeHarness)).toEqual([]);
  });

  it('pins TOLERANCE_PCT to 5 (Epic #6 PRD #195)', () => {
    expect(TOLERANCE_PCT).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// formatWorkspaceViolations
// ---------------------------------------------------------------------------

describe('formatWorkspaceViolations', () => {
  it('returns an empty string for an empty violation list', () => {
    expect(formatWorkspaceViolations([])).toBe('');
  });

  it('names the workspace, axis, prev, current, and relative pct drop', () => {
    const msg = formatWorkspaceViolations([
      {
        workspace: 'apps/api',
        axis: 'score',
        prev: 80,
        current: 75.2,
        tolerance: { kind: 'relative-pct', pct: 5 },
        severity: 'fail',
      },
    ]);
    expect(msg).toMatch(/apps\/api/);
    expect(msg).toMatch(/score/);
    expect(msg).toMatch(/80\.00/);
    expect(msg).toMatch(/75\.20/);
    expect(msg).toMatch(/-4\.80/);
    expect(msg).toMatch(/-6\.00%/);
  });

  it('mentions the remediation (mutation:update)', () => {
    const msg = formatWorkspaceViolations([
      {
        workspace: 'apps/api',
        axis: 'score',
        prev: 80,
        current: 75.2,
        tolerance: { kind: 'relative-pct', pct: 5 },
        severity: 'fail',
      },
    ]);
    expect(msg).toMatch(/mutation:update/);
  });
});

// ---------------------------------------------------------------------------
// Shipped baselines/mutation.json contract
// ---------------------------------------------------------------------------

describe('shipped baselines/mutation.json', () => {
  it('exists and parses as JSON', () => {
    const raw = fs.readFileSync(BASELINE_PATH, 'utf8');
    const doc = JSON.parse(raw);
    expect(doc.$schema).toBe(SCHEMA_POINTER);
    expect(doc.kernelVersion).toBe(KERNEL_VERSION);
  });

  it('carries the envelope shape (rollup."*" with four required axes, plus per-workspace rollups and rows)', () => {
    const doc = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    expect(doc.rollup).toBeDefined();
    expect(doc.rollup['*']).toBeDefined();
    for (const axis of ['score', 'killed', 'survived', 'noCoverage']) {
      expect(doc.rollup['*']).toHaveProperty(axis);
      expect(typeof doc.rollup['*'][axis]).toBe('number');
    }
    expect(Array.isArray(doc.rows)).toBe(true);
    // Story #379 primed the baseline against the nightly Stryker report.
    // The gate now bites — expect a non-empty row set and at least one
    // per-workspace rollup carrying a non-zero score.
    expect(doc.rows.length).toBeGreaterThan(0);
    const workspaceRollups = Object.entries(doc.rollup).filter(([k]) => k !== '*');
    expect(workspaceRollups.length).toBeGreaterThan(0);
    const someWorkspaceScored = workspaceRollups.some(([, v]) => Number(v?.score ?? 0) > 0);
    expect(someWorkspaceScored).toBe(true);
  });

  it('is primed (rollup."*" carries non-zero killed/survived counts)', () => {
    const doc = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    expect(doc.rollup['*'].killed).toBeGreaterThan(0);
    expect(doc.rollup['*'].score).toBeGreaterThan(0);
    // `survived` and `noCoverage` MAY be zero on a hypothetically
    // perfect suite, but `killed` cannot be zero on a primed envelope
    // — that is the load-bearing signal `modeCheck` uses to decide
    // whether to engage the relative-pct gate.
  });
});

// ---------------------------------------------------------------------------
// REPO_ROOT / DEFAULT_REPORT_PATH constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('REPO_ROOT resolves to the worktree root', () => {
    // Sanity check — REPO_ROOT must contain package.json and baselines/.
    expect(fs.existsSync(path.join(REPO_ROOT, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, 'baselines'))).toBe(true);
  });

  it('DEFAULT_REPORT_PATH points at reports/mutation/mutation.json', () => {
    expect(DEFAULT_REPORT_PATH.replace(/\\/g, '/')).toMatch(/reports\/mutation\/mutation\.json$/);
  });
});

// ---------------------------------------------------------------------------
// discoverWorkspaces
// ---------------------------------------------------------------------------

describe('discoverWorkspaces', () => {
  it('finds workspace dirs under apps/* and packages/*', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-baseline-'));
    try {
      const wsA = path.join(root, 'apps', 'fake');
      fs.mkdirSync(wsA, { recursive: true });
      fs.writeFileSync(path.join(wsA, 'package.json'), '{"name":"@repo/fake"}');
      const wsB = path.join(root, 'packages', 'fake-pkg');
      fs.mkdirSync(wsB, { recursive: true });
      fs.writeFileSync(path.join(wsB, 'package.json'), '{"name":"@repo/fake-pkg"}');
      fs.mkdirSync(path.join(root, 'apps', 'bare'), { recursive: true });
      expect(discoverWorkspaces(root)).toEqual(['apps/fake', 'packages/fake-pkg']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns empty when apps/ and packages/ are absent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-baseline-empty-'));
    try {
      expect(discoverWorkspaces(root)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
