---
id: tp-identity-signup-happy-path
type: plan
title: Sign-up → onboarding happy path (athlete)
domain: identity
persona: athlete
surface: web
route_prefixes:
  - /sign-up
  - /onboarding
est_minutes: 8
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded with a fresh org via pnpm --filter @repo/shared run db:seed"
  - "no existing user matches the e2e email; reset via pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed if rerunning"
---

## Setup

- Confirm the local stack is running. `pnpm dev` at the repo root must be active; the API binds to `http://localhost:8787` and the web app serves from `http://localhost:4321`.
- Confirm the DB has been seeded by running `pnpm --filter @repo/shared run db:seed` since the last reset. A fresh seed is required so the JIT user-provisioning path is exercised end-to-end against an empty `users` row.
- Pick a fresh, unique test email address (e.g. `e2e-athlete+<timestamp>@example.com`). The plan assumes this address is not yet registered with Clerk and not yet present in the local `users` table.
- Have the email-verification side-channel ready. In the local stack Clerk delivers verification codes through the Clerk test instance; the operator (or agent) retrieves the code via the Clerk dashboard or the `@clerk/testing` helper exposed by `packages/shared/src/testing/auth.ts`.

## Steps

1. Open a fresh browser session and visit `/sign-up`.
   **Expected:** the sign-up page renders with a heading that announces the sign-up flow and a form containing email and password fields. No "you're already signed in" banner appears.

2. Enter the test email address in the email field and a strong password (≥ 12 characters, mixed case, digit, symbol) in the password field, then submit the form.
   **Expected:** the page transitions to a "verify your email" state requesting a verification code. No top-level error banner appears.

3. Retrieve the verification code from the Clerk test channel and enter it in the verification field, then submit.
   **Expected:** Clerk acknowledges the verification and the browser is redirected to the post-sign-up surface. The redirect target is `/onboarding` (the mandatory onboarding gate) because the JIT user provisioning has just created a `users` row with `onboardingCompleted=false`.

4. Confirm the URL bar shows `/onboarding` and the onboarding shell renders.
   **Expected:** the onboarding page renders with the persona-selection prompt (or the first onboarding step the current build ships). The page is not the dashboard, and the page is not the marketing site.

5. Complete the onboarding flow by selecting the `athlete` persona (where the build prompts for one) and submitting any remaining required onboarding fields with safe placeholder values.
   **Expected:** each onboarding step accepts the input and advances to the next prompt without surfacing a validation error.

6. After the final onboarding step submits successfully, observe the post-onboarding redirect.
   **Expected:** the browser lands on `/dashboard` (the athlete's default authenticated landing surface). The header shows the signed-in identity (or initials) corresponding to the test email, and the "you must complete onboarding" gate is gone.

7. Reload `/dashboard` once.
   **Expected:** the dashboard re-renders without redirecting back to `/onboarding`. The session cookie is `httpOnly` and `secure` (verify in the browser devtools storage tab), and no auth token is present in `localStorage` or `sessionStorage`.

## Cleanup

- Sign out by visiting `/sign-out` (or clicking the sign-out control in the header). The browser should redirect to the unauthenticated landing surface.
- Reset the local DB to a known-clean state so the next run of this plan starts from the same baseline: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`.
- If the run failed midway and the test email was partially registered with Clerk, delete the user from the Clerk dashboard (Clerk Test instance) before retrying with the same address.
