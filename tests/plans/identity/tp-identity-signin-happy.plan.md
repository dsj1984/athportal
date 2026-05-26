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
- Note the seeded athlete's email and password. These come from the seed script (or a project-local secret declared in `.env.test.local` per the seed contract).
- Open a fresh browser session with no existing cookies for the local origin so this plan exercises a clean sign-in rather than a session-resume.

## Steps

1. Open the fresh browser session and visit `/sign-in`.
   **Expected:** the sign-in page renders with the sign-in heading and a form containing email and password fields. No "you're already signed in" banner appears.

2. Enter the seeded athlete's email in the email field.
   **Expected:** the password field becomes interactive (or the form advances to the password step per the Clerk-rendered flow). No top-level error banner appears.

3. Enter the seeded athlete's password and submit the form.
   **Expected:** Clerk authenticates the credentials and the browser is redirected to the athlete's default authenticated landing surface — `/dashboard`. No "verify your email" prompt appears because the seeded user is pre-verified.

4. Confirm the URL bar shows `/dashboard` and the dashboard renders.
   **Expected:** the dashboard surface renders with the signed-in athlete identity visible in the header. The page is not `/onboarding` and not the marketing site.

5. Reload `/dashboard` once.
   **Expected:** the dashboard re-renders without redirecting back to `/sign-in` or `/onboarding`. The session cookie is `httpOnly` and `secure` (verify in browser devtools storage tab), and no auth token is present in `localStorage` or `sessionStorage`.

6. Click the primary nav entry that leads to a different athlete-authenticated surface (e.g. profile or schedule, per the current build).
   **Expected:** the destination page renders signed-in. The transition does not bounce through `/sign-in` and the URL bar lands on the expected destination.

## Cleanup

- Sign out via the `<UserButton/>` menu in the header (the menu posts to `/sign-out`). The browser should redirect to the unauthenticated landing surface. Never GET `/sign-out` — the route returns 405 Method Not Allowed by design; see `docs/testing-strategy.md` § QA Corpus → Sign-out pattern.
- No DB reset is required — this plan reads only the seeded fixture and writes no new rows. If a future iteration adds a write, add the reset here.
