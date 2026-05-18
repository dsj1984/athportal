@pending
Feature: A fork pull request without Sentry credentials still passes CI

  Contributors who open a pull request from a fork have no access to the
  repository's Sentry credentials. AC-6 requires that the sourcemap upload
  step degrades gracefully: the CI build still passes, and the contributor
  sees a clear skip notice in the build log so it is obvious why the upload
  was skipped. Wire-level details — which workflow step ran, which exit
  code returned, which secret name was checked — live at the contract tier.

  @ac-6 @domain-observability
  Scenario: A fork pull request without Sentry credentials passes CI with a visible skip notice
    Given a contributor opens a pull request from a fork without Sentry credentials
    When the continuous integration build runs against that pull request
    Then the contributor sees the build pass
    And the contributor sees a skip notice naming the sourcemap upload in the build log
