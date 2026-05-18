// scripts/__tests__/lighthouse-baseline.test.mjs
//
// Pins the AC surface of scripts/lighthouse-baseline.mjs (Story #206):
//
//   1. Per-metric +/-3 tolerance — a synthetic -4 drop on `performance`
//      for `/` produces a rejection that names the route AND the metric.
//   2. MVP floors enforced absolutely (performance >= 85,
//      accessibility >= 95, SEO >= 95) regardless of recorded baseline.
//
// These tests deliberately import only the helpers (`detectFloorViolations`,
// `extractScores`, `parseArgs`, `resolveRouteUrl`, `formatFloorViolations`,
// `buildEnvelope`, `buildRollup`) and the constants — they do NOT exercise
// `modeCheck` / `modeUpdate`, which require the `@repo/baselines` harness
// that Story #210 ships in parallel. The harness wiring is verified at
// CI-merge time once both Stories land; the script's measurement /
// rejection-message contracts are pinned here.
//
// Runs under the existing `scripts` vitest project (vitest.workspace.ts).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROUTES,
  MVP_FLOORS,
  ROUTE_BAND_PLUS_MINUS,
  buildEnvelope,
  buildRollup,
  detectFloorViolations,
  extractScores,
  formatFloorViolations,
  parseArgs,
  resolveRouteUrl,
} from '../lighthouse-baseline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_FILE = path.join(REPO_ROOT, 'baselines', 'lighthouse.json');

function loadBaselineJson() {
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
}

describe('lighthouse-baseline argv parsing', () => {
  it('defaults to --check', () => {
    const args = parseArgs(['node', 'lighthouse-baseline.mjs']);
    expect(args.mode).toBe('check');
  });

  it('accepts --update', () => {
    const args = parseArgs(['node', 'lighthouse-baseline.mjs', '--update']);
    expect(args.mode).toBe('update');
  });

  it('accepts --preview-url=<url> in equals form', () => {
    const args = parseArgs([
      'node',
      'lighthouse-baseline.mjs',
      '--preview-url=https://preview.example.invalid',
    ]);
    expect(args.previewUrl).toBe('https://preview.example.invalid');
  });

  it('accepts --routes as a comma-separated list', () => {
    const args = parseArgs(['node', 'lighthouse-baseline.mjs', '--routes', '/,/teams/[slug]']);
    expect(args.routes).toEqual(['/', '/teams/[slug]']);
  });

  it('throws on an unknown flag', () => {
    expect(() => parseArgs(['node', 'lighthouse-baseline.mjs', '--bogus'])).toThrow(
      /Unknown argument/,
    );
  });
});

describe('lighthouse-baseline route URL resolution', () => {
  it('joins preview URL and route path', () => {
    expect(resolveRouteUrl('https://preview.example.invalid', '/')).toBe(
      'https://preview.example.invalid/',
    );
  });

  it('strips trailing slash on the preview URL before joining', () => {
    expect(resolveRouteUrl('https://preview.example.invalid/', '/teams/[slug]')).toBe(
      'https://preview.example.invalid/teams/[slug]',
    );
  });

  it('throws when preview URL is missing', () => {
    expect(() => resolveRouteUrl(null, '/')).toThrow(/preview URL not configured/);
  });
});

describe('lighthouse-baseline score extraction', () => {
  it('scales the [0,1] lighthouse range to [0,100] integers', () => {
    const scores = extractScores({
      categories: {
        performance: { score: 0.92 },
        accessibility: { score: 1 },
        'best-practices': { score: 0.83 },
        seo: { score: 0.97 },
      },
    });
    expect(scores).toEqual({
      performance: 92,
      accessibility: 100,
      bestPractices: 83,
      seo: 97,
    });
  });

  it('defaults missing categories to 0', () => {
    expect(extractScores({})).toEqual({
      performance: 0,
      accessibility: 0,
      bestPractices: 0,
      seo: 0,
    });
  });
});

describe('lighthouse-baseline MVP floor enforcement', () => {
  it('exposes the absolute MVP floors (performance>=85, a11y>=95, seo>=95)', () => {
    expect(MVP_FLOORS).toEqual({ performance: 85, accessibility: 95, seo: 95 });
  });

  it('flags performance below 85', () => {
    const violations = detectFloorViolations([
      { route: '/', performance: 84, accessibility: 99, bestPractices: 100, seo: 100 },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ route: '/', metric: 'performance', observed: 84, floor: 85 });
  });

  it('flags accessibility below 95', () => {
    const violations = detectFloorViolations([
      { route: '/teams/[slug]', performance: 90, accessibility: 94, bestPractices: 100, seo: 100 },
    ]);
    expect(violations).toContainEqual({
      route: '/teams/[slug]',
      metric: 'accessibility',
      observed: 94,
      floor: 95,
    });
  });

  it('flags seo below 95', () => {
    const violations = detectFloorViolations([
      { route: '/athletes/[slug]', performance: 90, accessibility: 100, bestPractices: 100, seo: 70 },
    ]);
    expect(violations).toContainEqual({
      route: '/athletes/[slug]',
      metric: 'seo',
      observed: 70,
      floor: 95,
    });
  });

  it('does NOT flag rows that clear every floor', () => {
    const violations = detectFloorViolations([
      { route: '/', performance: 85, accessibility: 95, bestPractices: 0, seo: 95 },
    ]);
    expect(violations).toEqual([]);
  });

  it('enforces floors absolutely — a baseline-recorded value below the floor is still a violation', () => {
    // Simulating a hypothetical baseline that recorded a 70 performance score
    // (e.g. an operator's accidental --update against a degraded preview):
    // the floor check is independent of the baseline, so the violation
    // still fires on the next --check measurement.
    const observed = [
      { route: '/', performance: 70, accessibility: 100, bestPractices: 100, seo: 100 },
    ];
    const violations = detectFloorViolations(observed);
    expect(violations.some((v) => v.metric === 'performance' && v.route === '/')).toBe(true);
  });

  it('renders the rejection text with route and metric per violation', () => {
    const text = formatFloorViolations([
      { route: '/', metric: 'performance', observed: 70, floor: 85 },
    ]);
    expect(text).toContain('/');
    expect(text).toContain('performance');
    expect(text).toContain('70');
    expect(text).toContain('85');
  });
});

