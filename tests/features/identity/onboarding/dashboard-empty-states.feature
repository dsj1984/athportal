# Pending: the freshly-onboarded user fixture seam (a per-scenario
# reset of `users.onboarded_at` plus a guaranteed-empty dashboard
# state) is not yet wired. Un-pend when the fresh-user seam lands and
# the dashboard widget empty-state markup is locked.
@pending @issue-997 @domain-onboarding
Feature: Freshly-onboarded dashboard shows meaningful empty states

  AC-13 requires every widget on the post-onboarding landing surface
  to render a meaningful empty-state message rather than a perpetual
  loading skeleton when the user has no data yet. The widget catalog
  and the empty-state copy live in `apps/web/src/pages/dashboard.ts`;
  this scenario asserts that each named widget surfaces its empty
  state to the user.

  @ac-13
  Scenario: Freshly-onboarded dashboard shows meaningful empty states across every widget
    Given I am signed in as "athlete"
    And I have already completed onboarding
    When I open the dashboard page
    Then I see the dashboard surface
    And I see the recent-activity widget empty state
    And I see the roster widget empty state
    And I see the upcoming widget empty state
