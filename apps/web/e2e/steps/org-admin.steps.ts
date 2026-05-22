/**
 * Org-admin step library (Epic #10 / Story #656 / Task #672).
 *
 * Owns the step phrases used by the org-admin acceptance corpus —
 * navigation to the admin org-config surface, the form-field updates
 * that map to the published Zod input shape, and the user-visible
 * confirmations after a save.
 *
 * Step authoring rules — no DOM selectors in scenario text, no URL
 * literals, no HTTP status codes inside step bodies — live in
 * `.agents/rules/gherkin-standards.md` and
 * `docs/testing-strategy.md`. Selector concepts here translate
 * business-language element names ("the organization name field",
 * "the saved confirmation") into accessibility locators or, where the
 * underlying input has no accessible role, the canonical data-testid
 * surface published by the form island.
 */

import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { Given, When, Then } = createBdd();
// `Given` is re-exported here so this file can host future per-domain
// preconditions without re-importing playwright-bdd. The current
// scenarios reach for `When` / `Then` only; suppress unused-binding
// linters by referencing the import.
void Given;

const ADMIN_ORG_CONFIG_PATH = '/admin/org';
const ADMIN_ROSTER_PATH = '/admin/roster';

When('I open the admin org configuration page', async ({ page }) => {
  await page.goto(ADMIN_ORG_CONFIG_PATH);
});

When('I open the admin roster page', async ({ page }) => {
  await page.goto(ADMIN_ROSTER_PATH);
});

Then('I see the org-wide roster table', async ({ page }) => {
  // The page renders the empty table shell server-side; the inline
  // script populates rows from the API. Asserting the table surface
  // is visible is enough to prove the page reached the org admin —
  // shape and pagination assertions live in the contract tier
  // (`apps/api/src/routes/v1/admin/roster.contract.test.ts`).
  const table = page.getByTestId('admin-roster-table');
  await expect(table).toBeVisible();
});

When('I change the organization name to {string}', async ({ page }, name: string) => {
  const field = page.getByTestId('admin-org-name-input');
  await field.fill(name);
});

When('I save the org configuration changes', async ({ page }) => {
  const submit = page.getByTestId('admin-org-config-submit');
  await submit.click();
});

Then('I see the org configuration saved confirmation', async ({ page }) => {
  const status = page.getByTestId('admin-org-config-status');
  await expect(status).toHaveText('Saved');
});
