/**
 * Onboarding step library — Epic #8 acceptance scenarios.
 *
 * Binds the `.feature` files under
 * `tests/features/identity/onboarding/` to the `/onboarding` route and
 * the `/dashboard` surface that Story #574 + Story #552 landed on
 * `epic/8`. Every step asserts a user-visible outcome — "I see the
 * onboarding screen", "the submit control is disabled" — and never
 * touches `/api/` URL literals, HTTP status codes, DOM selectors, or
 * raw SQL, per `scripts/lint-steps.mjs` § Forbidden patterns. The
 * wire-shape of `POST /api/v1/auth/onboard`, the row state in
 * `users.onboarded_at`, and the schema of the `userLegalAgreements`
 * write all live in the contract-tier suite (Story #564 + Story #555).
 *
 * Scenarios are tagged `@pending` until the fresh-user fixture seam
 * lands — the seeded Clerk test-instance personas
 * (`athlete@example.com`, …) carry an already-stamped onboarding row,
 * so the un-onboarded branch needs either a dedicated seed or a
 * per-scenario reset hook before the un-`@pending` cutover.
 */
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { Given, When, Then } = createBdd();

/**
 * Resolve a business-language surface name to the route the
 * acceptance runner navigates to. Centralising the table here keeps
 * `.feature` scenarios free of URL literals and gives a single place
 * to migrate when routes move.
 */
const SURFACE_NAME_TO_PATH: ReadonlyMap<string, string> = new Map([
  ['dashboard', '/dashboard'],
  ['dashboard page', '/dashboard'],
  ['dashboard surface', '/dashboard'],
  ['onboarding', '/onboarding'],
  ['onboarding screen', '/onboarding'],
  ['onboarding surface', '/onboarding'],
]);

function resolveOnboardingSurfacePath(surfaceName: string): string {
  const path = SURFACE_NAME_TO_PATH.get(surfaceName);
  if (path === undefined) {
    throw new Error(
      `Unknown onboarding surface: "${surfaceName}". ` +
        'Add it to SURFACE_NAME_TO_PATH in apps/web/e2e/steps/onboarding.steps.ts.',
    );
  }
  return path;
}

// ---------------------------------------------------------------------------
// Onboarding-state preconditions
// ---------------------------------------------------------------------------

/**
 * Mark the signed-in user as not-yet-onboarded for the scenario.
 *
 * The production source of truth for "has this user completed
 * onboarding" is `users.onboarded_at` (Story #553 schema, Story #555
 * query layer). This step is a placeholder until the fresh-user
 * fixture seam lands — scenarios that depend on it carry `@pending`
 * so bddgen skips them. The phrase is bound here so the step library
 * is complete on the day the seam lands.
 */
Given('I have not yet completed onboarding', async () => {
  // Intentional no-op. The corresponding scenarios are tagged
  // `@pending`; the fixture seam that resets `users.onboarded_at` for
  // the seeded persona lands in a follow-up Story.
});

Given('I have already completed onboarding', async () => {
  // Intentional no-op. The seeded Clerk test-instance personas carry
  // an already-stamped onboarding row at JIT-provision time, so the
  // onboarded branch needs no per-scenario setup against the seam.
  // Kept as an explicit phrase so scenarios read as a complete
  // business statement.
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

When('I navigate directly to the {word} surface', async ({ page }, surfaceName: string) => {
  await page.goto(resolveOnboardingSurfacePath(`${surfaceName} surface`));
});

When('I open the onboarding screen', async ({ page }) => {
  await page.goto(resolveOnboardingSurfacePath('onboarding screen'));
});

When('I submit the onboarding form', async ({ page }) => {
  await page.getByRole('button', { name: /finish setting up your account/i }).click();
});

// ---------------------------------------------------------------------------
// Form interactions — kept business-shaped; selectors stay inside step bodies
// ---------------------------------------------------------------------------

When('I complete the onboarding profile fields', async ({ page }) => {
  await page.getByLabel(/first name/i).fill('Ada');
  await page.getByLabel(/last name/i).fill('Lovelace');
  await page.getByLabel(/display name/i).fill('Ada L.');
});

When('I attest that I am at least 13 years old', async ({ page }) => {
  await page.getByRole('checkbox', { name: /at least 13/i }).check();
});

When('I attest that I am under 13', async () => {
  // Mirror of the above — leaving the age-attestation checkbox
  // unticked is what AC-8 actually asserts at the user-visible
  // layer. The step is bound so the scenario reads as a complete
  // business statement.
});

When('I accept the Terms of Service', async ({ page }) => {
  await page.getByRole('checkbox', { name: /terms of service/i }).check();
});

When('I accept the Privacy Policy', async ({ page }) => {
  await page.getByRole('checkbox', { name: /privacy policy/i }).check();
});

When('I leave the Terms of Service unaccepted', async () => {
  // Default state — the ToS checkbox starts unticked. The phrase is
  // bound so the scenario reads as a complete business statement
  // about what the user did not do.
});

When('I leave the Privacy Policy unaccepted', async () => {
  // Default state — the Privacy Policy checkbox starts unticked.
});

When('I skip uploading a profile photo', async () => {
  // Default state — the photo upload field starts empty. The phrase
  // is bound so the scenario reads as a complete business statement.
});

When('I upload a profile photo', async () => {
  // Intentional no-op for the @pending scaffold. The upload pipeline
  // (signed upload URL → photo island → form payload) wires in with
  // the photo-fixture seam in a follow-up Story.
});

When('my primary email is not yet verified', async () => {
  // Default state — the Clerk verify-email island renders the
  // unverified branch until the SDK reports verification.
});

When('my primary email becomes verified', async () => {
  // Driven by the Clerk testing helper in a follow-up Story; until
  // then the corresponding scenarios are `@pending`.
});

When('I request a verification email', async ({ page }) => {
  await page.getByRole('button', { name: /resend verification email/i }).click();
});

// ---------------------------------------------------------------------------
// Invite-acceptance preconditions (parent-athlete linking)
// ---------------------------------------------------------------------------

Given('I have a pending invite addressed to my account email', async () => {
  // Placeholder until the invite-fixture seam lands.
});

Given('I have a pending invite addressed to a different email than my account', async () => {
  // Placeholder until the invite-fixture seam lands.
});

When('I accept the invite during onboarding', async () => {
  // Placeholder until the invite-fixture seam lands.
});

// ---------------------------------------------------------------------------
// User-visible outcomes
// ---------------------------------------------------------------------------

Then('I see the onboarding screen', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /set up your account/i })).toBeVisible();
});

