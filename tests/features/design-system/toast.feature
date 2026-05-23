@skip @epic-702 @domain::design-system
Feature: Toast notifications

  The toast helper surfaces a single token-aligned toast in the corner
  with success, error, and info variants visually distinguishable; the
  toast host is mounted exactly once at the shell level.

  Scenario: Toast renders success, error, and info variants
    Given I am a contributor viewing a page with the shell-level toast host mounted exactly once
    When I trigger a toast via the helper for the success, error, and info variants
    Then I see a single token-aligned toast in the corner with each variant visually distinguishable
