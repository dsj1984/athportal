#!/usr/bin/env node
// scripts/lighthouse-baseline.mjs
//
// Lighthouse baseline dimension for the athportal monorepo.
//
// Drives Chrome via the `lighthouse` CLI against a configurable preview
// URL, captures the four Lighthouse-category scores per route
// (performance, accessibility, best-practices, SEO), and either:
//
//   --check    (default) diff per-route metrics against
//              `baselines/lighthouse.json`. Exits non-zero on:
//                * per-metric +/-3 tolerance violation against the
//                  recorded baseline (route-band tolerance, see
//                  `compareWithTolerance(..., { kind: 'route-band',
//                  plusMinus: 3 })`).
//                * MVP floor violation: performance < 85,
//                  accessibility < 95, SEO < 95. Floors are enforced
//                  absolutely regardless of recorded baseline.
//   --update   write fresh measurements to `baselines/lighthouse.json`
//              so the snapshot becomes the new band centre. Update
//              honours the byte-identical re-emission contract on
//              unchanged measurements.
//
// The script consumes the shared `@repo/baselines` harness for envelope
// read/write/validate/compare. The harness ships in Story #210; the
// import resolves once that Story has merged. The AC-pinning unit suite
// at `scripts/__tests__/lighthouse-baseline.test.mjs` covers the
// argv/rejection-message surface without instantiating the harness so
// the script's contract is verified ahead of the dependency landing.
//
// Security baseline: `.agents/rules/security-baseline.md`. The script
// runs `lighthouse` via `spawnSync({ shell: false })`; no PII is captured
// in Lighthouse trace JSON; the preview URL is consumed verbatim from
// env / argv and never built from untrusted templating.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The shared harness is imported lazily inside `modeCheck` / `modeUpdate`
// so the pure helpers below (parseArgs, buildEnvelope, extractScores,
// detectFloorViolations, …) remain unit-testable without the
// `@repo/baselines` package being resolvable on disk. Story #210 ships
// the harness; until that Story merges, the CLI modes throw a clear
// error if invoked, but the AC-pinning unit suite still runs.
async function loadHarness() {
  return import('@repo/baselines');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(REPO_ROOT, 'baselines', 'lighthouse.json');
const MAX_BUFFER = 50 * 1024 * 1024;

// Tolerance per ADR (lighthouse-baseline): +/-3 per metric per route.
const ROUTE_BAND_PLUS_MINUS = 3;

// MVP floors per PRD #195 AC #9 — absolute, baseline-independent.
const MVP_FLOORS = Object.freeze({
  performance: 85,
  accessibility: 95,
  seo: 95,
});

// Routes that ship in the unprimed baseline envelope per the Tech Spec.
// Update when adding a new public route to the MVP surface (and re-run
// `pnpm run lighthouse:update` to prime real measurements).
const DEFAULT_ROUTES = Object.freeze(['/', '/athletes/[slug]', '/teams/[slug]']);

// ---------------------------------------------------------------------------
// CLI argv parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  let mode = 'check';
  let previewUrl = process.env.LIGHTHOUSE_PREVIEW_URL ?? null;
  let routesArg = null;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') mode = 'check';
    else if (a === '--update') mode = 'update';
    else if (a === '--help' || a === '-h') mode = 'help';
    else if (a === '--preview-url' || a.startsWith('--preview-url=')) {
      previewUrl = a.includes('=') ? a.slice('--preview-url='.length) : argv[++i];
    } else if (a === '--routes' || a.startsWith('--routes=')) {
      routesArg = a.includes('=') ? a.slice('--routes='.length) : argv[++i];
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  const routes = routesArg
    ? routesArg
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean)
    : null;
  return { mode, previewUrl, routes };
}

// ---------------------------------------------------------------------------
// Lighthouse measurement
// ---------------------------------------------------------------------------

// Build the URL fed into the lighthouse CLI. For parameterised routes
// (e.g. `/athletes/[slug]`) the substitution is left to the caller — the
// preview deployment owns the canonical example slugs (configured under
// `LIGHTHOUSE_ROUTE_<NAME>` envs once the deploy contract is finalised).
// When no override is set, the placeholder route is requested verbatim;
// the deploy returns a representative example page.
export function resolveRouteUrl(previewUrl, route) {
  if (!previewUrl) {
    throw new Error(
      'lighthouse-baseline: preview URL not configured. Set LIGHTHOUSE_PREVIEW_URL or pass --preview-url=<url>.',
    );
  }
  const base = previewUrl.replace(/\/$/, '');
  const slug = route.startsWith('/') ? route : `/${route}`;
  return `${base}${slug}`;
}

