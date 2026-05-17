/**
 * lint-steps fixture — should be rejected by [no-dom-selector].
 *
 * The step body reaches for a raw locator via `page.locator(...)` with a
 * `data-testid` selector. Per docs/testing-strategy.md the acceptance
 * tier must use accessibility locators (`getByRole`, `getByText`) only.
 * This file is intentionally broken; the production linter never walks
 * scripts/__fixtures__/.
 */
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { Then } = createBdd();

Then('I see the welcome card via a dom selector', async ({ page }) => {
  await expect(page.locator('[data-testid=welcome-card]')).toBeVisible();
});
