---
id: tp-org-admin-season-rollover
type: plan
title: Season rollover — preview and apply
domain: org-admin
persona: org-admin
surface: web
route_prefixes:
  - /admin/rollover
est_minutes: 12
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded with a fresh org via pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed"
  - "signed in as a seeded org-admin against the seeded fixture org"
  - "seeded org has at least two teams from a prior season with athletes and coaches assigned so the rollover preview surface is non-empty"
---

## Setup

- Confirm `pnpm dev` is running at the repo root and the web app is reachable at `http://localhost:4321`. The season-rollover surface lives at `/admin/rollover.astro`.
- Confirm the local SQLite database has been reset and reseeded since the last destructive run: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`. The rollover plan logic is owned by `packages/shared/src/rollover/buildPlan.ts` — that module determines which athletes age-up, which teams roll forward, and which memberships expire. This plan exercises the surface that consumes that builder, so it relies on the seeded fixture to provide last-season teams and memberships.
- Sign in as the seeded org-admin (`Given I am signed in as "org-admin"`). The header should show the org-admin identity and `/admin/rollover` should render — a 403 / redirect to `/dashboard` indicates the role is wrong and the plan should be aborted.
- Note the current state of `/admin/roster` before starting (team count, athlete count) so the post-rollover comparison in step 7 has a clear baseline.

## Steps

1. Navigate to `/admin/rollover`.
   **Expected:** the rollover surface renders with a heading, a season-selector or a "next season" call-to-action (depending on the build), and a preview / apply affordance. No 403 or onboarding gate is rendered and no top-level error banner is shown.

2. Trigger the rollover preview (e.g. select the upcoming season from the selector, or click a "preview rollover plan" control).
   **Expected:** a preview panel renders that lists the rollover plan in human-readable form: teams that will roll forward, athletes that will age-up into a new bracket, memberships that will expire, and assignments that will need re-confirmation. The preview is read-only — no `applied`-state copy is shown yet.

3. Read each grouping in the preview panel and confirm it is internally consistent.
   **Expected:** every athlete in the "age-up" group references a team that also appears in the "rolling forward" group or in the "expiring" group — no orphan references. Every coach assignment in the "needs re-confirmation" group names a team that is also in the "rolling forward" group. No row in the preview names a team id that does not appear elsewhere on the page.

4. Confirm the preview surface accurately reflects last season's data by spot-checking one team's roster against the baseline noted in setup.
   **Expected:** the preview's "rolling forward" group includes the teams the operator expects from the seeded fixture. The preview does not silently drop a seeded team or invent a team that was not seeded.

5. Apply the rollover by clicking the apply / commit call-to-action. Confirm any modal prompt the build surfaces.
   **Expected:** the apply action completes without surfacing a top-level error banner. The surface transitions to a post-apply state (success indicator, link to the new season's roster, or refreshed preview) and the org-admin remains signed in.

6. Navigate to `/admin/roster` and inspect the new-season roster.
   **Expected:** the roster reflects the previewed plan: teams in the "rolling forward" group are present, athletes in the "age-up" group are bound to their new brackets, and memberships in the "expiring" group no longer appear in the default roster view. No athlete is orphaned (every athlete row references a team that exists in the new season).

7. Navigate to `/admin/teams` and confirm the team list matches the preview's "rolling forward" group.
   **Expected:** the team list shows exactly the teams the preview said would roll forward. Teams that were archived or aged out do not appear in the default view. Reloading the page does not change the team list (the state is durable, not in-memory-only).

8. Return to `/admin/rollover` to confirm the surface acknowledges the rollover has been applied.
   **Expected:** the rollover surface either reads "rollover already applied for season <X>" or otherwise prevents a second apply against the same season. The preview panel either disappears or is locked behind a re-confirmation gate so an accidental double-apply is impossible.

## Cleanup

- Reset the DB so the next run starts from the same pre-rollover baseline: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`. The rollover apply mutates `teams`, `athlete_memberships`, and `coach_assignments` simultaneously — a full reset is the only reliable cleanup.
- Sign out via the `<UserButton/>` menu in the header (the menu posts to `/sign-out`). Never GET `/sign-out` — the route returns 405 Method Not Allowed by design; see `docs/testing-strategy.md` § QA Corpus → Sign-out pattern.