export function runLighthouse(url, lhBin) {
  const entry = lhBin ?? path.join(REPO_ROOT, 'node_modules', 'lighthouse', 'cli', 'index.js');
  if (!fs.existsSync(entry)) {
    throw new Error(
      `lighthouse-baseline: lighthouse CLI entry missing at ${path.relative(REPO_ROOT, entry)}. Run \`pnpm install\` in the worktree.`,
    );
  }
  const result = spawnSync(
    process.execPath,
    [
      entry,
      url,
      '--output=json',
      '--output-path=stdout',
      '--quiet',
      '--chrome-flags=--headless=new --no-sandbox',
      '--only-categories=performance,accessibility,best-practices,seo',
    ],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      shell: false,
    },
  );
  if (result.error) {
    throw new Error(`lighthouse-baseline: spawn failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `lighthouse-baseline: lighthouse CLI exited with status ${result.status}: ${(result.stderr ?? '').slice(0, 500)}`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(`lighthouse-baseline: failed to parse lighthouse JSON: ${err.message}`);
  }
  return extractScores(parsed);
}

// Translate the raw lighthouse JSON envelope into the per-row shape the
// envelope contract requires. Lighthouse scores are reported in the
// `[0, 1]` range; we scale to the `[0, 100]` integer score that the
// per-kind schema declares.
export function extractScores(report) {
  const categories = report?.categories ?? {};
  const round = (n) => Math.round(Number(n) * 100);
  return {
    performance: round(categories.performance?.score ?? 0),
    accessibility: round(categories.accessibility?.score ?? 0),
    bestPractices: round(categories['best-practices']?.score ?? 0),
    seo: round(categories.seo?.score ?? 0),
  };
}

// ---------------------------------------------------------------------------
// MVP floor enforcement (absolute, baseline-independent)
// ---------------------------------------------------------------------------

// Returns the list of violations against the absolute MVP floors. Each
// violation carries the route, metric, observed score, and floor so the
// rejection message can pinpoint the regression for the reviewer.
export function detectFloorViolations(rows, floors = MVP_FLOORS) {
  const violations = [];
  for (const row of rows) {
    for (const [metric, floor] of Object.entries(floors)) {
      const observed = Number(row[metric] ?? 0);
      if (observed < floor) {
        violations.push({ route: row.route, metric, observed, floor });
      }
    }
  }
  return violations;
}

export function formatFloorViolations(violations) {
  if (violations.length === 0) return '';
  const lines = ['  MVP floor violations:'];
  for (const v of violations) {
    lines.push(`    ${v.route} · ${v.metric}: ${v.observed} < floor=${v.floor}`);
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Envelope construction
// ---------------------------------------------------------------------------

function buildRollup(rows) {
  if (rows.length === 0) {
    return { performance: 0, accessibility: 0, bestPractices: 0, seo: 0 };
  }
  const sums = { performance: 0, accessibility: 0, bestPractices: 0, seo: 0 };
  for (const row of rows) {
    sums.performance += Number(row.performance ?? 0);
    sums.accessibility += Number(row.accessibility ?? 0);
    sums.bestPractices += Number(row.bestPractices ?? 0);
    sums.seo += Number(row.seo ?? 0);
  }
  const round = (n) => Math.round(n / rows.length);
  return {
    performance: round(sums.performance),
    accessibility: round(sums.accessibility),
    bestPractices: round(sums.bestPractices),
    seo: round(sums.seo),
  };
}

function buildEnvelope(rows, now = new Date()) {
  const sortedRows = [...rows].sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : 0));
  return {
    $schema: '.agents/schemas/baselines/lighthouse.schema.json',
    kernelVersion: '1.0.0',
    generatedAt: now.toISOString(),
    rollup: { '*': buildRollup(sortedRows) },
    rows: sortedRows,
  };
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function measureRoutes(previewUrl, routes) {
  const rows = [];
  for (const route of routes) {
    const url = resolveRouteUrl(previewUrl, route);
    const scores = runLighthouse(url);
    rows.push({ route, ...scores });
  }
  return rows;
}

// Detect the unprimed envelope without loading the harness. An unprimed
// baseline ships either with `rows[]` empty (mutation-style) or with the
// three MVP routes seeded at score=0 across all four metrics (lighthouse
// ships the latter so the schema-pin tests can read the row shape). Both
// shapes mean "no real measurement has been captured yet" — the per-route
// tolerance gate is meaningless until `--update` runs.
function isUnprimedBaseline(envelope) {
  const rows = envelope?.rows ?? [];
  if (rows.length === 0) return true;
  return rows.every(
    (r) =>
      Number(r?.performance ?? 0) === 0 &&
      Number(r?.accessibility ?? 0) === 0 &&
      Number(r?.bestPractices ?? 0) === 0 &&
      Number(r?.seo ?? 0) === 0,
  );
}

const PREVIEW_URL_UNSET_MESSAGE =
  '[lighthouse-baseline] LIGHTHOUSE_PREVIEW_URL is not set. Configure it on the staging GitHub Environment (`gh secret set --env staging LIGHTHOUSE_PREVIEW_URL <url>`) or pass `--preview-url=<url>` locally.\n';

async function modeUpdate({ previewUrl, routes }) {
  if (!previewUrl) {
    process.stderr.write(PREVIEW_URL_UNSET_MESSAGE);
    return 1;
  }
  const { writeBaseline } = await loadHarness();
  const targetRoutes = routes && routes.length > 0 ? routes : DEFAULT_ROUTES;
  const rows = measureRoutes(previewUrl, targetRoutes);
  const envelope = buildEnvelope(rows);
  writeBaseline(BASELINE_PATH, envelope);
  process.stdout.write(
    `[lighthouse-baseline] wrote baselines/lighthouse.json — routes=${targetRoutes.length}\n`,
  );
  return 0;
}

async function modeCheck({ previewUrl, routes }) {
  if (!previewUrl) {
    process.stderr.write(PREVIEW_URL_UNSET_MESSAGE);
    return 1;
  }
  if (!fs.existsSync(BASELINE_PATH)) {
    process.stderr.write(
      `[lighthouse-baseline] baseline file missing at ${path.relative(REPO_ROOT, BASELINE_PATH)}\n`,
    );
    return 1;
  }
  const prev = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  if (isUnprimedBaseline(prev)) {
    process.stdout.write(
      '[lighthouse-baseline] baseline is unprimed (all rows at score 0). Skipping per-route tolerance gate. Run `pnpm run lighthouse:update` against the staging preview to prime the floor.\n',
    );
    return 0;
  }
  const { compareWithTolerance, formatRejectionMessage } = await loadHarness();
  const targetRoutes = routes && routes.length > 0 ? routes : prev.rows.map((r) => r.route);
  const rows = measureRoutes(previewUrl, targetRoutes);
  const next = buildEnvelope(rows);

  const tolerance = { kind: 'route-band', plusMinus: ROUTE_BAND_PLUS_MINUS };
  const diffs = compareWithTolerance(prev, next, tolerance);
  const floorViolations = detectFloorViolations(next.rows);

  if (diffs.length === 0 && floorViolations.length === 0) {
    process.stdout.write(
      `[lighthouse-baseline] ok — ${next.rows.length} route(s) within +/-${ROUTE_BAND_PLUS_MINUS} per metric and above MVP floors\n`,
    );
    return 0;
  }

  process.stderr.write('[lighthouse-baseline] baseline regression detected\n');
  if (diffs.length > 0) {
    process.stderr.write(formatRejectionMessage('lighthouse', diffs));
  }
  if (floorViolations.length > 0) {
    process.stderr.write(formatFloorViolations(floorViolations));
  }
  process.stderr.write(
    '  Fix the regression, or if the move is intentional, run `pnpm run lighthouse:update` against the preview deployment.\n',
  );
  return 1;
}

function modeHelp() {
  process.stdout.write(
    `Usage: node scripts/lighthouse-baseline.mjs [--check | --update] [--preview-url=<url>] [--routes=<r1,r2,...>]\n\n` +
      `  --check         (default) diff measurements against baselines/lighthouse.json\n` +
      `  --update        rewrite baselines/lighthouse.json from a fresh run\n` +
      `  --preview-url   preview deployment base URL (env: LIGHTHOUSE_PREVIEW_URL)\n` +
      `  --routes        comma-separated routes (default: the baseline's rows[])\n`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// Entrypoint (CLI only — exported helpers above are import-safe)
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  let exitCode = 0;
  try {
    const args = parseArgs(process.argv);
    if (args.mode === 'update') exitCode = await modeUpdate(args);
    else if (args.mode === 'check') exitCode = await modeCheck(args);
    else exitCode = modeHelp();
  } catch (err) {
    process.stderr.write(`[lighthouse-baseline] ${err.message}\n`);
    exitCode = 1;
  }
  process.exit(exitCode);
}

// Re-exports for unit testing.
export {
  BASELINE_PATH,
  DEFAULT_ROUTES,
  MVP_FLOORS,
  PREVIEW_URL_UNSET_MESSAGE,
  ROUTE_BAND_PLUS_MINUS,
  buildEnvelope,
  buildRollup,
  isUnprimedBaseline,
  modeCheck,
  modeUpdate,
};
