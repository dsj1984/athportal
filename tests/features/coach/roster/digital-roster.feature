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

  These scenarios are drivable by the agent QA harness (Epic #997 /
  Story #1024). Every scenario reaches the roster surface by navigating
  UI affordances from the dashboard — the coach signs in, finds their
  team in the dashboard roster widget, and follows the team link to the
  roster page. No step jumps to a deep link. Curation runs through the
  per-row controls (edit, save, remove with confirmation) and the
  athlete name link the roster page renders.

  Background:
    Given I am signed in as "coach"
    And I follow my team's link from the dashboard roster widget to its roster page

  @pending @issue-997 @ac-1 @persona-coach @smoke
  Scenario: Coach sees the roster for their team
    Given my team has at least one accepted athlete on its roster
    Then I see each accepted athlete listed on my team's roster
    And each row shows the athlete's jersey number, primary position, and verification badge

  @pending @issue-997 @ac-9 @persona-coach
  Scenario: Coach updates an athlete's jersey number
    Given my team has an accepted athlete with a known jersey number
    When I start editing that athlete's row
    And I change the jersey number to a new value and save the row
    Then I see the athlete's row showing the new jersey number
    And when I return to my team's roster from the dashboard
    Then I still see the athlete's row with the new jersey number

  @pending @issue-997 @ac-10 @persona-coach
  Scenario: Coach updates an athlete's primary position
    Given my team has an accepted athlete with a known primary position
    When I start editing that athlete's row
    And I change the primary position to a new value and save the row
    Then I see the athlete's row showing the new primary position
    And when I return to my team's roster from the dashboard
    Then I still see the athlete's row with the new primary position

  @pending @issue-997 @ac-11 @persona-coach
  Scenario: Coach removes an athlete from the roster
    Given my team has an accepted athlete on its roster
    When I choose to remove that athlete from their row
    And I confirm the removal when the prompt asks me to
    Then I no longer see that athlete listed on my team's roster

  @pending @issue-997 @ac-12 @persona-coach
  Scenario: Athlete profile is scoped to the current team's roster context
    Given one of my athletes is also on another coach's team with a different jersey number and position
    When I follow that athlete's name link from my team's roster
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