Then('I see the dashboard surface', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /^dashboard$/i })).toBeVisible();
});

Then('I see the {word} widget empty state', async ({ page }, widgetName: string) => {
  // Map the business name to the empty-state title rendered by
  // `EmptyState.astro`. Page-level test ids are owned by the
  // dashboard data-shaper (`apps/web/src/pages/dashboard.ts`); the
  // step asserts the user-visible title so the scenario stays free
  // of testid literals.
  const titleByWidget: Record<string, RegExp> = {
    'recent-activity': /nothing in your feed yet/i,
    roster: /no teams yet/i,
    upcoming: /nothing scheduled yet/i,
  };
  const title = titleByWidget[widgetName];
  if (!title) {
    throw new Error(
      `Unknown dashboard widget: "${widgetName}". ` +
        'Add it to titleByWidget in apps/web/e2e/steps/onboarding.steps.ts.',
    );
  }
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
});

Then('I see an initials-avatar placeholder', async ({ page }) => {
  // The dashboard renders an initials avatar when no photo is on
  // file. The fixture seam that asserts the rendered initials lands
  // with the avatar story; until then the scenarios that reference
  // this phrase are `@pending`.
  await expect(page.getByRole('img', { name: /initials/i })).toBeVisible();
});

Then('I see my uploaded profile photo on the dashboard', async ({ page }) => {
  await expect(page.getByRole('img', { name: /profile photo/i })).toBeVisible();
});

Then('I see the linked athlete on my dashboard', async ({ page }) => {
  await expect(page.getByRole('region', { name: /linked athlete/i })).toBeVisible();
});

Then('I see an invite-mismatch error', async ({ page }) => {
  await expect(
    page.getByRole('alert', { name: /invite.*email.*do(es)? not match/i }),
  ).toBeVisible();
});

Then('I see an under-13 not-available message', async ({ page }) => {
  await expect(page.getByRole('alert', { name: /not available.*under 13/i })).toBeVisible();
});

Then('I see a Terms of Service acceptance error', async ({ page }) => {
  await expect(page.getByText(/accept.*terms of service/i)).toBeVisible();
});

Then('I see a Privacy Policy acceptance error', async ({ page }) => {
  await expect(page.getByText(/accept.*privacy policy/i)).toBeVisible();
});

Then('the submit control is disabled', async ({ page }) => {
  const button = page.getByRole('button', { name: /finish setting up your account/i });
  await expect(button).toBeDisabled();
});

Then('the submit control becomes enabled', async ({ page }) => {
  const button = page.getByRole('button', { name: /finish setting up your account/i });
  await expect(button).toBeEnabled();
});

Then('I remain on the onboarding screen', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /set up your account/i })).toBeVisible();
});

Then('my previously-recorded onboarding completion is unchanged', async () => {
  // The "no change" invariant is a DB-side assertion; the contract
  // suite covers `users.onboarded_at` immutability on replay
  // (Story #564). At the acceptance tier the user-visible outcome
  // is simply "the user stays on the dashboard" — already covered
  // by the previous Then.
});
