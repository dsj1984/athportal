---
id: tp-identity-jit-provisioning
type: plan
title: Just-In-Time user provisioning on first authenticated request (ADR-005)
domain: identity
persona: athlete
surface: web
route_prefixes:
  - /sign-up
  - /onboarding
est_minutes: 8
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB freshly reset and reseeded via pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed so the users table contains only the seeded baseline"
  - "no existing user matches the e2e email"
---

## Setup

- This plan exercises the Just-In-Time user-provisioning contract specified by **ADR-005**: a newly-authenticated Clerk user receives an internal `users` row the first time they hit a protected route. The relevant code paths are `apps/api/src/middleware/auth.ts` (where `clerkAuth` validates the session token and `requireInternalUser` performs JIT provisioning) and `packages/shared/src/rbac/policy.ts` (which consumes the internal user record for downstream role decisions).
- Confirm the local stack is running. `pnpm dev` at the repo root must be active; the API binds to `http://localhost:8787` and the web app serves from `http://localhost:4321`.
- Reset and reseed the DB so the `users` table contains only the deterministic baseline: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`. The plan asserts the absence of a row for the test email both before and after sign-up.
- Pick a fresh, unique test email address (e.g. `e2e-jit+<timestamp>@example.com`).
- Have a way to inspect the local SQLite DB ready (e.g. `pnpm --filter @repo/shared exec drizzle-kit studio`, or a direct query via the project's DB-inspection script). The plan uses this side-channel to confirm the JIT row is created.

## Steps

1. Before any sign-up, inspect the local `users` table for any row whose email matches the test address.
   **Expected:** no row exists. The fresh seed contains only the baseline fixture rows; the test email is absent.

2. Open a fresh browser session and complete sign-up at `/sign-up` with the test email and a strong password. Verify the email via the Clerk test channel.
   **Expected:** Clerk creates the external user and the browser is redirected to `/onboarding`. At this point, per ADR-005, the JIT provisioning hook has fired on the first authenticated request and a corresponding internal `users` row should now exist.

3. While on `/onboarding`, re-inspect the local `users` table for a row whose email matches the test address.
   **Expected:** exactly one row exists for the test email. The row carries a Clerk user id (the foreign key linking the internal user back to Clerk) and `onboardingCompleted=false`. No duplicate rows exist (JIT is idempotent on subsequent requests).

4. Without completing onboarding, reload `/onboarding` once.
   **Expected:** the page renders the onboarding shell again. Re-inspecting the `users` table shows still exactly one row for the test email — the JIT path did not insert a duplicate on the second authenticated request.

5. Complete the onboarding flow with the `athlete` persona and safe placeholder values.
   **Expected:** the browser lands on the post-onboarding surface (`/dashboard`). The `users` row for the test email now has `onboardingCompleted=true` (verifiable via the DB-inspection side-channel).

6. Sign out via `/sign-out`, then sign back in with the same credentials.
   **Expected:** sign-in succeeds and the browser redirects directly to `/dashboard` (not `/onboarding`) because the internal user row already exists with `onboardingCompleted=true`. The `users` table still contains exactly one row for the test email — re-authentication does not create a second internal user.

7. Inspect the response from a protected API endpoint (any authenticated route the web app calls from `/dashboard`).
   **Expected:** the request succeeds with no JIT-provisioning side effects — the internal user is resolved from the existing row, not re-created. The browser devtools network panel shows the request authorising cleanly without an additional write to the user store.

## Cleanup

- Sign out via `/sign-out`.
- Reset the local DB to the deterministic baseline so the next plan starts from the same state: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`.
- If the run failed midway and left a Clerk user without a matching internal `users` row (or vice versa), delete the Clerk user via the Clerk dashboard before retrying.
