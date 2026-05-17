/**
 * lint-steps fixture — should be rejected by [no-status-code].
 *
 * The step body asserts an HTTP status code, which is a contract-tier
 * concern per docs/testing-strategy.md. This file is intentionally
 * broken; the production linter never walks scripts/__fixtures__/.
 */
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { Then } = createBdd();

Then('the response is ok with a status code', async ({ request }) => {
  const res = await request.get('/health');
  expect(res.status).toBe(200);
});
