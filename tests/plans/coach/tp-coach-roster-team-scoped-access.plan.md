---
id: tp-coach-roster-team-scoped-access
type: plan
title: Coach is refused at another team's roster — same org and cross-org
domain: coach-dashboard
persona: coach
surface: web
route_prefixes:
  - /app/coach/teams
est_minutes: 6
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded (pnpm --filter @repo/shared run db:seed) — seed includes a second team in the same org and a team in a different org, each with at least one accepted athlete"
  - "persona users bootstrapped in Clerk per docs/runbooks/clerk-persona-bootstrap.md"
---

## Setup

- Confirm `pnpm dev` is running at `http://localhost:4321`. Team scoping is enforced server-side by [`packages/shared/src/rbac/coachOnTeam.ts`](../../../packages/shared/src/rbac/coachOnTeam.ts) — this plan exercises the user-visible refusal, not the predicate itself (covered by unit tests).
- Reset to a clean seed: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`.
- Collect three `teamId` values from the seed:
  - `assignedTeamId` — a team the seeded coach is assigned to (control).
  - `otherTeamSameOrgId` — a team in the same org that the coach is **not** assigned to.
  - `otherOrgTeamId` — a team in a **different** org.
- Sign in as the seeded `coach` persona.

## Steps

1. Navigate to `/app/coach/teams/<assignedTeamId>/roster` to confirm the control surface works.
   **Expected:** the roster page renders normally with the assigned team's athletes. No 403/404. This baseline rules out unrelated breakage before exercising the negative cases.

2. Navigate directly to `/app/coach/teams/<otherTeamSameOrgId>/roster`.
   **Expected:** the page renders a not-found surface (404). No athletes from the other same-org team are visible. No row count, no jersey numbers, no badges leak. The URL bar may still show the entered path; the body is the not-found view.

3. Open the browser DevTools network panel and reload the same URL.
   **Expected:** the API request backing the roster returns a 404 (not 200-with-empty, not 403 leaking the team's existence). Response body does not contain the other team's name, athlete IDs, or any roster data.

4. Navigate directly to `/app/coach/teams/<otherOrgTeamId>/roster`.
   **Expected:** the same not-found surface as step 2. The cross-org case is indistinguishable from the same-org refusal — no signal that "this team exists but you can't see it" vs "this team doesn't exist."

5. As a final negative probe, try `/app/coach/teams/<assignedTeamId>/athletes/<rosterEntryIdFromOtherTeam>` — i.e. a roster entry that exists, but on a team this coach does not own — using a `roster_entry.id` retrieved from the seed for `otherTeamSameOrgId`.
   **Expected:** not-found surface. The team-scoped athlete profile route does not render another team's athlete just because the coach owns *a* team.

## Cleanup

- Sign out via `<UserButton/>` → sign-out.
- No DB reset required — this plan is read-only.
