@pending @issue-997 @domain-onboarding @smoke @asserts-no-console-errors
Feature: A freshly created user can complete onboarding without console errors

  This scenario is the canonical regression guard for Story #958
  (PR #962), which fixed three broken inline `<script>` tags in the
  `/onboarding` islands. Before that fix, every page load threw
  `SyntaxError: Cannot use import statement outside a module`, the
  submit handler never wired up, and a real signup silently navigated
  to `/onboarding?firstName=…` instead of `POST /api/v1/auth/onboard`.
  This scenario re-runs that journey against a freshly minted Clerk
  Test user, asserts the dashboard outcome, AND verifies the browser
  console stays clean.

  Tagged `@pending` until Issue #383 flips the Playwright `webServer`
  in `apps/web/playwright.config.ts` from the static-HTML stub to the
  real Astro dev server. The fixture (`apps/web/e2e/fixtures/freshUser.ts`)
  and the step library are functional today — only the runner
  prerequisite is missing. Remove the `@pending` tag here once #383
  merges.

  Scenario: Fresh user completes onboarding and lands on the dashboard
    Given I am a freshly created test user with a verified email
    When I open the onboarding screen
    And I complete the onboarding profile fields
    And I attest that I am at least 13 years old
    And I accept the Terms of Service
    And I accept the Privacy Policy
    And I submit the onboarding form
    Then I see the dashboard surface
    And the page reports no console errors
