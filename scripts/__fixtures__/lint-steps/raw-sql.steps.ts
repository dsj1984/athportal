/**
 * lint-steps fixture — should be rejected by [no-raw-sql].
 *
 * The step body contains a raw SQL literal (SELECT ... FROM). This file is
 * intentionally broken; it is NOT picked up by the production linter
 * because the corpus walk only reads `apps/web/e2e/steps/**` — fixtures
 * live under `scripts/__fixtures__/lint-steps/` so they are exempt.
 *
 * Driven by the AC-5 evidence harness: `pnpm run lint:steps:fixtures`.
 */
import { createBdd } from 'playwright-bdd';

const { Given } = createBdd();

Given('the database has a seeded athlete with raw sql', async () => {
  const sql = 'SELECT id, name FROM athletes WHERE org_id = 1';
  // biome-ignore lint: intentionally-broken fixture for lint-steps.
  void sql;
});
