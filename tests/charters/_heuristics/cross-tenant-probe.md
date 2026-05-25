# cross-tenant-probe

Probe the surface for cross-tenant leakage: a user authenticated against
tenant A must never read, list, or mutate a resource owned by tenant B.
This is the RBAC contract; the policy engine itself is exercised by
contract tests, but UI-level probes find the routes whose ownership
check is missing or stale.

## When to apply

Apply to every `/admin/*` surface, every API route reachable from the
web app, and every page that lists or shows a resource by id. Always
required for charters that touch the org-admin surface. Pair with
`auth-fuzz` for the auth axis.

## How to apply

Seed two distinct orgs (call them `org-a` and `org-b`) via
`pnpm --filter @repo/shared run db:seed` with deterministic ids. Sign in
as the `org-admin` for `org-a`. The policy decisions are made in
`packages/shared/src/rbac/` (see `policy.ts`); the UI is the surface
to probe. For each list page (`/admin/org`, `/admin/teams`,
`/admin/import`, `/admin/reports`, `/admin/invitations`), confirm only
`org-a` rows appear. Then, with the same session, attempt to: (1) navigate
to a detail URL whose id belongs to `org-b` (e.g.
`/admin/teams/<orgB-team-id>`); (2) submit a state-change action whose
payload references a `org-b` id (a team rename, a roster mutation, a
CSV import that lists `org-b` athlete emails); (3) read a CSV export
whose query parameter names a `org-b` filter. Each attempt must produce
a deny outcome the user can see; a 404 that masks a 403 is acceptable as
long as no `org-b` data is rendered. Do NOT probe production user ids;
probe only the seeded fixture ids per Tech Spec #782 § Security §6.

## Signals of a finding

- A list page leaks one or more rows from the other tenant.
- A detail page renders any field from a resource the active session
  does not own.
- A state-change action succeeds against an out-of-tenant id (look for
  the row change in the other tenant's DB state after the action).
- A redirect-on-deny still echoes the foreign id back in the URL or
  flash message.
- An error message names a foreign resource (e.g. "team Lions not
  found") — confirming existence is a tenant leak.