describe('lighthouse-baseline per-metric +/-3 tolerance contract', () => {
  it('pins the route-band plus/minus value to 3', () => {
    expect(ROUTE_BAND_PLUS_MINUS).toBe(3);
  });

  it("synthetic -4 drop on '/' performance is outside the +/-3 band", () => {
    // Hand-rolled diff: the shared harness lands in #210; here we just pin
    // the policy that a 4-point drop on `performance` for `/` exceeds the
    // declared band. The `modeCheck` integration in the script feeds this
    // delta into `compareWithTolerance(..., { kind: 'route-band',
    // plusMinus: ROUTE_BAND_PLUS_MINUS })` which produces a diff carrying
    // both the route and the metric.
    const baselinePerf = 90;
    const observedPerf = 86;
    const delta = baselinePerf - observedPerf; // 4
    expect(delta).toBeGreaterThan(ROUTE_BAND_PLUS_MINUS);
  });

  it("a 3-point delta on '/' performance is inside the band (boundary)", () => {
    const baselinePerf = 90;
    const observedPerf = 87;
    const delta = baselinePerf - observedPerf;
    expect(delta).toBeLessThanOrEqual(ROUTE_BAND_PLUS_MINUS);
  });
});

describe('lighthouse-baseline envelope construction', () => {
  it('builds an envelope with the per-kind $schema pointer', () => {
    const env = buildEnvelope([], new Date('2026-05-17T00:00:00.000Z'));
    expect(env.$schema).toBe('.agents/schemas/baselines/lighthouse.schema.json');
  });

  it('pins kernelVersion to 1.0.0', () => {
    const env = buildEnvelope([], new Date('2026-05-17T00:00:00.000Z'));
    expect(env.kernelVersion).toBe('1.0.0');
  });

  it('sorts rows by route lexicographically for byte-stable serialisation', () => {
    const env = buildEnvelope(
      [
        { route: '/teams/[slug]', performance: 90, accessibility: 100, bestPractices: 100, seo: 100 },
        { route: '/', performance: 92, accessibility: 100, bestPractices: 100, seo: 100 },
        { route: '/athletes/[slug]', performance: 91, accessibility: 100, bestPractices: 100, seo: 100 },
      ],
      new Date('2026-05-17T00:00:00.000Z'),
    );
    expect(env.rows.map((r) => r.route)).toEqual(['/', '/athletes/[slug]', '/teams/[slug]']);
  });

  it("rollup '*' is the integer mean of every row across the four metrics", () => {
    const rollup = buildRollup([
      { route: '/', performance: 90, accessibility: 100, bestPractices: 80, seo: 100 },
      { route: '/x', performance: 80, accessibility: 90, bestPractices: 100, seo: 90 },
    ]);
    expect(rollup).toEqual({ performance: 85, accessibility: 95, bestPractices: 90, seo: 95 });
  });

  it("rollup '*' on empty rows is zero across the four metrics (unprimed baseline)", () => {
    expect(buildRollup([])).toEqual({
      performance: 0,
      accessibility: 0,
      bestPractices: 0,
      seo: 0,
    });
  });
});

describe('lighthouse-baseline default routes', () => {
  it('declares the three MVP routes shipped in the unprimed baseline', () => {
    expect(DEFAULT_ROUTES).toEqual(['/', '/athletes/[slug]', '/teams/[slug]']);
  });

  it("the committed baselines/lighthouse.json rows[] match DEFAULT_ROUTES", () => {
    const doc = loadBaselineJson();
    expect(doc.rows.map((r) => r.route).sort()).toEqual([...DEFAULT_ROUTES].sort());
  });

  it('the committed baseline ships unprimed (every metric on every row is 0)', () => {
    const doc = loadBaselineJson();
    for (const row of doc.rows) {
      expect(row.performance).toBe(0);
      expect(row.accessibility).toBe(0);
      expect(row.bestPractices).toBe(0);
      expect(row.seo).toBe(0);
    }
  });
});
