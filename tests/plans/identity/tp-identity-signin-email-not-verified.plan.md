---
id: tp-identity-signin-email-not-verified
type: plan
title: Sign-in attempt with an unverified email surfaces the verification prompt
domain: identity
persona: athlete
surface: web
route_prefixes:
  - /sign-up
  - /sign-in
est_minutes: 7
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB freshly reset and reseeded via pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed"
  - "no existing user matches the e2e email"
---

## Setup

- Confirm the local stack is running. `pnpm dev` at the repo root must be active.
- Reset and reseed the DB: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`. The plan needs to create a brand-new Clerk user that has NOT verified the email.
- Pick a fresh, unique test email address (e.g. `e2e-unverified+<timestamp>@example.com`).
- Have the Clerk test channel ready in case the verification needs to be retrieved later in the plan, but for the first part of the plan, intentionally do NOT submit the verification code.

## Steps

1. Open a fresh browser session and visit `/sign-up`. Enter the test email and a strong password, then submit.
   **Expected:** Clerk creates the external user and the page transitions to a "verify your email" state. A verification code has been delivered to the Clerk test channel but the user has NOT yet submitted it.

2. Without entering the verification code, close the browser tab (or sign out via Clerk's "cancel" / "use a different account" control if exposed).
   **Expected:** the browser returns to an unauthenticated state. No session cookie was set, and the new Clerk user remains in an unverified state.

3. Open a fresh browser session (or new private window) and visit `/sign-in`. Enter the unverified test email in the email field.
   **Expected:** the form accepts the email and advances to the password step (or makes the password field interactive). No top-level error banner appears yet — Clerk does not leak the verification state before the credentials are submitted.

4. Enter the password used in step 1 and submit the form.
   **Expected:** instead of being signed in to `/dashboard` or `/onboarding`, the user is presented with the email-verification prompt — the same surface they abandoned in step 2. The page communicates that the email is not yet verified and requests the verification code.

5. Inspect the browser storage and cookies for any authenticated session marker.
   **Expected:** no authenticated session cookie has been set. The user has been authenticated against Clerk only insofar as Clerk knows the credentials match — the verification gate prevents a usable session from being issued. No auth token is present in `localStorage` or `sessionStorage`.

6. Retrieve the verification code from the Clerk test channel and submit it on the verification prompt.
   **Expected:** verification succeeds and Clerk completes the sign-in flow. The browser is redirected to `/onboarding` because the internal `users` row was JIT-provisioned with `onboardingCompleted=false` on this first fully-authenticated request.

7. Confirm the URL bar shows `/onboarding`.
   **Expected:** the onboarding shell renders. The verification-then-sign-in flow has correctly bridged into the standard post-sign-up path.

## Cleanup

- Sign out via `/sign-out` (or close the browser session without completing onboarding).
- Reset the local DB to the deterministic baseline: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`.
- Delete the Clerk test-instance user created by this plan from the Clerk dashboard so the test email can be reused.
