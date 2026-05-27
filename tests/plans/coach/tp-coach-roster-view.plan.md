---
id: tp-coach-roster-view
type: plan
title: Coach views their team's roster with jersey, position, and verification badge
domain: coach-dashboard
persona: coach
surface: web
route_prefixes:
  - /app/coach/teams
est_minutes: 8
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded (pnpm --filter @repo/shared run db:seed)"
  - "persona users bootstrapped in Clerk per docs/runbooks/clerk-persona-bootstrap.md"
---

## Setup

- Confirm `pnpm dev` is running and the web app is reachable at `http://localhost:4321`. The coach roster surface lives at [`apps/web/src/pages/app/coach/teams/[teamId]/roster.astro`](../../../apps/web/src/pages/app/coach/teams/%5BteamId%5D/roster.astro).
- Reset to a clean seed: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`. The seed creates at least one team for the `coach` persona with at least one accepted athlete carrying a jersey number and primary position.
- Identify the seeded coach's `teamId` (read it from the seeded org/team graph or copy from the coach landing page). Note it for use in step 2 — this plan does not exercise the navigation discovery, only the roster surface.
- Sign in as the seeded `coach` persona. The header should show the coach identity; landing surface should be the coach view, not athlete or org-admin.

## Steps

1. From the coach landing surface, locate and click into the seeded team's roster entry-point.
   **Expected:** the navigation surface offers a link to the seeded team (no empty state, no 403). Clicking it lands on `/app/coach/teams/<teamId>/roster`.

2. On `/app/coach/teams/<teamId>/roster`, confirm the roster table renders.
   **Expected:** the table shows every accepted athlete on the team, with columns for jersey number, primary position, and a verification badge per athlete. No row shows a different team's athlete. The pending-invites strip is either absent (no pending) or contains only invites issued for this team.

3. For one row, confirm the jersey number and primary position match the seed values, and the verification badge reflects the athlete's current verification state.
   **Expected:** values match the seeded `roster_entries` row for that athlete on this team. The badge is present (verified) or absent (unverified) consistent with the seed; it does not display data from another team.

4. Click the athlete's name (or row affordance) to open the team-scoped athlete profile.
   **Expected:** the URL becomes `/app/coach/teams/<teamId>/athletes/<athleteId>` and the page renders the athlete's profile scoped to *this* team — jersey number and position shown match the row from step 3, not any other team the athlete may be on.

5. Use the back affordance (browser back or in-page link) to return to the roster.
   **Expected:** the roster re-renders identically; no row disappears, no toast/error banner.

## Cleanup

- Sign out via the `<UserButton/>` menu in the header (posts to `/sign-out`). Never GET `/sign-out` — see `docs/testing-strategy.md` § QA Corpus → Sign-out pattern.
- No DB reset is required — this plan is read-only.
