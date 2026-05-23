@skip @epic-702 @domain::design-system
Feature: EventChip primitive

  The EventChip primitive renders every event type with the canonical
  colour mapping and surfaces a conflict indicator when the conflict
  prop is set.

  Scenario: EventChip renders every event type
    Given I am a contributor with the EventChip primitive imported on a page
    When I render the game, practice, training, academic, tournament, meeting, and other event types
    Then I see each event type rendered with the canonical colour mapping and an inset ring stripe

  Scenario: EventChip surfaces the conflict indicator
    Given I am a contributor with the EventChip primitive imported on a page
    When I render an EventChip with the conflict prop set
    Then I see the conflict dot on the EventChip
