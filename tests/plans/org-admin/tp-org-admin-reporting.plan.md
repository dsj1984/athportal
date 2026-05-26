---
id: tp-org-admin-reporting
type: plan
title: Verified-achievement reporting export
domain: org-admin
persona: org-admin
surface: web
route_prefixes:
  - /admin/reports
est_minutes: 8
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded with a fresh org via pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed"
  - "signed in as a seeded org-admin against the seeded fixture org"
  - "seeded org has at least one team with athletes that have at least one verified achievement so the report has non-empty content"
---

## Setup

- Confirm `pnpm dev` is running at the repo root and the web app is reachable at `http://localhost:4321`. The reporting surface lives at `/admin/reports.astro`.
- Confirm the local SQLite database has been reset and reseeded since the last destructive run: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`. The seed provisions verified achievements for the fixture org's athletes; if the seed is stale, the report will render empty and the export step cannot exercise the file-download path.
- Sign in as the seeded org-admin (`Given I am signed in as "org-admin"`). The header should show the org-admin identity and `/admin/reports` should render — a 403 / redirect to `/dashboard` indicates the role is wrong and the plan should be aborted.
- Have a clean downloads folder ready (or note the existing contents) so the export step can verify the new file lands without ambiguity.

## Steps

1. Navigate to `/admin/reports`.
   **Expected:** the reporting surface renders with a heading, at least one report selector (verified-achievement export, roster summary, or the build's equivalent), and an export / download call-to-action. No 403 or onboarding gate is rendered.

2. Select the verified-achievement report from the report selector (or click directly into the verified-achievement section).
   **Expected:** the page renders an on-screen preview of the verified-achievement data with at least one row when the seeded fixture has produced verified achievements. Column headers are visible and the preview names the athletes and teams the operator expects from the seed.

3. Apply any filter the build exposes (e.g. season, team) and confirm the preview narrows accordingly.
   **Expected:** the preview updates to reflect the filter without surfacing a top-level error banner. Removing the filter restores the unfiltered preview.

4. Click the export / download call-to-action.
   **Expected:** the browser initiates a file download (CSV or PDF depending on the build). The file lands in the configured downloads folder; no top-level error banner is shown. The org-admin remains signed in.

5. Open the downloaded file and inspect its contents.
   **Expected:** the file is readable in the operator's default tool (a spreadsheet program for CSV, a PDF viewer for PDF). The rows present in the on-screen preview are present in the file; the column headers match. No rows are silently truncated.

6. Confirm the file contains only verified achievements, not unverified or pending ones.
   **Expected:** every row in the file is for a verified achievement (matches the on-screen preview's verified-only filter). The file does not include rows for athletes outside the seeded org (no cross-tenant leakage).

7. Return to `/admin/reports` and confirm the export action is repeatable.
   **Expected:** clicking the export call-to-action a second time downloads a second copy of the file (or a file with an updated timestamp). The page does not enter an error state and the org-admin remains signed in.

8. Reload `/admin/reports` once.
   **Expected:** the page renders the same report selector and preview after a reload — the rendered state is durable, not in-memory-only. No filter selection is lost in a way that makes the page unusable.

## Cleanup

- Delete the downloaded report file(s) from the downloads folder so successive runs of this plan do not accumulate stale exports.
- Reset the DB so the next run starts from a known-clean state: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`.
- Sign out via the `<UserButton/>` menu in the header (the menu posts to `/sign-out`). Never GET `/sign-out` — the route returns 405 Method Not Allowed by design; see `docs/testing-strategy.md` § QA Corpus → Sign-out pattern.
