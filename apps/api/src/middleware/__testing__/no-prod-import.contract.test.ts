// apps/api/src/middleware/__testing__/no-prod-import.contract.test.ts
//
// Guard contract test (Story #342 / Task #355).
//
// Regression guard for the test-auth seam: if any production entry point
// ever imports from `apps/api/src/middleware/__testing__/`, this test
// fails with a clear message naming the offending file and the import
// specifier. The seam relies on the test-only adapter NEVER reaching a
// production bundle (Tech Spec #318 §F).
//
// Strategy: static scan, not a runtime import. We read each production
// entry point as text and look for any `import …from '…__testing__…'`
// or `import('…__testing__…')` form. A static scan is sufficient because
// the bundler (esbuild for the Worker, Astro for the web app) resolves
// imports lexically — there is no runtime path that would smuggle a
// `__testing__` module past static analysis without also appearing in
// the source as an import statement.
//
// Scope: every production entry point listed in `PROD_ENTRY_POINTS`. To
// extend coverage, add the new file to that list — the test iterates,
// so one new entry costs one new line.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Repository root, resolved from the location of this file. We sit at
// apps/api/src/middleware/__testing__/, so five levels up is the repo
// root.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

/**
 * Production entry points that MUST NOT reach into `__testing__/`. The
 * list is intentionally explicit — a globbed scan would silently lose
 * coverage if a new entry point is added under a non-obvious path.
 *
 * Per Tech Spec #318 §F:
 *   - `apps/api/src/index.ts` — the Hono Worker entry.
 *   - `apps/web/src/middleware.ts` — the Astro request middleware.
 */
const PROD_ENTRY_POINTS = [
  join(REPO_ROOT, 'apps', 'api', 'src', 'index.ts'),
  join(REPO_ROOT, 'apps', 'web', 'src', 'middleware.ts'),
] as const;

/**
 * Match any import-like construct whose specifier contains the segment
 * `__testing__`. Covers:
 *   - `import x from '…/__testing__/foo'`
 *   - `import { x } from "…/__testing__/foo"`
 *   - `import '…/__testing__/foo'`     (bare side-effect import)
 *   - `import('…/__testing__/foo')`    (dynamic import expression)
 *   - `require('…/__testing__/foo')`   (defensive — we are ESM, but if
 *     a future entry point goes through CJS interop this catches it)
 *
 * The pattern is intentionally generous on whitespace and quote style
 * so cosmetic reformats do not weaken the guard.
 */
const FORBIDDEN_IMPORT =
  /(?:import\s*(?:[\s\S]*?from\s*)?|import\s*\(\s*|require\s*\(\s*)['"][^'"]*__testing__[^'"]*['"]/g;

function scanForForbiddenImports(absolutePath: string): string[] {
  const source = readFileSync(absolutePath, 'utf8');
  const matches: string[] = [];
  for (const match of source.matchAll(FORBIDDEN_IMPORT)) {
    matches.push(match[0]);
  }
  return matches;
}

describe('production entry points must not import from __testing__/', () => {
  for (const entry of PROD_ENTRY_POINTS) {
    it(`${entry} carries no import rooted at __testing__/`, () => {
      const offending = scanForForbiddenImports(entry);
      expect(
        offending,
        `Production entry point ${entry} imports from a __testing__/ path. ` +
          `Found ${offending.length} offending import(s): ${JSON.stringify(offending)}. ` +
          'The test-auth seam (Tech Spec #318 §F) MUST never reach a production bundle. ' +
          'Move the import to a test-tier helper, or split the production logic out of __testing__/.',
      ).toEqual([]);
    });
  }
});
