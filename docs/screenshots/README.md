# Screenshots — Baseline visual reference

This directory holds **baseline screenshots** of the application's
styled pages so reviewers can diff a proposed UI change against the
known-good visual state. Each PNG lives next to this README at a
canonical name; pull requests that intentionally change a page's
visual contract MUST refresh the corresponding screenshot.

> **Note on the committed placeholders.** The PNGs in this directory
> are 1×1 transparent placeholders committed by Story #857. They
> exist to pin the file paths and the capture procedure; **operators
> must replace them with real screenshots** the first time a page's
> visual contract is reviewed. See the [refresh policy](#refresh-policy)
> below for the workflow.

## Files

Every screenshot is a PNG saved at `<page>.png`. The current set
(one per styled top-level surface):

| File | Page route | Persona |
| --- | --- | --- |
| `onboarding.png` | `/onboarding` | new signed-in user |
| `dashboard.png` | `/dashboard` | signed-in athlete |
| `admin-org.png` | `/admin/org` | dev_admin |
| `admin-roster.png` | `/admin/roster` | dev_admin |
| `admin-reports.png` | `/admin/reports` | dev_admin |
| `admin-teams-index.png` | `/admin/teams` | dev_admin |
| `admin-invitations.png` | `/admin/invitations` | dev_admin |
| `admin-import.png` | `/admin/import` | dev_admin |
| `admin-rollover.png` | `/admin/rollover` | dev_admin |

## Capture procedure

### 1. Environment

- Branch: capture against the branch you are reviewing (typically a
  PR branch off `main`).
- Database: run against the local SQLite seed at
  `packages/shared/data/local.db` (created on first `pnpm dev`). Do
  not capture against a personal development database with custom
  data — the goal is a deterministic baseline.
- Browser: any Chromium-based browser at a standard zoom level
  (100%). Disable extensions that inject overlays (ad blockers,
  password managers, devtools toolbars).

### 2. Viewport

- **Viewport size: 1440 × 900** (desktop reference).
- Capture only the **viewport**, not the full scrollable page —
  full-page captures inflate the file size and obscure above-the-fold
  changes. If a page is taller than the viewport, scroll to the top
  before capturing.

### 3. Signed-in fixture

For every signed-in surface (everything except `/onboarding`'s
unauthenticated entry path):

1. Run `pnpm dev` from the repository root. The dev preflight script
   provisions the local SQLite database and starts the api + web
   workspaces in parallel.
2. Sign in via Clerk using the project's test instance credentials.
   Use the `dev_admin`-roled account for the `/admin/*` pages and a
   standard `athlete`-roled account for `/dashboard` and
   `/onboarding`.
3. Wait for the page's loading skeletons and async data fetches to
   settle before capturing. Empty-state branches (e.g. an empty
   roster) are acceptable when the seeded database has no matching
   rows — the baseline is the page's *deterministic* render, not a
   populated demo.

### 4. Capture

- Use the browser's built-in screenshot tool (DevTools → "Capture
  screenshot") or any OS-level utility (Snipping Tool on Windows,
  `Cmd + Shift + 4` on macOS).
- Save as PNG. Crop to the 1440 × 900 viewport rectangle if your
  capture tool does not respect viewport bounds.
- Optimise the resulting PNG so the file is **under 250 KB**. Lossy
  optimisation is acceptable for baseline screenshots — the goal is
  visual diffing, not pixel-perfect archival. Tools that work:
  - [pngquant](https://pngquant.org/) — `pngquant --quality 65-80 <file>`
  - [TinyPNG](https://tinypng.com/) — drag-and-drop web UI
  - macOS Preview's "Export…" with reduced quality
- Save to `docs/screenshots/<page>.png`, overwriting the existing
  placeholder.

### 5. Verify

Before committing the refreshed screenshot:

- Confirm the file is a valid PNG (`file docs/screenshots/<page>.png`
  reports `PNG image data`).
- Confirm the file is under 250 KB (`du -h docs/screenshots/<page>.png`
  on POSIX, or `(Get-Item docs/screenshots/<page>.png).Length` in
  PowerShell).
- Confirm the rendered image opens correctly in a browser.

## Refresh policy {#refresh-policy}

Refresh the baseline screenshot for a page when **any** of the
following lands on `main`:

- A change to the page's layout (component reorder, new section,
  removed section).
- A change to the page's palette, typography, or spacing tokens that
  shifts the page's visible appearance.
- A change to one of the shared primitives the page consumes
  (`FormField`, `PageHeader`, `DataTable`, `EmptyState`, etc.) that
  alters that primitive's rendered appearance.

Do **not** refresh the baseline for changes that are invisible
end-to-end (refactors, performance fixes, accessibility-only fixes
that don't shift the visible render). The baseline tracks the
*visual contract*, not the implementation.

When you refresh a screenshot, include both the new PNG and a short
note in the PR description explaining what changed visually so
reviewers can confirm the intent.
