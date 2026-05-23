@skip @epic-702 @domain::design-system
Feature: Display atoms

  The Avatar, Ring, Stat, Card, CardSoft, Logo, VerifiedTick, and Ph
  display atoms render with their documented props against the real
  token catalogue.

  Scenario: Display atoms render against the token catalogue
    Given I am a contributor with the Avatar, Ring, Stat, Card, CardSoft, Logo, VerifiedTick, and Ph atoms imported on a page
    When I render each atom with its documented props
    Then I see each atom rendered against the real tokens
