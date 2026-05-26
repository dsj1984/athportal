---
id: tp-org-admin-csv-import-happy
type: plan
title: CSV import — happy-path roster upload
domain: org-admin
persona: org-admin
surface: web
route_prefixes:
  - /admin/import
est_minutes: 10
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded (pnpm db:seed)"
  - "persona users bootstrapped in Clerk per docs/runbooks/clerk-persona-bootstrap.md"
---

## Setup

- Confirm `pnpm dev` is running at the repo root and the web app is reachable at `http://localhost:4321`. The CSV import surface lives at `/admin/import.astro`.
- Confirm the local SQLite database has been reset and reseeded since the last destructive run: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`. This plan writes a row to `csv_import_batches` and three to five rows to `athlete_memberships`; the post-flow assertions are unambiguous only against a clean seed.
- Stage a well-formed sample roster CSV on the host machine. The accepted shape and per-cell caps are owned by `packages/shared/src/csv/parse.ts` (column whitelist, cell-length cap, encoding assumption) and `packages/shared/src/schemas/admin/csvImport.ts` (row-count cap, per-row Zod validation). Author 3–5 rows whose values stay comfortably inside every declared cap, with `team_name` cells that match a seeded team and `year_of_birth` cells in the documented range.
- Sign in as the seeded org-admin (`Given I am signed in as "org-admin"`). The header should show the org-admin identity and `/admin/import` should render — a 403 / redirect to `/dashboard` indicates the role is wrong and the plan should be aborted.

## Steps

1. Navigate to `/admin/import`.
   **Expected:** the CSV import surface renders with a heading, a file-picker affordance (`<input type="file">` or its accessible equivalent), and helper copy that names the supported file format. No 403 or onboarding gate is rendered.

2. Select the staged sample CSV via the file-picker and confirm the picker reports the chosen file name. Do not submit yet.
   **Expected:** the page acknowledges the selected file (shows the filename, a row count, or a "ready to upload" indicator). No row-level error is shown before submission and the upload control becomes enabled.

3. Submit the upload by clicking the upload / import call-to-action.
   **Expected:** the surface transitions to an in-progress or completed state without surfacing a top-level error banner. The browser does not redirect to an unauthenticated surface.

4. Confirm the post-upload summary surface.
   **Expected:** the page renders a per-row summary listing each CSV row's outcome (accepted / rejected) and a top-level success indicator stating that N rows were imported, where N equals the number of rows in the staged CSV. No row is marked as silently skipped.

5. Navigate to `/admin/roster` (or `/admin/teams/<id>/edit` for the team named in the CSV).
   **Expected:** every athlete listed in the staged CSV appears on the roster surface against the team named in their row. No duplicate rows are rendered. Athletes whose `team_name` cell named a seeded team are bound to that team, not orphaned.

6. Return to `/admin/import` and confirm the batch is listed in the import-history surface (where the build surfaces one).
   **Expected:** the new batch is present with the original file name, the row count, the imported-on timestamp, and an outcome label that reads succeeded (or the build's equivalent). The batch is not silently absent from history.

7. Reload `/admin/import` once to confirm the history-list assertion survives a page reload (no in-memory-only state).
   **Expected:** the batch row is still present after reload. The roster surface remains correct; no rows have been silently rolled back.

## Cleanup

- Reset the DB so the next run starts from a known-clean state: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`. The CSV import directly mutates `csv_import_batches` and `athlete_memberships`, so a reset is the only reliable cleanup.
- Sign out via the `<UserButton/>` menu in the header (the menu posts to `/sign-out`). Never GET `/sign-out` — the route returns 405 Method Not Allowed by design; see `docs/testing-strategy.md` § QA Corpus → Sign-out pattern.
- Delete the staged CSV from the host machine if it contains values that should not be retained in the operator's working directory.
