/**
 * CSV-import step library (Epic #10 / Story #663 / Task #686).
 *
 * Owns the step phrases used by the org-admin CSV-import acceptance
 * scenarios (`tests/features/org-admin/csv-import.feature`). Wire
 * shape (parse + commit envelopes, rollback, duplicate-email reuse,
 * cross-tenant team isolation) is pinned by the contract suite at
 * `apps/api/src/routes/v1/admin/csv-import/csv-import.contract.test.ts`;
 * these steps assert only what the admin sees on the page once the
 * upload/commit flow completes.
 *
 * Step authoring rules — no DOM selectors in scenario text, no URL
 * literals, no HTTP status codes inside step bodies — live in
 * `.agents/rules/gherkin-standards.md` and `docs/testing-strategy.md`.
 */

import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { Given, When, Then } = createBdd();

const ADMIN_CSV_IMPORT_PATH = '/admin/import';

const HAPPY_CSV = [
  'email,firstName,lastName',
  'a@example.invalid,Ada,Lovelace',
  'b@example.invalid,Bob,Smith',
  'c@example.invalid,Carol,Jones',
].join('\n');

const REUSE_CSV = [
  'email,firstName,lastName',
  'existing@example.invalid,Existing,User',
  'newcomer@example.invalid,New,Comer',
].join('\n');

Given('my organization knows about an existing platform account', async () => {
  // The contract suite pins the persistence side of duplicate-email
  // reuse; here we only need a scenario-readable precondition that
  // signals "the email in the upload exists in `users`". The seed
  // step is owned by the API-side fixture seeding that runs against
  // the preview stack; the step body is intentionally a no-op so the
  // scenario text reads as the user-visible precondition.
});

When('I open the admin csv import page', async ({ page }) => {
  await page.goto(ADMIN_CSV_IMPORT_PATH);
});

When('I upload a roster csv with three new athletes', async ({ page }) => {
  const input = page.getByTestId('admin-csv-upload-input');
  await input.setInputFiles({
    name: 'roster.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(HAPPY_CSV, 'utf8'),
  });
});

When('I upload a roster csv that includes the existing account email', async ({ page }) => {
  const input = page.getByTestId('admin-csv-upload-input');
  await input.setInputFiles({
    name: 'roster-reuse.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(REUSE_CSV, 'utf8'),
  });
});

When('I map every required column to its target field', async ({ page }) => {
  const mapping = page.getByTestId('admin-csv-mapping');
  await expect(mapping).toBeVisible();
  // The page renders one <select> per header; map by header name to
  // the matching target option. The header → target pairs come from
  // the CSV bodies above.
  for (const header of ['email', 'firstName', 'lastName'] as const) {
    const select = mapping.locator(`select[data-header="${header}"]`);
    await select.selectOption(header);
  }
});

When('I commit the csv import', async ({ page }) => {
  const commit = page.getByTestId('admin-csv-commit-btn');
  await expect(commit).toBeEnabled();
  await commit.click();
});

Then('I see the csv import success summary', async ({ page }) => {
  const status = page.getByTestId('admin-csv-status');
  await expect(status).toContainText('Imported');
});

Then('I see the csv import summary report a reused account', async ({ page }) => {
  const status = page.getByTestId('admin-csv-status');
  await expect(status).toContainText('Reused 1');
});
