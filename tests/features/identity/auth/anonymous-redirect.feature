@pending @issue-997 @domain-auth
Feature: Anonymous visitors are sent to sign-in

  Protected surfaces stay protected end-to-end: an anonymous visitor who
  asks for one is redirected to the sign-in surface instead of seeing
  the protected content. AC-6 asserts the user-visible outcome; the
  contract tier asserts the redirect status and target path.

  @smoke @ac-6
  Scenario: Anonymous visitor is sent to sign-in
    Given I am not signed in
    When I try to open my athlete dashboard
    Then I see the sign-in surface
