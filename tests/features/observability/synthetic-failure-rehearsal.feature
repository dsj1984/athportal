@pending
Feature: Operator rehearses the alert pipeline with a synthetic failure

  The synthetic-failure rehearsal lets the operator prove the alert path
  is live without waiting for a real outage. When the rehearsal switch is
  on, requesting the rehearsal surface triggers the full alert path and
  the operator receives a Sentry alert email. When the switch is off,
  the rehearsal surface is not exposed — the operator cannot see or fire
  it. Wire-level details (status codes, route paths) live at the
  contract tier.

  @ac-4 @domain-observability
  Scenario: With the rehearsal switch on, firing the synthetic failure alerts the operator
    Given the synthetic-failure rehearsal switch is on in staging
    When the operator fires the synthetic failure
    Then the operator receives an alert email naming the Workers runtime
    And the alert email contains a Sentry permalink to a sourcemapped stack trace

  @ac-4 @domain-observability
  Scenario: With the rehearsal switch off, the synthetic failure surface is not exposed
    Given the synthetic-failure rehearsal switch is off in staging
    When the operator attempts to fire the synthetic failure
    Then the rehearsal surface is not exposed to the operator
    And no alert email is delivered to the operator
