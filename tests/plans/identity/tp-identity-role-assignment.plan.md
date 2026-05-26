---
id: tp-identity-role-assignment
type: plan
title: Role assignment during onboarding lands each persona on its dashboard
domain: identity
persona: athlete
surface: web
route_prefixes:
  - /sign-up
  - /onboarding
  - /dashboard
est_minutes: 12
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded (pnpm db:seed)"
  - "persona users bootstrapped in Clerk per docs/runbooks/clerk-persona-bootstrap.md"
---

## Setup

- This plan exercises the role-assignment behaviour of the onboarding flow: the persona the user selects at the onboarding persona-prompt determines the internal role recorded on the `users` row, and that role drives the post-onboarding redirect target. The decision path runs through `packages/shared/src/rbac/policy.ts` (role-to-resource mapping) and the post-onboarding redirect helper invoked when the onboarding form submits.
- Confirm the local stack is running. `pnpm dev` at the repo root must be active.
- Reset and reseed the DB: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`. The plan creates three brand-new users — one per persona — so it must start from a clean baseline.
- Pick three fresh, unique test email addresses, one per persona (e.g. `e2e-role-athlete+<ts>@example.com`, `e2e-role-coach+<ts>@example.com`, `e2e-role-orgadmin+<ts>@example.com`).
- If the build requires an invitation token to onboard as an org-admin, have the seeded token available; otherwise the persona-selection prompt is the sole role-assignment input.

## Steps

1. In a fresh browser session, complete sign-up at `/sign-up` with the **athlete** test email and a strong password; verify via Clerk; reach `/onboarding`. Select the `athlete` persona at the persona-selection prompt and submit. Complete any remaining required fields with safe placeholders.
   **Expected:** after the final onboarding step, the browser lands on `/dashboard` (the athlete's default authenticated surface). The signed-in identity in the header corresponds to the athlete test email. The page is not the admin surface and not the coach surface.

2. Sign out via the `<UserButton/>` menu in the header (the menu posts to `/sign-out`). Never GET `/sign-out` — the route returns 405 Method Not Allowed by design; see `docs/testing-strategy.md` § QA Corpus → Sign-out pattern.
   **Expected:** the browser returns to the unauthenticated landing surface and the session cookie is cleared.

3. Open a second fresh browser session (or clear cookies), then complete sign-up with the **coach** test email and a strong password; verify; reach `/onboarding`. Select the `coach` persona and submit. Complete remaining coach-specific onboarding fields with safe placeholders.
   **Expected:** after the final onboarding step, the browser lands on the coach's default authenticated landing surface (coach dashboard or `/dashboard` per the current build). The header shows the coach test email's identity. The surface is recognisably coach-scoped — not the athlete dashboard's athlete-only widgets, not the admin surface.

4. Sign out via the `<UserButton/>` menu in the header (the menu posts to `/sign-out`). Never GET `/sign-out` — the route returns 405 Method Not Allowed by design; see `docs/testing-strategy.md` § QA Corpus → Sign-out pattern.
   **Expected:** the browser returns to the unauthenticated landing surface and the session cookie is cleared.

5. Open a third fresh browser session, complete sign-up with the **org-admin** test email, verify, reach `/onboarding`. Select the `org-admin` persona (and paste the seeded invitation token if the build requires it). Complete remaining org-admin onboarding fields with safe placeholders.
   **Expected:** after the final onboarding step, the browser lands on the org-admin's default authenticated landing surface (typically `/admin` or the admin dashboard). The header shows the org-admin test email's identity. Admin-only nav entries (e.g. `/admin/import`, `/admin/invitations`) are visible.

6. While still signed in as the org-admin, try to navigate to a coach-only or athlete-only surface (whichever exists on the current build). Then try to navigate the athlete back to `/admin` after signing in as the athlete again.
   **Expected:** each cross-role attempt is denied at the authorisation boundary — either redirected to the persona's correct landing surface or rendered as an access-denied state. The role recorded at onboarding governs which surfaces the user can reach; the user cannot escalate by visiting another role's URL.

7. Inspect the three internal `users` rows created by this plan via the DB-inspection side-channel.
   **Expected:** each row carries the persona/role recorded at the persona-prompt step (athlete, coach, org-admin respectively). No row has a role other than the one selected by the user at onboarding.

## Cleanup

- Sign out via the `<UserButton/>` menu in the header from whichever session is active (the menu posts to `/sign-out`). Never GET `/sign-out` — the route returns 405 Method Not Allowed by design; see `docs/testing-strategy.md` § QA Corpus → Sign-out pattern.
- Reset the local DB so the next plan starts from a clean baseline: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`.
- Delete any Clerk test-instance users that were partially created if the run aborted midway, so the test emails can be reused.
