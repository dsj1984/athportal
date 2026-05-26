---
id: ec-identity-cross-tenant
type: charter
title: Cross-tenant probe — role-scoped surfaces against two seeded orgs
domain: identity
persona: org-admin
route_prefixes:
  - /admin
  - /dashboard
  - /onboarding
mission: >-
  Probe role-scoped surfaces for cross-tenant leakage using two seeded
  orgs. A user authenticated against tenant A must never read, list, or
  mutate a resource owned by tenant B; the probes target the routes
  whose ownership check is missing, stale, or trustingly client-side.
heuristics:
  - cross-tenant-probe
  - landmark-tour
time_box_minutes: 45
safety_constraints:
  environment: local
  mutation_surface:
    - "athlete_memberships table (a cross-tenant write attempt may successfully insert a row into the wrong org's membership set)"
    - "coach_assignments table (a cross-tenant rename or reassignment payload may land against an out-of-tenant coach record)"
  required_reset: "pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed"
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded (pnpm db:seed)"
  - "persona users bootstrapped in Clerk per docs/runbooks/clerk-persona-bootstrap.md"
  - "the seeded fixture declares TWO deterministic tenants (org-a and org-b) with disjoint membership; the exact ids are read from the seed-fixture export at packages/shared/src/seed/fixture.ts (or the project's equivalent) — DO NOT discover ids by probing the surface"
  - "tenant org-a has at least one seeded org-admin user whose credentials are known so the session is authenticated as org-a's admin"
  - "tenant org-b has at least one seeded resource per probed surface (a team, a coach, an athlete membership) whose id is read from the seed fixture and used verbatim in the probes"
  - "browser devtools open to the network panel for redirect / status inspection"
---

## Mission

Cross-tenant leakage is the failure mode that turns a healthy
single-tenant feature into a multi-tenant incident: a list page that
forgets its `WHERE org_id = ?` filter, a detail page that trusts the
path id without re-checking ownership, a mutation that accepts a
foreign-tenant id in its payload and writes against it. The mission of
this session is to walk the identity-adjacent role-scoped surfaces
(`/admin/*`, `/dashboard`, persona-specific landing surfaces) while
signed in as the **org-a** admin and confirm no `org-b` data appears,
no `org-b` resource can be read via direct URL, and no state-change
payload referencing an `org-b` id succeeds. The policy decisions live
in `packages/shared/src/rbac/policy.ts` and the JIT user resolution
runs through `apps/api/src/middleware/auth.ts`; this charter probes
the surface those modules are supposed to defend.

## Heuristics

- **cross-tenant-probe** (`tests/charters/_heuristics/cross-tenant-probe.md`)
  — drive the surface through the probe paths the heuristic describes:
  list pages must show only `org-a` rows, detail URLs whose path id
  belongs to `org-b` must deny with no `org-b` field rendered, state-
  change actions whose payload names an `org-b` id must deny, and
  redirect-on-deny must not echo the foreign id back in the URL or
  flash message. CRITICAL: every `org-b` id used in a probe is read
  verbatim from the seed-fixture export — never guessed, never
  discovered by enumerating the surface itself, per Tech Spec #782
  § Security §6.

- **landmark-tour** (`tests/charters/_heuristics/landmark-tour.md`) —
  before mutating, do a full read-only walk of the org-admin surface
  signed in as the `org-a` admin. Enumerate every authenticated
  destination the org-admin can reach (admin sub-pages, dashboard,
  profile, settings). For each landmark, confirm the rendered row set,
  the rendered counts, and the rendered names belong to `org-a`. The
  tour establishes a baseline so the subsequent direct-URL probes have
  a known-clean state to deviate from.

## Notes

Scratchpad. The session runner appends per-snapshot notes here.

## Findings

| id | title | severity | repro | suggested-promotion |
| --- | --- | --- | --- | --- |
