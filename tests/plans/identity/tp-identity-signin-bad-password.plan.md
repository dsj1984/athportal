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
  - "DB seeded (pnpm db:seed)"
  - "persona users bootstrapped in Clerk per docs/runbooks/clerk-persona-bootstrap.md"
---

## Setup

- Confirm the local stack is running. `pnpm dev` at the repo root must be active; the API binds to `http://localhost:8787` and the web app serves from `http://localhost:4321`.
- Confirm the seeded fixture is present: run `pnpm --filter @repo/shared run db:seed` since the last reset. The seed must produce at least one athlete `users` row whose email this plan will reuse.
- Note the seeded athlete's email. The password this plan submits is an intentionally-wrong value (e.g. `WrongPassword!9999`) — never the seeded user's real password. This Plan MUST exercise the password-form path; the `/dev/sign-in-as/:persona` seam (a valid shortcut for the happy-path and sign-out Plans) BYPASSES the password screen and so does not exercise the surface under test here. The recovery step at the end (re-sign-in with the correct password) may instead use the dev-seam if the operator does not know the persona password — see [`apps/web/src/pages/dev/sign-in-as/[persona].ts`](../../../apps/web/src/pages/dev/sign-in-as/%5Bpersona%5D.ts).
- Open a fresh browser session with no existing cookies for the local origin so the plan exercises the wrong-password path against an unauthenticated visitor.

## Steps

1. Open the fresh browser session and visit `/sign-in`.
   **Expected:** the sign-in page renders with the sign-in heading and a form containing email and password fields. No "you're already signed in" banner appears.

2. Enter the seeded athlete's email and submit.
   **Expected:** Clerk's two-step flow advances to the factor-one (password) screen without a top-level error banner.

3. Enter the intentionally-wrong password on the factor-one screen and submit.
   **Expected:** the page remains on the factor-one (sign-in) flow. A visible error message indicates the credentials are not valid. The browser is NOT redirected to `/dashboard` or `/onboarding`.

4. Inspect the error message wording.
   **Expected:** the message is generic (e.g. "incorrect email or password") and does not disclose whether the email exists in the system. No timing-oracle signal — the response feels comparable to a sign-in with a non-existent email (this is a soft check; the contract-tier auth-fuzz coverage owns the precise timing assertion).

5. Inspect the browser storage and cookies via devtools.
   **Expected:** no authenticated session cookie was set. No auth token appears in `localStorage` or `sessionStorage`. The pre-existing visitor cookie state is unchanged.

6. Click into the password field, replace the wrong value with the correct seeded password, and submit.
   **Expected:** the form authenticates successfully and redirects to `/dashboard`. The previous failed attempt did not lock the account or block this legitimate sign-in.

## Cleanup

- Sign out via the `<UserButton/>` menu in the header (the menu posts to `/sign-out`). The browser should redirect to the unauthenticated landing surface. Never GET `/sign-out` — the route returns 405 Method Not Allowed by design; see `docs/testing-strategy.md` § QA Corpus → Sign-out pattern.
- No DB reset is required — this plan does not mutate persistent state.
- If a rate-limit was reached during repeated wrong-password attempts (the auth endpoint is rate-limited per the security baseline), wait the configured cool-down before rerunning, or reset the local rate-limit store per the project's documented procedure.
