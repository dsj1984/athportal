// packages/shared/src/testing/no-prod-import.contract.test.ts
//
// Guard contract test (Story #371 / AC-7).
//
// Mirror of `apps/api/src/middleware/__testing__/no-prod-import.contract.test.ts`,
// scoped to the test-auth seam under `@repo/shared/testing`. The seam
// brings `@clerk/testing/playwright` in as a devDependency; this guard
// keeps that surface (and the broader `testing/` subpath) out of every
// production bundle.
//
// Strategy: static scan, not a runtime import. We read each production
// entry point as text and look for any `import …from '…/testing…'` or
// `import('…/testing…')` form. A static scan is sufficient because the
// bundler (esbuild for the Worker, Astro for the web app) resolves
// imports lexically — there is no runtime path that would smuggle a
// `testing` module past static analysis without also appearing in the
// source as an import statement.
//
// Scope: every production entry point listed in `PROD_ENTRY_POINTS`. To
// extend coverage, add the new file to that list.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Repository root, resolved from the location of this file. We sit at
// packages/shared/src/testing/, so four levels up is the repo root.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

/**
 * Production entry points that MUST NOT reach into `@repo/shared/testing`
 * (or its package-relative path forms). The list is explicit so a globbed
 * scan does not silently lose coverage when a new entry point lands.
 *
 *   - `apps/api/src/index.ts` — the Hono Worker entry.
 *   - `apps/web/src/middleware.ts` — the Astro request middleware.
 *   - `packages/shared/src/index.ts` — the public `@repo/shared` surface.
 */
const PROD_ENTRY_POINTS = [
  join(REPO_ROOT, 'apps', 'api', 'src', 'index.ts'),
  join(REPO_ROOT, 'apps', 'web', 'src', 'middleware.ts'),
  join(REPO_ROOT, 'packages', 'shared', 'src', 'index.ts'),
] as const;

/**
 * Match any import-like construct whose specifier contains a reference
 * to the testing subpath. Covers:
 *   - `import x from '@repo/shared/testing'`
 *   - `import x from '@repo/shared/testing/auth'`
 *   - `import x from '../testing'` / `'./testing/...'`
 *   - bare side-effect imports and dynamic `import('…')` calls
 *   - `@clerk/testing/...` (the testing package itself — production
 *     bundles MUST NOT statically import it).
 */
const FORBIDDEN_IMPORT =
  /(?:import\s*(?:[\s\S]*?from\s*)?|import\s*\(\s*|require\s*\(\s*)['"]((?:@repo\/shared\/testing|@clerk\/testing|(?:\.{1,2}\/)+(?:[^'"]*\/)?testing)(?:['"\/])[^'"]*)['"]/g;

function scanForForbiddenImports(absolutePath: string): string[] {
  const source = readFileSync(absolutePath, 'utf8');
  const matches: string[] = [];
  for (const match of source.matchAll(FORBIDDEN_IMPORT)) {
    matches.push(match[0]);
  }
  return matches;
}

describe('production entry points must not import @repo/shared/testing or @clerk/testing', () => {
  for (const entry of PROD_ENTRY_POINTS) {
    it(`${entry} carries no import rooted at a test-only surface`, () => {
      const offending = scanForForbiddenImports(entry);
      expect(
        offending,
        `Production entry point ${entry} imports from a test-only surface. ` +
          `Found ${offending.length} offending import(s): ${JSON.stringify(offending)}. ` +
          'The test-auth seam (Story #371) MUST never reach a production bundle. ' +
          'Move the import to a test-tier helper, or split the production logic out of testing/.',
      ).toEqual([]);
    });
  }
});
