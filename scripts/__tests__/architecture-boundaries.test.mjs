// scripts/__tests__/architecture-boundaries.test.mjs
//
// Unit-tier mirror of `pnpm run lint:deps` (Story #590). Loads the root
// `.dependency-cruiser.cjs` config, runs dependency-cruiser's `cruise()`
// API against the workspace source tree, and asserts zero `error`-severity
// violations.
//
// Lives in the `scripts` Vitest project so it runs under `pnpm run test`
// alongside the rest of the unit-tier corpus. The same checks are also
// gated in CI as a dedicated `lint-deps` job — this test is the
// developer-loop surface, not a CI substitute.
//
// See docs/patterns.md § "Dependency boundaries (dependency-cruiser)"
// for the runbook and no-ratchet policy.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('architecture boundaries (dependency-cruiser)', () => {
  it('enforces zero error-severity violations across apps/** and packages/**', async () => {
    const configPath = path.join(REPO_ROOT, '.dependency-cruiser.cjs');
    // Use CJS require via createRequire so the .cjs config loads cleanly from this .mjs test.
    const { createRequire } = await import('node:module');
    const require_ = createRequire(import.meta.url);
    const ruleSet = require_(configPath);

    const { cruise } = await import('dependency-cruiser');
    const result = await cruise([path.join(REPO_ROOT, 'apps'), path.join(REPO_ROOT, 'packages')], {
      validate: true,
      ruleSet,
      outputType: 'json',
    });

    const summary =
      typeof result.output === 'string' ? JSON.parse(result.output).summary : result.output.summary;
    const errors = summary.violations.filter((v) => v.rule.severity === 'error');

    if (errors.length > 0) {
      const formatted = errors
        .map((v) => `  [${v.rule.name}] ${v.from}${v.to ? ` → ${v.to}` : ''}`)
        .join('\n');
      throw new Error(
        `dependency-cruiser found ${errors.length} architecture violation(s):\n${formatted}\n\n` +
          'Fix the import, or relax the rule in .dependency-cruiser.cjs in the same PR. ' +
          'See docs/patterns.md § "Dependency boundaries (dependency-cruiser)".',
      );
    }

    expect(errors).toHaveLength(0);
    // dependency-cruiser walks the entire apps/** + packages/** source
    // tree. In isolation this finishes in ~20s, but under the full
    // `test:coverage` run (V8 coverage instrumentation + 140+ parallel
    // test files) CPU contention on slower hosts can push it past the
    // prior 60s ceiling — a timeout flake, not a real violation. The
    // generous ceiling keeps the gate honest (the assertion still runs)
    // without flaking the close-validation coverage capture.
  }, 300_000);
});
