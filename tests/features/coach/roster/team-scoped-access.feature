@epic-11 @domain-roster
Feature: Coach roster is scoped to the coach's assigned teams

  Epic #11 / Story #911 ships a tenant- and team-scoped read path for the
  coach roster surface. The wire shape — the 404 envelope returned for a
  cross-team or cross-org request, the predicate that drives it, and the
  DB-level guards that back it up — lives at the contract tier in
  `apps/api/src/routes/v1/coach/roster.contract.test.ts`. These scenarios
  assert only the user-visible refusal a coach experiences when they
  reach a team's roster they have no business seeing: the page treats the
  team as if it does not exist, and no athlete on that team is shown.

  These scenarios are drivable by the agent QA harness (Epic #997 /
  Story #1024). The affordance-driven truth is the load-bearing
  assertion: the coach's dashboard roster widget links only the teams
  they are assigned to, so there is no UI affordance that leads a coach
  to another team's roster. Reaching such a roster directly is the only
  way to exercise the guard, and the user-visible outcome is a
  not-found page that reveals nothing about the team or its athletes.

  Background:
    Given I am signed in as "coach"

  @pending @issue-997 @ac-2 @persona-coach
  Scenario: Coach is refused at another team's roster within the same org
    Given another team in my organisation has at least one accepted athlete on its roster
    And my dashboard offers no link to that other team's roster
    When I reach the roster page for that other team
    Then I see a not-found page for the team's roster
    And I do not see any athletes from that team's roster

  @pending @issue-997 @ac-3 @persona-coach
  Scenario: Coach is refused at a team's roster in another organisation
    Given a team in another organisation has at least one accepted athlete on its roster
    And my dashboard offers no link to that other organisation's team roster
    When I reach the roster page for that other organisation's team
    Then I see a not-found page for the team's roster
    And I do not see any athletes from that team's roster
