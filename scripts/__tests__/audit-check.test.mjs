// scripts/__tests__/audit-check.test.mjs
//
// AC-pinning tests for Task #224: the scripts/audit-check.mjs supply-chain
// gate. These run under the repo's Vitest `scripts` project so
// `pnpm run test` exercises them on every PR.
//
// ADR-011 invariants pinned here:
//
//   1. Script exits non-zero on any unsuppressed High/Critical advisory
//      in the production graph (--level=high --prod semantics).
//   2. Script writes audit.json with the full audit findings list (incl.
//      Moderate) to the workspace root for CI artifact upload.
//   3. Moderate findings surface in audit.json without failing the gate.
//   4. An IGNORED entry with a non-empty reason + future revisit date
//      suppresses a matching High/Critical advisory.
//
// Pyramid tier: unit. The kernel under test (`normalizeFindings`,
// `partitionFindings`, `buildArtifact`) is pure; the script's CLI
// surface is also covered via a stub-pnpm child-process boundary.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildArtifact, normalizeFindings, partitionFindings } from '../audit-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(HERE, '..', 'audit-check.mjs');

// ---------------------------------------------------------------------------
// normalizeFindings — pure transform
// ---------------------------------------------------------------------------

describe('normalizeFindings', () => {
  it('flattens pnpm audit advisories into a typed list', () => {
    const payload = {
      advisories: {
        1234: {
          github_advisory_id: 'GHSA-aaaa-bbbb-cccc',
          severity: 'high',
          module_name: 'lodash',
          title: 'Prototype pollution',
          url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
        },
        5678: {
          github_advisory_id: 'GHSA-dddd-eeee-ffff',
          severity: 'moderate',
          module_name: 'minimist',
          title: 'Prototype pollution',
          url: 'https://example.invalid/dddd',
        },
      },
    };

    const findings = normalizeFindings(payload);

    expect(findings).toHaveLength(2);
    expect(findings.find((f) => f.id === 'GHSA-aaaa-bbbb-cccc')).toMatchObject({
      severity: 'high',
      module: 'lodash',
    });
    expect(findings.find((f) => f.id === 'GHSA-dddd-eeee-ffff')).toMatchObject({
      severity: 'moderate',
      module: 'minimist',
    });
  });

  it('returns [] for an empty payload', () => {
    expect(normalizeFindings({})).toEqual([]);
    expect(normalizeFindings({ advisories: {} })).toEqual([]);
  });

  it('returns [] for malformed input', () => {
    expect(normalizeFindings(null)).toEqual([]);
    expect(normalizeFindings(undefined)).toEqual([]);
    expect(normalizeFindings('not an object')).toEqual([]);
  });

  it('falls back to the map key when github_advisory_id is missing', () => {
    const payload = {
      advisories: {
        'CVE-2025-0001': {
          severity: 'critical',
          module_name: 'foo',
          title: 'Bad bug',
          url: 'https://example.invalid/cve',
        },
      },
    };
    const findings = normalizeFindings(payload);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('CVE-2025-0001');
  });

  it('lowercases severity so comparisons stay deterministic', () => {
    const payload = {
      advisories: {
        x: { github_advisory_id: 'GHSA-x', severity: 'HIGH', module_name: 'm', title: 't' },
      },
    };
    expect(normalizeFindings(payload)[0].severity).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// partitionFindings — blocking / suppressed / surfaced
// ---------------------------------------------------------------------------

describe('partitionFindings', () => {
  const findings = [
    { id: 'GHSA-high-1', severity: 'high', module: 'a', title: '', url: null, raw: {} },
    { id: 'GHSA-crit-1', severity: 'critical', module: 'b', title: '', url: null, raw: {} },
    { id: 'GHSA-mod-1', severity: 'moderate', module: 'c', title: '', url: null, raw: {} },
    { id: 'GHSA-low-1', severity: 'low', module: 'd', title: '', url: null, raw: {} },
    { id: 'GHSA-info-1', severity: 'info', module: 'e', title: '', url: null, raw: {} },
  ];

  it('routes High/Critical without an IGNORED entry into blocking', () => {
    const { blocking, suppressed, surfaced } = partitionFindings(findings, {});
    expect(blocking.map((f) => f.id).sort()).toEqual(['GHSA-crit-1', 'GHSA-high-1']);
    expect(suppressed).toEqual([]);
    expect(surfaced.map((f) => f.id)).toEqual(['GHSA-mod-1']);
  });

  it('routes High/Critical matched against IGNORED into suppressed', () => {
    const ignored = {
      'GHSA-high-1': { reason: 'documented unreachable', revisit: '2027-01-01' },
    };
    const { blocking, suppressed, surfaced } = partitionFindings(findings, ignored);
    expect(blocking.map((f) => f.id)).toEqual(['GHSA-crit-1']);
    expect(suppressed.map((f) => f.id)).toEqual(['GHSA-high-1']);
    expect(surfaced.map((f) => f.id)).toEqual(['GHSA-mod-1']);
  });

  it('drops Low/Info severities entirely (not blocked, not surfaced)', () => {
    const { surfaced } = partitionFindings(findings, {});
    expect(surfaced.find((f) => f.id === 'GHSA-low-1')).toBeUndefined();
    expect(surfaced.find((f) => f.id === 'GHSA-info-1')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildArtifact — audit.json shape
// ---------------------------------------------------------------------------

describe('buildArtifact', () => {
  it('produces a stable, versioned envelope with summary counts and full finding lists', () => {
    const blocking = [{ id: 'b', severity: 'high', module: 'm', title: '', url: null, raw: {} }];
    const suppressed = [{ id: 's', severity: 'high', module: 'm', title: '', url: null, raw: {} }];
    const surfaced = [
      { id: 'm', severity: 'moderate', module: 'm', title: '', url: null, raw: {} },
    ];
    const findings = [...blocking, ...suppressed, ...surfaced];

    const artifact = buildArtifact({
      findings,
      blocking,
      suppressed,
      surfaced,
      generatedAt: '2026-05-17T00:00:00.000Z',
    });

    expect(artifact).toMatchObject({
      schema: 'athportal-audit-check@1',
      generatedAt: '2026-05-17T00:00:00.000Z',
      summary: { totalFindings: 3, blocking: 1, suppressed: 1, moderate: 1 },
    });
    expect(artifact.blocking).toEqual(blocking);
    expect(artifact.suppressed).toEqual(suppressed);
    expect(artifact.moderate).toEqual(surfaced);
  });
});

// ---------------------------------------------------------------------------
// CLI surface — drive the script with a stub `pnpm` on PATH so we observe
// exit code, stderr, and audit.json without touching the real registry.
// ---------------------------------------------------------------------------

/**
 * Build a temp directory with:
 *   - a stub `pnpm` (or `pnpm.cmd` on win32) that prints the supplied
 *     JSON payload to stdout and exits 0
 *   - a working copy of audit-check.mjs (we copy rather than relative-
 *     import so the script's `process.cwd()` lands inside the sandbox
 *     and `audit.json` writes there)
 *
 * @param {object} payload The JSON pnpm audit would emit.
 */
function setupStubSandbox(payload) {
  const sandbox = mkdtempSync(join(tmpdir(), 'audit-check-stub-'));
  const binDir = join(sandbox, 'bin');
  mkdirSync(binDir, { recursive: true });

  // Write the payload to a sidecar JSON file the stub reads at runtime —
  // this dodges .cmd / shell quoting pitfalls entirely.
  const payloadPath = join(binDir, 'pnpm-stub-payload.json');
  writeFileSync(payloadPath, JSON.stringify(payload), 'utf8');

  // Helper script the stub invokes; it prints the payload verbatim.
  const stubJsPath = join(binDir, 'pnpm-stub.mjs');
  writeFileSync(
    stubJsPath,
    [
      "import { readFileSync } from 'node:fs';",
      "import { fileURLToPath } from 'node:url';",
      "import { dirname, join } from 'node:path';",
      'const here = dirname(fileURLToPath(import.meta.url));',
      "const body = readFileSync(join(here, 'pnpm-stub-payload.json'), 'utf8');",
      'process.stdout.write(body);',
      '',
    ].join('\n'),
    'utf8',
  );

  if (process.platform === 'win32') {
    const stubPath = join(binDir, 'pnpm.cmd');
    // %~dp0 includes a trailing backslash; node receives the absolute
    // path to pnpm-stub.mjs and writes the payload to stdout.
    writeFileSync(stubPath, `@echo off\r\nnode "%~dp0pnpm-stub.mjs"\r\n`, 'utf8');
  } else {
    const stubPath = join(binDir, 'pnpm');
    writeFileSync(stubPath, `#!/usr/bin/env bash\nexec node "$(dirname "$0")/pnpm-stub.mjs"\n`, {
      encoding: 'utf8',
      mode: 0o755,
    });
  }

  // Copy audit-check.mjs into the sandbox so `process.cwd()` (and thus
  // the audit.json write target) lands inside the sandbox when we
  // `cwd:` the spawn there.
  const scriptCopy = join(sandbox, 'audit-check.mjs');
  writeFileSync(scriptCopy, readFileSync(SCRIPT_PATH, 'utf8'), 'utf8');

  return { sandbox, binDir, scriptCopy };
}

function runCli({ sandbox, binDir, scriptCopy }) {
  const pathSep = process.platform === 'win32' ? ';' : ':';
  return spawnSync(process.execPath, [scriptCopy], {
    cwd: sandbox,
    env: {
      ...process.env,
      PATH: `${binDir}${pathSep}${process.env.PATH ?? ''}`,
    },
    encoding: 'utf8',
  });
}

describe('audit-check CLI', () => {
  /** @type {string | null} */
  let activeSandbox = null;

  afterEach(() => {
    if (activeSandbox) {
      rmSync(activeSandbox, { recursive: true, force: true });
      activeSandbox = null;
    }
  });

  it('exits 0 when pnpm audit reports no advisories (Task #224 AC #1, happy path)', () => {
    const ctx = setupStubSandbox({ advisories: {} });
    activeSandbox = ctx.sandbox;

    const result = runCli(ctx);

    expect(result.status).toBe(0);
    const artifact = JSON.parse(readFileSync(join(ctx.sandbox, 'audit.json'), 'utf8'));
    expect(artifact.summary).toMatchObject({
      totalFindings: 0,
      blocking: 0,
      suppressed: 0,
      moderate: 0,
    });
  });

  it('exits non-zero on any unsuppressed High advisory (Task #224 AC #1)', () => {
    const ctx = setupStubSandbox({
      advisories: {
        1: {
          github_advisory_id: 'GHSA-high-uncovered',
          severity: 'high',
          module_name: 'evil-pkg',
          title: 'Code execution via prototype pollution',
          url: 'https://example.invalid/h',
        },
      },
    });
    activeSandbox = ctx.sandbox;

    const result = runCli(ctx);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/GHSA-high-uncovered/);
  });

  it('exits non-zero on any unsuppressed Critical advisory', () => {
    const ctx = setupStubSandbox({
      advisories: {
        1: {
          github_advisory_id: 'GHSA-crit-uncovered',
          severity: 'critical',
          module_name: 'evil-pkg',
          title: 'RCE',
        },
      },
    });
    activeSandbox = ctx.sandbox;

    const result = runCli(ctx);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/GHSA-crit-uncovered/);
  });

  it('writes audit.json with the full findings list to the workspace root (Task #224 AC #2)', () => {
    const ctx = setupStubSandbox({
      advisories: {
        1: {
          github_advisory_id: 'GHSA-h',
          severity: 'high',
          module_name: 'a',
          title: 't',
        },
        2: {
          github_advisory_id: 'GHSA-m',
          severity: 'moderate',
          module_name: 'b',
          title: 't',
        },
      },
    });
    activeSandbox = ctx.sandbox;

    runCli(ctx);

    const artifactPath = join(ctx.sandbox, 'audit.json');
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    expect(artifact.schema).toBe('athportal-audit-check@1');
    expect(artifact.summary.totalFindings).toBe(2);
    expect(artifact.blocking.map((/** @type {{ id: string }} */ f) => f.id)).toEqual(['GHSA-h']);
    expect(artifact.moderate.map((/** @type {{ id: string }} */ f) => f.id)).toEqual(['GHSA-m']);
  });

  it('surfaces Moderate findings in audit.json without failing the gate (Task #224 AC #3)', () => {
    const ctx = setupStubSandbox({
      advisories: {
        1: {
          github_advisory_id: 'GHSA-mod-only',
          severity: 'moderate',
          module_name: 'm',
          title: 'meh',
        },
      },
    });
    activeSandbox = ctx.sandbox;

    const result = runCli(ctx);

    expect(result.status).toBe(0);
    const artifact = JSON.parse(readFileSync(join(ctx.sandbox, 'audit.json'), 'utf8'));
    expect(artifact.summary.moderate).toBe(1);
    expect(artifact.summary.blocking).toBe(0);
    expect(artifact.moderate.map((/** @type {{ id: string }} */ f) => f.id)).toEqual([
      'GHSA-mod-only',
    ]);
  });

  it('exits non-zero when the only blocking finding is paired with a malformed allow-list entry', () => {
    // Patch the script copy to inject a malformed IGNORED entry so we
    // exercise the validation-failure exit path through the CLI surface.
    const ctx = setupStubSandbox({ advisories: {} });
    activeSandbox = ctx.sandbox;
    const original = readFileSync(ctx.scriptCopy, 'utf8');
    const patched = original.replace(
      'export const IGNORED = {',
      "export const IGNORED = {\n  'GHSA-no-reason': { revisit: '2027-01-01' },",
    );
    writeFileSync(ctx.scriptCopy, patched, 'utf8');

    const result = runCli(ctx);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/allow-list entry incomplete/);
  });
});
