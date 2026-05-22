@epic-10 @identity::org-admin @domain-invitations
Feature: Org admin invites an athlete directly

  Epic #10 / Story #662 ships the safety-valve flow that lets an org
  admin invite an athlete directly to a single team without routing
  through a coach. The wire shape (the POST envelope, the 201
  response, the 404 cross-tenant denial, the local row's persisted
  state) is pinned at the contract tier in
  `apps/api/src/routes/v1/admin/invitations/athlete.contract.test.ts`.
  This scenario asserts only the user-visible outcome on the
  /admin/invitations/athlete page: after the admin submits the form
  the page confirms the invitation was sent.

  @ac-680 @persona-org-admin
  Scenario: Org admin invites an athlete directly
    Given I am signed in as "org admin"
    And my organization has at least one team
    When I open the direct athlete invitation admin page
    And I submit the direct athlete invitation form
    Then I see confirmation that the invitation was sent
