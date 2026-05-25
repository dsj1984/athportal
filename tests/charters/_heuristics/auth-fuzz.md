# auth-fuzz

Probe the authentication surface for paths that bypass, partially apply,
or persist past sign-out. Auth-fuzz is high-value because a single defect
here is a security incident; pair it with `cross-tenant-probe` for the
multi-tenant axis.

## When to apply

Apply at the start of every identity charter, after any change to the
Clerk integration in `apps/api/src/middleware/auth.ts` or the
`@clerk/astro` setup in the web app, and any time the JIT user
provisioning path or session-cookie shape changes. The primary surface
is `/sign-in` (rendered from `apps/web/src/pages/sign-in.astro`),
`/sign-up` (`apps/web/src/pages/sign-up.astro`), and the sign-out
control wired through Clerk's hosted endpoints.

## How to apply

Drive the surface through paths that break the implicit single-session
assumption: (1) open two browser tabs against `/sign-in`, sign in on
tab A, then submit a stale form on tab B; (2) sign in, copy the session
cookie, sign out, then replay the cookie via devtools; (3) submit
`/sign-in` with credentials that match an existing email but a bogus
password — confirm the response time does not leak existence; (4) on
`/sign-up`, submit an email that already has an account and observe
whether the error path leaks the collision via a different message,
status, or timing; (5) attempt to navigate to `/onboarding` and
`/dashboard` with no session cookie, with a session cookie for a user
whose `onboardingCompleted=false`, and with a session cookie tampered to
flip the `onboardingCompleted` flag (the server is the source of truth;
the client claim must be ignored).

## Signals of a finding

- A signed-out session cookie still authorizes a privileged request.
- The sign-in response time differs measurably between
  "email exists, wrong password" and "email does not exist" (timing
  oracle).
- A direct GET to `/dashboard` with no session yields a 200 with cached
  content instead of redirecting.
- A user lands on `/dashboard` without going through `/onboarding`
  despite the server's `onboardingCompleted=false`.
- The sign-up error message reveals whether an email already exists in
  a way that lets an attacker enumerate users.
