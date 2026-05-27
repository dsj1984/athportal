---
id: tp-org-admin-team-crud
type: plan
title: Team CRUD — create, rename, archive
domain: org-admin
persona: org-admin
surface: web
route_prefixes:
  - /admin/teams
  - /admin/teams/new
  - /admin/teams/:id/edit
est_minutes: 10
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded (pnpm db:seed)"
  - "persona users bootstrapped in Clerk per docs/runbooks/clerk-persona-bootstrap.md"
---

## Setup

- Confirm `pnpm dev` is running at the repo root and the web app is reachable at `http://localhost:4321`. The team CRUD surface lives at `/admin/teams/index.astro`, `/admin/teams/new.astro`, and `/admin/teams/[id]/edit.astro`.
- Confirm the local SQLite database has been reset and reseeded since the last destructive run: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`. The seed provisions a fixture org plus a seeded org-admin user; this plan mutates the `teams` table for that org and relies on the seed for the org_id used in URL paths.
- Sign in as the seeded org-admin (Gherkin step `Given I am signed in as "org-admin"`, mirrored manually as: navigate to `/sign-in`, complete Clerk auth with the seeded org-admin credentials, OR — when the operator does not know the persona password — GET `/dev/sign-in-as/org-admin` to mint a sign-in ticket via Clerk's Backend SDK; see [`apps/web/src/pages/dev/sign-in-as/[persona].ts`](../../../apps/web/src/pages/dev/sign-in-as/%5Bpersona%5D.ts), hard-refused in production). The header should show the org-admin identity and `/admin/teams` should render — a 403 / redirect to `/dashboard` indicates the RBAC role on the active user is not `org-admin` and the plan should be aborted.
- Pick a unique team name for this run (e.g. `e2e-team-<timestamp>`) so the create step does not collide with any existing seed row or a prior plan run.

## Steps

1. Navigate to `/admin/teams`.
   **Expected:** the team index renders with a heading announcing the team list, a "create team" call-to-action (button or link pointing at `/admin/teams/new`), and at least one row corresponding to a seeded team. No top-level error banner appears and no "you must finish onboarding" gate is shown.

2. Click the create-team call-to-action (or navigate to `/admin/teams/new` directly).
   **Expected:** the new-team form renders with a name input, a season / start-date input (where the build prompts for one), and a submit control. The page does not redirect away and no validation errors are shown before the form is touched.

3. Enter the unique team name picked in setup, fill any other required fields with safe placeholder values (e.g. season `2025-2026`, sport `track`), and submit the form.
   **Expected:** the form submits without surfacing a validation banner and the browser redirects to either the team index (`/admin/teams`) or the new team's edit page (`/admin/teams/<id>/edit`). The new team's name appears on the landing surface within one render.

4. From `/admin/teams`, click the newly-created team's row (or its "edit" control) to open `/admin/teams/<id>/edit`.
   **Expected:** the edit form renders pre-populated with the team's current name and metadata. The URL `<id>` segment matches the team that was just created; no 404 is rendered.

5. Change the team name to a second unique value (e.g. `e2e-team-<timestamp>-renamed`) and submit the edit form.
   **Expected:** the form submits without errors, the browser returns to the team index (or stays on the edit page with a success indicator), and the renamed team appears in the index list under its new name. The previous name is no longer present in the index.

6. From the edit page, locate the archive control (a button, toggle, or status selector that transitions the team to an archived/inactive state) and trigger it. Confirm any modal prompt the build surfaces.
   **Expected:** the archive action completes without surfacing a validation banner and the team either disappears from the default `/admin/teams` view or moves into a visually-distinct "archived" section depending on the build. The current user remains signed in as org-admin and the page is not redirected to an unauthenticated surface.

7. Reload `/admin/teams` and confirm the archived team is not in the active list.
   **Expected:** the archived team is filtered out of the default view. If the index exposes an "include archived" toggle, enabling it surfaces the team with an archived indicator; the team is not silently deleted from persistence.

8. Verify the audit trail by reloading the dashboard or the team detail and confirming the team's archived state survives a page reload (no in-memory-only mutation).
   **Expected:** the archived state is durable across reloads. Navigating to `/admin/teams/<id>/edit` directly still resolves to the team's edit page (or to a surface that explains the team is archived), not a 404.

## Cleanup

- If the run did not reach the archive step, delete the test team via the edit page's delete/archive control so the seeded org returns to a stable baseline.
- Reset the DB so the next run starts from a known-clean state: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`.
- Sign out via the `<UserButton/>` menu in the header (the menu posts to `/sign-out`). Never GET `/sign-out` — the route returns 405 Method Not Allowed by design; see `docs/testing-strategy.md` § QA Corpus → Sign-out pattern.
