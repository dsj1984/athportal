---
id: tp-coach-roster-invite-decline-expiry
type: plan
title: Recipient declines invite; expired invite cannot be accepted; coach re-issues
domain: coach-dashboard
persona: coach
surface: web
route_prefixes:
  - /app/coach/teams
  - /r/roster-invite
est_minutes: 18
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded (pnpm --filter @repo/shared run db:seed)"
  - "persona users bootstrapped in Clerk per docs/runbooks/clerk-persona-bootstrap.md"
  - "ability to backdate a roster_invites row (direct SQL against packages/shared/data/local.db) to force expiry without waiting for TTL"
---

## Setup

- Confirm `pnpm dev` is running and the web app is reachable at `http://localhost:4321`. Decline lands at [`/r/roster-invite/[token]/decline.astro`](../../../apps/web/src/pages/r/roster-invite/%5Btoken%5D/decline.astro); the underlying queries live in [`packages/shared/src/db/queries/coach/roster.ts`](../../../packages/shared/src/db/queries/coach/roster.ts).
- Reset to a clean seed: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`.
- Pick two unique addresses (e.g. `e2e-decline+<ts>@example.com`, `e2e-expire+<ts>@example.com`). Neither should exist in `roster_invites` for the seeded org.
- Sign in as the seeded `coach` persona. Note the seeded `teamId`.

## Steps

### Decline path

1. From `/app/coach/teams/<teamId>/roster`, send a roster invite to the decline address. Retrieve the tokenized link from the delivered email and open the *decline* variant (`/r/roster-invite/<token>/decline`) in a private window.
   **Expected:** the decline page renders a confirmation that the invite was declined. The `roster_invites` row transitions to `declined`. No `roster_entries` row is created.

2. Return to the coach session and reload `/app/coach/teams/<teamId>/roster`.
   **Expected:** the declined invite is no longer listed as pending. The decline address does not appear in the roster table.

### Expiry path

3. Send a second roster invite from `/app/coach/teams/<teamId>/roster` to the expire address. Confirm the pending row appears.
   **Expected:** pending invite visible in the pending-invites strip with the expire address.

4. Force expiry: open `packages/shared/data/local.db` (e.g. via `pnpm sqlite3 packages/shared/data/local.db` or a SQLite client) and update the `expires_at` for that `roster_invites` row to a timestamp in the past (e.g. `expires_at = strftime('%s','now') - 86400`). Reload the roster page.
   **Expected:** the invite is now displayed as `expired` rather than `pending` (lazy expiry transition).

5. Retrieve the original tokenized accept link for the expired invite and open it in a private window.
   **Expected:** the accept handshake page refuses the invite — a clear "no longer acceptable" / expired banner. No `roster_entries` row is created. The `roster_invites` row remains `expired` (or transitions to it on read).

6. From the coach session, send a fresh invite to the same expire address.
   **Expected:** the new invite is accepted by the system (no "duplicate invite" error) and appears as pending in the strip. The previously-expired row is unchanged.

## Cleanup

- Sign out of every browser session via `<UserButton/>` → sign-out (posts to `/sign-out`).
- Delete any Clerk test users created for the decline/expire addresses via the Clerk Test dashboard.
- Reset the DB: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`.
