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

  These scenarios are drivable by the agent QA harness (Epic #997 /
  Story #1024). The coach reaches the invite surface by navigating from
  the dashboard to their team's roster page and opening the invite
  dialog from the pending-invites strip — no step jumps to a deep link.
  The recipient-side steps follow the tokenized link delivered in the
  invite email, which is the only user-facing entry into the public
  accept / decline surface. The send path depends on a configured
  transactional-mail transport in the target environment; against a
  local stack with no mailer the send surfaces a user-visible "cannot
  send" message, so the harness records these scenarios as blocked
  rather than passed until a mail-capable environment is supplied.

  Background:
    Given I am signed in as "coach"
    And I follow my team's link from the dashboard roster widget to its roster page

  @pending @issue-997 @ac-4 @persona-coach
  Scenario: Coach sends an invite and sees it listed as pending
    Given my team has no outstanding roster invite for the recipient's email
    When I open the invite dialog from the pending-invites strip
    And I send a roster invite to the recipient's email
    Then I see confirmation that the invite was sent
    And I see the invite listed as pending on my team's roster page

  @pending @issue-997 @ac-5 @persona-coach
  Scenario: Recipient accepts the invite and joins the roster
    Given my team has a pending roster invite addressed to an onboarded athlete
    When the invited athlete follows the accept link from the invite email
    Then the athlete sees confirmation that they joined the team
    And when I return to my team's roster from the dashboard
    Then I see the athlete listed on my team's roster

  @pending @issue-997 @ac-6 @persona-coach
  Scenario: Recipient declines the invite
    Given my team has a pending roster invite addressed to an onboarded athlete
    When the invited athlete follows the decline link from the invite email
    Then the athlete sees confirmation that they declined the invite
    And when I return to my team's roster from the dashboard
    Then I do not see that athlete on my team's roster

  @pending @issue-997 @ac-7 @persona-coach
  Scenario: Expired invite is no longer acceptable
    Given my team has a roster invite whose lifetime has elapsed
    Then I see that invite listed as expired in the pending-invites strip
    And when the invited recipient follows the accept link from the invite email
    Then the recipient sees that the invite is no longer acceptable

  @pending @issue-997 @ac-8 @persona-coach
  Scenario: Coach re-issues an invite after expiry
    Given my team has a roster invite to the recipient that has expired
    When I open the invite dialog from the pending-invites strip
    And I send a fresh roster invite to the same recipient
    Then I see confirmation that the invite was sent
    And I see the new invite listed as pending on my team's roster page

  @pending @issue-1051 @persona-coach
  Scenario: Coach re-sends an expired invite from the pending-invites strip
    Given my team has a roster invite to the recipient that has expired
    Then I see that invite listed as expired in the pending-invites strip
    When I re-send that expired invite from the pending-invites strip
    Then I see confirmation that the invite was sent
    And I see the invite to that recipient listed as pending on my team's roster page
