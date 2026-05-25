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
| f-auth-fuzz-001 | /internal/styleguide crashes the SSR runtime with "Cannot open database because the directory does not exist" when an authenticated session reaches `decideStyleguideAccess` | high | sign in as any Clerk user, navigate to http://localhost:4321/internal/styleguide — Astro overlay shows TypeError at apps/web/src/lib/db.ts:75; the resolved `TURSO_URL` is a relative path that mis-resolves against the Astro SSR worker CWD. Workaround: change `apps/web/.env`'s `TURSO_URL` to an absolute `file:` URL pointing at packages/shared/data/local.db. | wire `resolveDatabasePath()` (apps/web/src/lib/db.ts) to anchor relative `file:` URLs against the repo root (or to a stable monorepo anchor like `pnpm-workspace.yaml` parent) instead of `process.cwd()`. Contract test in apps/web/src/lib/db.test.ts that asserts the resolver accepts `file:../../packages/shared/data/local.db` and returns an absolute path the runtime can open from any CWD. |
| f-auth-fuzz-002 | Sign-in surfaces a user-enumeration oracle by advancing to a per-user "Enter your password" step only when the email exists | medium | visit http://localhost:4321/sign-in, enter `athlete@example.com` and click Continue: Clerk advances to the factor-one password page bearing the entered email and the heading "Enter your password". Entering an unknown email instead surfaces a generic "Couldn't find your account" response and stays on the email step. The differential UX tells an unauthenticated visitor whether an account exists for an email. (Note: this is a Clerk-instance configuration choice, not project code — the relevant lever is Clerk's "show generic error on sign-in" sign-in policy.) | toggle the Clerk dev/test/prod instance settings to surface a uniform generic error on email submission so the existence-disclosure differential disappears; add a contract test against the sign-in handler that asserts the response body for "known vs unknown email" is byte-identical (or differs only in fields that do not leak identity). |
| f-auth-fuzz-003 | GET `/sign-out` returns 405 Method Not Allowed; every QA plan that says "Visit /sign-out" cannot be walked through the address bar | low | curl http://localhost:4321/sign-out returns "Method Not Allowed"; the endpoint is POST-only by design (apps/web/src/pages/sign-out.ts header comment confirms 405 on GET). Plans tp-identity-signin-happy, tp-identity-signout, tp-identity-signup-happy-path, tp-identity-signup-coach, tp-identity-signup-org-admin, tp-identity-jit-provisioning, tp-identity-onboarding-gate, tp-identity-role-assignment, tp-design-system-styleguide-walkthrough, and every org-admin plan all instruct the operator to "navigate to /sign-out" for cleanup — this step is impossible via GET. | update the plan corpus to drive sign-out via the header sign-out control (rendered by `<UserButton/>` from `@clerk/astro`) or via a `<form method="POST" action="/sign-out">` shim; alternatively, add a small `/sign-out` GET handler that issues a 303 to a POST self-action so the documented behaviour matches the plan instructions. The contract test in `apps/web/src/pages/sign-out.test.ts` should be updated to match whichever shape is chosen. |
| f-auth-fuzz-004 | Plan corpus references `pnpm --filter @repo/shared run db:seed` and an "athlete / coach / org-admin / dev-admin" seed-fixture set that the codebase does not ship | high | every `tp-*` plan front-matter and Setup section requires running `pnpm --filter @repo/shared run db:seed` and references seeded fixtures like "the seeded athlete" / "the seeded org-admin" with onboardingCompleted=true / a fixture org / pre-existing teams. The shared package's package.json (`packages/shared/package.json`) declares only `lint`, `typecheck`, `test`, `build` scripts — there is no `db:seed` or `db:reset`. The on-disk seed at `packages/shared/src/db/seed.ts` seeds only two `legal_documents` rows (ToS + Privacy). The local DB contains exactly one users row (the operator's Clerk-provisioned account, manually promoted to dev_admin via `scripts/seed-dev-admin.mjs`); there are zero organizations and zero teams. As a result, every plan that requires a seeded fixture cannot be executed end-to-end against the running local stack. | land the deferred seed harness as a real Story under Epic #27 (or equivalent foundation Epic): a `packages/shared/scripts/seed-fixtures.mjs` that idempotently inserts the persona ↔ org ↔ team graph documented in `packages/shared/src/testing/auth.ts § PERSONA_FIXTURES`, plus a `db:seed` script in `packages/shared/package.json` that runs both `seedLegalDocuments` and `seedFixtures`. Until that lands, mark every plan with `status: blocked-on-seed` in the QA index so `/run-qa` short-circuits with a deterministic "missing fixture" message rather than attempting an end-to-end walk. |
| f-auth-fuzz-005 | `/admin/*` pages render as static shells with no auth gate, no RBAC, and no DB-backed data — the org-admin plans cannot exercise real CRUD because there is no persistence wired through the page | high | curl http://localhost:4321/admin/teams returns 200 with a static "Teams" page heading regardless of caller identity (no signed-in session, no role check). `grep -r 'getDb\|requireInternalUser\|productionRoleLookup' apps/web/src/pages/admin/` returns zero hits. The plans tp-org-admin-team-crud, tp-org-admin-invite-athlete, tp-org-admin-invite-coach, tp-org-admin-csv-import-happy, tp-org-admin-season-rollover, and tp-org-admin-reporting all assume signed-in org-admin RBAC + DB-backed lists, forms, and mutations — none of that surface exists. | wire the admin pages to the standing Clerk + DB seam (`requireInternalUser` middleware on the web side, `getDb()` for reads, hono API call-throughs for mutations) before the org-admin plans are runnable. Until then, mark the org-admin plan domain as `awaiting-feature` in `tests/qa-index.json`. |
