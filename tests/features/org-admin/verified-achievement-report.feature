@epic-10 @identity::org-admin @domain-org-admin
Feature: Org admin reads the verified-achievement report

  The verified-achievement report is the org admin's at-a-glance view
  of how verified achievements are distributed across teams and across
  sports in their organization. AC-11 for Epic #10 / Story #679
  asserts that an org admin can open the admin reports page and see
  the by-team and by-sport breakdowns rendered back to them.

  Wire shape — the
  GET /api/v1/admin/reports/verified-achievements envelope, the
  alphabetical ordering, the pinned-zero count, and the cross-tenant
  guards — lives in the matching contract suite
  (`apps/api/src/routes/v1/admin/reports.contract.test.ts`). This
  scenario only asserts what the org admin sees on the page.

  Scenario: Org admin reads the verified-achievement report
    Given I am signed in as "org admin"
    When I open the admin reports page
    Then I see the verified-achievement report
