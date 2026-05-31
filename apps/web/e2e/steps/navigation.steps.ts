/**
 * Navigation step library.
 *
 * Owns When phrases that drive page navigation and routing transitions
 * (open a named page, follow a named link, return to a previously visited
 * surface). Page names map to URLs inside step bodies so scenarios never
 * mention a route path directly.
 *
 * Step authoring rules — no URL literals or framework names in scenario
 * text — live in `.agents/rules/gherkin-standards.md`.
 */
import { createBdd } from 'playwright-bdd';

const { When } = createBdd();

/**
 * Resolve a business-language page name to its routable path. Centralising
 * the table here keeps `.feature` scenarios free of URL literals and gives
 * a single place to migrate when routes move.
 */
function resolvePagePath(pageName: string): string {
  switch (pageName) {
    case 'welcome page':
    case 'public welcome page':
      return '/';
    case 'dashboard page':
      return '/dashboard';
    default:
      throw new Error(
        `Unknown page name: "${pageName}". Add it to resolvePagePath in apps/web/e2e/steps/navigation.steps.ts.`,
      );
  }
}

When('I open the {word} page', async ({ page }, pageName: string) => {
  await page.goto(resolvePagePath(`${pageName} page`));
});

/**
 * Follow a primary navigation link in the authenticated App Shell header
 * by its visible label. Each header row renders with a stable
 * `app-nav-item-<slug>` data-testid (the `APP_NAV_ITEM_TEST_ID_PREFIX`
 * contract pinned in `apps/web/src/lib/navigation.ts`); the slug
 * derivation here mirrors that registry so scenarios name the link by
 * its label ("Roster") without mentioning a route path or selector.
 */
When('I follow the {string} link in the app header', async ({ page }, label: string) => {
  const slug = label
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  await page.getByTestId(`app-nav-item-${slug}`).click();
});
