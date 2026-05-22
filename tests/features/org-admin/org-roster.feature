@domain-org-admin
Feature: Org admin browses the org-wide roster

  The org-wide roster is the single surface where an org admin can see
  every athlete on every team in their organization. AC-10 for
  Epic #10 / Story #661 asserts that an org admin can open the admin
  roster page and see the athletes on their org's teams listed back to
  them.

  Wire shape — the GET /api/v1/admin/roster envelope, the pagination
  cursor, the filter narrowing, and the cross-tenant guards — lives in
  the matching contract suite
  (`apps/api/src/routes/v1/admin/roster.contract.test.ts`). This
  scenario only asserts what the org admin sees on the page.

  @persona-org-admin
  Scenario: Org admin browses the org-wide roster
    Given I am signed in as "org admin"
    When I open the admin roster page
    Then I see the org-wide roster table
