@epic-9 @domain-rbac
Feature: RBAC matrix in the data dictionary stays in sync with the policy module

  Epic #9 (AC-94, originally Acceptance Spec AC-12) pins the
  documentation-as-code contract for the RBAC matrix:
  `packages/shared/src/rbac/rules.ts` is the source of truth for every
  `(role, resource, action)` triple, and
  `docs/data-dictionary.md` publishes the matrix between
  `<!-- rbac-matrix:start -->` / `<!-- rbac-matrix:end -->` sentinels.
  Drift is rejected at commit time by the Husky pre-commit hook and at
  PR time by the `RBAC matrix drift check` step in
  `.github/workflows/quality.yml`. Both call
  `node scripts/render-rbac-matrix.mjs --check`. The user-visible end
  of this contract is a reviewer's experience: they cannot land a PR
  that edits the rules table without the dictionary updating in
  lockstep.

  @ac-94 @persona-dev-admin
  Scenario: PR that desyncs the RBAC matrix from the data dictionary fails the quality gate
    Given I am signed in as "dev admin"
    And a pull request edits the RBAC rules table without re-rendering the data dictionary
    When the quality workflow runs against the pull request
    Then I see the RBAC matrix drift check fail with a clear remediation message
    And the pull request is blocked from merging until the drift is resolved
