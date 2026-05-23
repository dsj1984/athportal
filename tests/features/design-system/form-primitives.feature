@skip @epic-702 @domain::design-system
Feature: Form primitives

  The Input, Textarea, and Select primitives render the same focus ring
  and intent variants against the token system.

  Scenario: Form primitives render default and invalid intents
    Given I am a contributor with the Input, Textarea, and Select primitives imported on a page
    When I render each primitive with its default and invalid intents
    Then I see the intent variants rendered against the token system

  Scenario: Form primitives focus ring is visible on keyboard tab
    Given I am a contributor viewing a page with the form primitives rendered
    When I tab to each primitive with the keyboard
    Then I see the same focus ring rendered against the token system
