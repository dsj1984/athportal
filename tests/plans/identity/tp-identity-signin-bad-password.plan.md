---
id: tp-identity-signin-bad-password
type: plan
title: Sign-in with wrong password surfaces a visible error
domain: identity
persona: athlete
surface: web
route_prefixes:
  - /sign-in
est_minutes: 5
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded via pnpm --filter @repo/shared run db:seed so the seeded athlete fixture exists"
  - "the seeded athlete's email is known; the password used in this plan is intentionally wrong"
---

## Setup

- Confirm the local stack is running. `pnpm dev` at the repo root must be active; the API binds to `http://localhost:8787` and the web app serves from `http://localhost:4321`.
- Confirm the seeded fixture is present: run `pnpm --filter @repo/shared run db:seed` since the last reset. The seed must produce at least one athlete `users` row whose email this plan will reuse.
- Note the seeded athlete's email. The password this plan submits is an intentionally-wrong value (e.g. `WrongPassword!9999`) — never the seeded user's real password.
- Open a fresh browser session with no existing cookies for the local origin so the plan exercises the wrong-password path against an unauthenticated visitor.

## Steps

1. Open the fresh browser session and visit `/sign-in`.
   **Expected:** the sign-in page renders with the sign-in heading and a form containing email and password fields. No "you're already signed in" banner appears.

2. Enter the seeded athlete's email in the email field.
   **Expected:** the form accepts the email and advances to the password step (or makes the password field interactive) without a top-level error banner.

3. Enter the intentionally-wrong password and submit the form.
   **Expected:** the page remains on `/sign-in`. A visible error message indicates the credentials are not valid. The browser is NOT redirected to `/dashboard` or `/onboarding`.

4. Inspect the error message wording.
   **Expected:** the message is generic (e.g. "incorrect email or password") and does not disclose whether the email exists in the system. No timing-oracle signal — the response feels comparable to a sign-in with a non-existent email (this is a soft check; the contract-tier auth-fuzz coverage owns the precise timing assertion).

5. Inspect the browser storage and cookies via devtools.
   **Expected:** no authenticated session cookie was set. No auth token appears in `localStorage` or `sessionStorage`. The pre-existing visitor cookie state is unchanged.

6. Click into the password field, replace the wrong value with the correct seeded password, and submit.
   **Expected:** the form authenticates successfully and redirects to `/dashboard`. The previous failed attempt did not lock the account or block this legitimate sign-in.

## Cleanup

- Sign out via `/sign-out`. The browser should redirect to the unauthenticated landing surface.
- No DB reset is required — this plan does not mutate persistent state.
- If a rate-limit was reached during repeated wrong-password attempts (the auth endpoint is rate-limited per the security baseline), wait the configured cool-down before rerunning, or reset the local rate-limit store per the project's documented procedure.
