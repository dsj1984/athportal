---
id: tp-identity-signin-happy
type: plan
title: Sign-in happy path (already-onboarded athlete)
domain: identity
persona: athlete
surface: web
route_prefixes:
  - /sign-in
  - /dashboard
est_minutes: 5
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded (pnpm db:seed)"
  - "persona users bootstrapped in Clerk per docs/runbooks/clerk-persona-bootstrap.md"
---

## Setup

- Confirm the local stack is running. `pnpm dev` at the repo root must be active; the API binds to `http://localhost:8787` and the web app serves from `http://localhost:4321`.
- Confirm the seeded fixture is present: run `pnpm --filter @repo/shared run db:seed` since the last reset. The seed must produce at least one athlete `users` row with `onboardingCompleted=true` so the sign-in path skips the onboarding gate.
- Note the seeded athlete's email. Operators without the persona password (Clerk passwords aren't stored durably outside the bootstrap session) may sign in via the dev-only seam `/dev/sign-in-as/athlete` — see [`apps/web/src/pages/dev/sign-in-as/[persona].ts`](../../../apps/web/src/pages/dev/sign-in-as/%5Bpersona%5D.ts). The seam mints a Clerk sign-in ticket from `clerk-personas.json` and redirects through Clerk's ticket flow; it is hard-refused in production. Plans that exercise password-form behaviour (e.g. `tp-identity-signin-bad-password`) MUST use the form path; this happy-path Plan may use either.
- Open a fresh browser session with no existing cookies for the local origin so this plan exercises a clean sign-in rather than a session-resume.

## Steps

1. Open the fresh browser session and visit `/sign-in`.
   **Expected:** the sign-in page renders with the sign-in heading and a form containing email and password fields. No "you're already signed in" banner appears.

2. Enter the seeded athlete's email and submit.
   **Expected:** Clerk's two-step flow advances to the factor-one (password) screen. No top-level error banner appears.

3. Enter the seeded athlete's password on the factor-one screen and submit.
   **Expected:** Clerk authenticates the credentials and the browser is redirected to the athlete's default authenticated landing surface — `/dashboard`. No "verify your email" prompt appears because the seeded user is pre-verified.

4. Confirm the URL bar shows `/dashboard` and the dashboard renders.
   **Expected:** the dashboard surface renders with the signed-in athlete identity visible in the header. The page is not `/onboarding` and not the marketing site.

5. Reload `/dashboard` once.
   **Expected:** the dashboard re-renders without redirecting back to `/sign-in` or `/onboarding`. Session cookies match Clerk's documented posture — `__session` is short-lived (≤5 min TTL) and JS-readable by design (Clerk's SDK reads it to refresh). No long-lived auth secret (refresh token, `sk_*` key, or anything Clerk's docs forbid for the browser) appears in `localStorage` or `sessionStorage`.

6. Click the primary nav entry that leads to a different athlete-authenticated surface (e.g. profile or schedule, per the current build).
   **Expected:** the destination page renders signed-in. The transition does not bounce through `/sign-in` and the URL bar lands on the expected destination.

## Cleanup

- Sign out via the `<UserButton/>` menu in the header (the menu posts to `/sign-out`). The browser should redirect to the unauthenticated landing surface. Never GET `/sign-out` — the route returns 405 Method Not Allowed by design; see `docs/testing-strategy.md` § QA Corpus → Sign-out pattern.
- No DB reset is required — this plan reads only the seeded fixture and writes no new rows. If a future iteration adds a write, add the reset here.
