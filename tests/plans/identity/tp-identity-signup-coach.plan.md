---
id: tp-identity-signup-coach
type: plan
title: Sign-up → onboarding happy path (coach)
domain: identity
persona: coach
surface: web
route_prefixes:
  - /sign-up
  - /onboarding
est_minutes: 9
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded (pnpm db:seed)"
  - "persona users bootstrapped in Clerk per docs/runbooks/clerk-persona-bootstrap.md"
---

## Setup

- Confirm the local stack is running. `pnpm dev` at the repo root must be active; the API binds to `http://localhost:8787` and the web app serves from `http://localhost:4321`.
- Confirm the DB has been seeded by running `pnpm --filter @repo/shared run db:seed` since the last reset. A fresh seed is required so the JIT user-provisioning path is exercised end-to-end against an empty `users` row for the coach persona.
- Pick a fresh, unique test email address (e.g. `e2e-coach+<timestamp>@example.com`). The plan assumes this address is not yet registered with Clerk and not yet present in the local `users` table.
- Have the email-verification side-channel ready. Verification codes are delivered through the Clerk test instance; retrieve via the Clerk dashboard or the `@clerk/testing` helper exposed by `packages/shared/src/testing/auth.ts`.

## Steps

1. Open a fresh browser session and visit `/sign-up`.
   **Expected:** the sign-up page renders with the sign-up heading and a form containing email and password fields. No "you're already signed in" banner appears.

2. Enter the test email address in the email field and a strong password (≥ 12 characters, mixed case, digit, symbol) in the password field, then submit the form.
   **Expected:** the page transitions to a "verify your email" state requesting a verification code. No top-level error banner appears.

3. Retrieve the verification code from the Clerk test channel and enter it in the verification field, then submit.
   **Expected:** Clerk acknowledges the verification and the browser is redirected to `/onboarding` (the mandatory onboarding gate) because JIT user provisioning has just created a `users` row with `onboardingCompleted=false`.

4. Confirm the URL bar shows `/onboarding` and the onboarding shell renders.
   **Expected:** the onboarding page renders with the persona-selection prompt. The page is not the dashboard, and the page is not the marketing site.

5. Select the `coach` persona at the persona-selection prompt and submit.
   **Expected:** the onboarding flow advances to the next coach-specific step (team selection or coach-profile fields, per the current build) without surfacing a validation error.

6. Complete any remaining required coach-onboarding fields with safe placeholder values (e.g. coach display name, team affiliation if the build prompts) and submit each step.
   **Expected:** each step accepts the input and advances to the next prompt. No validation error blocks progression.

7. After the final onboarding step submits successfully, observe the post-onboarding redirect.
   **Expected:** the browser lands on the coach's default authenticated landing surface (the coach dashboard or `/dashboard`, per the current build). The header shows the signed-in identity for the test email and the "must complete onboarding" gate is gone.

8. Reload the landing surface once.
   **Expected:** the page re-renders without redirecting back to `/onboarding`. The session cookie is `httpOnly` and `secure` (verify in browser devtools), and no auth token is present in `localStorage` or `sessionStorage`.

## Cleanup

- Sign out via the `<UserButton/>` menu in the header (the menu posts to `/sign-out`). The browser should redirect to the unauthenticated landing surface. Never GET `/sign-out` — the route returns 405 Method Not Allowed by design; see `docs/testing-strategy.md` § QA Corpus → Sign-out pattern.
- Reset the local DB so the next run starts from a clean baseline: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`.
- If the run failed midway and the test email was partially registered with Clerk, delete the user from the Clerk dashboard (Clerk Test instance) before retrying with the same address.
