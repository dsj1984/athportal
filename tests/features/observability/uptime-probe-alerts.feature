Feature: Uptime probe failures page the operator per probe target

  Three external uptime probes watch the user-visible surfaces of the
  staging deployment: the API health endpoint, the web origin, and the
  auth callback. When any one probe fails, the operator receives an alert
  email naming the failed target. AC-3 splits one scenario per target so a
  regression on any single probe is visible on its own. Probe-vendor
  configuration, retry semantics, and HTTP-level details live at the
  contract tier.

  @ac-3 @domain-observability
  Scenario: A failing API health probe alerts the operator
    Given the API health probe is configured against staging
    When the API health probe fails for long enough to trigger an alert
    Then the operator receives an alert email naming the API health probe

  @ac-3 @domain-observability
  Scenario: A failing web origin probe alerts the operator
    Given the web origin probe is configured against staging
    When the web origin probe fails for long enough to trigger an alert
    Then the operator receives an alert email naming the web origin probe

  @ac-3 @domain-observability
  Scenario: A failing auth callback probe alerts the operator
    Given the auth callback probe is configured against staging
    When the auth callback probe fails for long enough to trigger an alert
    Then the operator receives an alert email naming the auth callback probe
