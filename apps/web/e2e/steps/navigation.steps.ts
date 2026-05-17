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
    default:
      throw new Error(
        `Unknown page name: "${pageName}". Add it to resolvePagePath in apps/web/e2e/steps/navigation.steps.ts.`,
      );
  }
}

When('I open the {word} page', async ({ page }, pageName: string) => {
  await page.goto(resolvePagePath(`${pageName} page`));
});
