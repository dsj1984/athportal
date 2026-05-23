@skip @epic-702 @domain::design-system
Feature: Design system foundations

  The design system foundations are alive in the running app: Tailwind v4
  renders against the canonical token catalogue, no third-party mono font
  is loaded over the network, and existing aligned components keep
  working after the token-extension lands.

  Scenario: Tailwind v4 renders against the canonical token catalogue
    Given I am a frontend contributor running the local dev server
    When I open an Astro-rendered page
    Then I see the page rendered with the new design tokens

  Scenario: No third-party mono font is loaded
    Given I am viewing the live styleguide page
    When the page finishes loading
    Then no third-party mono font is loaded over the network

  Scenario: Existing aligned components keep working after token extension
    Given the token extension work has landed
    When I view a surface that depends on the existing aligned components
    Then the surface continues to render unchanged
