@pending
Feature: Unhandled errors page the operator with a Sentry permalink

  An unhandled exception in any of the three runtimes raises a Sentry
  issue with a sourcemapped stack and emails the operator a permalink
  within five minutes. AC-1 spans Workers, Astro, and Expo — one scenario
  per runtime so a regression in any single envelope is visible on its
  own. Steps assert what the operator sees in their inbox; stack-frame
  shape and DSN routing live at the contract tier.

  @ac-1 @domain-observability
  Scenario: An unhandled error in the Workers API alerts the operator
    Given the Workers API is deployed to staging
    When an unhandled error is thrown while serving a request
    Then the operator receives an alert email naming the Workers runtime
    And the alert email contains a Sentry permalink to a sourcemapped stack trace

  @ac-1 @domain-observability
  Scenario: An unhandled error in the Astro web app alerts the operator
    Given the Astro web app is deployed to staging
    When an unhandled error is thrown while rendering a page
    Then the operator receives an alert email naming the Astro runtime
    And the alert email contains a Sentry permalink to a sourcemapped stack trace

  @ac-1 @domain-observability
  Scenario: An unhandled error in the Expo mobile app alerts the operator
    Given the Expo mobile app is running on a staging build
    When an unhandled error is thrown during a user interaction
    Then the operator receives an alert email naming the Expo runtime
    And the alert email contains a Sentry permalink to a sourcemapped stack trace
