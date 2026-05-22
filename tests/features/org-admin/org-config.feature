@domain-org-admin
Feature: Org admin updates the organization profile

  The organization profile (name, brand colour, logo) is the surface
  the rest of the platform reads to render a tenant's identity. AC-1
  for Epic #10 / Story #656 asserts that an org admin can change those
  fields from the admin org-config page and see the changes reflected
  back to them once the save completes.

  Wire shape — the PATCH /api/v1/admin/org envelope, the row-level
  side effects, and the cross-tenant guards — lives in the matching
  contract suite (`apps/api/src/routes/v1/admin/org.contract.test.ts`
  and `apps/api/src/routes/v1/admin/org-logo.contract.test.ts`). This
  scenario only asserts what the org admin sees on the page.

  @persona-org-admin
  Scenario: Org admin updates organization profile
    Given I am signed in as "org admin"
    When I open the admin org configuration page
    And I change the organization name to "Riverside Athletics"
    And I save the org configuration changes
    Then I see the org configuration saved confirmation
