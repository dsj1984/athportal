@epic-11 @domain-roster
Feature: Coach roster is scoped to the coach's assigned teams

  Epic #11 / Story #911 ships a tenant- and team-scoped read path for the
  coach roster surface. The wire shape — the 404 envelope returned for a
  cross-team or cross-org request, the predicate that drives it, and the
  DB-level guards that back it up — lives at the contract tier in
  `apps/api/src/routes/v1/coach/roster.contract.test.ts`. This scenario
  asserts only the user-visible refusal a coach experiences when they
  navigate to a team's roster they have no business seeing: the page
  treats the team as if it does not exist, and no athlete on that team
  is shown.

  @pending @ac-2 @persona-coach
  Scenario: Coach is refused at another team's roster within the same org
    Given I am signed in as "coach"
    And another team in my organisation has at least one accepted athlete on its roster
    When I open the roster page for that other team
    Then I see a not-found page for the team's roster
    And I do not see any athletes from that team's roster

  @pending @ac-3 @persona-coach
  Scenario: Coach is refused at a team's roster in another organisation
    Given I am signed in as "coach"
    And a team in another organisation has at least one accepted athlete on its roster
    When I open the roster page for that other organisation's team
    Then I see a not-found page for the team's roster
    And I do not see any athletes from that team's roster
