@epic-10 @identity::org-admin @domain-invitations
Feature: Org admin invites a coach who accepts

  Epic #10 / Story #664 ships the coach-invitation flow that lets an
  org admin invite a coach to one or more existing teams in their
  org. The wire shape (the POST envelope, the 201 response, the 404
  cross-tenant denial when any teamId belongs to a different org,
  the 400 INVALID_BODY denial when teamIds is empty, the local row's
  persisted state) is pinned at the contract tier in
  `apps/api/src/routes/v1/admin/invitations/coach.contract.test.ts`.
  This scenario asserts only the user-visible outcome on the
  /admin/invitations/coach page: after the admin submits the form
  the page confirms the invitation was sent, and after the coach
  accepts they appear on the team roster.

  @ac-683 @persona-org-admin
  Scenario: Org admin invites a coach who accepts
    Given I am signed in as "org admin"
    And my organization has at least one team
    When I open the coach invitation admin page
    And I submit the coach invitation form
    Then I see confirmation that the invitation was sent
    And after the invited coach accepts the invitation
    Then the coach appears on the team roster
