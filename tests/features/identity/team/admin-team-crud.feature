@pending @domain-team
Feature: Org admin manages the team roster

  Epic #10 (AC-2, AC-3) pins the org-admin Team CRUD surface: an org
  admin opens the team management page, creates a new team with sport,
  season, and age-group metadata, edits its name later, and archives
  it when the season ends. Wire shape (the POST/PATCH/archive payloads,
  the cross-org 404 isolation, the `archived_at` column state) lives
  in the contract suite at
  `apps/api/src/routes/v1/admin/teams.contract.test.ts`; this file
  asserts only what the org admin sees.

  @ac-2 @persona-org-admin
  Scenario: Org admin creates a team
    Given I am signed in as "org admin"
    When I open the team management page
    And I create a team named "Varsity Volleyball" for "Volleyball" in "Fall 2026" for "Varsity"
    Then I see the team "Varsity Volleyball" on the active teams list

  @ac-3 @persona-org-admin
  Scenario: Org admin edits and archives a team
    Given I am signed in as "org admin"
    And one of my teams is named "Junior Varsity Volleyball"
    When I open the team management page
    And I rename the team "Junior Varsity Volleyball" to "JV Volleyball"
    Then I see the team "JV Volleyball" on the active teams list
    When I archive the team "JV Volleyball"
    Then I no longer see the team "JV Volleyball" on the active teams list
    And I see the team "JV Volleyball" on the archived teams list
