---
id: tp-coach-roster-edit-remove
type: plan
title: Coach edits jersey number and primary position, then removes an athlete
domain: coach-dashboard
persona: coach
surface: web
route_prefixes:
  - /app/coach/teams
est_minutes: 10
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded (pnpm --filter @repo/shared run db:seed)"
  - "persona users bootstrapped in Clerk per docs/runbooks/clerk-persona-bootstrap.md"
---

## Setup

- Confirm `pnpm dev` is running at `http://localhost:4321`. Roster mutations are wired through [`apps/web/src/components/coach/RosterTable.ts`](../../../apps/web/src/components/coach/RosterTable.ts) against the coach-roster API in [`packages/shared/src/db/queries/coach/roster.ts`](../../../packages/shared/src/db/queries/coach/roster.ts).
- Reset to a clean seed: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`. Confirm the seeded coach's team has at least two accepted athletes (one for editing, one as a control row to confirm scoping).
- Sign in as the seeded `coach` persona. Note the seeded `teamId` and pick a target athlete row plus a control athlete row.

## Steps

1. Navigate to `/app/coach/teams/<teamId>/roster` and note the target row's current jersey number and primary position, and the control row's values.
   **Expected:** both rows render with their seeded values.

2. Edit the target row's jersey number to a new, unique value (e.g. 99). Submit the change.
   **Expected:** an inline or toast confirmation that the jersey number was updated. The target row immediately reflects the new jersey number. The control row is unchanged.

3. Hard-refresh the page (Ctrl/Cmd+R).
   **Expected:** after reload, the target row still shows the new jersey number — the change persisted server-side, not just in client state.

4. Edit the target row's primary position to a different valid value (e.g. switch from `Forward` to `Midfielder`, or whatever the suggestion list provides). Submit.
   **Expected:** confirmation indicator; row updates; control row unchanged. Hard-refresh and confirm the new position persists.

5. Attempt to set the jersey number to a clearly invalid value (e.g. empty string, negative number, or non-numeric text, depending on what the input allows).
   **Expected:** the edit is refused at the boundary with a visible validation message; no toast indicates success; the persisted value is unchanged after refresh.

6. Trigger the "remove athlete" action on the target row and confirm the confirmation prompt.
   **Expected:** confirmation indicator that the athlete was removed. The target row disappears from the roster table immediately. The control row is unchanged.

7. Hard-refresh `/app/coach/teams/<teamId>/roster`.
   **Expected:** the removed athlete still does not appear in the roster — the removal persisted. The control row still renders. The pending-invites strip is unchanged.

## Cleanup

- Sign out via `<UserButton/>` → sign-out.
- Reset the DB so the next run starts clean: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`.
