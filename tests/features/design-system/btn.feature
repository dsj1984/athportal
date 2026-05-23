@skip @epic-702 @domain::design-system
Feature: Btn primitive

  The Btn primitive renders every variant and size combination against
  the token system, exposes a visible focus ring on keyboard navigation,
  and surfaces a disabled state.

  Scenario: Btn renders every variant and size combination
    Given I am a contributor with the Btn primitive imported on a page
    When I render the primary, ghost, subtle, and coral variants at sm, default, and lg sizes
    Then I see each variant and size combination rendered against the token system

  Scenario: Btn focus ring is visible on keyboard tab
    Given I am a contributor viewing a page with the Btn primitive rendered
    When I tab to the Btn with the keyboard
    Then I see the focus-visible ring keyed to the brand token

  Scenario: Btn shows disabled state
    Given I am a contributor viewing a page with the Btn primitive rendered
    When the Btn is rendered in its disabled state
    Then I see a visibly disabled Btn
