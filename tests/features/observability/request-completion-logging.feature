Feature: API request-completion logging reaches the operator sink

  Every request to the Workers API emits one structured completion event
  that the operator can find in the managed log sink within a minute, and
  the redaction allowlist keeps personally identifying values out of that
  event. The scenario below names the user-visible outcome from the
  operator's perspective; field-shape and redaction-boundary assertions
  live in the contract tier.

  @ac-2 @domain-observability
  Scenario: Operator finds the completion event without any unallowlisted personal data
    Given the Workers API is serving requests in staging
    When an end user submits a request that includes personal contact details in the payload
    Then the operator can find a single completion event for that request in the sink
    And the operator does not see any personal contact details on that event
