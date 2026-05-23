@skip @epic-702 @domain::design-system
Feature: Patterns documentation codifies the primitive-library rule

  The repo patterns document codifies the rule that contributors import
  primitives from the library rather than writing raw Tailwind classes,
  prohibits per-Epic restyling, and documents the lucide-react icon
  catalogue mapping.

  Scenario: Patterns doc documents the primitive-library rule
    Given I am a contributor opening the repo patterns document
    When I read the primitive library section
    Then I see the import-this-not-Tailwind-classes rule codified along with the prohibition against per-Epic restyling and the lucide-react icon-catalogue mapping
