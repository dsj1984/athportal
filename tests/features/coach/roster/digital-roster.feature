@epic-11 @domain-roster
Feature: Coach views and curates their team's digital roster

  Epic #11 ships the digital roster surface a coach uses to see the
  athletes assigned to one of their teams, with team-scoped attributes
  (jersey number, primary position, verification badge) attached to each
  row, and to curate that roster — edit attributes, remove athletes, and
  drill into a team-scoped athlete profile. Wire shape (the read
  envelope, the mutation 400/404 denials, the soft-delete row state)
  lives at the contract tier under
  `apps/api/src/routes/v1/coach/roster.contract.test.ts` and
  `apps/api/src/routes/v1/coach/roster-entries.contract.test.ts`. These
  scenarios assert only the user-visible outcomes on the coach roster
  page and the athlete profile page.

  @pending @issue-997 @ac-1 @persona-coach @smoke
  Scenario: Coach sees the roster for their team
    Given I am signed in as "coach"
    And my team has at least one accepted athlete on its roster
    When I open my team's roster page
    Then I see each accepted athlete listed on my team's roster
    And each row shows the athlete's jersey number, primary position, and verification badge

  @pending @issue-997 @ac-9 @persona-coach
  Scenario: Coach updates an athlete's jersey number
    Given I am signed in as "coach"
    And my team has an accepted athlete with a known jersey number
    When I open my team's roster page
    And I change that athlete's jersey number to a new value
    Then I see confirmation that the jersey number was updated
    And when I refresh my team's roster page
    Then I see the athlete's row with the new jersey number

  @pending @issue-997 @ac-10 @persona-coach
  Scenario: Coach updates an athlete's primary position
    Given I am signed in as "coach"
    And my team has an accepted athlete with a known primary position
    When I open my team's roster page
    And I change that athlete's primary position to a new value
    Then I see confirmation that the primary position was updated
    And when I refresh my team's roster page
    Then I see the athlete's row with the new primary position

  @pending @issue-997 @ac-11 @persona-coach
  Scenario: Coach removes an athlete from the roster
    Given I am signed in as "coach"
    And my team has an accepted athlete on its roster
    When I open my team's roster page
    And I remove that athlete from the roster
    Then I see confirmation that the athlete was removed
    And I no longer see that athlete listed on my team's roster

  @pending @issue-997 @ac-12 @persona-coach
  Scenario: Athlete profile is scoped to the current team's roster context
    Given I am signed in as "coach"
    And one of my athletes is also on another coach's team with a different jersey number and position
    When I open my team's roster page
    And I open that athlete's profile from my team's roster
    Then I see the athlete's profile scoped to my team
    And the jersey number and primary position match the values from my team's roster

  @ac-13 @persona-coach @smoke @meta-acceptance
  Scenario: Coach roster feature files reach SMOKE-PASS
    Given the QA-corpus agent runner has loaded the coach roster feature bundle
    When the runner discovers the coach roster feature files
    Then the runner reports a deterministic verdict for every coach roster scenario

  @ac-14 @persona-coach @meta-acceptance
  Scenario: Canonical docs are confirmed or updated by Epic close
    Given the Epic touches the data model, the routing surface, and the testing strategy
    When the Epic reaches close
    Then the canonical docs reflect the new roster tables, routes, and acceptance bundle
