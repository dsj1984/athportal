/**
 * lint-steps fixture — should be rejected by [no-api-url-literal].
 *
 * The step body inlines an `/api/...` URL literal, leaking transport-tier
 * concerns into a scenario step. Per docs/testing-strategy.md API URLs
 * belong in contract tests. This file is intentionally broken; the
 * production linter never walks scripts/__fixtures__/.
 */
import { createBdd } from 'playwright-bdd';

const { When } = createBdd();

When('I call the users endpoint via an api url literal', async ({ request }) => {
  const url = '/api/v1/users';
  await request.get(url);
});
