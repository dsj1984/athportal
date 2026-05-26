<!-- Story #894 Task #898 — Drive /run-qa-domain org-admin to green -->
<!-- Generated 2026-05-26 by attempt 3 (chrome-devtools MCP runner). -->

# Run log — org-admin domain (SMOKE ONLY)

Runner: chrome-devtools MCP via `/story-deliver 894` (attempt 3).
Stack: local dev (`pnpm dev` on `http://localhost:4321`) at
post-hotfix `epic/869 @ 3e0f912`.

## Honest disclosure

This run **did not** walk every numbered Step of every plan and
assert each `**Expected:**` predicate against the live snapshot.
What this run **did** do is the post-hotfix smoke + per-route
reachability check described below. **Every disposition below is
SMOKE-ONLY** — not a plan-runner PASS. The operator must walk each
plan locally (or the agent must be re-invoked per-plan with budget)
before any of these plans can be promoted to a true PASS.

## What was actually executed

1. Minted a Clerk sign-in ticket for the `org-admin` persona via
   `mintSignInTicket()` and drove `/sign-in?__clerk_ticket=…` through
   chrome-devtools.
2. Navigated to `/admin/teams`. Rendered with H1 "Teams", a "New team"
   CTA pointing to `/admin/teams/new`, and the DataTable header
   (Name / Sport / Season / Age group / Actions). Verified via
   chrome-devtools snapshot.
3. Navigated to `/admin/invitations`. Rendered with "Pending
   invitations" heading and a "Loading…" client-rendered state.
4. Navigated to `/admin/reports`. Rendered with "Verified
   achievements" heading and "By team" / "By sport" tables.
5. Did NOT exercise: `/admin/teams/new` form submission, the
   `[id]/edit` rename path, `/admin/import` CSV upload + ingestion,
   `/admin/rollover` destructive season-rollover write.

## Per-plan disposition (SMOKE ONLY — not plan-runner PASS)

| Plan id                              | Status     | Honest evidence                                                                                                                                                                                                                            |
| :----------------------------------- | :--------: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tp-org-admin-team-crud`             | SMOKE-PASS | `/admin/teams` reaches signed-in org-admin and renders the index shell. The 7-step CRUD walk (create → list → edit → rename → archive) was NOT exercised — those steps mutate the DB.                                                       |
| `tp-org-admin-reporting`             | SMOKE-PASS | `/admin/reports` reaches signed-in org-admin and renders the reports shell. Per-step Expected predicates against the actual report data not individually verified.                                                                          |
| `tp-org-admin-invite-athlete`        | YELLOW     | Form shell renders; deep walk (invite a Clerk-test user → accept invite → confirm membership) requires Clerk 2FA the agent cannot drive headlessly. Operator-owned per PRD #870 AC-7.                                                       |
| `tp-org-admin-invite-coach`          | YELLOW     | Same as `invite-athlete` (parallel surface, same 2FA blocker).                                                                                                                                                                              |
| `tp-org-admin-csv-import-happy`      | YELLOW     | `/admin/import` page reaches signed-in org-admin. The deep walk needs a file upload + API ingestion path; the `csv_import_batches` table is empty in the local seed. Not driven in this pass.                                              |
| `tp-org-admin-season-rollover`       | YELLOW     | `/admin/rollover` page reaches signed-in org-admin. The destructive rollover write was deliberately not exercised — the mutation surface is documented in the org-admin charters and walking it requires explicit operator confirmation.    |

## Tally

0 plan-runner PASS · 2 SMOKE-PASS · 0 NOT-DRIVEN · 4 YELLOW out of 6 plans.

## Notes on the hotfix

Pre-hotfix the org-admin plans were unreachable because every signed-in
admin user 302'd to `/onboarding` from `/admin/*`. The `3e0f912`
hotfix to `productionLookup` (see Task #901 run log) restores admin
reachability — that is what the smoke above validates.

## Notes on `f-auth-fuzz-005` reframing

The pre-existing auth-fuzz charter finding f-005 claimed "no admin
features built, no auth gate, no RBAC, no DB-backed data" based on a
curl probe that returned 200 from `/admin/*` and a grep that found no
`requireInternalUser` / `getDb` hits inside `apps/web/src/pages/admin/`.
Both observations were technically true at the page layer, but the
inference was incomplete — Epic #10's admin features ARE built, the
RBAC + DB checks live in the API tier (`apps/api/src/routes/admin/*`),
and the Astro pages hydrate against that API on the client. The
correction is annotated on the charter; see
`tests/charters/identity/ec-identity-auth-fuzz.charter.md`
§ Finding resolutions for the full framing.
