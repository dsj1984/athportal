@pending @issue-997 @domain-auth
Feature: Rejected sign-in shows a friendly error

  When sign-in fails, the athlete sees a clear, friendly error that
  helps them recover without revealing whether the account exists or
  surfacing any internal error detail. AC-5 asserts that user-visible
  surface; the contract suite covers status code, error envelope, and
  rate-limiting on the auth endpoint.

  @smoke @ac-5
  Scenario: Athlete is rejected with the wrong password
    Given I am not signed in
    When I attempt to sign in as an athlete with the wrong password
    Then I see a friendly sign-in error
    And the error does not reveal account or internal details
