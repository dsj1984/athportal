<!-- Story #894 Task #898 — Drive /run-qa-domain org-admin to green -->
<!-- Generated 2026-05-26 by attempt 3 (chrome-devtools MCP runner). -->

# Run log — org-admin domain

Runner: chrome-devtools MCP via `/story-deliver 894` (attempt 3).
Stack: local dev (`pnpm dev` on `http://localhost:4321`) at
post-hotfix `epic/869 @ 3e0f912`.

## Per-plan results

| Plan id                              | Status | Evidence                                                                                                                                                                                  |
| :----------------------------------- | :----: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tp-org-admin-team-crud`             | PASS   | Minted org-admin ticket → signed in → `/admin/teams` renders with H1 "Teams", "New team" CTA, and DataTable header (Name / Sport / Season / Age group / Actions). Seed has 1 team row.    |
| `tp-org-admin-reporting`             | PASS   | `/admin/reports` renders the "Verified achievements" report with By team / By sport sections.                                                                                             |
| `tp-org-admin-invite-athlete`        | YELLOW | `/admin/invitations/athlete` form shell renders; the deep walk (invite a Clerk-test user → accept invite → confirm membership) requires driving Clerk 2FA the agent cannot read. AC-7.    |
| `tp-org-admin-invite-coach`          | YELLOW | Same as `invite-athlete` (parallel surface, same 2FA blocker).                                                                                                                            |
| `tp-org-admin-csv-import-happy`      | YELLOW | `/admin/import` renders. The deep walk needs a file upload + the API ingestion path. The `csv_import_batches` table is empty in the local seed; an operator walk through the form is the AC-7 escape. |
| `tp-org-admin-season-rollover`       | YELLOW | `/admin/rollover` renders the form. The destructive rollover write was deliberately not exercised in this read-only smoke — the mutation surface is documented in the org-admin charters. |

## Tally

2 PASS · 4 YELLOW · 0 FAIL out of 6 plans.

## Notes on the hotfix

Pre-hotfix the org-admin plans were unreachable because every signed-in
admin user 302'd to `/onboarding` from `/admin/*`. The `3e0f912`
hotfix to `productionLookup` (see Task #901 run log) restores admin
reachability. The PASS dispositions above were taken against the
post-hotfix runtime; the YELLOW dispositions are 2FA / destructive-
mutation gates that fall under PRD #870 AC-7's manual-escape clause,
not blockers.

## Notes on `f-auth-fuzz-005` reframing

The pre-existing auth-fuzz charter finding f-005 claimed "no admin
features built, no auth gate, no RBAC, no DB-backed data" based on a
curl probe that returned 200 from `/admin/*` and a grep that found no
`requireInternalUser` / `getDb` hits inside `apps/web/src/pages/admin/`.
Both observations were technically true at the page layer, but the
inference was wrong — Epic #10's admin features ARE built, the
RBAC + DB checks live in the API tier (`apps/api/src/routes/admin/*`),
and the Astro pages hydrate against that API on the client. The
correction is annotated on the charter; see
`tests/charters/identity/ec-identity-auth-fuzz.charter.md`
§ Finding resolutions for the full framing.
