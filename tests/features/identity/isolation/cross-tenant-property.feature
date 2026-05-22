@epic-9 @domain-graph
Feature: Cross-tenant isolation holds under randomized actor and resource pairings

  Epic #9 (AC-95, originally Acceptance Spec AC-13) is the
  load-bearing acceptance gate for the multi-tenant graph: a
  property-based test over randomized
  `(orgA, orgB, role, resource, action)` tuples exercises every
  meaningful combination through the production isolation boundary
  (`scopedDb(actor)`) and asserts two properties together — no read
  leakage across orgs, and `canPerform`'s verdict agrees with the
  routed outcome for every generated tuple. The implementation is at
  `packages/shared/src/testing/__tests__/crossTenantIsolation.property.contract.test.ts`,
  authored via `fast-check` and authenticated against a real Clerk
  test instance through the test-auth seam at
  `packages/shared/src/testing/auth.ts` (no dev bypass). The nightly
  job at `.github/workflows/nightly.yml` re-runs the property with
  `FC_NUM_RUNS=1000` so regressions hidden behind rare-tuple shrinking
  on the per-PR run surface within 24h.

  @ac-95 @persona-dev-admin
  Scenario: Nightly cross-tenant property run completes without a leaked row
    Given I am signed in as "dev admin"
    And the nightly cross-tenant isolation property job has completed today
    When I review the nightly report for the cross-tenant isolation property
    Then I see that every generated actor-and-resource pairing held the isolation invariant
    And no leaked row was reported across the 1000-case run
