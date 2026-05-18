Feature: Exceeding an observability vendor cost ceiling alerts the operator

  AC-5 requires that every observability vendor has a documented monthly
  cost ceiling in the observability budget runbook, and that exceeding any
  ceiling emails the operator. The scenario below names the operator-
  visible outcome — an alert email naming the offending vendor — while
  billing-API integration shape and ceiling-evaluation arithmetic live at
  the contract tier.

  @ac-5 @domain-observability
  Scenario: A vendor exceeding its observability budget ceiling alerts the operator
    Given an observability vendor has a documented monthly cost ceiling in the observability budget runbook
    When that vendor's monthly spend exceeds its documented ceiling
    Then the operator receives an alert email naming the offending vendor
    And the alert email references the observability budget runbook
