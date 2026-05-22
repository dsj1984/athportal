@epic-10 @identity::org-admin @domain-invitations
Feature: Org admin manages pending invitations

  Epic #10 / Story #655 ships the pending-invitations admin surface:
  list, resend, revoke. The contract-tier suite at
  `apps/api/src/routes/v1/admin/invitations/management.contract.test.ts`
  pins the wire shape (status codes, response bodies, DB row state,
  cross-tenant denial). This scenario asserts only the user-visible
  outcome: after the admin resends a pending invitation it stays on
  the list, and after they revoke one it disappears from the list
  without a full-page reload.

  @ac-668 @persona-org-admin
  Scenario: Org admin re-sends and revokes pending invitations
    Given I am signed in as "org admin"
    And my organization has at least one pending invitation
    When I open the pending invitations admin page
    And I resend the first pending invitation
    Then I still see that invitation on the pending invitations list
    When I revoke the first pending invitation
    Then I no longer see that invitation on the pending invitations list
