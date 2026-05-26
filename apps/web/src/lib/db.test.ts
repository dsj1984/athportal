// apps/web/src/lib/db.test.ts
//
// Unit test for `findMonorepoRoot()` — Story #903 hardening of the
// resolver landed by Story #877.
//
// Story #877 anchored relative `file:` URLs against the monorepo root,
// but the implementation hard-coded a four-directory climb that assumed
// Vite/Astro emitted SSR chunks at the same depth as the source file
// (`apps/web/src/lib/db.ts`). In production, the bundled SSR chunk may
// land at `apps/web/dist/server/chunks/<hash>.mjs` (six levels deep) or
// `apps/web/dist/server/entry.mjs` (four levels — coincidentally passes
// the fixed climb but only at one specific depth). The hardening
// switches to a `pnpm-workspace.yaml` upward search that works
// regardless of the running module's depth.
//
// This test pins the new behaviour and locks the regression: a fresh
// stub that walks four levels (the prior implementation's shape) WOULD
// fail the "deep-dist" case, but the upward search passes it.
//
// Unit tier per `.agents/rules/testing-standards.md § Unit` — no DB, no
// network, just filesystem fixture directories and the pure resolver.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findMonorepoRoot } from './db';

// Synthetic monorepo fixture rooted under the OS tmpdir. We layout a
// directory tree that mimics a real workspace so we can exercise the
// resolver from several different "running module locations" without
// touching the real repo.
const FIXTURE_BASE = join(tmpdir(), 'athportal-findMonorepoRoot-test');
const FIXTURE_ROOT = join(FIXTURE_BASE, 'workspace-fixture');
const FIXTURE_MARKER = join(FIXTURE_ROOT, 'pnpm-workspace.yaml');

// Three synthetic "running module" locations of varying depth, each
// nested under the FIXTURE_ROOT. The fixed-4-level prior implementation
// would resolve to the wrong directory for two of them; the upward
// search must produce FIXTURE_ROOT for all three.
const SOURCE_DEPTH_DIR = join(FIXTURE_ROOT, 'apps', 'web', 'src', 'lib');
const SHALLOW_DIST_DIR = join(FIXTURE_ROOT, 'apps', 'web', 'dist', 'server');
const DEEP_DIST_DIR = join(FIXTURE_ROOT, 'apps', 'web', 'dist', 'server', 'chunks');

beforeAll(() => {
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  writeFileSync(FIXTURE_MARKER, "packages:\n  - 'apps/*'\n");
  mkdirSync(SOURCE_DEPTH_DIR, { recursive: true });
  mkdirSync(SHALLOW_DIST_DIR, { recursive: true });
  mkdirSync(DEEP_DIST_DIR, { recursive: true });
});

afterAll(() => {
  try {
    rmSync(FIXTURE_BASE, { recursive: true, force: true });
  } catch {
    // Intentionally ignored — Windows may still hold handles.
  }
});

describe('findMonorepoRoot()', () => {
  it('resolves the workspace root when called from the source layout (apps/web/src/lib)', () => {
    expect(findMonorepoRoot(SOURCE_DEPTH_DIR)).toBe(FIXTURE_ROOT);
  });

  it('resolves the workspace root when called from a shallow bundled SSR location (apps/web/dist/server)', () => {
    // Story #903 regression guard — the prior 4-level fixed climb would
    // land at apps/web/dist (one level inside the workspace), NOT at
    // FIXTURE_ROOT. The upward search reads pnpm-workspace.yaml at the
    // root and returns the correct anchor.
    expect(findMonorepoRoot(SHALLOW_DIST_DIR)).toBe(FIXTURE_ROOT);
  });

  it('resolves the workspace root when called from a deep bundled chunk (apps/web/dist/server/chunks)', () => {
    // The Astro/Vite SSR emit shape from production builds. The 4-level
    // fixed climb resolves to `apps/web/dist` (chunks → server → dist →
    // web), missing the root by two levels. The upward search reads the
    // marker correctly.
    expect(findMonorepoRoot(DEEP_DIST_DIR)).toBe(FIXTURE_ROOT);
  });

  it('throws an actionable error when no pnpm-workspace.yaml is found upward', () => {
    // Walk upward from the OS tmpdir itself. tmpdir() is a system path
    // that does not contain a pnpm-workspace.yaml marker (we may
    // contend with the fixture marker if tmpdir is shallow, so isolate
    // to a synthetic subdirectory we know is empty of markers above).
    const isolatedRoot = join(FIXTURE_BASE, 'no-marker-here');
    mkdirSync(isolatedRoot, { recursive: true });
    // Note: this test relies on the OS tmpdir not being itself nested
    // inside a pnpm-workspace.yaml-containing tree. On standard CI and
    // dev hosts this holds. If it ever doesn't, the test fails fast
    // with a clear assertion error rather than misbehaving silently.
    expect(() => findMonorepoRoot(isolatedRoot)).toThrow(/pnpm-workspace\.yaml/);
  });

  it('resolves the workspace root when called from FIXTURE_ROOT itself', () => {
    // Edge case — the running module lives directly at the root. The
    // first existsSync check should hit the marker without climbing.
    expect(findMonorepoRoot(FIXTURE_ROOT)).toBe(FIXTURE_ROOT);
  });
});
