---
id: ec-identity-auth-fuzz
type: charter
title: Authentication-surface fuzz — credential stuffing, replay, and encoding bypass
domain: identity
persona: visitor
route_prefixes:
  - /sign-in
  - /sign-up
  - /sign-out
mission: >-
  Probe `/sign-in` and `/sign-up` for credential-stuffing, session-replay,
  and encoding-bypass paths that grant an unauthorised session, leak
  user existence, or persist past sign-out.
heuristics:
  - auth-fuzz
  - encoding-fuzz
  - boundary-values
time_box_minutes: 45
safety_constraints:
  environment: local
  mutation_surface:
    - "clerk-users table writes via attempted-but-failed sign-ups (the Clerk test instance accepts the attempt and may persist a partial user record even when the local users row is not created)"
    - "users table (any JIT-provisioned internal user row that lands when a fuzzed sign-up unexpectedly succeeds)"
  required_reset: "pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed"
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB freshly reset and reseeded via pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed so the users table contains only the seeded baseline"
  - "the seeded athlete fixture's email is known so the timing-oracle probes can compare existing vs non-existent email shapes"
  - "browser devtools open to the network and storage panels for cookie inspection"
---

## Mission

The `/sign-in` and `/sign-up` surfaces are the front door of the
authenticated experience. A single defect here is a security incident:
a credential-stuffing path that succeeds against a stale session, a
sign-out flow that leaves a cookie still authorised, an enumeration
oracle in the sign-up error response, or an encoding-fuzz that lets a
duplicate registration through against the same canonical email all
sit one step above the entire authenticated app. The mission of this
session is to find paths where the authentication surface accepts a
request it should reject, leaks information it should hide, or
persists a credential past the point the user (or the server) believed
it had been invalidated. Defects of this shape are far more dangerous
than a parse crash because they usually succeed silently and do not
trip any visible error path; the only signal is a session that
should not exist or a side channel that should not leak.

## Heuristics

- **auth-fuzz** (`tests/charters/_heuristics/auth-fuzz.md`) — drive the
  surface through the multi-session and replay paths the heuristic
  describes. Two-tab stale-form submission, post-sign-out cookie replay,
  email-exists timing comparison on `/sign-in`, sign-up error-message
  comparison for an already-registered email, and direct-navigation
  attempts to `/onboarding` and `/dashboard` with no session, with a
  not-yet-onboarded session, and with a tampered `onboardingCompleted`
  claim. The middleware path under probe is
  `apps/api/src/middleware/auth.ts` (`clerkAuth` + `requireInternalUser`).

- **encoding-fuzz** (`tests/charters/_heuristics/encoding-fuzz.md`) —
  submit `/sign-up` with an email that is canonically equivalent to a
  pre-registered address under different encodings: unicode-normalised
  vs unnormalised forms, mixed case (`Foo@Example.com` vs
  `foo@example.com`), trailing dots, Punycode for an internationalised
  domain, and zero-width unicode characters embedded in the local part.
  Confirm the canonicalisation that Clerk uses for uniqueness lines up
  with the canonicalisation the internal `users` table uses for
  uniqueness — a mismatch lets a duplicate account through that is
  invisible to the operator's "find user by email" view.

- **boundary-values** (`tests/charters/_heuristics/boundary-values.md`)
  — probe every input that carries a documented length or rate cap.
  Email at the spec's max length and one byte over, password at the
  minimum length and one byte under, verification code with a leading
  zero, a one-character-too-short code, and a code submitted just after
  the configured expiry. The hypothesis is that a server-side cap is
  enforced loosely (client-only) at one of these boundaries, letting a
  malformed credential through that the operator would assume was
  rejected.

## Notes

Scratchpad. The session runner appends per-snapshot notes here.

## Findings

| id | title | severity | repro | suggested-promotion |
| --- | --- | --- | --- | --- |
