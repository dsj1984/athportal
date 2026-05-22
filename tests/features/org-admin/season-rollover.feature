@identity::org-admin @domain-org-admin
Feature: Org admin rolls over a season with mixed promote/archive/transfer

  Season rollover is the surface where an org admin moves the current
  cohort of athletes into the next season — some are promoted to a
  next-up team, some are archived (graduated, departed), and some are
  transferred laterally. AC-9 for Epic #10 / Story #665 asserts that the
  org admin can preview the planned writes and then commit them, and
  that on commit the page surfaces the applied counts.

  Wire shape — the preview/commit request envelopes, the STALE_PLAN
  refusal, the transactional commit, and the cross-tenant guards — lives
  in the matching contract suite
  (`apps/api/src/routes/v1/admin/rollover.contract.test.ts`). This
  scenario only asserts what the org admin sees on the page.

  @persona-org-admin
  Scenario: Org admin rolls over a season with mixed promote/archive/transfer
    Given I am signed in as "org admin"
    When I open the season rollover page
    Then I see the season rollover surface
