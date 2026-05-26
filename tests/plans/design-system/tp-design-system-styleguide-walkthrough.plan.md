---
id: tp-design-system-styleguide-walkthrough
type: plan
title: Internal styleguide walkthrough (design-system reference)
domain: design-system
persona: org-admin
surface: web
route_prefixes:
  - /internal/styleguide
est_minutes: 10
prerequisites:
  - "local stack running (pnpm dev) — api on http://localhost:8787, web on http://localhost:4321"
  - "DB seeded via pnpm --filter @repo/shared run db:seed so the internal users table is populated"
  - "operator's local user promoted to dev_admin via pnpm --filter @repo/shared exec scripts/seed-dev-admin.mjs — decideStyleguideAccess (apps/web/src/pages/internal/styleguide.ts) denies every non-dev_admin caller with a 302 to /; an org-admin or coach session is bounced even though they are signed in"
  - "browser session signed in (via /sign-in) as the dev_admin-promoted user; no separate org-admin session is required to walk the page"
---

## Setup

- Confirm the local stack is running. `pnpm dev` at the repo root must be active; the api binds to `http://localhost:8787` and the web app serves from `http://localhost:4321`.
- Confirm the DB has been seeded by running `pnpm --filter @repo/shared run db:seed` since the last reset. The internal `users` table must be populated so the styleguide gate (`apps/web/src/pages/internal/styleguide.ts` → `decideStyleguideAccess`) can resolve a role for the operator's Clerk subject id.
- Promote the operator's local user to `dev_admin` via `pnpm --filter @repo/shared exec scripts/seed-dev-admin.mjs`. The gate is deny-by-default: any signed-in user whose role is not `dev_admin` (including a seeded `org-admin`) is bounced with a 302 to `/`. The plan's `persona: org-admin` front-matter identifies the closest in-product signed-in administrative role the QA persona enum exposes (`scripts/qa/schema/personas.ts`); the in-app gate itself is satisfied by the `dev_admin` promotion script, not by the persona claim.
- Sign in at `/sign-in` with the promoted account, then confirm the header shows the signed-in identity before walking the plan. Do **not** test in an incognito window without the `dev_admin` promotion — the gate will 302 to `/` and the rest of the steps will not be reachable.
- Open DevTools so the Network tab is visible during step 1; the unconditional `X-Robots-Tag: noindex, nofollow` response header (set by the page front-matter regardless of branch) is part of the expected outcome.

## Steps

1. Navigate to `http://localhost:4321/internal/styleguide`.
   **Expected:** the page renders with the `Internal styleguide` H1 and intro copy explaining the page documents the Epic #702 primitives. The browser does **not** redirect to `/`. The Network tab shows the response carries `X-Robots-Tag: noindex, nofollow` per `docs/style-guide.md` § _Live reference: `/internal/styleguide`_ (the auth gate row pins this header on every branch).

2. Scroll to the `1. Foundations` section and verify it renders the four foundation sub-grids in order: `Colour tokens`, `Radius scale`, `Shadow scale`, `Type ramp` (each rendered by `apps/web/src/components/styleguide/Foundations.astro`).
   **Expected:** the colour-token swatches surface the brand and functional accent tokens declared in `docs/style-guide.md` §3.1–§3.3 (Hyper-Violet `#9333EA`, Electric Cyan `#06B6D4`, Emerald `#10B981`, Amber `#F59E0B`, Alert Coral `#F43F5E`, plus the surface/text tokens). The Radius and Shadow grids render the five-step `--radius-*` ramp and the four-step `--shadow-*` ramp documented in `docs/style-guide.md` §3.5. The Type ramp shows the Space Grotesk display face and the Inter UI face from `docs/style-guide.md` §2.

3. Scroll to the `2. Interactive atoms` section and verify it renders the three sub-grids in order: `Btn — kind × size matrix`, `Form controls — default + invalid intents`, `Toast triggers` (each rendered by `apps/web/src/components/styleguide/InteractiveAtoms.astro`).
   **Expected:** the `Btn` matrix shows every kind × size combination the primitive library ships and the buttons accept keyboard focus (tab through them and confirm a visible focus ring rendered with the `--color-border-strong` token from `docs/style-guide.md` §3.3). The form controls section shows the default state, the invalid intent (red `--color-alert-coral` ring), and at least one disabled control with reduced contrast per `docs/style-guide.md` §3.3 (text-tertiary).

4. Scroll to the `3. Display atoms` section and verify it renders eight sub-grids in order: `Badge — every tone × dot`, `Avatar — image + initials`, `Ring — multiple values`, `Stat — label / value / unit / trend / verified / hint`, `Card / CardSoft`, `Logo`, `VerifiedTick`, `Ph — placeholder` (each rendered by `apps/web/src/components/styleguide/DisplayAtoms.astro`).
   **Expected:** the `Badge` grid renders every tone using the translucent "soft" pattern from `docs/style-guide.md` §3.4 (12–15 % accent-colour background, 100 % accent-colour text) — no badge uses a solid dark background. The `Avatar` grid shows both an image-backed avatar and an initials-backed avatar. The `Card`/`CardSoft` row shows the resting elevation `--shadow-sm` from `docs/style-guide.md` §3.5. The `Logo` and `VerifiedTick` atoms render once each.

5. Scroll to the `4. Composites` section and verify it renders the higher-level building blocks in order: `EventChip — every event_type × conflict` and `Shell — persona previews` (each rendered by `apps/web/src/components/styleguide/Composites.astro`).
   **Expected:** the `EventChip` grid renders every event-type variant (game, practice, admin, etc.) including the conflict-overlay variant documented in `docs/style-guide.md` § _Calendar & event chip styling (Epic #466)_ / § _EventChip composite — Epic #702 extension_. The `Shell` previews render at least one persona-scoped preview frame and each preview surfaces a `<h2>` title that names the previewed persona.

6. Scroll to the `5. Primitives (Epic #828)` section and verify it renders the three sub-grids in order: `FormField — full props matrix`, `PageHeader — branches`, `DataTable — branches` (each rendered by `apps/web/src/components/styleguide/Primitives.astro`).
   **Expected:** the `FormField` matrix renders the labelled control with its supporting copy slots (label, hint, error). The `PageHeader` row renders at least the default branch and one alternative branch. The `DataTable` row renders a table with column headers and at least one data row. All three primitives respect the `--radius-md`/`--radius-lg` tokens from `docs/style-guide.md` §3.5 — no inline `border-radius` overrides are visible.

7. Tab through the page from the top of `1. Foundations` to the bottom of `5. Primitives` using the keyboard alone.
   **Expected:** every interactive control (button, link, form input) receives a visible focus ring; no element is reached that lacks a focus indicator. Confirms the `Accessibility First` principle from `docs/style-guide.md` §1.

## Cleanup

- Sign out via the `<UserButton/>` menu in the header (the menu posts to `/sign-out`). The browser should redirect to the unauthenticated landing surface. Never GET `/sign-out` — the route returns 405 Method Not Allowed by design; see `docs/testing-strategy.md` § QA Corpus → Sign-out pattern.
- No DB reset is required — the plan does not mutate any rows; it is read-only against the rendered styleguide page.
- If the operator's `dev_admin` promotion was temporary (e.g. created solely to walk this plan), revert it by running `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed` so the next contributor starts from the same baseline.
