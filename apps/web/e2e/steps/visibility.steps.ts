/**
 * Visibility step library.
 *
 * Owns Then phrases that assert user-visible outcomes — "I see the welcome
 * banner", "I see the error message". Steps use accessibility locators
 * (`getByRole`, `getByText`) exclusively; raw CSS selectors and DOM
 * queries are forbidden by `docs/testing-strategy.md` § Forbidden
 * Patterns.
 *
 * `.feature` scenarios refer to elements by business concept ("the
 * welcome banner"); this file maps those concepts to accessible names.
 */
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { Then } = createBdd();

/**
 * Map a business-language element name to a Playwright accessibility
 * locator. Co-locating the table keeps scenarios free of `data-testid`
 * values and DOM selectors.
 */
function resolveVisibleConcept(conceptName: string) {
  switch (conceptName) {
    case 'welcome banner':
      return { role: 'banner' as const, nameRegex: /welcome/i };
    default:
      throw new Error(
        `Unknown visible concept: "${conceptName}". Add it to resolveVisibleConcept in apps/web/e2e/steps/visibility.steps.ts.`,
      );
  }
}

Then('I see the {word} banner', async ({ page }, bannerName: string) => {
  const { role, nameRegex } = resolveVisibleConcept(`${bannerName} banner`);
  await expect(page.getByRole(role, { name: nameRegex })).toBeVisible();
});
