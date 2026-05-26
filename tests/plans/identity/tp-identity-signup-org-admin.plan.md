---
id: tp-identity-signup-org-admin
type: plan
title: Sign-up → onboarding happy path (org-admin)
domain: identity
persona: org-admin
surface: web
route_prefixes:
  - /sign-up
  - /onboarding
est_minutes: 10
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded with a fresh org via pnpm --filter @repo/shared run db:seed"
  - "no existing user matches the e2e email; reset via pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed if rerunning"
  - "an org invitation token or org-admin bootstrap path exists in the seed fixture so the new user can land in the org-admin role"
---

## Setup

- Confirm the local stack is running. `pnpm dev` at the repo root must be active; the API binds to `http://localhost:8787` and the web app serves from `http://localhost:4321`.
- Confirm the DB has been seeded by running `pnpm --filter @repo/shared run db:seed` since the last reset. A fresh seed is required so the JIT user-provisioning path is exercised against an empty `users` row.
- Pick a fresh, unique test email address (e.g. `e2e-orgadmin+<timestamp>@example.com`). The plan assumes this address is not yet registered with Clerk and not yet present in the local `users` table.
- Confirm the seeded fixture exposes an org-admin onboarding path (typically an invitation token URL or a seed-time first-admin bootstrap on a fresh org). The exact mechanism is whichever the current build ships; the plan assumes the persona-selection prompt offers `org-admin` for the seeded fixture.

## Steps

1. Open a fresh browser session and visit `/sign-up`.
   **Expected:** the sign-up page renders with the sign-up heading and a form containing email and password fields. No "you're already signed in" banner appears.

2. Enter the test email address in the email field and a strong password (≥ 12 characters, mixed case, digit, symbol) in the password field, then submit the form.
   **Expected:** the page transitions to a "verify your email" state requesting a verification code. No top-level error banner appears.

3. Retrieve the verification code from the Clerk test channel and enter it in the verification field, then submit.
   **Expected:** Clerk acknowledges the verification and the browser is redirected to `/onboarding` (the mandatory onboarding gate).

4. Confirm the URL bar shows `/onboarding` and the onboarding shell renders.
   **Expected:** the onboarding page renders with the persona-selection prompt. The page is not the dashboard.

5. Select the `org-admin` persona at the persona-selection prompt and submit. If the build requires an invitation token for org-admin sign-up, paste the seeded token and submit.
   **Expected:** the onboarding flow advances to the org-admin-specific next step (org selection or org-admin profile fields) without surfacing a validation error.

6. Complete any remaining required org-admin onboarding fields with safe placeholder values (e.g. display name, role within org) and submit each step.
   **Expected:** each step accepts the input and advances. No validation error blocks progression.

7. After the final onboarding step submits successfully, observe the post-onboarding redirect.
   **Expected:** the browser lands on the org-admin's default authenticated landing surface (typically `/admin` or the admin dashboard per the current build). The header shows the signed-in identity for the test email.

8. From the landing surface, navigate to `/admin` (or click the primary admin nav entry).
   **Expected:** the `/admin` surface renders without an authorization error. The signed-in user is recognised as an org-admin and admin-only controls (e.g. import, invitations) are visible.

9. Reload the admin landing surface once.
   **Expected:** the page re-renders without redirecting back to `/onboarding`. The session cookie is `httpOnly` and `secure`, and no auth token is present in `localStorage` or `sessionStorage`.

## Cleanup

- Sign out via the `<UserButton/>` menu in the header (the menu posts to `/sign-out`). The browser should redirect to the unauthenticated landing surface. Never GET `/sign-out` — the route returns 405 Method Not Allowed by design; see `docs/testing-strategy.md` § QA Corpus → Sign-out pattern.
- Reset the local DB so the next run starts from a clean baseline: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`.
- If the run failed midway and the test email was partially registered with Clerk, delete the user from the Clerk dashboard (Clerk Test instance) before retrying with the same address.
