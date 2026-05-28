---
id: tp-coach-roster-invite-send-accept
type: plan
title: Coach invites athlete by email and recipient accepts the invite
domain: coach-dashboard
persona: coach
surface: web
route_prefixes:
  - /app/coach/teams
  - /r/roster-invite
est_minutes: 15
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded (pnpm --filter @repo/shared run db:seed)"
  - "persona users bootstrapped in Clerk per docs/runbooks/clerk-persona-bootstrap.md"
  - "transactional email channel reachable (local mail catcher or Clerk test channel for the recipient address)"
---

## Setup

- Confirm `pnpm dev` is running and the web app is reachable at `http://localhost:4321`. The invite send surface is the `<InviteAthleteDialog/>` on the team's roster page; accept lands on [`/r/roster-invite/[token]/accept.astro`](../../../apps/web/src/pages/r/roster-invite/%5Btoken%5D/accept.astro).
- Reset to a clean seed: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`. Confirm the seeded coach has at least one team with no outstanding `roster_invite` for the address you will use below.
- Pick a unique test address (e.g. `e2e-roster+<timestamp>@example.com`) that has no existing `roster_invite` or `roster_entry` in the seeded org. Have the local mail catcher (or Clerk test channel) ready to retrieve the tokenized invite link. If the local stack has no mail transport bound, the send-leg will refuse with `503 MAIL_TRANSPORT_UNBOUND` — see [`docs/testing-strategy.md` § Manually injecting roster invites](../../../docs/testing-strategy.md#manually-injecting-roster-invites) for the hex-token convention and the documented workaround.
- Sign in as the seeded `coach` persona. Note the seeded `teamId` for the team you will invite into.

## Steps

1. Navigate to `/app/coach/teams/<teamId>/roster` and open the "invite athlete" affordance.
   **Expected:** the `<InviteAthleteDialog/>` opens with email (required) and optional first/last name fields, plus a submit control. No top-level error banner.

2. Enter the unique test address, optionally first/last name, and submit.
   **Expected:** the dialog confirms the invite was sent (toast or inline success). The roster page now lists the invite in the pending-invites strip with the invited email and a status of pending. A row appears in `roster_invites` with `state = pending` (verify via DB if convenient, otherwise rely on the UI).

3. Retrieve the tokenized accept link from the delivered email (local mail catcher or Clerk test channel). Open it in a second browser session (or a private window) so the acceptance leg runs against a separate authenticated session.
   **Expected:** the URL is `/r/roster-invite/<token>/accept`. The page renders the accept-handshake surface scoped to the invitation — no "invitation not found", no "invitation expired" banner. If the recipient address is not yet a Clerk user, the page chains into the sign-up surface for that address.

4. Complete sign-up if required (set a password, retrieve and submit the verification code), then confirm the accept affordance.
   **Expected:** the accept page shows a success confirmation that the recipient has joined the team. The `roster_invites` row transitions to `accepted`. A new `roster_entries` row is created for the athlete on the team.

5. Return to the coach browser session and reload `/app/coach/teams/<teamId>/roster`.
   **Expected:** the previously-pending invite no longer appears in the pending strip. The newly-accepted athlete appears in the main roster table (jersey number and position will be empty or defaulted until set in the edit plan).

## Cleanup

- Sign out of both browser sessions via the `<UserButton/>` menu (posts to `/sign-out`).
- Delete the Clerk test user created for the invite address via the Clerk Test dashboard so the plan can be re-run against the same address.
- Reset the DB so the next run starts clean: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`.
