@epic-10 @identity::org-admin @domain-csv-import
Feature: Org admin imports an athlete roster from CSV

  Epic #10 / Story #663 ships the admin CSV import surface: upload,
  column mapping, preview, transactional commit. The contract-tier
  suite at
  `apps/api/src/routes/v1/admin/csv-import/csv-import.contract.test.ts`
  pins the wire shape (parse + commit endpoints, rollback on failure,
  duplicate-email reuse via `reusedUserIds`, cross-tenant team
  isolation). These scenarios assert only what the org admin sees on
  the page once the import completes.

  @ac-687 @persona-org-admin
  Scenario: Org admin imports a roster from CSV
    Given I am signed in as "org admin"
    When I open the admin csv import page
    And I upload a roster csv with three new athletes
    And I map every required column to its target field
    And I commit the csv import
    Then I see the csv import success summary

  @ac-687 @persona-org-admin
  Scenario: CSV import re-uses existing accounts for duplicate emails
    Given I am signed in as "org admin"
    And my organization knows about an existing platform account
    When I open the admin csv import page
    And I upload a roster csv that includes the existing account email
    And I map every required column to its target field
    And I commit the csv import
    Then I see the csv import summary report a reused account
