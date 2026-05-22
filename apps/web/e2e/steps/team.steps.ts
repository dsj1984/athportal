/**
 * Team admin step library — Epic #10 acceptance scenarios.
 *
 * Binds the `.feature` files under `tests/features/identity/team/` that
 * pin the user-visible side of the org-admin Team CRUD surface
 * (Story #657 / Task #677). The wire shape — POST/PATCH/archive payload,
 * cross-org 404 isolation, `archived_at` column state — is exhaustively
 * covered by the contract suite at
 * `apps/api/src/routes/v1/admin/teams.contract.test.ts`; the steps below
 * assert only what an org admin sees on the page.
 *
 * Scenarios are tagged `@pending` until the fresh-org-admin fixture seam
 * lands — the seeded Clerk test-instance org-admin persona carries pre-
 * existing rows that the create / archive scenarios mutate, and the
 * suite needs a per-scenario reset hook before the un-`@pending`
 * cutover. The step bodies are wired against the real `/admin/teams`
 * surface that Task #676 landed so the seam swap is a one-line change
 * in the test config, not a step-library rewrite.
 *
 * Per `scripts/lint-steps.mjs` § Forbidden patterns: no `/api/` literals,
 * HTTP status codes, DOM selectors, or raw SQL appear in any step body.
 * The `data-testid` strings live behind `getByTestId(...)` calls that
 * resolve a business-language concept ("the team management page") to a
 * stable test id.
 */

import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { Given, When, Then } = createBdd();

/**
 * Resolve a business-language admin surface name to its route. The
 * `/admin/teams` surface that Task #676 landed is the single page this
 * Epic exposes; downstream Epics extend this table as new admin
 * surfaces land.
 */
const ADMIN_SURFACE_TO_PATH: ReadonlyMap<string, string> = new Map([
  ['team management page', '/admin/teams'],
  ['archived teams view', '/admin/teams'],
]);

function resolveAdminSurfacePath(surfaceName: string): string {
  const path = ADMIN_SURFACE_TO_PATH.get(surfaceName);
  if (path === undefined) {
    throw new Error(
      `Unknown admin surface: "${surfaceName}". ` +
        'Add it to ADMIN_SURFACE_TO_PATH in apps/web/e2e/steps/team.steps.ts.',
    );
  }
  return path;
}

// ---------------------------------------------------------------------------
// Preconditions
// ---------------------------------------------------------------------------

Given('one of my teams is named {string}', async () => {
  // Placeholder until the fresh-org-admin fixture seam lands. The
  // matching scenario is `@pending`; the seam will seed the named
  // team for the signed-in org admin before each scenario.
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

When('I open the team management page', async ({ page }) => {
  await page.goto(resolveAdminSurfacePath('team management page'));
});

// ---------------------------------------------------------------------------
// Form interactions — selectors stay inside step bodies
// ---------------------------------------------------------------------------

When(
  'I create a team named {string} for {string} in {string} for {string}',
  async ({ page }, name: string, sport: string, season: string, ageGroup: string) => {
    await page.getByTestId('admin-teams-create-link').click();
    await page.getByLabel(/team name/i).fill(name);
    await page.getByLabel(/sport/i).fill(sport);
    await page.getByLabel(/season/i).fill(season);
    await page.getByLabel(/age group/i).fill(ageGroup);
    await page.getByRole('button', { name: /create team/i }).click();
  },
);

When(
  'I rename the team {string} to {string}',
  async ({ page }, _currentName: string, newName: string) => {
    // The edit affordance per row is the "Edit" link inside the
    // matching row of the teams table. The acceptance scenario names
    // the team by its current name; the step body resolves the row
    // via the visible text and follows its edit link.
    await page
      .getByTestId('admin-teams-row')
      .filter({ hasText: _currentName })
      .getByTestId('admin-team-edit-link')
      .click();
    await page.getByLabel(/team name/i).fill(newName);
    await page.getByRole('button', { name: /save changes/i }).click();
  },
);

When('I archive the team {string}', async ({ page }, teamName: string) => {
  await page
    .getByTestId('admin-teams-row')
    .filter({ hasText: teamName })
    .getByTestId('admin-team-archive-btn')
    .click();
});

// ---------------------------------------------------------------------------
// User-visible outcomes
// ---------------------------------------------------------------------------

Then('I see the team {string} on the active teams list', async ({ page }, teamName: string) => {
  await expect(page.getByTestId('admin-teams-row').filter({ hasText: teamName })).toBeVisible();
});

Then(
  'I no longer see the team {string} on the active teams list',
  async ({ page }, teamName: string) => {
    await expect(page.getByTestId('admin-teams-row').filter({ hasText: teamName })).toHaveCount(0);
  },
);

Then('I see the team {string} on the archived teams list', async ({ page }, teamName: string) => {
  // Flip the show-archived toggle so the row appears in the
  // archived-only view. The toggle's accessible label maps to the
  // checkbox the page renders next to the table.
  await page.getByRole('checkbox', { name: /show archived/i }).check();
  await expect(page.getByTestId('admin-teams-row').filter({ hasText: teamName })).toBeVisible();
});
