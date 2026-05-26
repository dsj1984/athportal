@epic-11 @domain-roster
Feature: Coach sends roster invites and recipients accept or decline

  Epic #11 / Stories #918 and #920 ship the coach-issued roster invite
  flow: the coach sends an invite from the team's roster page, the
  recipient receives a tokenized email link, and accepting or declining
  the link produces a confirmation in the public-handshake surface. Wire
  shape — the token-hash lookup, the lazy expiry transition, the public
  accept/decline envelopes, and the cross-tenant denial — lives at the
  contract tier under `apps/api/src/routes/v1/coach/roster.contract.test.ts`
  and `apps/api/src/routes/v1/public/roster-invites.contract.test.ts`.
  These scenarios assert only the user-visible outcomes a coach and a
  recipient experience: the invite appears as pending, the recipient
  sees an accept or decline confirmation, an expired invite refuses to
  accept, and a coach can re-issue after expiry.

  @pending @ac-4 @persona-coach
  Scenario: Coach sends an invite and sees it listed as pending
    Given I am signed in as "coach"
    And my team has no outstanding roster invite for the recipient's email
    When I open my team's roster page
    And I send a roster invite to the recipient's email
    Then I see confirmation that the invite was sent
    And I see the invite listed as pending on my team's roster page

  @pending @ac-5 @persona-coach
  Scenario: Recipient accepts the invite and joins the roster
    Given my team has a pending roster invite addressed to an onboarded athlete
    When the invited athlete opens the accept link from the invite email
    Then the athlete sees confirmation that they joined the team
    And when I refresh my team's roster page as the coach
    Then I see the athlete listed on my team's roster

  @pending @ac-6 @persona-coach
  Scenario: Recipient declines the invite
    Given my team has a pending roster invite addressed to an onboarded athlete
    When the invited athlete opens the decline link from the invite email
    Then the athlete sees confirmation that they declined the invite
    And when I refresh my team's roster page as the coach
    Then I do not see that athlete on my team's roster

  @pending @ac-7 @persona-coach
  Scenario: Expired invite is no longer acceptable
    Given my team has a roster invite whose lifetime has elapsed
    When I open my team's roster page
    Then I see that invite listed as expired on the invites list
    And when the invited recipient opens the accept link from the invite email
    Then the recipient sees that the invite is no longer acceptable

  @pending @ac-8 @persona-coach
  Scenario: Coach re-issues an invite after expiry
    Given my team has a roster invite to the recipient that has expired
    When I open my team's roster page
    And I send a fresh roster invite to the same recipient
    Then I see confirmation that the invite was sent
    And I see the new invite listed as pending on my team's roster page
