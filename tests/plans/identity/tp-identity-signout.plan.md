---
id: tp-identity-signout
type: plan
title: Sign-out invalidates the session and blocks protected routes
domain: identity
persona: athlete
surface: web
route_prefixes:
  - /sign-out
  - /dashboard
  - /sign-in
est_minutes: 6
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded via pnpm --filter @repo/shared run db:seed so the seeded athlete fixture exists with onboardingCompleted=true"
  - "the seeded athlete's email + password are known"
---

## Setup

- Confirm the local stack is running. `pnpm dev` at the repo root must be active.
- Confirm the seeded fixture is present: run `pnpm --filter @repo/shared run db:seed` since the last reset. The seeded athlete must have `onboardingCompleted=true` so the sign-in path reaches `/dashboard` directly.
- Note the seeded athlete's email and password.
- Open a fresh browser session with no existing cookies for the local origin so the plan exercises sign-in → sign-out → protected-route attempt in a clean state.

## Steps

1. Open the fresh browser session, visit `/sign-in`, enter the seeded athlete's credentials, and submit.
   **Expected:** the browser is redirected to `/dashboard` and the signed-in identity appears in the header. The session cookie is set and visible in devtools storage (httpOnly + secure).

2. Navigate to `/dashboard` if not already there and copy down the name of the session cookie (the Clerk session cookie that authorises requests).
   **Expected:** the dashboard renders signed-in and the named cookie is present in the browser's cookie storage for the local origin.

3. Visit `/sign-out` (or click the sign-out control in the header).
   **Expected:** the browser is redirected to the unauthenticated landing surface (typically `/` or `/sign-in`). The signed-in identity is no longer visible in the header.

4. Inspect the browser cookies for the local origin.
   **Expected:** the session cookie noted in step 2 is gone (or has been replaced by an empty / sign-out marker). No auth token remains in `localStorage` or `sessionStorage`.

5. Without signing in again, navigate directly to `/dashboard` by typing the URL into the address bar.
   **Expected:** the browser is redirected to `/sign-in` (the protected-route gate). The dashboard does NOT render — no cached content from the prior signed-in session is shown.

6. Press the browser back button to revisit the dashboard URL.
   **Expected:** the page either redirects to `/sign-in` again or displays an unauthenticated state. No signed-in content is rendered from the back/forward cache.

7. Sign in again with the same credentials.
   **Expected:** the browser is redirected back to `/dashboard`. A fresh session cookie is issued (the value differs from the one captured in step 2), demonstrating the prior session was not reused.

## Cleanup

- Sign out via `/sign-out` to leave the browser in a clean unauthenticated state.
- No DB reset is required — this plan does not mutate persistent state.
