Feature: A maintainer can discover the redaction allowlist and the widening template

  AC-7 requires that the redaction allowlist is self-documenting: a
  maintainer who opens the observability redaction runbook can find both
  the allowlist module they need to edit and the architecture-decision
  template they must copy when widening the allowlist. Module paths and
  template field shapes live at the contract tier.

  @ac-7 @domain-observability
  Scenario: A maintainer reads the runbook and locates the allowlist module and the widening template
    Given a maintainer is reading the observability redaction runbook
    Then the maintainer sees a reference to the redaction allowlist module
    And the maintainer sees a reference to the redaction widening decision template
