---
id: tp-identity-onboarding-gate
type: plan
title: Mandatory onboarding gate redirects an incomplete user to /onboarding (ADR-005)
domain: identity
persona: athlete
surface: web
route_prefixes:
  - /onboarding
  - /dashboard
  - /sign-up
est_minutes: 7
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB freshly reset and reseeded via pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed"
  - "no existing user matches the e2e email"
---

## Setup

- This plan exercises the **mandatory onboarding gate** specified by **ADR-005**: a signed-in user whose internal `users` row has `onboardingCompleted=false` is redirected to `/onboarding` from every other authenticated surface. The gate is enforced by the same middleware path that performs JIT provisioning (`apps/api/src/middleware/auth.ts` → `requireInternalUser`), with role-aware redirect decisions reading from `packages/shared/src/rbac/policy.ts`.
- Confirm the local stack is running. `pnpm dev` at the repo root must be active.
- Reset and reseed the DB so the `users` table contains only the deterministic baseline: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`. The plan needs a freshly-authenticated user that has NOT yet completed onboarding.
- Pick a fresh, unique test email address (e.g. `e2e-gate+<timestamp>@example.com`).

## Steps

1. Complete sign-up at `/sign-up` with the test email and a strong password, then verify the email via the Clerk test channel.
   **Expected:** the browser is redirected to `/onboarding` because JIT provisioning created a `users` row with `onboardingCompleted=false`.

2. Without completing the onboarding form, leave the onboarding surface partially filled (or untouched), then in the same browser session type `/dashboard` directly into the address bar.
   **Expected:** the browser is redirected back to `/onboarding`. The `/dashboard` surface does NOT render — the onboarding gate intercepts the navigation server-side and rewrites the destination.

3. Try the same direct-navigation trick against any other signed-in surface the build ships (e.g. `/admin`, a profile page, a schedule page — whichever is reachable on the current build).
   **Expected:** every protected destination redirects back to `/onboarding`. No protected page renders for a user with `onboardingCompleted=false`.

4. Inspect the redirect chain in the browser devtools network panel for one of the attempts (e.g. the `/dashboard` attempt).
   **Expected:** the chain shows a server-side redirect (a 3xx response) from the protected destination to `/onboarding`. The browser never receives the protected page's HTML body — the gate runs at the middleware boundary, not in the client.

5. Open a second browser tab in the same session and try to navigate to `/dashboard` from there as well.
   **Expected:** the second tab also redirects to `/onboarding`. The gate is stateless with respect to tab identity and applies to every request the session makes.

6. Return to `/onboarding`, complete the flow with the `athlete` persona and safe placeholder values, and submit the final step.
   **Expected:** the browser is redirected to `/dashboard` (the post-onboarding landing surface). The `users` row now has `onboardingCompleted=true`.

7. After onboarding completes, navigate to `/dashboard` directly via the address bar.
   **Expected:** the dashboard renders signed-in. The onboarding gate no longer intercepts — `onboardingCompleted=true` lets the user reach every persona-appropriate authenticated surface.

## Cleanup

- Sign out via `/sign-out`.
- Reset the local DB to the deterministic baseline: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`.
- If a Clerk user was created without completing onboarding and the test will rerun with the same email, delete the Clerk user from the Clerk dashboard before retrying.
